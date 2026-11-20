import { cacheJobFiles } from "@/app/actions/workboard-media";
import { familyMediaSources, resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { readJobMediaGroups } from "@/lib/workboard/job-media-query";
import { actAsPhoneUser, ok, requireMobile } from "@/lib/mobile/auth";
import { withThumbs } from "@/lib/mobile/photo-thumbs";

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
  const read = await readJobMediaGroups(ctx.orgId, parentRemoteId, claims);
  /* each photo's square is a small copy; the full photo waits until it's opened (lib/mobile/photo-thumbs-plan) */
  return ok({ ...read, photos: await withThumbs(read.photos) });
}

/* BRINGING SERVICEM8'S PHOTOS ACROSS for the phone, a few a call, as the web's
   job sheet does each time it opens a job (actions/workboard-media's
   cacheJobFiles, run as the phone's person). Until 20 November 2026 only the
   web did, so a job nobody had opened on the web had its ServiceM8 photos
   without bytes: the phone's Gallery left them out, and with none left it
   wasn't in More at all (Isaac, 18 November 2026, bug 38: "Gallery missing").
   The phone calls again while `cached` comes back above 0 and `remaining`
   does too, and reads the media again after. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;

  const id = (await params).id.trim().slice(0, 80);
  if (!id) return Response.json({ error: "Which job?" }, { status: 400, headers: { "cache-control": "no-store" } });

  const { parentRemoteId } = await resolveJobCard(ctx.orgId, id);
  const res = await actAsPhoneUser(ctx, () => cacheJobFiles(parentRemoteId));
  return ok({ ok: res.ok, cached: res.cached, remaining: res.remaining, note: res.note });
}
