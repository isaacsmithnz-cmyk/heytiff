import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { refreshJobSummary } from "@/lib/workboard/job-summary";

/* A ROUTE HANDLER FOR THE SAME REASON THE FLEET VALUATIONS ARE ONE: a Claude
   call is seconds, sometimes tens of them, and `maxDuration` is a
   route-segment option — as a server action this would inherit the page's
   ceiling and raising that raises it for every action on the screen.

   THE ROUTE OWNS THE DECISION. The body names WHICH job; everything else —
   the story, the stamp, whether the stored summary is stale — is derived
   here from the mirror. A client that asks when nothing moved costs a
   re-derive and no model call, so a confused caller cannot spend money,
   only queries.

   Nothing here needs a money gate any more: the summary carries no money
   by design (Isaac's cut — the Money face says collection once), and the
   writer never even receives the money-shaped story entries. */

export const maxDuration = 120;

export async function POST(req: Request) {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  if (!orgId || !(await can("workboard"))) {
    return Response.json({ ok: false, reason: "No access to the Workboard." }, { status: 403 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ ok: false, reason: "The writer is offline — no API key configured." });
  }

  let job: string | null = null;
  try {
    const body = (await req.json()) as { job?: unknown };
    job = typeof body.job === "string" ? body.job.trim().slice(0, 80) : null;
  } catch {
    job = null;
  }
  if (!job) {
    return Response.json({ ok: false, reason: "No job named." }, { status: 400 });
  }

  const res = await refreshJobSummary(orgId, job);
  if (!res.ok) return Response.json(res);
  return Response.json({ ok: true, summary: res.summary });
}
