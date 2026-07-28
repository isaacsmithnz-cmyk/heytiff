"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";
import { isReadinessKey, readReadiness, READINESS_KEYS } from "@/lib/workboard/visit-schedule";
import { ensureVisits, pruneAndRegenerate } from "@/lib/workboard/visit-ensure";
import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";

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

function refresh(agreementId?: string) {
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

const intervalOf = (v: unknown): number | null => {
  const n = typeof v === "number" ? Math.trunc(v) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 24 ? n : null;
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

async function visitIn(
  orgId: string,
  id: string
): Promise<{ id: string; agreement_id: string; readiness: unknown; status: string } | null> {
  const { data } = await supabaseAdmin
    .from("maintenance_visits")
    .select("id, agreement_id, readiness, status")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  return (data as { id: string; agreement_id: string; readiness: unknown; status: string } | null) ?? null;
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
