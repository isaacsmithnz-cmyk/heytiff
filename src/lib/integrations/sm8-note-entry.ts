import { supabaseAdmin } from "@/lib/supabase-server";
import type { Sm8Press } from "@/lib/integrations/sm8-press";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { sendRefusal, type Sm8WriteState } from "@/lib/integrations/sm8-write-plan";
import { sm8NoteSender, type NoteSender } from "@/lib/integrations/links";
import { NOTE_PRESS_BUDGET_MS, settlePressedWrites } from "@/lib/integrations/sm8-drain";
import { senderWords } from "@/lib/integrations/sm8-note-words";
import {
  FLAG_UNDO_AFTER_SENT,
  NOTE_WORDS,
  pressRefusalWords,
  type NoteRefusal,
  type NoteState,
} from "@/lib/integrations/sm8-note-plan";
import { readOurJobNote, staffDisplayNames, type NotesViewer } from "@/lib/workboard/job-notes-query";
import { queueNoteCreate } from "@/app/actions/sm8-note-queue";

/* A DIARY ENTRY'S WAY TO SERVICEM8, and the words a press is answered in,
   with no session: the job sheet's doors (actions/job-note-sm8, which mints
   its press from the cookie) and the phone's (api/mobile, which mints its
   press from a verified token) both go through here, so a note goes, is
   refused, and is said the same way wherever it was pressed. Moved here
   from actions/job-note-sm8 as they were.

   Only a PRESS queues (lib/integrations/sm8-press): every caller mints one
   for a person it has already checked, and the queue refuses anything
   else. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Why notes aren't offered here, in the owner's order of fixes. */
export const notOffered = (state: Sm8WriteState | null) =>
  (state ? sendRefusal(state, "note") : null) ?? NOTE_WORDS.press.kindOff;

/** The presser, as the lines read them: their doors, their ServiceM8 name. */
export async function viewerOf(orgId: string, press: Sm8Press, state?: Sm8WriteState | null): Promise<NotesViewer> {
  const s = state ?? (await readSm8WriteState(orgId));
  const sender = await sm8NoteSender(orgId, press.staffId, s.tenantId ?? undefined);
  return { staffId: press.staffId, state: s, sender };
}

export const sm8NameOf = (s: NoteSender | null | undefined) => (s && "sm8Name" in s ? s.sm8Name : "that ServiceM8 person");

export { senderWords };

/** A queue helper's refusal, said to the person who pressed. `name` fills
    "Only {name}, who sent it / marked it done". */
export async function refusalWords(
  code: NoteRefusal,
  ctx: {
    orgId: string;
    press: Sm8Press;
    state?: Sm8WriteState | null;
    /** what was pressed: a send, a take-back, or a flag's mark */
    doing: "send" | "take_back" | "flag";
    /** who sent it, or marked it done, when that's the refusal */
    owner?: string | null;
  }
): Promise<string> {
  /* a mark on its way out: final while an Undo can't follow it once it went
     (read here, where the switch is this module's own) */
  if (code === "in_flight") return FLAG_UNDO_AFTER_SENT ? NOTE_WORDS.press.inFlight : NOTE_WORDS.press.inFlightFinal;
  /* the name the question and the refusal carry is the sender's own */
  const sm8Name =
    code === "confirm" || code === "denied" || code === "inactive"
      ? sm8NameOf(await sm8NoteSender(ctx.orgId, ctx.press.staffId))
      : null;
  const owner =
    code === "not_yours" && ctx.doing !== "send" && ctx.owner
      ? ((await staffDisplayNames(ctx.orgId, [ctx.owner])).get(ctx.owner) ?? null)
      : null;
  return pressRefusalWords(code, {
    doing: ctx.doing,
    sm8Name,
    owner,
    notOffered: code === "not_offered" && ctx.doing !== "take_back" ? notOffered(ctx.state ?? null) : null,
  });
}

/** The press's rows, sent in the foreground for a moment, then the drain. */
export async function settle(orgId: string, ids: readonly string[], startedAt: number): Promise<void> {
  await settlePressedWrites(orgId, ids, { startedAt, budgetMs: NOTE_PRESS_BUDGET_MS }).catch((err: unknown) => {
    console.error(`[sm8] a note press for org ${orgId} couldn't settle: ${err instanceof Error ? err.message : String(err)}`);
  });
}

export type NoteHead = {
  id: string;
  org_id: string;
  target_kind: string;
  target_id: string | null;
  author_id: string | null;
  reply_to_sm8_note_uuid: string | null;
  removed_at: string | null;
};

export async function readHead(orgId: string, noteId: string): Promise<NoteHead | null> {
  if (!UUID.test(noteId)) return null;
  const { data } = await supabaseAdmin
    .from("workboard_notes")
    .select("id, org_id, target_kind, target_id, author_id, reply_to_sm8_note_uuid, removed_at")
    .eq("org_id", orgId)
    .eq("id", noteId)
    .maybeSingle();
  return (data as NoteHead | null) ?? null;
}

export type EntrySend = { ok: true; state: NoteState | null } | { ok: false; error: string; state?: NoteState | null };

/** Send one of the presser's own entries to ServiceM8, once its gates have
    passed (notes on here, the presser a member who may write on the board,
    notes offered on the workspace): only its author, the row's own words,
    on the row's own job. The caller revalidates whatever its pages are. */
export async function sendEntryToSm8(
  press: Sm8Press,
  state: Sm8WriteState | null,
  input: { jobUuid: string; noteId: string },
  startedAt: number
): Promise<EntrySend> {
  const orgId = press.orgId;
  const job = typeof input?.jobUuid === "string" ? input.jobUuid.trim() : "";
  const noteId = typeof input?.noteId === "string" ? input.noteId.trim() : "";

  const head = await readHead(orgId, noteId);
  if (!head || head.target_kind !== "job" || head.target_id !== job || head.removed_at) {
    return { ok: false, error: NOTE_WORDS.press.noNote };
  }
  if (!press.staffId || head.author_id !== press.staffId) return { ok: false, error: NOTE_WORDS.press.notAuthor };

  const queued = await queueNoteCreate(press, { noteId });
  if (!queued.ok) {
    const error = await refusalWords(queued.refusal, { orgId, press, state, doing: "send" });
    const now = await readOurJobNote(orgId, noteId, viewerOf(orgId, press, state));
    return { ok: false, error, state: now?.state ?? null };
  }
  await settle(orgId, queued.rowIds, startedAt);
  const now = await readOurJobNote(orgId, noteId, viewerOf(orgId, press, state));
  return { ok: true, state: now?.state ?? null };
}
