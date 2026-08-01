"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";
import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";
import { staffIdFor } from "@/lib/workboard/projects-query";

/* Projects-side mutations for the redesigned board — the new tables from the
   foundations migration (blocked state, money target, variations, claims,
   scope, milestones, hand-made visits with per-visit bring lists).

   Same two capability tiers as the rest of the Workboard:

     MANAGE (`workboard_manage`) — state calls: blocking, money, variations,
             claims, scope, milestones, creating and deleting trips.
     TICKING (`workboard`) — site facts: the bring list. The tech who says
             "chuck the vac pump on next visit's list" IS the record; making
             them radio an admin recreates the exact gap this board closes.

   Money arrives as INTEGER CENTS (the UI parses with parseAudToCents) and is
   re-validated here — a Server Function is reachable by direct POST.
   Every mutation touches projects.updated_at: the stale rule reads movement,
   and all of these are movement. */

export type ProjectsResult = { ok: true; id?: string } | { ok: false; error: string };

const NOT_SIGNED_IN: ProjectsResult = { ok: false, error: "Not signed in." };
const NO_VIEW: ProjectsResult = { ok: false, error: "You don't have access to the Workboard." };
const NO_MANAGE: ProjectsResult = {
  ok: false,
  error: "You don't have access to manage the Workboard.",
};
const GONE: ProjectsResult = { ok: false, error: "That project is no longer here." };

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

/** Integer cents, |v| ≤ $100M — the same cap the parser enforces, re-checked
    because the wire is not the form. */
const centsOf = (v: unknown): number | null => {
  if (typeof v !== "number" || !Number.isInteger(v)) return null;
  if (Math.abs(v) > 10_000_000_000) return null;
  return v;
};

/** Hours as budgets are spoken — 0.5 to 20,000, one decimal. */
const hoursBudgetOf = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 20_000) return null;
  return Math.round(n * 10) / 10;
};

type ProjectRow = { id: string; name: string; status: string; defects_task_id: string | null };

async function projectIn(orgId: string, projectId: string): Promise<ProjectRow | null> {
  const { data } = await supabaseAdmin
    .from("projects")
    .select("id, name, status, defects_task_id")
    .eq("org_id", orgId)
    .eq("id", projectId)
    .maybeSingle();
  return (data as ProjectRow | null) ?? null;
}

/** A visit that belongs to a PROJECT in this org — the bring-list and
    trip actions refuse agreement visits by construction. */
async function projectVisitIn(
  orgId: string,
  visitId: string
): Promise<{ id: string; project_id: string; status: string } | null> {
  const { data } = await supabaseAdmin
    .from("maintenance_visits")
    .select("id, project_id, status")
    .eq("org_id", orgId)
    .eq("id", visitId)
    .not("project_id", "is", null)
    .maybeSingle();
  return (data as { id: string; project_id: string; status: string } | null) ?? null;
}

async function touchProject(orgId: string, projectId: string): Promise<void> {
  await supabaseAdmin
    .from("projects")
    .update({ updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", projectId);
}

/* ---------------- blocked (P4 — first-class, reason + who) ---------------- */

export async function setProjectBlocked(
  projectId: string,
  input: { reason: string; on: string }
): Promise<ProjectsResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const reason = trim(input.reason, 300);
  const on = trim(input.on, 160);
  if (!reason) return { ok: false, error: "Blocking needs a reason." };
  if (!on) return { ok: false, error: "Say who or what it's waiting on." };

  const project = await projectIn(ctx.orgId, projectId);
  if (!project) return GONE;
  if (project.status === "done" || project.status === "archived") {
    return { ok: false, error: "A finished project can't be blocked." };
  }

  const { error } = await supabaseAdmin
    .from("projects")
    .update({
      status: "blocked",
      blocked_reason: reason,
      blocked_on: on,
      blocked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", ctx.orgId)
    .eq("id", projectId);
  if (error) return { ok: false, error: "Couldn't block the project." };
  refresh(projectId);
  return { ok: true };
}

export async function clearProjectBlocked(projectId: string): Promise<ProjectsResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const project = await projectIn(ctx.orgId, projectId);
  if (!project) return GONE;
  if (project.status !== "blocked") return { ok: false, error: "That project isn't blocked." };

  const { error } = await supabaseAdmin
    .from("projects")
    .update({
      status: "active",
      blocked_reason: null,
      blocked_on: null,
      blocked_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", ctx.orgId)
    .eq("id", projectId);
  if (error) return { ok: false, error: "Couldn't unblock the project." };
  refresh(projectId);
  return { ok: true };
}

/* ---------------- the money target ---------------- */

const BUDGET_SOURCES = ["studio", "sm8_quote", "manual"] as const;

export async function setProjectBudget(
  projectId: string,
  input: { cents: number | null; source?: string | null }
): Promise<ProjectsResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;
  if (!(await projectIn(ctx.orgId, projectId))) return GONE;

  let cents: number | null = null;
  let source: string | null = null;
  if (input.cents !== null) {
    cents = centsOf(input.cents);
    if (cents === null || cents < 0) {
      return { ok: false, error: "The budget needs to be a real dollar amount." };
    }
    source = BUDGET_SOURCES.includes(input.source as (typeof BUDGET_SOURCES)[number])
      ? (input.source as string)
      : "manual";
  }

  const { error } = await supabaseAdmin
    .from("projects")
    .update({ budget_cents: cents, budget_source: source, updated_at: new Date().toISOString() })
    .eq("org_id", ctx.orgId)
    .eq("id", projectId);
  if (error) return { ok: false, error: "Couldn't save the budget." };
  refresh(projectId);
  return { ok: true };
}

export async function setProjectHoursBudget(
  projectId: string,
  hours: number | null
): Promise<ProjectsResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;
  if (!(await projectIn(ctx.orgId, projectId))) return GONE;

  let value: number | null = null;
  if (hours !== null) {
    value = hoursBudgetOf(hours);
    if (value === null) return { ok: false, error: "Hours need to be a real number of hours." };
  }

  const { error } = await supabaseAdmin
    .from("projects")
    .update({ hours_budget: value, updated_at: new Date().toISOString() })
    .eq("org_id", ctx.orgId)
    .eq("id", projectId);
  if (error) return { ok: false, error: "Couldn't save the hours budget." };
  refresh(projectId);
  return { ok: true };
}

/* ---------------- committed dates ---------------- */

export async function setProjectPromise(
  projectId: string,
  dateISO: string | null
): Promise<ProjectsResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;
  if (!(await projectIn(ctx.orgId, projectId))) return GONE;

  let value: string | null = null;
  if (dateISO !== null) {
    value = isoDate(dateISO);
    if (!value) return { ok: false, error: "Pick a real day." };
  }

  const { error } = await supabaseAdmin
    .from("projects")
    .update({ promised_finish: value, updated_at: new Date().toISOString() })
    .eq("org_id", ctx.orgId)
    .eq("id", projectId);
  if (error) return { ok: false, error: "Couldn't save the promised finish." };
  refresh(projectId);
  return { ok: true };
}

/** The defects tail: setting the date keeps ONE open task pointed at it —
    created if missing, moved if the date moves, deleted (only while still
    open) when the date clears. No staff profile → the date still saves,
    there's just nobody to hand the task to. */
export async function setProjectDefectsEnd(
  projectId: string,
  dateISO: string | null
): Promise<ProjectsResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const project = await projectIn(ctx.orgId, projectId);
  if (!project) return GONE;

  let value: string | null = null;
  if (dateISO !== null) {
    value = isoDate(dateISO);
    if (!value) return { ok: false, error: "Pick a real day." };
  }

  let taskId: string | null = project.defects_task_id;

  if (value === null) {
    if (taskId) {
      // Only an OPEN task vanishes with the date — a done task is history.
      await supabaseAdmin
        .from("tasks")
        .delete()
        .eq("org_id", ctx.orgId)
        .eq("id", taskId)
        .eq("status", "open");
      taskId = null;
    }
  } else {
    const title = `Defects period ends — ${project.name}`;
    const detail = "Walk the job for defect reports and close out the defects tail.";
    if (taskId) {
      const { data } = await supabaseAdmin
        .from("tasks")
        .update({ title, detail, due_date: value, updated_at: new Date().toISOString() })
        .eq("org_id", ctx.orgId)
        .eq("id", taskId)
        .eq("status", "open")
        .select("id");
      // The task may have been completed or deleted out from under the
      // pointer — spawn a fresh one below.
      if (!data || data.length === 0) taskId = null;
    }
    if (!taskId) {
      const staffId = await staffIdFor(ctx.orgId, ctx.userId);
      if (staffId) {
        const { data } = await supabaseAdmin
          .from("tasks")
          .insert({
            org_id: ctx.orgId,
            title,
            detail,
            assigned_to: staffId,
            created_by: staffId,
            due_date: value,
          })
          .select("id")
          .single();
        taskId = (data as { id: string } | null)?.id ?? null;
      }
    }
  }

  const { error } = await supabaseAdmin
    .from("projects")
    .update({
      defects_end: value,
      defects_task_id: taskId,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", ctx.orgId)
    .eq("id", projectId);
  if (error) return { ok: false, error: "Couldn't save the defects period." };
  refresh(projectId);
  return { ok: true };
}

export async function addMilestone(
  projectId: string,
  input: { label: string; onDate: string }
): Promise<ProjectsResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;
  if (!(await projectIn(ctx.orgId, projectId))) return GONE;

  const label = trim(input.label, 160);
  const onDate = isoDate(input.onDate);
  if (!label) return { ok: false, error: "A milestone needs a name." };
  if (!onDate) return { ok: false, error: "Pick a real day." };

  const { data, error } = await supabaseAdmin
    .from("project_milestones")
    .insert({ org_id: ctx.orgId, project_id: projectId, label, on_date: onDate })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't add the milestone." };
  await touchProject(ctx.orgId, projectId);
  refresh(projectId);
  return { ok: true, id: (data as { id: string }).id };
}

export async function removeMilestone(milestoneId: string): Promise<ProjectsResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const { data } = await supabaseAdmin
    .from("project_milestones")
    .select("id, project_id")
    .eq("org_id", ctx.orgId)
    .eq("id", milestoneId)
    .maybeSingle();
  const row = data as { id: string; project_id: string } | null;
  if (!row) return { ok: false, error: "That milestone is no longer here." };

  await supabaseAdmin
    .from("project_milestones")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("id", milestoneId);
  await touchProject(ctx.orgId, row.project_id);
  refresh(row.project_id);
  return { ok: true };
}

/* ---------------- scope of work ---------------- */

export async function addScopeItem(
  projectId: string,
  kind: string,
  label: string
): Promise<ProjectsResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;
  if (kind !== "inclusion" && kind !== "exclusion") {
    return { ok: false, error: "Scope lines are inclusions or exclusions." };
  }
  if (!(await projectIn(ctx.orgId, projectId))) return GONE;

  const text = trim(label, 300);
  if (!text) return { ok: false, error: "Write the scope line first." };

  const { count } = await supabaseAdmin
    .from("project_scope_items")
    .select("id", { count: "exact", head: true })
    .eq("org_id", ctx.orgId)
    .eq("project_id", projectId)
    .eq("kind", kind);

  const { data, error } = await supabaseAdmin
    .from("project_scope_items")
    .insert({
      org_id: ctx.orgId,
      project_id: projectId,
      kind,
      label: text,
      position: count ?? 0,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't add the scope line." };
  await touchProject(ctx.orgId, projectId);
  refresh(projectId);
  return { ok: true, id: (data as { id: string }).id };
}

export async function removeScopeItem(itemId: string): Promise<ProjectsResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const { data } = await supabaseAdmin
    .from("project_scope_items")
    .select("id, project_id")
    .eq("org_id", ctx.orgId)
    .eq("id", itemId)
    .maybeSingle();
  const row = data as { id: string; project_id: string } | null;
  if (!row) return { ok: false, error: "That scope line is no longer here." };

  await supabaseAdmin
    .from("project_scope_items")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("id", itemId);
  await touchProject(ctx.orgId, row.project_id);
  refresh(row.project_id);
  return { ok: true };
}

/* ---------------- variations (the target-movers) ---------------- */

export async function addVariation(
  projectId: string,
  input: { title: string; detail?: string; amountCents: number }
): Promise<ProjectsResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;
  if (!(await projectIn(ctx.orgId, projectId))) return GONE;

  const title = trim(input.title, 200);
  if (!title) return { ok: false, error: "A variation needs a name." };
  const amount = centsOf(input.amountCents);
  if (amount === null || amount === 0) {
    return { ok: false, error: "The variation needs a real amount (credits go negative)." };
  }

  const { data, error } = await supabaseAdmin
    .from("project_variations")
    .insert({
      org_id: ctx.orgId,
      project_id: projectId,
      title,
      detail: trim(input.detail, 2000),
      amount_cents: amount,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't add the variation." };
  await touchProject(ctx.orgId, projectId);
  refresh(projectId);
  return { ok: true, id: (data as { id: string }).id };
}

/** Approving or declining records WHO MADE THE CALL — that name is the whole
    point of the ledger. Reopening to pending clears the decision. */
export async function decideVariation(
  variationId: string,
  decision: string,
  decidedBy?: string
): Promise<ProjectsResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;
  if (!["approved", "declined", "pending"].includes(decision)) {
    return { ok: false, error: "That isn't a decision this ledger knows." };
  }

  const { data } = await supabaseAdmin
    .from("project_variations")
    .select("id, project_id")
    .eq("org_id", ctx.orgId)
    .eq("id", variationId)
    .maybeSingle();
  const row = data as { id: string; project_id: string } | null;
  if (!row) return { ok: false, error: "That variation is no longer here." };

  let patch: Record<string, unknown>;
  if (decision === "pending") {
    patch = { status: "pending", decided_by: null, decided_at: null };
  } else {
    const who = trim(decidedBy, 120);
    if (!who) return { ok: false, error: "Record who made the call." };
    patch = { status: decision, decided_by: who, decided_at: new Date().toISOString() };
  }

  const { error } = await supabaseAdmin
    .from("project_variations")
    .update(patch)
    .eq("org_id", ctx.orgId)
    .eq("id", variationId);
  if (error) return { ok: false, error: "Couldn't record the decision." };
  await touchProject(ctx.orgId, row.project_id);
  refresh(row.project_id);
  return { ok: true };
}

/** Pending and declined variations can go; an approved one moved the target,
    so it reopens first — two deliberate presses, like ending an agreement. */
export async function removeVariation(variationId: string): Promise<ProjectsResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const { data } = await supabaseAdmin
    .from("project_variations")
    .select("id, project_id, status")
    .eq("org_id", ctx.orgId)
    .eq("id", variationId)
    .maybeSingle();
  const row = data as { id: string; project_id: string; status: string } | null;
  if (!row) return { ok: false, error: "That variation is no longer here." };
  if (row.status === "approved") {
    return { ok: false, error: "An approved variation moved the target — reopen it first." };
  }

  await supabaseAdmin
    .from("project_variations")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("id", variationId);
  await touchProject(ctx.orgId, row.project_id);
  refresh(row.project_id);
  return { ok: true };
}

/* ---------------- claims (axis 1 rows, axis 2 status) ---------------- */

export async function addClaim(
  projectId: string,
  input: { label: string; amountCents: number; claimedOn?: string; variationId?: string | null }
): Promise<ProjectsResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;
  if (!(await projectIn(ctx.orgId, projectId))) return GONE;

  const label = trim(input.label, 200);
  if (!label) return { ok: false, error: "A claim needs a name — 'Deposit', 'Rough-in claim'…" };
  const amount = centsOf(input.amountCents);
  if (amount === null || amount <= 0) {
    return { ok: false, error: "The claim needs a real amount." };
  }

  let claimedOn = todayInZone(await getSm8Timezone(ctx.orgId));
  if (input.claimedOn !== undefined) {
    const parsed = isoDate(input.claimedOn);
    if (!parsed) return { ok: false, error: "Pick the day it was claimed." };
    claimedOn = parsed;
  }

  let variationId: string | null = null;
  if (input.variationId) {
    const { data } = await supabaseAdmin
      .from("project_variations")
      .select("id")
      .eq("org_id", ctx.orgId)
      .eq("id", input.variationId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (!data) return { ok: false, error: "That variation isn't on this project." };
    variationId = input.variationId;
  }

  const { data, error } = await supabaseAdmin
    .from("project_claims")
    .insert({
      org_id: ctx.orgId,
      project_id: projectId,
      label,
      amount_cents: amount,
      claimed_on: claimedOn,
      variation_id: variationId,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't add the claim." };
  await touchProject(ctx.orgId, projectId);
  refresh(projectId);
  return { ok: true, id: (data as { id: string }).id };
}

export async function setClaimPaid(
  claimId: string,
  paid: boolean,
  paidOn?: string
): Promise<ProjectsResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const { data } = await supabaseAdmin
    .from("project_claims")
    .select("id, project_id")
    .eq("org_id", ctx.orgId)
    .eq("id", claimId)
    .maybeSingle();
  const row = data as { id: string; project_id: string } | null;
  if (!row) return { ok: false, error: "That claim is no longer here." };

  let patch: Record<string, unknown>;
  if (paid) {
    let on = todayInZone(await getSm8Timezone(ctx.orgId));
    if (paidOn !== undefined) {
      const parsed = isoDate(paidOn);
      if (!parsed) return { ok: false, error: "Pick the day it was paid." };
      on = parsed;
    }
    patch = { status: "paid", paid_on: on };
  } else {
    patch = { status: "awaiting", paid_on: null };
  }

  const { error } = await supabaseAdmin
    .from("project_claims")
    .update(patch)
    .eq("org_id", ctx.orgId)
    .eq("id", claimId);
  if (error) return { ok: false, error: "Couldn't update the claim." };
  await touchProject(ctx.orgId, row.project_id);
  refresh(row.project_id);
  return { ok: true };
}

/** Only MANUAL rows delete — a mirrored claim's truth lives in the mirror. */
export async function removeClaim(claimId: string): Promise<ProjectsResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const { data } = await supabaseAdmin
    .from("project_claims")
    .select("id, project_id, source")
    .eq("org_id", ctx.orgId)
    .eq("id", claimId)
    .maybeSingle();
  const row = data as { id: string; project_id: string; source: string } | null;
  if (!row) return { ok: false, error: "That claim is no longer here." };
  if (row.source !== "manual") {
    return { ok: false, error: "That claim mirrors an invoice — it clears itself." };
  }

  await supabaseAdmin
    .from("project_claims")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("id", claimId);
  await touchProject(ctx.orgId, row.project_id);
  refresh(row.project_id);
  return { ok: true };
}

/* ---------------- trips (hand-made visits on the shared model) ---------------- */

export async function createProjectVisit(
  projectId: string,
  input: { label: string; dueDate: string; bookedDate?: string | null }
): Promise<ProjectsResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const project = await projectIn(ctx.orgId, projectId);
  if (!project) return GONE;
  if (project.status === "done" || project.status === "archived") {
    return { ok: false, error: "A finished project doesn't take new trips." };
  }

  const label = trim(input.label, 160);
  if (!label) return { ok: false, error: "Name the trip — 'Rough-in day 1', 'Commissioning'…" };
  const dueDate = isoDate(input.dueDate);
  if (!dueDate) return { ok: false, error: "Pick the day it should happen around." };

  let bookedDate: string | null = null;
  if (input.bookedDate) {
    bookedDate = isoDate(input.bookedDate);
    if (!bookedDate) return { ok: false, error: "Pick a real day to book it on." };
  }

  const { data, error } = await supabaseAdmin
    .from("maintenance_visits")
    .insert({
      org_id: ctx.orgId,
      project_id: projectId,
      label,
      due_date: dueDate,
      booked_date: bookedDate,
      status: bookedDate ? "booked" : "upcoming",
      readiness: {},
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't create the trip." };
  await touchProject(ctx.orgId, projectId);
  refresh(projectId);
  return { ok: true, id: (data as { id: string }).id };
}

export async function setProjectVisitLabel(
  visitId: string,
  label: string
): Promise<ProjectsResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const visit = await projectVisitIn(ctx.orgId, visitId);
  if (!visit) return { ok: false, error: "That trip is no longer here." };

  const text = trim(label, 160);
  if (!text) return { ok: false, error: "A trip needs a name." };

  const { error } = await supabaseAdmin
    .from("maintenance_visits")
    .update({ label: text })
    .eq("org_id", ctx.orgId)
    .eq("id", visitId);
  if (error) return { ok: false, error: "Couldn't rename the trip." };
  await touchProject(ctx.orgId, visit.project_id);
  refresh(visit.project_id);
  return { ok: true };
}

/** Hand-made trips can be un-made — but only while still open. History
    (done/skipped) is the record of what happened and never deletes. */
export async function deleteProjectVisit(visitId: string): Promise<ProjectsResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard_manage"))) return NO_MANAGE;

  const visit = await projectVisitIn(ctx.orgId, visitId);
  if (!visit) return { ok: false, error: "That trip is no longer here." };
  if (visit.status !== "upcoming" && visit.status !== "booked") {
    return { ok: false, error: "A trip that ran is history — it doesn't delete." };
  }

  await supabaseAdmin
    .from("maintenance_visits")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("id", visitId);
  await touchProject(ctx.orgId, visit.project_id);
  refresh(visit.project_id);
  return { ok: true };
}

/* ---------------- the bring list (tick tier — site reality) ---------------- */

export async function addVisitBringItem(
  visitId: string,
  label: string
): Promise<ProjectsResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard"))) return NO_VIEW;

  const visit = await projectVisitIn(ctx.orgId, visitId);
  if (!visit) return { ok: false, error: "That trip is no longer here." };

  const text = trim(label, 160);
  if (!text) return { ok: false, error: "Write what to bring." };

  const { count } = await supabaseAdmin
    .from("project_visit_items")
    .select("id", { count: "exact", head: true })
    .eq("org_id", ctx.orgId)
    .eq("visit_id", visitId);

  const { data, error } = await supabaseAdmin
    .from("project_visit_items")
    .insert({ org_id: ctx.orgId, visit_id: visitId, label: text, position: count ?? 0 })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't add it to the list." };
  await touchProject(ctx.orgId, visit.project_id);
  refresh(visit.project_id);
  return { ok: true, id: (data as { id: string }).id };
}

export async function removeVisitBringItem(itemId: string): Promise<ProjectsResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard"))) return NO_VIEW;

  const { data } = await supabaseAdmin
    .from("project_visit_items")
    .select("id, visit_id")
    .eq("org_id", ctx.orgId)
    .eq("id", itemId)
    .maybeSingle();
  const row = data as { id: string; visit_id: string } | null;
  if (!row) return { ok: false, error: "That item is no longer on the list." };

  const visit = await projectVisitIn(ctx.orgId, row.visit_id);
  await supabaseAdmin
    .from("project_visit_items")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("id", itemId);
  if (visit) {
    await touchProject(ctx.orgId, visit.project_id);
    refresh(visit.project_id);
  }
  return { ok: true };
}

export async function setVisitBringPacked(
  itemId: string,
  packed: boolean
): Promise<ProjectsResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard"))) return NO_VIEW;

  const { data } = await supabaseAdmin
    .from("project_visit_items")
    .select("id, visit_id")
    .eq("org_id", ctx.orgId)
    .eq("id", itemId)
    .maybeSingle();
  const row = data as { id: string; visit_id: string } | null;
  if (!row) return { ok: false, error: "That item is no longer on the list." };

  const staffId = await staffIdFor(ctx.orgId, ctx.userId);
  const { error } = await supabaseAdmin
    .from("project_visit_items")
    .update({ packed: packed === true, packed_by: packed ? staffId : null })
    .eq("org_id", ctx.orgId)
    .eq("id", itemId);
  if (error) return { ok: false, error: "Couldn't update the list." };

  const visit = await projectVisitIn(ctx.orgId, row.visit_id);
  if (visit) refresh(visit.project_id);
  return { ok: true };
}

/** "Bring it NEXT time" — copy this trip's unpacked leftovers onto another
    trip of the same project (the close-out flow offers the next one).
    Labels already on the target don't duplicate. */
export async function carryVisitBringItems(
  fromVisitId: string,
  toVisitId: string
): Promise<ProjectsResult> {
  const ctx = await context();
  if (!ctx) return NOT_SIGNED_IN;
  if (!(await can("workboard"))) return NO_VIEW;

  const [from, to] = await Promise.all([
    projectVisitIn(ctx.orgId, fromVisitId),
    projectVisitIn(ctx.orgId, toVisitId),
  ]);
  if (!from || !to) return { ok: false, error: "That trip is no longer here." };
  if (from.project_id !== to.project_id) {
    return { ok: false, error: "Those trips belong to different projects." };
  }
  if (from.id === to.id) return { ok: false, error: "Pick a different trip to carry to." };

  const [{ data: fromRows }, { data: toRows }] = await Promise.all([
    supabaseAdmin
      .from("project_visit_items")
      .select("label, position")
      .eq("org_id", ctx.orgId)
      .eq("visit_id", fromVisitId)
      .eq("packed", false)
      .order("position", { ascending: true }),
    supabaseAdmin
      .from("project_visit_items")
      .select("label")
      .eq("org_id", ctx.orgId)
      .eq("visit_id", toVisitId),
  ]);

  const already = new Set(
    ((toRows ?? []) as { label: string }[]).map((r) => r.label.toLowerCase())
  );
  const carry = ((fromRows ?? []) as { label: string }[]).filter(
    (r) => !already.has(r.label.toLowerCase())
  );
  if (carry.length === 0) return { ok: true };

  const base = (toRows ?? []).length;
  const { error } = await supabaseAdmin.from("project_visit_items").insert(
    carry.map((r, i) => ({
      org_id: ctx.orgId,
      visit_id: toVisitId,
      label: r.label,
      position: base + i,
    }))
  );
  if (error) return { ok: false, error: "Couldn't carry the list over." };
  await touchProject(ctx.orgId, from.project_id);
  refresh(from.project_id);
  return { ok: true };
}
