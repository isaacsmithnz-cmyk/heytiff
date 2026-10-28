import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { refreshJobScope } from "@/lib/workboard/job-scope-server";

/* A JOB'S SCOPE, brought up to date (lib/workboard/job-scope-server.ts). A
   route handler, as the summary's is, because Tiff's read is seconds and
   `maxDuration` is a route-segment option. The body names the job; whether
   anything moved is decided here, so asking again costs a derive, never a
   second read. No money in it, so no money gate. */

export const maxDuration = 120;

export async function POST(req: Request) {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  if (!orgId || !(await can("workboard"))) {
    return Response.json({ ok: false, reason: "No access to Jobs." }, { status: 403 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ ok: false, reason: "Tiff is offline: no API key configured." });
  }
  let job: string | null = null;
  try {
    const body = (await req.json()) as { job?: unknown };
    job = typeof body.job === "string" ? body.job.trim().slice(0, 80) : null;
  } catch {
    job = null;
  }
  if (!job) return Response.json({ ok: false, reason: "No job named." }, { status: 400 });

  const res = await refreshJobScope(orgId, job);
  return Response.json(res.ok ? { ok: true, scope: res.scope } : res);
}
