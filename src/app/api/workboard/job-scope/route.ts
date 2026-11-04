import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { takeOffQuoteRail, undoJobScope, refreshJobScope, withQuoteState } from "@/lib/workboard/job-scope-server";

/* A JOB'S SCOPE, brought up to date (lib/workboard/job-scope-server.ts). A
   route handler, as the summary's is, because Tiff's read is seconds and
   `maxDuration` is a route-segment option. The body names the job; whether
   anything moved is decided here, so asking again costs a derive, never a
   second read. No money in it, so no money gate. `undo` puts the brief back
   as it was before Tiff's newest change, and asks nothing of her; nor does
   `off`, which takes what's been priced or left out off the quote's rail.
   Every answer says whether the quote has gone to the client (slice 4). */

export const maxDuration = 120;

export async function POST(req: Request) {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  if (!orgId || !(await can("workboard"))) {
    return Response.json({ ok: false, reason: "No access to Jobs." }, { status: 403 });
  }
  let job: string | null = null;
  let undo = false;
  let off: string[] = [];
  try {
    const body = (await req.json()) as { job?: unknown; undo?: unknown; off?: unknown };
    job = typeof body.job === "string" ? body.job.trim().slice(0, 80) : null;
    undo = body.undo === true;
    off = Array.isArray(body.off) ? body.off.filter((t): t is string => typeof t === "string").slice(0, 12) : [];
  } catch {
    job = null;
  }
  if (!job) return Response.json({ ok: false, reason: "No job named." }, { status: 400 });

  if (off.length) {
    const done = await takeOffQuoteRail(orgId, job, off);
    return Response.json(done.ok ? { ok: true, scope: await withQuoteState(orgId, job, done.scope) } : done);
  }
  if (undo) {
    const done = await undoJobScope(orgId, job, (session?.user?.name as string | undefined) ?? null);
    return Response.json(done.ok ? { ok: true, scope: await withQuoteState(orgId, job, done.scope) } : done);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ ok: false, reason: "Tiff is offline: no API key configured." });
  }
  const res = await refreshJobScope(orgId, job);
  return Response.json(res.ok ? { ok: true, scope: await withQuoteState(orgId, job, res.scope) } : res);
}
