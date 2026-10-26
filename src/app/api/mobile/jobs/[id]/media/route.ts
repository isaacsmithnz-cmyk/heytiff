import { familyMediaSources, resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { readJobMediaGroups } from "@/lib/workboard/job-media-query";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* A JOB'S PHOTOS AND FILES for the phone's job page, as the job sheet reads
   them (actions/workboard's readJobFiles), behind the same `workboard`
   grant: the job's own and its claims' (a photo taken on site lands on
   whichever clone was open), signed for an hour. Not money-gated: a reader
   without `workboard_money` still sees the pictures of their own job.

   The id is a CHOICE the phone hands in, so it is only read inside the
   caller's own workspace; a clone resolves to the job it claims against. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;

  const id = (await params).id.trim().slice(0, 80);
  if (!id) return Response.json({ error: "Which job?" }, { status: 400, headers: { "cache-control": "no-store" } });

  const { parentRemoteId } = await resolveJobCard(ctx.orgId, id);
  const claims = await familyMediaSources(ctx.orgId, parentRemoteId);
  return ok(await readJobMediaGroups(ctx.orgId, parentRemoteId, claims));
}
