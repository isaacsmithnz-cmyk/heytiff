"use server";

import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { addJobPlans, readJobPlans, type AddPlansResult } from "@/lib/jobs/plans-server";
import type { JobPlanRead, PlanPick } from "@/lib/jobs/plans";

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
