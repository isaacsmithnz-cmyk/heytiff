"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";
import { DEFAULT_CHECKLIST, isProjectStage, isProjectStatus } from "@/lib/workboard/stages";
import { searchMirrorJobs, staffIdFor, type JobSearchHit } from "@/lib/workboard/projects-query";
import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";
import { parseSm8AmountToCents } from "@/lib/workboard/job-money";
import {
  readMirrorJobDetail,
  searchAllMirrorJobs,
  type MirrorJobDetail,
} from "@/lib/workboard/all-jobs-query";
import type { AllJobsMirrorJob } from "@/lib/workboard/all-jobs";
import {
  EMPTY_SCHEDULE,
  loadScheduleDay,
  type SchedulePayload,
} from "@/lib/workboard/schedule-query";

/* Workboard mutations. Everything the UI decided is re-decided here — a
   Server Function is reachable by direct POST.

   Two tiers, both CAPABILITIES (house doctrine — never a role check):

     MANAGE (create/edit/archive projects, attach jobs, shape checklists &
             equipment) needs `workboard_manage` — admin default, grantable
             to a senior tech through the overrides grid.
     TICKING (checklist done, manual-left) needs only `workboard` — the
             person ON SITE is the one who knows, and making them radio an
             admin to record "manuals left" would recreate the exact gap
             this board exists to close. Every tick records who.

   No id from a client is trusted: every row is re-resolved inside the
   caller's org before it's touched. */

export type WorkboardResult = { ok: true; id?: string } | { ok: false; error: string };

const NOT_SIGNED_IN: WorkboardResult = { ok: false, error: "Not signed in." };
const NO_VIEW: WorkboardResult = { ok: false, error: "You don't have access to the Workboard." };
const NO_MANAGE: WorkboardResult = {
  ok: false,
  error: "You don't have access to manage the Workboard.",
};
const GONE: WorkboardResult = { ok: false, error: "That project is no longer here." };

type Ctx = { orgId: string; userId: string };

async function context(): Promise<Ctx | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;
  return { orgId, userId };
}

function refresh(projectId?: string) {
  revalidatePath("/dashboard/workboard");
  revalidatePath("/dashboard/workboard/projects");
  if (projectId) revalidatePath(`/dashboard/workboard/projects/${projectId}`);
}

async function projectIn(orgId: string, projectId: string): Promise<{ id: string } | null> {
  const { data } = await supabaseAdmin
    .from("projects")
    .select("id")
    .eq("org_id", orgId)
    .eq("id", projectId)
    .maybeSingle();
  return (data as { id: string } | null) ?? null;
}

const trim = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};

/* ---------------- projects (workboard_manage) ---------------- */

export type NewProject = {
  name: string;
  clientName?: string;
  siteLabel?: string;
  siteAddress?: string;
  notes?: string;
};

export async function createProject(input: NewProject): Promise<WorkboardResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const name = trim(input.name, 120);
  if (!name) return { ok: false, error: "A project needs a name." };

  const { data, error } = await supabaseAdmin
    .from("projects")
    .insert({
      org_id: ctx.orgId,
      name,
      client_name: trim(input.clientName, 160),
      site_label: trim(input.siteLabel, 160),
      site_address: trim(input.siteAddress, 500),
      notes: trim(input.notes, 4000),
      created_by_user_id: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't create the project." };
  const projectId = (data as { id: string }).id;

  /* Seed the default checklist — a copy, not a reference: this project now
     owns its rows and edits them freely. */
  await supabaseAdmin.from("project_checklist_items").insert(
    DEFAULT_CHECKLIST.map((item, i) => ({
      org_id: ctx.orgId,
      project_id: projectId,
      section: item.section,
      label: item.label,
      sort: i,
    }))
  );

  refresh(projectId);
  return { ok: true, id: projectId };
}

export type ProjectPatch = {
  name?: string;
  clientName?: string | null;
  siteLabel?: string | null;
  siteAddress?: string | null;
  notes?: string | null;
};

export async function updateProjectMeta(
  projectId: string,
  patch: ProjectPatch
): Promise<WorkboardResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;
  if (!(await projectIn(ctx.orgId, projectId))) return GONE;

  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) {
    const name = trim(patch.name, 120);
    if (!name) return { ok: false, error: "A project needs a name." };
    row.name = name;
  }
  if (patch.clientName !== undefined) row.client_name = trim(patch.clientName, 160);
  if (patch.siteLabel !== undefined) row.site_label = trim(patch.siteLabel, 160);
  if (patch.siteAddress !== undefined) row.site_address = trim(patch.siteAddress, 500);
  if (patch.notes !== undefined) row.notes = trim(patch.notes, 4000);

  const { error } = await supabaseAdmin
    .from("projects")
    .update(row)
    .eq("org_id", ctx.orgId)
    .eq("id", projectId);
  if (error) return { ok: false, error: "Couldn't save the project." };
  refresh(projectId);
  return { ok: true };
}

export async function setProjectStage(projectId: string, stage: string): Promise<WorkboardResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;
  if (!isProjectStage(stage)) return { ok: false, error: "That isn't a stage this board knows." };
  if (!(await projectIn(ctx.orgId, projectId))) return GONE;

  const { error } = await supabaseAdmin
    .from("projects")
    .update({ stage, updated_at: new Date().toISOString() })
    .eq("org_id", ctx.orgId)
    .eq("id", projectId);
  if (error) return { ok: false, error: "Couldn't move the stage." };
  refresh(projectId);
  return { ok: true };
}

export async function setProjectStatus(
  projectId: string,
  status: string
): Promise<WorkboardResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;
  if (!isProjectStatus(status)) return { ok: false, error: "That isn't a status this board knows." };
  // Blocked is not a status you slip into — it demands a reason and who it's
  // waiting on, which is setProjectBlocked's whole job (P4).
  if (status === "blocked") {
    return { ok: false, error: "Blocking needs a reason — use the block control." };
  }
  if (!(await projectIn(ctx.orgId, projectId))) return GONE;

  const { error } = await supabaseAdmin
    .from("projects")
    .update({
      status,
      // Leaving blocked by any door clears the block's story with it.
      blocked_reason: null,
      blocked_on: null,
      blocked_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", ctx.orgId)
    .eq("id", projectId);
  if (error) return { ok: false, error: "Couldn't change the status." };
  refresh(projectId);
  return { ok: true };
}

/** Link (or clear) a Design Studio design. The design id names a CHOICE —
    it's re-resolved inside the org, so a foreign id simply doesn't match. */
export async function setProjectDesign(
  projectId: string,
  designId: string | null
): Promise<WorkboardResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;
  if (!(await projectIn(ctx.orgId, projectId))) return GONE;

  if (designId !== null) {
    const { data } = await supabaseAdmin
      .from("studio_designs")
      .select("id")
      .eq("org_id", ctx.orgId)
      .eq("id", designId)
      .maybeSingle();
    if (!data) return { ok: false, error: "That design isn't in this workspace." };
  }

  const { error } = await supabaseAdmin
    .from("projects")
    .update({ design_id: designId, updated_at: new Date().toISOString() })
    .eq("org_id", ctx.orgId)
    .eq("id", projectId);
  if (error) return { ok: false, error: "Couldn't link the design." };
  refresh(projectId);
  return { ok: true };
}

/** The design picker's options — names only, under the manage gate. */
export async function listDesignOptions(): Promise<{ id: string; name: string }[]> {
  const ctx = await context();
  if (!ctx || !(await can("workboard_manage"))) return [];
  const { data } = await supabaseAdmin
    .from("studio_designs")
    .select("id, name")
    .eq("org_id", ctx.orgId)
    .order("updated_at", { ascending: false })
    .limit(50);
  return ((data ?? []) as { id: string; name: string | null }[]).map((d) => ({
    id: d.id,
    name: d.name?.trim() || "Untitled design",
  }));
}

/* ---------------- jobs on a project (workboard_manage) ---------------- */

export type AttachJobInput = {
  /** Typed number for manual mode; ignored when a mirror job is chosen. */
  jobNumber?: string;
  /** A sm8_jobs uuid from the search picker. */
  remoteId?: string;
  role?: string;
};

export async function attachJob(
  projectId: string,
  input: AttachJobInput
): Promise<WorkboardResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;
  if (!(await projectIn(ctx.orgId, projectId))) return GONE;

  const role = ["quote", "install", "variation", "service", "other"].includes(input.role ?? "")
    ? (input.role as string)
    : "other";

  let jobNumber: string | null;
  let provider: string | null = null;
  let remoteId: string | null = null;

  if (input.remoteId) {
    // The picker chose a mirror job: the id names a choice, the mirror row
    // inside THIS org is the target — and its number beats anything typed.
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
  } else {
    jobNumber = trim(input.jobNumber, 40);
    if (!jobNumber) return { ok: false, error: "Type the job number to attach." };
  }

  const { error } = await supabaseAdmin.from("project_jobs").insert({
    org_id: ctx.orgId,
    project_id: projectId,
    job_number: jobNumber,
    provider,
    remote_id: remoteId,
    role,
  });
  if (error) {
    // 23505 — one of the two per-project uniques; either way the message is
    // the same human fact.
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, error: "That job is already on this project." };
    }
    return { ok: false, error: "Couldn't attach the job." };
  }
  refresh(projectId);
  return { ok: true };
}

export async function detachJob(projectJobId: string): Promise<WorkboardResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const { data } = await supabaseAdmin
    .from("project_jobs")
    .select("id, project_id")
    .eq("org_id", ctx.orgId)
    .eq("id", projectJobId)
    .maybeSingle();
  const row = data as { id: string; project_id: string } | null;
  if (!row) return GONE;

  await supabaseAdmin.from("project_jobs").delete().eq("org_id", ctx.orgId).eq("id", projectJobId);
  refresh(row.project_id);
  return { ok: true };
}

/* The attach picker's search. This was gated MANAGE on the grounds that the
   results are the client book rather than just numbers — a good argument
   while the book was reachable ONLY through this box. The All jobs side now
   shows that same book to anyone with `workboard`, which is what ServiceM8
   itself does and what Tiff's search_jobs tool already did. Keeping the
   stricter gate here would only mean the picker finds less than the list
   beside it, so the two now agree. */
export async function searchJobs(query: string): Promise<JobSearchHit[]> {
  const ctx = await context();
  if (!ctx || !(await can("workboard"))) return [];
  return searchMirrorJobs(ctx.orgId, query);
}

/* ---------------- All jobs: reading the book, and promoting out of it ------ */

/** The job sheet's own read. The uuid is a CHOICE the client handed in, so
    the loader re-resolves it inside this org's mirror. Money rides only for a
    reader who holds `workboard_money`. */
export async function readMirrorJob(remoteId: string): Promise<MirrorJobDetail | null> {
  const ctx = await context();
  if (!ctx || !(await can("workboard"))) return null;
  const id = trim(remoteId, 80);
  if (!id) return null;
  const today = todayInZone(await getSm8Timezone(ctx.orgId));
  /* Designs ride the same rule money does: the reader's own capability
     decides, asked here and handed down, so the loader never reads what this
     person may not see. `studio` is a staff default and revocable — someone
     without it has no studio to open, and a list of doors they can't use is
     not a kindness. */
  const [includeMoney, includeDesigns] = await Promise.all([
    can("workboard_money"),
    can("studio"),
  ]);
  return readMirrorJobDetail(ctx.orgId, id, today, { includeMoney, includeDesigns });
}

/** All jobs' own search — reaches the WHOLE mirror, which is how a job that
    finished last year is found at all. */
export async function searchAllJobs(query: string): Promise<AllJobsMirrorJob[]> {
  const ctx = await context();
  if (!ctx || !(await can("workboard"))) return [];
  const today = todayInZone(await getSm8Timezone(ctx.orgId));
  return searchAllMirrorJobs(ctx.orgId, query, today, {
    includeMoney: await can("workboard_money"),
  });
}

/** One day of the diary for the Schedule tab. The day is a CHOICE handed in
    by a client, so it is validated to a bare ISO date here — anything else
    would ride into a lexicographic string comparison unexamined. Returns the
    empty payload rather than throwing for a reader without the board. */
export async function scheduleDay(dayISO: string): Promise<SchedulePayload> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayISO)) return EMPTY_SCHEDULE;
  const ctx = await context();
  if (!ctx || !(await can("workboard"))) return EMPTY_SCHEDULE;
  return loadScheduleDay(ctx.orgId, dayISO);
}

export type ProjectFromJobInput = {
  name?: string;
  clientName?: string;
  siteLabel?: string;
  siteAddress?: string;
};

/** Promote an untracked ServiceM8 job into a project: create it, link the job
    that started it, and — when that job is a quote carrying a total — seed the
    budget from it.

    THE BUDGET PREFILL IS WHY THIS ISN'T JUST createProject + attachJob. The
    projects design always had `budget_source` ready for "the SM8 quote" and no
    data to fill it; a quote's own total IS that number, and the moment it's
    worth taking is the moment the project is born from that quote. It stays
    editable, and its provenance is stored so the money card can say where it
    came from. A job with no readable total simply seeds nothing. */
export async function createProjectFromJob(
  remoteId: string,
  input: ProjectFromJobInput = {}
): Promise<WorkboardResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const id = trim(remoteId, 80);
  if (!id) return { ok: false, error: "That job is no longer here." };

  const { data } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid, generated_job_id, status, job_description, job_address, geo_city, total_invoice_amount")
    .eq("org_id", ctx.orgId)
    .eq("uuid", id)
    .eq("active", 1)
    .maybeSingle();
  const job = data as {
    uuid: string;
    generated_job_id: string | null;
    status: string | null;
    job_description: string | null;
    job_address: string | null;
    geo_city: string | null;
    total_invoice_amount: string | null;
  } | null;
  if (!job) return { ok: false, error: "That ServiceM8 job isn't in this workspace's mirror." };

  /* A name is required by createProject, and the person confirms it in the
     sheet — but a direct POST must not be able to make a nameless project, so
     the fallbacks are here too. */
  const name =
    trim(input.name, 120) ??
    trim(input.clientName, 120) ??
    (job.generated_job_id ? `Job #${job.generated_job_id}` : null) ??
    "New project";

  const created = await createProject({
    name,
    clientName: input.clientName,
    siteLabel: input.siteLabel ?? job.geo_city ?? undefined,
    siteAddress: input.siteAddress ?? job.job_address ?? undefined,
  });
  if (!created.ok || !created.id) return created;
  const projectId = created.id;

  await supabaseAdmin.from("project_jobs").insert({
    org_id: ctx.orgId,
    project_id: projectId,
    job_number: job.generated_job_id ?? "—",
    provider: "servicem8",
    remote_id: job.uuid,
    // What the job WAS is what it is to this project: a quote becomes the
    // quote, anything else is the install it turned into.
    role: job.status === "Quote" ? "quote" : "install",
  });

  const quoted = parseSm8AmountToCents(job.total_invoice_amount);
  if (job.status === "Quote" && quoted !== null && quoted > 0) {
    await supabaseAdmin
      .from("projects")
      .update({ budget_cents: quoted, budget_source: "sm8_quote" })
      .eq("org_id", ctx.orgId)
      .eq("id", projectId);
  }

  refresh(projectId);
  return { ok: true, id: projectId };
}

/* ---------------- checklist ---------------- */

export async function addChecklistItem(
  projectId: string,
  section: string,
  label: string
): Promise<WorkboardResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;
  if (!(await projectIn(ctx.orgId, projectId))) return GONE;

  const sec = trim(section, 80);
  const lab = trim(label, 200);
  if (!sec || !lab) return { ok: false, error: "A checklist item needs a section and a label." };

  const { data } = await supabaseAdmin
    .from("project_checklist_items")
    .select("sort")
    .eq("org_id", ctx.orgId)
    .eq("project_id", projectId)
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = ((data as { sort: number } | null)?.sort ?? -1) + 1;

  const { error } = await supabaseAdmin.from("project_checklist_items").insert({
    org_id: ctx.orgId,
    project_id: projectId,
    section: sec,
    label: lab,
    sort: nextSort,
  });
  if (error) return { ok: false, error: "Couldn't add the item." };
  refresh(projectId);
  return { ok: true };
}

export async function removeChecklistItem(itemId: string): Promise<WorkboardResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const { data } = await supabaseAdmin
    .from("project_checklist_items")
    .select("id, project_id")
    .eq("org_id", ctx.orgId)
    .eq("id", itemId)
    .maybeSingle();
  const row = data as { id: string; project_id: string } | null;
  if (!row) return GONE;

  await supabaseAdmin
    .from("project_checklist_items")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("id", itemId);
  refresh(row.project_id);
  return { ok: true };
}

/** The tick itself — `workboard`, not manage: the person on site knows. */
export async function toggleChecklistItem(itemId: string, done: boolean): Promise<WorkboardResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard"))) return NO_VIEW;

  const { data } = await supabaseAdmin
    .from("project_checklist_items")
    .select("id, project_id")
    .eq("org_id", ctx.orgId)
    .eq("id", itemId)
    .maybeSingle();
  const row = data as { id: string; project_id: string } | null;
  if (!row) return GONE;

  const staffId = await staffIdFor(ctx.orgId, ctx.userId);
  const { error } = await supabaseAdmin
    .from("project_checklist_items")
    .update(
      done
        ? { done: true, done_by: staffId, done_at: new Date().toISOString() }
        : { done: false, done_by: null, done_at: null }
    )
    .eq("org_id", ctx.orgId)
    .eq("id", itemId);
  if (error) return { ok: false, error: "Couldn't save the tick." };
  refresh(row.project_id);
  return { ok: true };
}

/* ---------------- equipment ---------------- */

export type EquipmentInput = {
  description: string;
  model?: string;
  serial?: string;
  locationNote?: string;
  notes?: string;
};

export async function addEquipment(
  projectId: string,
  input: EquipmentInput
): Promise<WorkboardResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;
  if (!(await projectIn(ctx.orgId, projectId))) return GONE;

  const description = trim(input.description, 200);
  if (!description) return { ok: false, error: "Say what the equipment is." };

  const { error } = await supabaseAdmin.from("project_equipment").insert({
    org_id: ctx.orgId,
    project_id: projectId,
    description,
    model: trim(input.model, 120),
    serial: trim(input.serial, 120),
    location_note: trim(input.locationNote, 200),
    notes: trim(input.notes, 1000),
  });
  if (error) return { ok: false, error: "Couldn't add the equipment." };
  refresh(projectId);
  return { ok: true };
}

export async function removeEquipment(equipmentId: string): Promise<WorkboardResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const { data } = await supabaseAdmin
    .from("project_equipment")
    .select("id, project_id")
    .eq("org_id", ctx.orgId)
    .eq("id", equipmentId)
    .maybeSingle();
  const row = data as { id: string; project_id: string } | null;
  if (!row) return GONE;

  await supabaseAdmin
    .from("project_equipment")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("id", equipmentId);
  refresh(row.project_id);
  return { ok: true };
}

/** Manual-left is a TICK (workboard) — it's confirmed standing in the
    customer's hallway, not from a desk. */
export async function setEquipmentManualLeft(
  equipmentId: string,
  left: boolean
): Promise<WorkboardResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard"))) return NO_VIEW;

  const { data } = await supabaseAdmin
    .from("project_equipment")
    .select("id, project_id")
    .eq("org_id", ctx.orgId)
    .eq("id", equipmentId)
    .maybeSingle();
  const row = data as { id: string; project_id: string } | null;
  if (!row) return GONE;

  const { error } = await supabaseAdmin
    .from("project_equipment")
    .update({ manual_left: left })
    .eq("org_id", ctx.orgId)
    .eq("id", equipmentId);
  if (error) return { ok: false, error: "Couldn't save that." };
  refresh(row.project_id);
  return { ok: true };
}
