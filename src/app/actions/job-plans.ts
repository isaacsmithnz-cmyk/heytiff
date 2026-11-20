"use server";

import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { addJobPlans, choosePlanFloors, readPlanAgain, keepSubfloorHeight, planPageForScale, readJobPlans, setPlanScale, type AddPlansResult, type PageForScale } from "@/lib/jobs/plans-server";
import type { JobPlanRead, PlanPick } from "@/lib/jobs/plans";
import type { LinkPlansResult } from "@/lib/jobs/plans-link-server";

/* PLANS ON THE JOB: the job card's actions (lib/jobs/plans-server.ts).
   Behind `workboard`, the card's own tier, as the Documents face's upload
   is. The read itself is a route (api/jobs/plans/read): minutes, not an
   action's seconds. */

async function context(): Promise<{ orgId: string; staffId: string | null } | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;
  if (!(await can("workboard"))) return null;
  return { orgId, staffId: await staffProfileIdFor(orgId, userId) };
}

const trim = (v: unknown) => String(v ?? "").trim().slice(0, 80);

/** The job's plans, for its Documents and for a poll while one is read. */
export async function readPlansOnJob(jobUuid: string): Promise<JobPlanRead[] | null> {
  const ctx = await context();
  const job = trim(jobUuid);
  if (!ctx || !job) return null;
  return readJobPlans(ctx.orgId, job);
}

/** The picked files into the job's Plans. The caller then asks the read
    route for each plan made. */
export async function addPlansToJob(jobUuid: string, picks: readonly PlanPick[]): Promise<AddPlansResult> {
  const ctx = await context();
  const job = trim(jobUuid);
  if (!ctx || !job) return { ok: false, error: "You can't add plans to jobs." };
  const clean: PlanPick[] = [];
  for (const p of Array.isArray(picks) ? picks : []) {
    if ("documentId" in p && trim(p.documentId)) clean.push({ documentId: trim(p.documentId) });
    else if ("attachmentId" in p && trim(p.attachmentId)) clean.push({ attachmentId: trim(p.attachmentId) });
  }
  if (clean.length === 0) return { ok: false, error: "Nothing was picked." };
  return addJobPlans(ctx.orgId, job, clean, ctx.staffId);
}

/** A plan that couldn't be read, put back to be read; null once it is, or
    the reason. The caller then asks the read route for it. */
export async function readPlanAgainOnJob(jobUuid: string, planId: string): Promise<string | null> {
  const ctx = await context();
  const job = trim(jobUuid);
  const plan = trim(planId);
  if (!ctx || !job || !plan) return "You can't read plans on jobs.";
  return (await readPlanAgain(ctx.orgId, job, plan)) ? null : "That plan isn't waiting to be read again.";
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const point = (v: unknown): { x: number; y: number } | null => {
  const p = v as { x?: unknown; y?: unknown } | null;
  const x = num(p?.x);
  const y = num(p?.y);
  return x == null || y == null ? null : { x, y };
};

/** A floor page's picture for Set scale, and the figure its scale rests on. */
export async function pageForScale(jobUuid: string, planId: string, n: number): Promise<PageForScale | null> {
  const ctx = await context();
  const job = trim(jobUuid);
  const plan = trim(planId);
  const page = num(n);
  if (!ctx || !job || !plan || page == null) return null;
  return planPageForScale(ctx.orgId, job, plan, page);
}

/** Set scale: the length between two points on a page, kept on the job's
    plan. Null once it's saved, or the reason not. */
export async function setScaleOnPlan(jobUuid: string, planId: string, n: number, a: { x: number; y: number }, b: { x: number; y: number }, mm: number): Promise<string | null> {
  const ctx = await context();
  const job = trim(jobUuid);
  const plan = trim(planId);
  if (!ctx || !job || !plan) return "You can't set a plan's scale.";
  const page = num(n);
  const from = point(a);
  const to = point(b);
  const length = num(mm);
  if (page == null || !from || !to) return "Press the two ends of a length first.";
  /* a wall's thickness to a long boundary: 100 mm to 500 m */
  if (length == null || length < 100 || length > 500_000) return "Type the length between the two points, in millimetres.";
  return setPlanScale(ctx.orgId, plan, page, { a: from, b: to, mm: length }, ctx.staffId, job);
}

/** A scale measured in a design made from one of the job's plans, kept on
    that plan's page (lib/studio/plan-set.ts measuredForJob). Behind
    `studio`, where it was measured. Null once it's saved, or the reason. */
export async function savePlanScaleFromDesign(planId: string, n: number, mmPerPx: number): Promise<string | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId || !(await can("studio"))) return "You can't set a plan's scale.";
  const plan = trim(planId);
  const page = num(n);
  const scale = num(mmPerPx);
  if (!plan || page == null || scale == null || scale <= 0) return "That scale can't be used.";
  return setPlanScale(orgId, plan, page, { mmPerPx: scale }, await staffProfileIdFor(orgId, userId));
}

/** The floors chosen for a set's pages in the Plans dialog, from the job's
    Plans or a design's Edit plans: page number to a level, or "none" for
    Not a floor plan. Null once saved, or the reason. */
/** A subfloor's height typed in a design, kept on the job's plan it came off. */
export async function keepSubfloorOnPlan(jobUuid: string, planId: string, heightMm: number, design: string): Promise<string | null> {
  const ctx = await context();
  const job = trim(jobUuid);
  const plan = trim(planId);
  const mm = Math.round(Number(heightMm));
  if (!ctx || !job || !plan || !(mm > 0 && mm <= 20000)) return "You can't change the plan's subfloor.";
  return keepSubfloorHeight(ctx.orgId, plan, mm, ctx.staffId, String(design ?? "").trim(), job);
}

export async function chooseFloorsOnPlan(jobUuid: string, planId: string, chosen: Record<number, string>): Promise<string | null> {
  const ctx = await context();
  const job = trim(jobUuid);
  const plan = trim(planId);
  if (!ctx || !job || !plan) return "You can't change a plan's floors.";
  const clean: Record<number, string> = {};
  for (const [k, v] of Object.entries(chosen && typeof chosen === "object" ? chosen : {})) {
    const n = Number(k);
    const value = String(v);
    if (Number.isInteger(n) && n > 0 && (value === "none" || /^-?\d{1,2}$/.test(value))) clean[n] = value;
  }
  return choosePlanFloors(ctx.orgId, plan, clean, ctx.staffId, job);
}

/** Link job on a design with no job: its plans onto the job's Plans, read as
    the design has them (lib/jobs/plans-link-server.ts). The caller links the
    design and starts the reads of `toRead`. */
export async function linkPlansToJob(jobUuid: string, designId: string): Promise<LinkPlansResult> {
  const ctx = await context();
  const job = trim(jobUuid);
  const design = trim(designId);
  if (!ctx || !(await can("studio"))) return { ok: false, error: "You can't link designs to jobs." };
  if (!job || !design) return { ok: false, error: "Pick a job first." };
  /* loaded when asked: it brings sharp and the storage, which the rest of these doors don't need */
  const { linkDesignPlans } = await import("@/lib/jobs/plans-link-server");
  return linkDesignPlans(ctx.orgId, job, design, ctx.staffId);
}
