import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { sm8NotesAllowed } from "@/lib/integrations/sm8-kinds";
import { sm8PressFromMobile } from "@/lib/integrations/sm8-press";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { offersSend } from "@/lib/integrations/sm8-write-plan";
import { NOTE_WORDS } from "@/lib/integrations/sm8-note-plan";
import { notOffered, sendEntryToSm8 } from "@/lib/integrations/sm8-note-entry";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* SENDING ONE OF YOUR NOTES TO SERVICEM8 from the phone: the job sheet's
   "Send to ServiceM8" and the pen's Also in ServiceM8, over the same gates
   and the same send (lib/integrations/sm8-note-entry). The token check comes
   first; then notes must go from this deployment, the presser may write on
   the board, the press is minted from the verified context alone, and the
   workspace must offer notes. Only the note's author may send it, its own
   words, on its own job; it goes as their linked ServiceM8 person. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  const startedAt = Date.now();
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const no = (status: number, error: string, extra: Record<string, unknown> = {}) =>
    Response.json({ error, ...extra }, { status, headers: { "cache-control": "no-store" } });

  if (!sm8NotesAllowed()) return no(409, NOTE_WORDS.card.notesUnavailable);
  const press = await sm8PressFromMobile(ctx);
  if (!press) return no(401, "Sign in again.");
  const state = await readSm8WriteState(ctx.orgId);
  if (!offersSend(state, "note")) return no(409, notOffered(state));

  const { id, noteId } = await params;
  const { parentRemoteId } = await resolveJobCard(ctx.orgId, id.trim().slice(0, 80));
  const sent = await sendEntryToSm8(press, state, { jobUuid: parentRemoteId, noteId }, startedAt);
  return sent.ok ? ok({ state: sent.state }) : no(400, sent.error, { state: sent.state ?? null });
}
