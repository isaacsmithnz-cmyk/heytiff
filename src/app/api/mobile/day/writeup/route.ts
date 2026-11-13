import { notesViewerOf } from "@/lib/workboard/job-notes-query";
import { sm8NotesAllowed } from "@/lib/integrations/sm8-kinds";
import { offersSend } from "@/lib/integrations/sm8-write-plan";
import { senderWords } from "@/lib/integrations/sm8-note-words";
import { ok, requireMobile } from "@/lib/mobile/auth";
import { writeUpDay } from "@/lib/mobile/day-writeup";

/* YOUR DAY, WRITTEN UP (lib/mobile/day-writeup): one entry per job on the
   Clock off sheet, to the finish you're thinking of (`until`), drafted from
   what you left on each job today. Nothing is written here: the phone keeps
   what you keep through the job's own pen, and sends to ServiceM8 only what
   you tick, through the note's own send; `sm8Notes` says whether that tick
   is offered, as the job read says it. Your own day needs no grant beyond
   being a member. The wrap-up after Clock off reads the same, with each
   job's notes and photos from today and everyone else's notes on it; `on`
   is a day already over, for its wrap-up the morning after. */
export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const [day, viewer] = await Promise.all([
    writeUpDay(ctx, new URL(request.url).searchParams.get("until"), Date.now(), new URL(request.url).searchParams.get("on"), new URL(request.url).searchParams.get("job")),
    sm8NotesAllowed() && ctx.caps.has("workboard") ? notesViewerOf(ctx.orgId, ctx.userId).catch(() => null) : null,
  ]);
  const sender = viewer?.sender ?? { state: "unknown" as const };
  const sm8Notes = viewer && offersSend(viewer.state, "note") ? { ready: sender.state === "ready", why: senderWords(sender) } : null;
  return ok({ ...day, sm8Notes });
}
