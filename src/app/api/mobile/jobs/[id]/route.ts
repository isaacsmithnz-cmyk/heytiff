import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";
import { familyMediaSources, readJobNotes, readMirrorJobDetail, resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { readOurJobNotes } from "@/lib/workboard/job-notes-query";
import { comingVisits } from "@/lib/mobile/visits";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* ONE JOB for the phone's job page: what the job sheet's card reads
   (actions/workboard's readMirrorJob) and its written record's notes
   (readJobRecord's), behind the same `workboard` grant.

   The id is a CHOICE the phone hands in, so it is only ever read inside the
   caller's own workspace's mirror; a ServiceM8 clone resolves to the job it
   claims against, as the card does. Money rides only with
   `workboard_money`, designs only with `studio`, each asked here and handed
   down so the loader never reads what this person may not see. The notes
   are the job's and its claims', as one stream, and not money-gated; and
   beside them HeyTiff's own diary entries on the job (`ourNotes`), the ones
   typed on the sheet's pen or the phone's. And its coming visits, a day
   each with everyone booked on it (lib/mobile/visits), since the detail's
   own nextBooking names only the first booking's one person. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;

  const id = (await params).id.trim().slice(0, 80);
  if (!id) return Response.json({ error: "Which job?" }, { status: 400, headers: { "cache-control": "no-store" } });

  const target = await resolveJobCard(ctx.orgId, id);
  const timezone = await getSm8Timezone(ctx.orgId);
  const today = todayInZone(timezone);
  const [detail, claims] = await Promise.all([
    readMirrorJobDetail(ctx.orgId, target.parentRemoteId, today, {
      includeMoney: ctx.caps.has("workboard_money"),
      includeDesigns: ctx.caps.has("studio"),
      timezone,
    }),
    familyMediaSources(ctx.orgId, target.parentRemoteId),
  ]);
  if (!detail) return Response.json({ error: "That job isn't here." }, { status: 404, headers: { "cache-control": "no-store" } });

  const [notes, ourNotes, coming] = await Promise.all([
    readJobNotes(ctx.orgId, target.parentRemoteId, claims),
    readOurJobNotes(ctx.orgId, target.parentRemoteId),
    comingVisits(ctx.orgId, target.parentRemoteId, today),
  ]);
  return ok({ detail, notes, ourNotes, coming, focusRemoteId: target.focusRemoteId });
}
