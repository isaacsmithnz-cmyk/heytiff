import { can } from "@/lib/permissions-server";
import { auth0 } from "@/lib/auth0";
import { readPlan } from "@/lib/jobs/plans-server";
import { readPlanReadTicket } from "@/lib/studio/pdf-request";

/* POST { planId } — Tiff reads a plan in a job's Plans
   (lib/jobs/plans-server.ts): a set of drawings has its pages drawn in the
   headless browser, the floors found and each read, the roof and the site
   off the set; a specification has its pages on the air read by their
   words. A route, not an action, because the read is minutes and
   `maxDuration` is a route-segment option. The row is written as it goes,
   so whoever asked may leave; the Documents face polls the plan instead of
   waiting on this answer. Asked by a person behind `workboard`, the job
   card's own gate, or by the server itself with a signed ticket for that
   plan, when a PDF landed on a job by any door (lib/jobs/take-in-server.ts). */

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const planId = typeof body?.planId === "string" ? body.planId.slice(0, 80) : "";
  if (!planId) return Response.json({ ok: false, error: "Which plan?" }, { status: 400 });
  const ticket = readPlanReadTicket(request.headers.get("x-plan-read"));
  let orgId: string | null = null;
  if (ticket) {
    if (ticket.planId !== planId) return Response.json({ ok: false, error: "That ticket is for another plan." }, { status: 401 });
    orgId = ticket.orgId;
  } else {
    const session = await auth0.getSession();
    orgId = (session?.orgId as string | undefined) ?? null;
    if (!orgId || !(await can("workboard"))) return Response.json({ ok: false, error: "Sign in to read the plans." }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ ok: false, error: "Tiff is offline: no API key configured." });
  const out = await readPlan(orgId, planId, new URL(request.url).origin);
  return Response.json(out);
}
