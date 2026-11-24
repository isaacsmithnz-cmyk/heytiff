import { ok, requireMobile } from "@/lib/mobile/auth";
import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { setStar } from "@/lib/jobs/job-stars";

/* STAR A JOB from the phone (Isaac, 24 November 2026, the Star a job mock):
   the job head's Star, and holding a row in Jobs or Search. POST
   `{ starred: true }` stars it, `false` takes the star off; yours alone, on
   the job's card (a claim's star is its parent's), behind the job's own
   `workboard` grant. */

const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const id = (await params).id.trim().slice(0, 80);
  if (!id) return no(400, "Which job?");
  const body = (await request.json().catch(() => null)) as { starred?: unknown } | null;
  if (typeof body?.starred !== "boolean") return no(400, "Star it or not?");
  const { parentRemoteId } = await resolveJobCard(ctx.orgId, id);
  const r = await setStar({ orgId: ctx.orgId, userId: ctx.userId }, parentRemoteId, body.starred);
  if (!r.ok) return no(409, r.error);
  return ok({ starred: r.starred });
}
