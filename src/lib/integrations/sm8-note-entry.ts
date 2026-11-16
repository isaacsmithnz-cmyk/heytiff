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
  replyText,
  type NoteRefusal,
  type NoteState,
} from "@/lib/integrations/sm8-note-plan";
import { readOurJobNote, staffDisplayNames, type NotesViewer, type OurJobNote } from "@/lib/workboard/job-notes-query";
import { noteAskerOf, noteSourceOf, sourceStands } from "@/lib/integrations/sm8-note-source";
import { familyMediaSources } from "@/lib/workboard/all-jobs-query";
import { jobIsReal } from "@/lib/compliance/send";
import { mentionedHandles } from "@/lib/workboard/sm8-mentions";
import { englishLine } from "@/lib/workboard/note-english";
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

export type ReplyResult =
  | { ok: true; note: OurJobNote }
  /** `sender`: who the server found the person to be, when that is why —
      the box then asks its question instead. */
  | { ok: false; error: string; sender?: NoteSender };

const MAX_REPLY = 4000;

/** A reply to one of ServiceM8's notes that mentions the presser, once its
    gates have passed: the job sheet's Reply (actions/job-note-sm8, with its
    task to close) and the phone's (api/mobile/jobs/[id]/notes, `replyTo`)
    both come through here, so a reply is checked, saved and sent the same
    way wherever it was pressed. Moved here from actions/job-note-sm8 as it
    was. `afterQueue` runs once the reply is queued, before it settles. The
    caller revalidates whatever its pages are. */
export async function replyToNote(
  press: Sm8Press,
  state: Sm8WriteState | null,
  input: { jobUuid: string; sourceNoteUuid: string; words: string; spoken?: boolean; composeId: string },
  startedAt: number,
  afterQueue?: (composeId: string) => Promise<void>
): Promise<ReplyResult> {
  const orgId = press.orgId;
  const job = typeof input?.jobUuid === "string" ? input.jobUuid.trim() : "";
  const sourceUuid = typeof input?.sourceNoteUuid === "string" ? input.sourceNoteUuid.trim() : "";
  const composeId = typeof input?.composeId === "string" ? input.composeId.trim() : "";

  /* 1. the box's own id: one reply per box, however many presses */
  if (!UUID.test(composeId)) return { ok: false, error: NOTE_WORDS.press.saveFailed };
  /* 2. words */
  const words = typeof input?.words === "string" ? input.words.trim().slice(0, MAX_REPLY) : "";
  if (!words) return { ok: false, error: NOTE_WORDS.press.emptyReply };

  /* 3. the note it answers, on this job or one of its claims */
  const source = job ? await noteSourceOf(orgId, sourceUuid) : null;
  if (!source) return { ok: false, error: NOTE_WORDS.press.noNote };
  if (source.relatedUuid !== job) {
    const family = await familyMediaSources(orgId, job);
    if (!family.some((c) => c.remoteId === source.relatedUuid)) return { ok: false, error: NOTE_WORDS.press.noNote };
  }
  /* ...and still standing: nobody answers a note its author took back, or
     one somebody removed in ServiceM8 */
  const standing = await sourceStands(orgId, sourceUuid, source.origin);
  if (standing === null) return { ok: false, error: NOTE_WORDS.press.saveFailed };
  if (!standing) return { ok: false, error: NOTE_WORDS.press.noNote };
  /* 4. nothing goes to a job its own business deleted — checked before the
     row is saved, so the words stay in the box */
  if (!(await jobIsReal(orgId, source.relatedUuid))) return { ok: false, error: NOTE_WORDS.press.jobGone };

  /* 5. who it would go as: the box asks the question instead of saving */
  const sender = await sm8NoteSender(orgId, press.staffId, state?.tenantId ?? undefined);
  const refused = senderWords(sender);
  if (refused || sender.state !== "ready" || !press.staffId) {
    return { ok: false, error: refused ?? NOTE_WORDS.press.unknown, sender };
  }

  /* 6. a reply answers a note that asked YOU */
  if (!sender.handle || mentionedHandles(source.text, [sender.handle]).length === 0) {
    return { ok: false, error: NOTE_WORDS.press.notMentioned };
  }

  /* 7. the words go as said; the diary keeps them in English (lang/policy)
     — both fixed now, so every later send sends the same words */
  const english = await englishLine(words);
  const asker = await noteAskerOf(orgId, sourceUuid, source);
  /* nobody is addressed by their own reply */
  const askerHandle = asker && asker.sm8Uuid.toLowerCase() !== sender.staffUuid.toLowerCase() ? asker.handle : null;

  /* 8. RECORD FIRST: HeyTiff's row, under the box's id */
  const now = new Date().toISOString();
  const { error: saveError } = await supabaseAdmin.from("workboard_notes").upsert(
    {
      id: composeId,
      org_id: orgId,
      author_id: press.staffId,
      target_kind: "job",
      target_id: job,
      transcript: words,
      source: input.spoken ? "voice" : "text",
      status: "applied",
      applied: { jobNotes: [replyText(askerHandle, english)], sm8Text: replyText(askerHandle, words) },
      applied_at: now,
      reply_to_sm8_note_uuid: sourceUuid,
    },
    { onConflict: "id", ignoreDuplicates: true }
  );
  if (saveError) return { ok: false, error: NOTE_WORDS.press.saveFailed };
  const saved = await readHead(orgId, composeId);
  if (
    !saved ||
    saved.target_kind !== "job" ||
    saved.target_id !== job ||
    saved.author_id !== press.staffId ||
    saved.reply_to_sm8_note_uuid !== sourceUuid
  ) {
    return { ok: false, error: NOTE_WORDS.press.saveFailed };
  }
  /* a late second press of a reply somebody has already taken back */
  if (saved.removed_at) return { ok: false, error: NOTE_WORDS.press.noNote };

  /* 9. queue it — a refusal stays on the row; an Undo racing this press is
     settled inside the helper */
  const queued = await queueNoteCreate(press, { noteId: composeId });

  if (afterQueue) await afterQueue(composeId);

  if (queued.ok) await settle(orgId, queued.rowIds, startedAt);

  /* 10. the row, as it now stands */
  const note = await readOurJobNote(orgId, composeId, viewerOf(orgId, press, state));
  if (!note) return { ok: false, error: NOTE_WORDS.press.noNote };
  return { ok: true, note };
}
