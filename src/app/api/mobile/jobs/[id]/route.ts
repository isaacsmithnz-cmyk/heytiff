import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";
import { familyMediaSources, readJobNotes, readMirrorJobDetail, resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { notesViewerOf, readOurJobNotes } from "@/lib/workboard/job-notes-query";
import { sm8NotesAllowed } from "@/lib/integrations/sm8-kinds";
import { offersSend } from "@/lib/integrations/sm8-write-plan";
import { senderWords } from "@/lib/integrations/sm8-note-words";
import { comingVisits, missedVisits } from "@/lib/mobile/visits";
import { changeAllowed } from "@/lib/mobile/schedule-gate";
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
   typed on the sheet's pen or the phone's. Where the deployment sends notes
   to ServiceM8, each of those carries its line (sent, queued, refused), read
   for this viewer, and `sm8Notes` says whether the pen's Also in ServiceM8
   can send and, while it can't, why (the job sheet's sentence); null where
   notes aren't offered at all. And its coming visits, a day each with
   everyone booked on it (lib/mobile/visits), since the detail's own
   nextBooking names only the first booking's one person; and `canChange`
   where this person may change those visits from the phone, the Schedule's
   own gate (lib/mobile/schedule-gate). And on a job not yet done, the
   bookings that are over with no one there (`missed`), to move: it's still
   the job's booking (Isaac, 4 November 2026, on 3488). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;

  const id = (await params).id.trim().slice(0, 80);
  if (!id) return Response.json({ error: "Which job?" }, { status: 400, headers: { "cache-control": "no-store" } });

  /* EVERYTHING AT ONCE that can be (Isaac, 13 November 2026, job 2043 sat on a spinner two seconds: "Still
     lagging, now on job card too"; the reads went one after another, about 1.8 s of them). Which job, the
     account's clock, who's reading the notes and the Schedule's gate don't wait on each other; the notes,
     the visits and the job's detail then go together, the claims' notes as soon as the claims are known.
     A missed visit is only kept on a job not yet done. */
  const [target, timezone, viewer, gate] = await Promise.all([
    resolveJobCard(ctx.orgId, id),
    getSm8Timezone(ctx.orgId),
    sm8NotesAllowed() ? notesViewerOf(ctx.orgId, ctx.userId) : Promise.resolve(null),
    changeAllowed(ctx).catch(() => null),
  ]);
  const job = target.parentRemoteId;
  const today = todayInZone(timezone);
  const claimsRead = familyMediaSources(ctx.orgId, job);
  const [detail, notes, ourNotes, coming, missedAll] = await Promise.all([
    readMirrorJobDetail(ctx.orgId, job, today, {
      includeMoney: ctx.caps.has("workboard_money"),
      includeDesigns: ctx.caps.has("studio"),
      timezone,
    }),
    claimsRead.then((claims) => readJobNotes(ctx.orgId, job, claims)),
    viewer ? readOurJobNotes(ctx.orgId, job, 60, viewer) : readOurJobNotes(ctx.orgId, job),
    comingVisits(ctx.orgId, job, today),
    timezone ? missedVisits(ctx.orgId, job, Date.now(), timezone).catch(() => []) : Promise.resolve([]),
  ]);
  if (!detail) return Response.json({ error: "That job isn't here." }, { status: 404, headers: { "cache-control": "no-store" } });

  const open = !detail.status || /^(quote|work order)$/i.test(detail.status.trim());
  const missed = open ? missedAll : [];
  const sender = viewer?.sender ?? { state: "unknown" as const };
  const sm8Notes = viewer && offersSend(viewer.state, "note") ? { ready: sender.state === "ready", why: senderWords(sender) } : null;
  return ok({ detail, notes, ourNotes, sm8Notes, coming, ...(missed.length ? { missed } : {}), focusRemoteId: target.focusRemoteId, ...(gate?.ok ? { canChange: true } : {}) });
}
