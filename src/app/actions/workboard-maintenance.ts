"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";
import { isReadinessKey, readReadiness, READINESS_KEYS } from "@/lib/workboard/visit-schedule";
import { ensureVisits, pruneAndRegenerate } from "@/lib/workboard/visit-ensure";
import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";
import { staffIdFor } from "@/lib/workboard/projects-query";
import { nextCategoryAccent, tagToneFor } from "@/lib/workboard/tags";

/* Maintenance mutations — same two tiers as projects, same reasons:

     MANAGE (agreements, cadence, equipment, visit status, job links) needs
     `workboard_manage`.
     TICKING readiness ("access confirmed", "parts ready") needs only
     `workboard` — confirming access is a phone call anyone on the board
     makes, and the whole point of the chips is that the person who did it
     ticks it.

   Cadence edits regenerate ONLY pristine future visits (the engine's rule);
   status paths never delete anything. */

export type MaintenanceResult = { ok: true; id?: string } | { ok: false; error: string };

const NOT_SIGNED_IN: MaintenanceResult = { ok: false, error: "Not signed in." };
const NO_VIEW: MaintenanceResult = { ok: false, error: "You don't have access to the Workboard." };
const NO_MANAGE: MaintenanceResult = {
  ok: false,
  error: "You don't have access to manage the Workboard.",
};
const GONE: MaintenanceResult = { ok: false, error: "That agreement is no longer here." };

type Ctx = { orgId: string; userId: string };

async function context(): Promise<Ctx | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;
  return { orgId, userId };
}

function refresh(agreementId?: string | null) {
  revalidatePath("/dashboard/workboard");
  revalidatePath("/dashboard/workboard/maintenance");
  if (agreementId) revalidatePath(`/dashboard/workboard/maintenance/${agreementId}`);
}

const trim = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (v: unknown): string | null => {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return null;
  return Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? null : v;
};

/* Whole months only, 1..24 — sub-monthly cadences were deliberately CUT
   (decision D3, 2026-08-01): HVAC maintenance reality is monthly-and-up,
   and interval_days arrives only when a real agreement needs it. */
const intervalOf = (v: unknown): number | null => {
  const n = typeof v === "number" ? Math.trunc(v) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 24 ? n : null;
};

/** How many technicians the service usually takes — capacity info for the
    crew chip ("1 of 2"), never the gate itself (one assigned tech ticks
    Crew). The design's select runs 1–6. */
const techsNeededOf = (v: unknown): number | null => {
  const n = typeof v === "number" ? Math.trunc(v) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 6 ? n : null;
};

/** Hours as spoken on a job: 0.5 to 24, half-steps respected by rounding to
    one decimal. */
const hoursOf = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 24) return null;
  return Math.round(n * 10) / 10;
};

async function agreementIn(orgId: string, id: string): Promise<{ id: string } | null> {
  const { data } = await supabaseAdmin
    .from("maintenance_agreements")
    .select("id")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  return (data as { id: string } | null) ?? null;
}

/** A visit belongs to an agreement OR a project (one parent, checked in the
    schema) — every shared action here works on both, so agreement_id is
    nullable and the agreement-only tails guard on it. */
async function visitIn(
  orgId: string,
  id: string
): Promise<{
  id: string;
  agreement_id: string | null;
  project_id: string | null;
  readiness: unknown;
  status: string;
} | null> {
  const { data } = await supabaseAdmin
    .from("maintenance_visits")
    .select("id, agreement_id, project_id, readiness, status")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  return (
    (data as {
      id: string;
      agreement_id: string | null;
      project_id: string | null;
      readiness: unknown;
      status: string;
    } | null) ?? null
  );
}

async function categoryIn(orgId: string, id: string): Promise<{ id: string } | null> {
  const { data } = await supabaseAdmin
    .from("agreement_categories")
    .select("id")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  return (data as { id: string } | null) ?? null;
}

/* ---------------- agreements (workboard_manage) ---------------- */

export type NewAgreement = {
  label: string;
  clientName: string;
  siteLabel?: string;
  siteAddress?: string;
  intervalMonths: number;
  anchorDate: string;
  contractEnd?: string;
  weInstalled?: boolean;
  accessNotes?: string;
  bringList?: string;
  siteRequirements?: string;
  /** L2's fix — collected AND rendered from now on. */
  billingContact?: string;
  techsNeeded?: number;
  hoursEstimate?: number;
  categoryId?: string | null;
  /** Provenance when born from a ServiceM8 job (D7) — the mirror stays
      read-only; this just remembers which client record seeded it. */
  clientRemoteId?: string;
};

export async function createAgreement(input: NewAgreement): Promise<MaintenanceResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const label = trim(input.label, 140);
  const clientName = trim(input.clientName, 160);
  const intervalMonths = intervalOf(input.intervalMonths);
  const anchorDate = isoDate(input.anchorDate);
  if (!label) return { ok: false, error: "An agreement needs a label." };
  if (!clientName) return { ok: false, error: "Say who the client is — typed is fine." };
  if (!intervalMonths) return { ok: false, error: "Pick how often the service runs." };
  if (!anchorDate) return { ok: false, error: "Pick the first service date." };
  if (input.techsNeeded !== undefined && techsNeededOf(input.techsNeeded) === null) {
    return { ok: false, error: "Technicians needed runs 1 to 6." };
  }
  if (input.hoursEstimate !== undefined && hoursOf(input.hoursEstimate) === null) {
    return { ok: false, error: "Estimated hours need to be a real number of hours." };
  }

  let categoryId: string | null = null;
  if (input.categoryId) {
    if (!(await categoryIn(ctx.orgId, input.categoryId))) {
      return { ok: false, error: "That category isn't in this workspace." };
    }
    categoryId = input.categoryId;
  }

  // A mirror id names a CHOICE; this decides whether it's a real one.
  let clientProvider: string | null = null;
  let clientRemoteId: string | null = null;
  if (input.clientRemoteId) {
    const { data: company } = await supabaseAdmin
      .from("sm8_companies")
      .select("uuid")
      .eq("org_id", ctx.orgId)
      .eq("uuid", input.clientRemoteId)
      .maybeSingle();
    if (company) {
      clientProvider = "servicem8";
      clientRemoteId = input.clientRemoteId;
    }
  }

  const { data, error } = await supabaseAdmin
    .from("maintenance_agreements")
    .insert({
      org_id: ctx.orgId,
      label,
      client_name: clientName,
      site_label: trim(input.siteLabel, 160),
      site_address: trim(input.siteAddress, 500),
      interval_months: intervalMonths,
      anchor_date: anchorDate,
      contract_end: isoDate(input.contractEnd),
      we_installed: input.weInstalled === true,
      access_notes: trim(input.accessNotes, 2000),
      bring_list: trim(input.bringList, 2000),
      site_requirements: trim(input.siteRequirements, 2000),
      billing_contact: trim(input.billingContact, 200),
      techs_needed: techsNeededOf(input.techsNeeded) ?? 1,
      hours_estimate: hoursOf(input.hoursEstimate),
      category_id: categoryId,
      client_provider: clientProvider,
      client_remote_id: clientRemoteId,
      created_by_user_id: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't create the agreement." };
  const id = (data as { id: string }).id;

  // The visits exist the moment the agreement does — the radar must never
  // wait for someone to happen to open a page.
  await ensureVisits(ctx.orgId, { agreementId: id });

  refresh(id);
  return { ok: true, id };
}

export type AgreementPatch = {
  label?: string;
  clientName?: string;
  siteLabel?: string | null;
  siteAddress?: string | null;
  weInstalled?: boolean;
  accessNotes?: string | null;
  bringList?: string | null;
  siteRequirements?: string | null;
  notes?: string | null;
  billingContact?: string | null;
  techsNeeded?: number;
  hoursEstimate?: number | null;
};

export async function updateAgreementMeta(
  agreementId: string,
  patch: AgreementPatch
): Promise<MaintenanceResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;
  if (!(await agreementIn(ctx.orgId, agreementId))) return GONE;

  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.label !== undefined) {
    const label = trim(patch.label, 140);
    if (!label) return { ok: false, error: "An agreement needs a label." };
    row.label = label;
  }
  if (patch.clientName !== undefined) {
    const clientName = trim(patch.clientName, 160);
    if (!clientName) return { ok: false, error: "Say who the client is." };
    row.client_name = clientName;
  }
  if (patch.siteLabel !== undefined) row.site_label = trim(patch.siteLabel, 160);
  if (patch.siteAddress !== undefined) row.site_address = trim(patch.siteAddress, 500);
  if (patch.weInstalled !== undefined) row.we_installed = patch.weInstalled === true;
  if (patch.accessNotes !== undefined) row.access_notes = trim(patch.accessNotes, 2000);
  if (patch.bringList !== undefined) row.bring_list = trim(patch.bringList, 2000);
  if (patch.siteRequirements !== undefined)
    row.site_requirements = trim(patch.siteRequirements, 2000);
  if (patch.notes !== undefined) row.notes = trim(patch.notes, 4000);
  if (patch.billingContact !== undefined) row.billing_contact = trim(patch.billingContact, 200);
  if (patch.techsNeeded !== undefined) {
    const n = techsNeededOf(patch.techsNeeded);
    if (n === null) return { ok: false, error: "Technicians needed runs 1 to 6." };
    row.techs_needed = n;
  }
  if (patch.hoursEstimate !== undefined) {
    if (patch.hoursEstimate === null) row.hours_estimate = null;
    else {
      const h = hoursOf(patch.hoursEstimate);
      if (h === null) return { ok: false, error: "Estimated hours need to be a real number of hours." };
      row.hours_estimate = h;
    }
  }

  const { error } = await supabaseAdmin
    .from("maintenance_agreements")
    .update(row)
    .eq("org_id", ctx.orgId)
    .eq("id", agreementId);
  if (error) return { ok: false, error: "Couldn't save the agreement." };
  refresh(agreementId);
  return { ok: true };
}

/** Cadence is its own save because it has a consequence the meta form
    doesn't: pristine future visits are redrawn to the new pattern. */
export async function updateAgreementSchedule(
  agreementId: string,
  input: { intervalMonths: number; anchorDate: string; contractEnd?: string | null }
): Promise<MaintenanceResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;
  if (!(await agreementIn(ctx.orgId, agreementId))) return GONE;

  const intervalMonths = intervalOf(input.intervalMonths);
  const anchorDate = isoDate(input.anchorDate);
  if (!intervalMonths) return { ok: false, error: "Pick how often the service runs." };
  if (!anchorDate) return { ok: false, error: "Pick the anchor date." };

  const { error } = await supabaseAdmin
    .from("maintenance_agreements")
    .update({
      interval_months: intervalMonths,
      anchor_date: anchorDate,
      contract_end: input.contractEnd === null ? null : isoDate(input.contractEnd),
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", ctx.orgId)
    .eq("id", agreementId);
  if (error) return { ok: false, error: "Couldn't save the cadence." };

  await pruneAndRegenerate(ctx.orgId, agreementId);
  refresh(agreementId);
  return { ok: true };
}

export async function setAgreementStatus(
  agreementId: string,
  status: string
): Promise<MaintenanceResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;
  if (!["active", "paused", "ended"].includes(status)) {
    return { ok: false, error: "That isn't a status this board knows." };
  }
  if (!(await agreementIn(ctx.orgId, agreementId))) return GONE;

  const { error } = await supabaseAdmin
    .from("maintenance_agreements")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("org_id", ctx.orgId)
    .eq("id", agreementId);
  if (error) return { ok: false, error: "Couldn't change the status." };

  // Coming back from a pause tops the horizon straight back up; pausing
  // deletes nothing — the rows just leave the radar.
  if (status === "active") await ensureVisits(ctx.orgId, { agreementId });

  refresh(agreementId);
  return { ok: true };
}

/* ---------------- equipment (workboard_manage) ---------------- */

export async function addAgreementEquipment(
  agreementId: string,
  input: { description: string; model?: string; serial?: string; location?: string; installProjectId?: string | null }
): Promise<MaintenanceResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;
  if (!(await agreementIn(ctx.orgId, agreementId))) return GONE;

  const description = trim(input.description, 200);
  if (!description) return { ok: false, error: "Say what the unit is." };

  let installProjectId: string | null = null;
  if (input.installProjectId) {
    const { data } = await supabaseAdmin
      .from("projects")
      .select("id")
      .eq("org_id", ctx.orgId)
      .eq("id", input.installProjectId)
      .maybeSingle();
    if (!data) return { ok: false, error: "That install project isn't in this workspace." };
    installProjectId = input.installProjectId;
  }

  const { error } = await supabaseAdmin.from("agreement_equipment").insert({
    org_id: ctx.orgId,
    agreement_id: agreementId,
    description,
    model: trim(input.model, 120),
    serial: trim(input.serial, 120),
    location: trim(input.location, 200),
    install_project_id: installProjectId,
  });
  if (error) return { ok: false, error: "Couldn't add the equipment." };
  refresh(agreementId);
  return { ok: true };
}

export async function removeAgreementEquipment(equipmentId: string): Promise<MaintenanceResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const { data } = await supabaseAdmin
    .from("agreement_equipment")
    .select("id, agreement_id")
    .eq("org_id", ctx.orgId)
    .eq("id", equipmentId)
    .maybeSingle();
  const row = data as { id: string; agreement_id: string } | null;
  if (!row) return GONE;

  await supabaseAdmin
    .from("agreement_equipment")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("id", equipmentId);
  refresh(row.agreement_id);
  return { ok: true };
}

/* ---------------- visits ---------------- */

/** Readiness is the TICK tier: whoever made the phone call ticks the chip.
    Junk keys die at the whitelist, and the stored object is rebuilt FROM the
    whitelist — a readiness jsonb can never accumulate stray keys. */
export async function setVisitReadiness(
  visitId: string,
  key: string,
  value: boolean
): Promise<MaintenanceResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard"))) return NO_VIEW;
  if (!isReadinessKey(key)) return { ok: false, error: "That isn't a readiness chip." };

  const visit = await visitIn(ctx.orgId, visitId);
  if (!visit) return { ok: false, error: "That visit is no longer here." };

  const next = readReadiness(visit.readiness);
  next[key] = value === true;
  const stored: Record<string, boolean> = {};
  for (const k of READINESS_KEYS) if (next[k]) stored[k] = true;

  const { error } = await supabaseAdmin
    .from("maintenance_visits")
    .update({ readiness: stored })
    .eq("org_id", ctx.orgId)
    .eq("id", visitId);
  if (error) return { ok: false, error: "Couldn't save the chip." };
  refresh(visit.agreement_id);
  return { ok: true };
}

export async function setVisitStatus(visitId: string, status: string): Promise<MaintenanceResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;
  if (!["upcoming", "booked", "done", "skipped"].includes(status)) {
    return { ok: false, error: "That isn't a visit status this board knows." };
  }

  const visit = await visitIn(ctx.orgId, visitId);
  if (!visit) return { ok: false, error: "That visit is no longer here." };

  const patch: Record<string, unknown> =
    status === "done"
      ? {
          status,
          completed_at: todayInZone(await getSm8Timezone(ctx.orgId)),
          completed_source: "manual",
        }
      : { status, completed_at: null, completed_source: null };

  const { error } = await supabaseAdmin
    .from("maintenance_visits")
    .update(patch)
    .eq("org_id", ctx.orgId)
    .eq("id", visitId);
  if (error) return { ok: false, error: "Couldn't move the visit." };
  refresh(visit.agreement_id);
  return { ok: true };
}

/** Attach the raised job. Typed number or a mirror pick — same contract as
    projects' attachJob, plus the booking cache: the job's next scheduled
    block becomes the visit's booked time, and the visit moves to 'booked'. */
export async function linkVisitJob(
  visitId: string,
  input: { jobNumber?: string; remoteId?: string }
): Promise<MaintenanceResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const visit = await visitIn(ctx.orgId, visitId);
  if (!visit) return { ok: false, error: "That visit is no longer here." };

  let jobNumber: string | null;
  let provider: string | null = null;
  let remoteId: string | null = null;
  let bookedStart: string | null = null;

  if (input.remoteId) {
    const { data } = await supabaseAdmin
      .from("sm8_jobs")
      .select("uuid, generated_job_id")
      .eq("org_id", ctx.orgId)
      .eq("uuid", input.remoteId)
      .maybeSingle();
    const job = data as { uuid: string; generated_job_id: string | null } | null;
    if (!job) return { ok: false, error: "That ServiceM8 job isn't in this workspace's mirror." };
    provider = "servicem8";
    remoteId = job.uuid;
    jobNumber = job.generated_job_id ?? trim(input.jobNumber, 40) ?? "—";

    const today = todayInZone(await getSm8Timezone(ctx.orgId));
    const { data: act } = await supabaseAdmin
      .from("sm8_job_activities")
      .select("start_date")
      .eq("org_id", ctx.orgId)
      .eq("job_uuid", job.uuid)
      .eq("active", 1)
      .gte("start_date", `${today} 00:00:00`)
      .order("start_date", { ascending: true })
      .limit(1)
      .maybeSingle();
    bookedStart = (act as { start_date: string } | null)?.start_date ?? null;
  } else {
    jobNumber = trim(input.jobNumber, 40);
    if (!jobNumber) return { ok: false, error: "Type the job number to link." };
  }

  const { error } = await supabaseAdmin
    .from("maintenance_visits")
    .update({
      job_number: jobNumber,
      provider,
      remote_id: remoteId,
      booked_start_cached: bookedStart,
      ...(visit.status === "upcoming" ? { status: "booked" } : {}),
    })
    .eq("org_id", ctx.orgId)
    .eq("id", visitId);
  if (error) return { ok: false, error: "Couldn't link the job." };
  refresh(visit.agreement_id);
  return { ok: true };
}

export async function unlinkVisitJob(visitId: string): Promise<MaintenanceResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const visit = await visitIn(ctx.orgId, visitId);
  if (!visit) return { ok: false, error: "That visit is no longer here." };

  const { error } = await supabaseAdmin
    .from("maintenance_visits")
    .update({ job_number: null, provider: null, remote_id: null, booked_start_cached: null })
    .eq("org_id", ctx.orgId)
    .eq("id", visitId);
  if (error) return { ok: false, error: "Couldn't unlink the job." };
  refresh(visit.agreement_id);
  return { ok: true };
}

export async function setVisitNotes(visitId: string, text: string): Promise<MaintenanceResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const visit = await visitIn(ctx.orgId, visitId);
  if (!visit) return { ok: false, error: "That visit is no longer here." };

  const { error } = await supabaseAdmin
    .from("maintenance_visits")
    .update({ notes: trim(text, 2000) })
    .eq("org_id", ctx.orgId)
    .eq("id", visitId);
  if (error) return { ok: false, error: "Couldn't save the note." };
  refresh(visit.agreement_id);
  return { ok: true };
}

/* ---------------- close-out (K1 — the loop finally closes) ---------------- */

/** The completion path the design never built: date it ran, the hours it
    ACTUALLY took (the Completed screen shows actuals, never the booking
    estimate — L3), and the technician's note. Generation then tops the
    horizon back up, so the next visit exists the moment this one is history.
    Manual completion is the standalone guarantee; a linked ServiceM8 job
    completing feeds the same fields via the mirror tail. */
export async function completeVisit(
  visitId: string,
  input: { ranOn?: string; actualHours?: number | null; note?: string } = {}
): Promise<MaintenanceResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const visit = await visitIn(ctx.orgId, visitId);
  if (!visit) return { ok: false, error: "That visit is no longer here." };
  if (visit.status !== "upcoming" && visit.status !== "booked") {
    return { ok: false, error: "That visit is already closed." };
  }

  const today = todayInZone(await getSm8Timezone(ctx.orgId));
  const ranOn = input.ranOn === undefined ? today : isoDate(input.ranOn);
  if (!ranOn) return { ok: false, error: "Pick the day the visit ran." };
  if (ranOn > today) return { ok: false, error: "A visit can't be completed in the future." };

  let actualHours: number | null = null;
  if (input.actualHours !== undefined && input.actualHours !== null) {
    actualHours = hoursOf(input.actualHours);
    if (actualHours === null) {
      return { ok: false, error: "Hours on site need to be a real number of hours." };
    }
  }

  const { error } = await supabaseAdmin
    .from("maintenance_visits")
    .update({
      status: "done",
      completed_at: ranOn,
      completed_source: "manual",
      actual_hours: actualHours,
      completion_note: trim(input.note, 2000),
    })
    .eq("org_id", ctx.orgId)
    .eq("id", visitId)
    // Same guard as the mirror tail: if someone else closed it first, this
    // write must not overrule them.
    .in("status", ["upcoming", "booked"]);
  if (error) return { ok: false, error: "Couldn't complete the visit." };

  // Generation is an agreement thing — project trips are hand-made, so
  // closing one must not top any horizon up.
  if (visit.agreement_id) await ensureVisits(ctx.orgId, { agreementId: visit.agreement_id });
  refresh(visit.agreement_id);
  return { ok: true };
}

/** The Completed screen's whole job is invoicing (L3) — one flag, one
    owner (L7). Only a visit that actually RAN can be invoiced. */
export async function setVisitInvoiced(
  visitId: string,
  invoiced: boolean
): Promise<MaintenanceResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const visit = await visitIn(ctx.orgId, visitId);
  if (!visit) return { ok: false, error: "That visit is no longer here." };
  if (visit.status !== "done") {
    return { ok: false, error: "Only a completed visit can be invoiced." };
  }

  const { error } = await supabaseAdmin
    .from("maintenance_visits")
    .update({ invoiced_at: invoiced ? new Date().toISOString() : null })
    .eq("org_id", ctx.orgId)
    .eq("id", visitId);
  if (error) return { ok: false, error: "Couldn't update the invoice flag." };
  refresh(visit.agreement_id);
  return { ok: true };
}

/* ---------------- placement (time_confirmed's successor, D1) ---------------- */

/** Put the visit on a day. Placement IS the time confirmation — there is no
    separate tick. Weekends are allowed on purpose (B9's deliberate-booking
    half); the UI offers the Monday roll, the server records the choice. */
export async function placeVisit(visitId: string, dateISO: string): Promise<MaintenanceResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const bookedDate = isoDate(dateISO);
  if (!bookedDate) return { ok: false, error: "Pick a real day." };

  const visit = await visitIn(ctx.orgId, visitId);
  if (!visit) return { ok: false, error: "That visit is no longer here." };
  if (visit.status === "done" || visit.status === "skipped") {
    return { ok: false, error: "That visit is already closed." };
  }

  const { error } = await supabaseAdmin
    .from("maintenance_visits")
    .update({
      booked_date: bookedDate,
      ...(visit.status === "upcoming" ? { status: "booked" } : {}),
    })
    .eq("org_id", ctx.orgId)
    .eq("id", visitId);
  if (error) return { ok: false, error: "Couldn't place the visit." };
  refresh(visit.agreement_id);
  return { ok: true };
}

/** Take it back off the day. A visit that only had a placement returns to
    'upcoming'; one still linked to a job keeps its 'booked' status — the
    job's diary is its own truth. */
export async function clearVisitPlacement(visitId: string): Promise<MaintenanceResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const { data } = await supabaseAdmin
    .from("maintenance_visits")
    .select("id, agreement_id, status, remote_id, job_number")
    .eq("org_id", ctx.orgId)
    .eq("id", visitId)
    .maybeSingle();
  const visit = data as {
    id: string;
    agreement_id: string | null;
    status: string;
    remote_id: string | null;
    job_number: string | null;
  } | null;
  if (!visit) return { ok: false, error: "That visit is no longer here." };
  if (visit.status === "done" || visit.status === "skipped") {
    return { ok: false, error: "That visit is already closed." };
  }

  const stillLinked = !!(visit.remote_id || visit.job_number);
  const { error } = await supabaseAdmin
    .from("maintenance_visits")
    .update({
      booked_date: null,
      ...(visit.status === "booked" && !stillLinked ? { status: "upcoming" } : {}),
    })
    .eq("org_id", ctx.orgId)
    .eq("id", visitId);
  if (error) return { ok: false, error: "Couldn't clear the placement." };
  refresh(visit.agreement_id);
  return { ok: true };
}

/* ---------------- technicians (D2 — the Crew gate's substance) ---------------- */

/** Assign a technician. NEVER called by a gate tick (A12: the prototype's
    Crew tick silently invented an assignment) — Crew derives from these rows
    and is satisfied by one assigned tech. */
export async function assignVisitTech(
  visitId: string,
  staffProfileId: string
): Promise<MaintenanceResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const visit = await visitIn(ctx.orgId, visitId);
  if (!visit) return { ok: false, error: "That visit is no longer here." };
  if (visit.status === "done" || visit.status === "skipped") {
    return { ok: false, error: "That visit is already closed." };
  }

  const { data: staff } = await supabaseAdmin
    .from("staff_profiles")
    .select("id")
    .eq("org_id", ctx.orgId)
    .eq("id", staffProfileId)
    .maybeSingle();
  if (!staff) return { ok: false, error: "That person isn't on this workspace's team." };

  const { error } = await supabaseAdmin.from("maintenance_visit_techs").upsert(
    { org_id: ctx.orgId, visit_id: visitId, staff_profile_id: staffProfileId },
    { onConflict: "visit_id,staff_profile_id", ignoreDuplicates: true }
  );
  if (error) return { ok: false, error: "Couldn't assign the technician." };
  refresh(visit.agreement_id);
  return { ok: true };
}

export async function unassignVisitTech(
  visitId: string,
  staffProfileId: string
): Promise<MaintenanceResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const visit = await visitIn(ctx.orgId, visitId);
  if (!visit) return { ok: false, error: "That visit is no longer here." };

  await supabaseAdmin
    .from("maintenance_visit_techs")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("visit_id", visitId)
    .eq("staff_profile_id", staffProfileId);
  refresh(visit.agreement_id);
  return { ok: true };
}

/* ---------------- packing list (D5 — owned by the agreement, ticked per visit) ---------------- */

export async function addPackingItem(
  agreementId: string,
  label: string
): Promise<MaintenanceResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;
  if (!(await agreementIn(ctx.orgId, agreementId))) return GONE;

  const clean = trim(label, 200);
  if (!clean) return { ok: false, error: "Say what needs to go on the van." };

  const { data, error } = await supabaseAdmin
    .from("agreement_packing_items")
    .insert({ org_id: ctx.orgId, agreement_id: agreementId, label: clean })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't add it to the packing list." };
  refresh(agreementId);
  return { ok: true, id: (data as { id: string }).id };
}

export async function removePackingItem(itemId: string): Promise<MaintenanceResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const { data } = await supabaseAdmin
    .from("agreement_packing_items")
    .select("id, agreement_id")
    .eq("org_id", ctx.orgId)
    .eq("id", itemId)
    .maybeSingle();
  const row = data as { id: string; agreement_id: string } | null;
  if (!row) return GONE;

  await supabaseAdmin
    .from("agreement_packing_items")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("id", itemId);
  refresh(row.agreement_id);
  return { ok: true };
}

/** The van-loading tick — the TICK tier, like readiness: whoever packed the
    ladder ticks the ladder. Presence of the row IS the packed state. */
export async function setVisitPacked(
  visitId: string,
  itemId: string,
  packed: boolean
): Promise<MaintenanceResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard"))) return NO_VIEW;

  const visit = await visitIn(ctx.orgId, visitId);
  if (!visit) return { ok: false, error: "That visit is no longer here." };

  const { data: item } = await supabaseAdmin
    .from("agreement_packing_items")
    .select("id, agreement_id")
    .eq("org_id", ctx.orgId)
    .eq("id", itemId)
    .maybeSingle();
  const itemRow = item as { id: string; agreement_id: string } | null;
  if (!itemRow || itemRow.agreement_id !== visit.agreement_id) {
    return { ok: false, error: "That item isn't on this agreement's packing list." };
  }

  if (packed) {
    const staffId = await staffIdFor(ctx.orgId, ctx.userId);
    const { error } = await supabaseAdmin.from("maintenance_visit_packed").upsert(
      { org_id: ctx.orgId, visit_id: visitId, item_id: itemId, packed_by: staffId },
      { onConflict: "visit_id,item_id", ignoreDuplicates: true }
    );
    if (error) return { ok: false, error: "Couldn't tick it off." };
  } else {
    await supabaseAdmin
      .from("maintenance_visit_packed")
      .delete()
      .eq("org_id", ctx.orgId)
      .eq("visit_id", visitId)
      .eq("item_id", itemId);
  }
  refresh(visit.agreement_id);
  return { ok: true };
}

/* ---------------- categories + tags (D10) ---------------- */

/** A category is born with its accent and keeps it (B2's rule applied to
    categories). Creating one NEVER moves agreements into it — B17's silent
    re-home is not a thing this board does. */
export async function createCategory(name: string): Promise<MaintenanceResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const clean = trim(name, 80);
  if (!clean) return { ok: false, error: "A category needs a name." };

  const { count } = await supabaseAdmin
    .from("agreement_categories")
    .select("id", { count: "exact", head: true })
    .eq("org_id", ctx.orgId);

  const { data, error } = await supabaseAdmin
    .from("agreement_categories")
    .insert({ org_id: ctx.orgId, name: clean, accent: nextCategoryAccent(count ?? 0) })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, error: "Couldn't create the category — is the name already taken?" };
  }
  refresh();
  return { ok: true, id: (data as { id: string }).id };
}

export async function setAgreementCategory(
  agreementId: string,
  categoryId: string | null
): Promise<MaintenanceResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;
  if (!(await agreementIn(ctx.orgId, agreementId))) return GONE;

  if (categoryId && !(await categoryIn(ctx.orgId, categoryId))) {
    return { ok: false, error: "That category isn't in this workspace." };
  }

  const { error } = await supabaseAdmin
    .from("maintenance_agreements")
    .update({ category_id: categoryId, updated_at: new Date().toISOString() })
    .eq("org_id", ctx.orgId)
    .eq("id", agreementId);
  if (error) return { ok: false, error: "Couldn't move the agreement." };
  refresh(agreementId);
  return { ok: true };
}

/** A tag's colour is decided here, once, and stored — nothing downstream
    ever recomputes it, so adding tag #7 can't repaint tags #1–6 (B2). */
export async function createTag(name: string): Promise<MaintenanceResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const clean = trim(name, 60);
  if (!clean) return { ok: false, error: "A tag needs a name." };

  const { data, error } = await supabaseAdmin
    .from("agreement_tags")
    .insert({ org_id: ctx.orgId, name: clean, color: tagToneFor(clean) })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, error: "Couldn't create the tag — is the name already taken?" };
  }
  refresh();
  return { ok: true, id: (data as { id: string }).id };
}

export async function tagAgreement(agreementId: string, tagId: string): Promise<MaintenanceResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;
  if (!(await agreementIn(ctx.orgId, agreementId))) return GONE;

  const { data: tag } = await supabaseAdmin
    .from("agreement_tags")
    .select("id")
    .eq("org_id", ctx.orgId)
    .eq("id", tagId)
    .maybeSingle();
  if (!tag) return { ok: false, error: "That tag isn't in this workspace." };

  const { error } = await supabaseAdmin.from("agreement_tag_links").upsert(
    { org_id: ctx.orgId, agreement_id: agreementId, tag_id: tagId },
    { onConflict: "agreement_id,tag_id", ignoreDuplicates: true }
  );
  if (error) return { ok: false, error: "Couldn't add the tag." };
  refresh(agreementId);
  return { ok: true };
}

export async function untagAgreement(
  agreementId: string,
  tagId: string
): Promise<MaintenanceResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;
  if (!(await agreementIn(ctx.orgId, agreementId))) return GONE;

  await supabaseAdmin
    .from("agreement_tag_links")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("agreement_id", agreementId)
    .eq("tag_id", tagId);
  refresh(agreementId);
  return { ok: true };
}
