"use server";

/* NOTES ON THE JOB CARD, TO SERVICEM8 AND BACK (two-way phase 2, PR B).

   What a person presses on the job card's diary and its strip: a reply to a
   note that mentions them, a diary entry sent to ServiceM8, the Undo (or
   Remove) that takes one back, Mark done on one of ServiceM8's flags and its
   Undo, and their answer to "Is <ServiceM8 name> you?". Every one is a
   Server Function, so every one is reachable by direct POST: nothing the
   browser sends decides WHAT goes or WHERE. The words and the object are
   read from HeyTiff's own row by the queue helpers (sm8-note-queue), which
   are the only door a note is queued through; these actions only gate, save
   the row a reply needs, and say what happened in NOTE_WORDS' sentences.

   THE GATES, IN ORDER:
   0. the deployment sends notes (SM8_WRITES names `note`). Production sends
      files only, and there every action answers before any read: nothing
      about notes may change there until Isaac's phase-1 live walk.
   1. `workboard`: notes are the Workboard's.
   2. a press minted from the session, in this workspace, on everything that
      queues or takes back.
   3. on the SENDING actions only (a reply, Send to ServiceM8, Mark done):
      notes are offered here. Taking back, the flag's Undo, the link answer
      and the poll skip it — the helpers refuse `not_offered` only where a
      ServiceM8 call is needed, so a note that never went is taken back with
      Notes Off.

   Surface-neutral: ids in, states out. The Home redesign calls these as
   they are. */

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOrg } from "@/lib/permissions-server";
import { sm8PressFromSession, type Sm8Press } from "@/lib/integrations/sm8-press";
import { sm8NotesAllowed } from "@/lib/integrations/sm8-kinds";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { offersSend, sendHold, sendRefusal, type Sm8WriteState } from "@/lib/integrations/sm8-write-plan";
import { confirmSm8Link, sm8NoteSender, type NoteSender } from "@/lib/integrations/links";
import { noteAskerOf, noteSourceOf, sourceStands } from "@/lib/integrations/sm8-note-source";
import { NOTE_PRESS_BUDGET_MS, settlePressedWrites } from "@/lib/integrations/sm8-drain";
import {
  FLAG_UNDO_AFTER_SENT,
  fillWords,
  flagState,
  NOTE_WORDS,
  pressRefusalWords,
  replyText,
  type FlagState,
  type NoteRefusal,
  type NoteState,
} from "@/lib/integrations/sm8-note-plan";
import { jobIsReal } from "@/lib/compliance/send";
import { familyMediaSources, readJobNotes } from "@/lib/workboard/all-jobs-query";
import {
  readFlagOps,
  readFlagStates,
  readOurJobNote,
  readOurJobNotes,
  staffDisplayNames,
  type NotesViewer,
  type OurJobNote,
} from "@/lib/workboard/job-notes-query";
import { mentionedHandles } from "@/lib/workboard/sm8-mentions";
import { englishLine } from "@/lib/workboard/note-english";
import { queueFlagChange, queueNoteCreate, queueNoteTakeBack } from "./sm8-note-queue";
import { completeTask } from "./dashboard";

const WB = "/dashboard/workboard";
/* The new Home (/dashboard): the desk's one job card opens over it, and its
   diary threads each reply of yours and says where it stands (lib/
   dashboard/diary-reply). A press that changes a note of yours asks for
   Home again as it asks for the board, so the diary under the card shows
   it at once rather than on its next load. A flag's mark changes nothing
   the diary draws, and asks for the board alone. */
const HOME = "/dashboard";
const revalidateNotes = () => {
  revalidatePath(WB);
  revalidatePath(HOME);
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_WORDS = 4000;

export type ReplyResult =
  | { ok: true; note: OurJobNote }
  /** `sender`: who the server found the person to be, when that is why —
      the box then asks its question instead. */
  | { ok: false; error: string; sender?: NoteSender };
export type NoteStateResult =
  | { ok: true; state: NoteState | null }
  /** `state`: the row's line after the press, when it changed (a refusal
      kept on the row, a take-back that removed it but couldn't queue its
      delete). */
  | { ok: false; error: string; state?: NoteState | null };
export type TakeBackNoteResult =
  | { ok: true; gone: boolean; state: NoteState | null }
  | { ok: false; error: string; state?: NoteState | null };
export type FlagResult = { ok: true; state: FlagState } | { ok: false; error: string; state?: FlagState };
export type ConfirmResult = { ok: true; sender: NoteSender } | { ok: false; error: string };
export type JobNoteStates = { ours: Record<string, NoteState>; flags: Record<string, FlagState> };

const NONE: NoteState = { key: null, text: null, tone: null, acts: [] };

/* ── the gates ── */

type Gated = { ok: true; orgId: string; press: Sm8Press; state: Sm8WriteState | null } | { ok: false; error: string };

/** Gates 0 to 3 (the header). `sending` adds gate 3. */
async function gate(sending: boolean): Promise<Gated> {
  if (!sm8NotesAllowed()) return { ok: false, error: NOTE_WORDS.card.notesUnavailable };
  let orgId: string;
  try {
    ({ orgId } = await requireOrg("workboard"));
  } catch {
    return { ok: false, error: "You don't have access to the Workboard." };
  }
  const press = await sm8PressFromSession();
  if (!press || press.orgId !== orgId) return { ok: false, error: "Not signed in." };
  if (!sending) return { ok: true, orgId, press, state: null };
  const state = await readSm8WriteState(orgId);
  if (!offersSend(state, "note")) return { ok: false, error: notOffered(state) };
  return { ok: true, orgId, press, state };
}

/** Why notes aren't offered here, in the owner's order of fixes. */
const notOffered = (state: Sm8WriteState | null) =>
  (state ? sendRefusal(state, "note") : null) ?? NOTE_WORDS.press.kindOff;

/** The presser, as the lines read them: their doors, their ServiceM8 name. */
async function viewerOf(orgId: string, press: Sm8Press, state?: Sm8WriteState | null): Promise<NotesViewer> {
  const s = state ?? (await readSm8WriteState(orgId));
  const sender = await sm8NoteSender(orgId, press.staffId, s.tenantId ?? undefined);
  return { staffId: press.staffId, state: s, sender };
}

const sm8NameOf = (s: NoteSender | null | undefined) => (s && "sm8Name" in s ? s.sm8Name : "that ServiceM8 person");

/** The press sentence for why a sender can't send: null when they can. */
function senderWords(s: NoteSender): string | null {
  switch (s.state) {
    case "ready":
      return null;
    case "unlinked":
      return s.noCard ? NOTE_WORDS.press.noCard : NOTE_WORDS.press.unlinked;
    case "confirm":
      return fillWords(NOTE_WORDS.press.confirm, { sm8Name: s.sm8Name });
    case "denied":
      return fillWords(NOTE_WORDS.press.denied, { sm8Name: s.sm8Name });
    case "inactive":
      return fillWords(NOTE_WORDS.press.inactive, { sm8Name: s.sm8Name });
    case "bad_link":
      return NOTE_WORDS.press.badLink;
    default:
      return NOTE_WORDS.press.unknown;
  }
}

/** A queue helper's refusal, said to the person who pressed. `name` fills
    "Only {name}, who sent it / marked it done". */
async function refusalWords(
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
async function settle(orgId: string, ids: readonly string[], startedAt: number): Promise<void> {
  await settlePressedWrites(orgId, ids, { startedAt, budgetMs: NOTE_PRESS_BUDGET_MS }).catch((err: unknown) => {
    console.error(`[sm8] a note press for org ${orgId} couldn't settle: ${err instanceof Error ? err.message : String(err)}`);
  });
}

type NoteHead = {
  id: string;
  org_id: string;
  target_kind: string;
  target_id: string | null;
  author_id: string | null;
  reply_to_sm8_note_uuid: string | null;
  removed_at: string | null;
};

async function readHead(orgId: string, noteId: string): Promise<NoteHead | null> {
  if (!UUID.test(noteId)) return null;
  const { data } = await supabaseAdmin
    .from("workboard_notes")
    .select("id, org_id, target_kind, target_id, author_id, reply_to_sm8_note_uuid, removed_at")
    .eq("org_id", orgId)
    .eq("id", noteId)
    .maybeSingle();
  return (data as NoteHead | null) ?? null;
}

/** Who a note's create was pressed by, or with no create its author: the
    one person who may take it back. */
async function senderOfNote(orgId: string, noteId: string, authorId: string | null): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("sm8_writes")
    .select("requested_by")
    .eq("org_id", orgId)
    .eq("kind", "note")
    .eq("op", "create")
    .eq("note_id", noteId)
    .maybeSingle();
  const create = data as { requested_by: string | null } | null;
  return create ? create.requested_by : authorId;
}

/* ── a reply ── */

/** Reply to one of ServiceM8's notes that mentions you (or to one of ours
    that went, which ServiceM8 alerted you to). The reply is HeyTiff's row
    first — saved under the id the box minted, so a double press is one
    reply — and then goes to ServiceM8 as you, on whatever the note it
    answers hangs off: this job, or one of its claims.

    Everything a person can fix is checked BEFORE anything is saved, so a
    refusal leaves their words in the box. What only the queue can know
    (paused, capped, the settings unreadable) is kept on the saved row,
    which then says why and offers Send again.

    `closesTaskId` (PR C): the reply also closes the task made from this
    note — the task is ticked with no Done, because the reply is the answer,
    and the reply stands for the task while it is done (its line shows on
    the task, and Reopen never takes it back: it is a real reply). Only a
    task made from THIS note, still open; otherwise the reply goes as a
    plain reply and closes nothing. */
export async function replyToJobNote(input: {
  jobUuid: string;
  sourceNoteUuid: string;
  words: string;
  spoken?: boolean;
  composeId: string;
  closesTaskId?: string;
}): Promise<ReplyResult> {
  const startedAt = Date.now();
  const g = await gate(true);
  if (!g.ok) return g;
  const { orgId, press } = g;
  const job = typeof input?.jobUuid === "string" ? input.jobUuid.trim() : "";
  const sourceUuid = typeof input?.sourceNoteUuid === "string" ? input.sourceNoteUuid.trim() : "";
  const composeId = typeof input?.composeId === "string" ? input.composeId.trim() : "";

  /* 1. the box's own id: one reply per box, however many presses */
  if (!UUID.test(composeId)) return { ok: false, error: NOTE_WORDS.press.saveFailed };
  /* 2. words */
  const words = typeof input?.words === "string" ? input.words.trim().slice(0, MAX_WORDS) : "";
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
  const sender = await sm8NoteSender(orgId, press.staffId, g.state?.tenantId ?? undefined);
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

  /* the task this reply closes, if it asked to: one made from this very
     note, and still open — otherwise it closes nothing */
  const closes = await taskItCloses(orgId, sourceUuid, input?.closesTaskId);

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

  /* THE REPLY CLOSES ITS TASK (PR C): the task is ticked with no Done — the
     reply is the answer, so one note goes, not two — and the reply stands
     for the task while it is done. Only when this reply's own tick won. */
  if (closes) {
    const done = await completeTask(closes);
    if (done.ok) {
      const { error: linkError } = await supabaseAdmin
        .from("workboard_notes")
        .update({ task_id: closes })
        .eq("org_id", orgId)
        .eq("id", composeId)
        .is("task_id", null);
      if (linkError) console.error(`[sm8] couldn't link reply ${composeId} to the task it closed for org ${orgId}:`, linkError);
    }
  }

  if (queued.ok) await settle(orgId, queued.rowIds, startedAt);

  revalidateNotes();
  /* 10. the row, as it now stands */
  const note = await readOurJobNote(orgId, composeId, viewerOf(orgId, press, g.state));
  if (!note) return { ok: false, error: NOTE_WORDS.press.noNote };
  return { ok: true, note };
}

/** The task a reply closes: `taskId` when the task was made from the note
    the reply answers (job_note_actions names it) and is still open. Null
    otherwise, and with no read when none was asked for. */
async function taskItCloses(orgId: string, sourceUuid: string, taskId: unknown): Promise<string | null> {
  const id = typeof taskId === "string" ? taskId.trim() : "";
  if (!UUID.test(id)) return null;
  const [{ data: act }, { data: task }] = await Promise.all([
    supabaseAdmin
      .from("job_note_actions")
      .select("task_id")
      .eq("org_id", orgId)
      .eq("task_id", id)
      .eq("action", "task")
      .eq("sm8_note_uuid", sourceUuid)
      .limit(1)
      .maybeSingle(),
    supabaseAdmin.from("tasks").select("status").eq("org_id", orgId).eq("id", id).maybeSingle(),
  ]);
  if (!act || (task as { status: string | null } | null)?.status !== "open") return null;
  return id;
}

/* ── a diary entry, sent ── */

/** Send one of your own entries to ServiceM8: "Send to ServiceM8" on an
    entry that stayed in HeyTiff, the pen's Also in ServiceM8, and "Send
    again" after a failure, a cancel, a kept refusal or an unsure line.
    Only its author. What goes is the row's own words — a reply's as said,
    never the English copy — and where is the row's own object. */
export async function sendJobNoteToServiceM8(input: { jobUuid: string; noteId: string }): Promise<NoteStateResult> {
  const startedAt = Date.now();
  const g = await gate(true);
  if (!g.ok) return g;
  const { orgId, press } = g;
  const job = typeof input?.jobUuid === "string" ? input.jobUuid.trim() : "";
  const noteId = typeof input?.noteId === "string" ? input.noteId.trim() : "";

  const head = await readHead(orgId, noteId);
  if (!head || head.target_kind !== "job" || head.target_id !== job || head.removed_at) {
    return { ok: false, error: NOTE_WORDS.press.noNote };
  }
  if (!press.staffId || head.author_id !== press.staffId) return { ok: false, error: NOTE_WORDS.press.notAuthor };

  const queued = await queueNoteCreate(press, { noteId });
  revalidateNotes();
  if (!queued.ok) {
    const error = await refusalWords(queued.refusal, { orgId, press, state: g.state, doing: "send" });
    const now = await readOurJobNote(orgId, noteId, viewerOf(orgId, press, g.state));
    return { ok: false, error, state: now?.state ?? null };
  }
  await settle(orgId, queued.rowIds, startedAt);
  const now = await readOurJobNote(orgId, noteId, viewerOf(orgId, press, g.state));
  return { ok: true, state: now?.state ?? null };
}

/* ── taking one back ── */

/** Take one of your notes back, whatever state it is in: Undo on a reply,
    Remove on a diary entry that went (or was queued), and Try again on a
    line that reads "Still in ServiceM8". HeyTiff's row is kept as a
    tombstone while something of it may be in ServiceM8, and goes once
    nothing of it can be. Only whoever sent it — the helper checks, on every
    path. */
export async function takeBackJobNote(input: { jobUuid: string; noteId: string }): Promise<TakeBackNoteResult> {
  const startedAt = Date.now();
  const g = await gate(false);
  if (!g.ok) return g;
  const { orgId, press } = g;
  const job = typeof input?.jobUuid === "string" ? input.jobUuid.trim() : "";
  const noteId = typeof input?.noteId === "string" ? input.noteId.trim() : "";

  const head = await readHead(orgId, noteId);
  if (!head || head.target_kind !== "job" || head.target_id !== job) return { ok: false, error: NOTE_WORDS.press.noNote };

  const r = await queueNoteTakeBack(press, { noteId });
  revalidateNotes();
  const lineNow = async () => readOurJobNote(orgId, noteId, viewerOf(orgId, press));
  if (!r.ok && !r.removed) {
    const owner = r.refusal === "not_yours" ? await senderOfNote(orgId, noteId, head.author_id) : null;
    return { ok: false, error: await refusalWords(r.refusal, { orgId, press, doing: "take_back", owner }) };
  }
  if (!r.ok) {
    /* removed, its create closed; only the delete couldn't queue — the line
       now says "Still in ServiceM8" with Try again */
    const error = await refusalWords(r.refusal, { orgId, press, doing: "take_back" });
    const now = await lineNow();
    return { ok: false, error, state: now?.state ?? null };
  }
  const ids = r.plan === "deleting" ? await takeBackRowIds(orgId, noteId) : [];
  await settle(orgId, ids, startedAt);
  const now = await lineNow();
  return { ok: true, gone: !now, state: now?.state ?? null };
}

/** The take-back row a press just queued, to send it in the foreground. */
async function takeBackRowIds(orgId: string, noteId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("sm8_writes")
    .select("id")
    .eq("org_id", orgId)
    .eq("kind", "note")
    .eq("op", "delete")
    .eq("note_id", noteId)
    .eq("status", "queued");
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

/* ── ServiceM8's flags ── */

/** One flagged note's line, with our marks on it, as the presser sees it. */
async function flagStateOf(orgId: string, press: Sm8Press, noteUuid: string, state?: Sm8WriteState | null): Promise<FlagState> {
  const [source, ops, s] = await Promise.all([
    noteSourceOf(orgId, noteUuid),
    readFlagOps(orgId, [noteUuid]),
    state ? Promise.resolve(state) : readSm8WriteState(orgId),
  ]);
  const completedBy = source?.completedBy ?? null;
  const name = completedBy ? await sm8StaffName(orgId, completedBy) : null;
  return flagState({
    mirror: { flagged: !!source?.flagged, completedByName: name, completedBy, editDate: source?.editDate ?? null },
    ops: ops.get(noteUuid) ?? [],
    hold: s.readable ? sendHold(s, "note") : null,
    trialNow: s.mode === "trial",
    viewerStaffId: press.staffId,
  });
}

async function sm8StaffName(orgId: string, uuid: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from("sm8_staff").select("first, last").eq("org_id", orgId).eq("uuid", uuid).maybeSingle();
  const s = data as { first: string | null; last: string | null } | null;
  const name = s ? [s.first, s.last].filter(Boolean).join(" ").trim() : "";
  return name || null;
}

/** Mark one of ServiceM8's flagged notes done, as you, checked against the
    edit time you saw — if somebody changed it since, nothing goes and the
    card looks again. Also Mark done again, once somebody cleared ours. */
export async function markJobNoteDone(input: {
  jobUuid: string;
  noteUuid: string;
  seenEditDate: string | null;
  pressId: string;
}): Promise<FlagResult> {
  const startedAt = Date.now();
  const g = await gate(true);
  if (!g.ok) return g;
  const { orgId, press } = g;
  const noteUuid = typeof input?.noteUuid === "string" ? input.noteUuid.trim() : "";
  const q = await queueFlagChange(press, {
    noteUuid,
    done: true,
    seenEditDate: typeof input?.seenEditDate === "string" ? input.seenEditDate : null,
    pressId: typeof input?.pressId === "string" ? input.pressId : "",
  });
  revalidatePath(WB);
  if (!q.ok) {
    const error = await refusalWords(q.refusal, { orgId, press, state: g.state, doing: "flag" });
    return { ok: false, error, state: UUID.test(noteUuid) ? await flagStateOf(orgId, press, noteUuid, g.state) : undefined };
  }
  await settle(orgId, q.rowIds, startedAt);
  return { ok: true, state: await flagStateOf(orgId, press, noteUuid, g.state) };
}

/** Take your own Mark done back. A mark still waiting is simply cancelled —
    nothing is asked of ServiceM8, and it works with Notes Off. One that is
    going now can't be (while FLAG_UNDO_AFTER_SENT is off, no Undo is
    offered once a mark went, so "try again" would be a promise nobody can
    keep). Only whoever marked it. */
export async function undoJobNoteDone(input: { jobUuid: string; noteUuid: string; pressId: string }): Promise<FlagResult> {
  const startedAt = Date.now();
  const g = await gate(false);
  if (!g.ok) return g;
  const { orgId, press } = g;
  const noteUuid = typeof input?.noteUuid === "string" ? input.noteUuid.trim() : "";
  const q = await queueFlagChange(press, {
    noteUuid,
    done: false,
    pressId: typeof input?.pressId === "string" ? input.pressId : "",
  });
  revalidatePath(WB);
  if (!q.ok) {
    let owner: string | null = null;
    if (q.refusal === "not_yours" && UUID.test(noteUuid)) {
      const ops = (await readFlagOps(orgId, [noteUuid])).get(noteUuid) ?? [];
      owner = ops.find((o) => o.flag_done)?.requested_by ?? null;
    }
    const error = await refusalWords(q.refusal, { orgId, press, doing: "flag", owner });
    return { ok: false, error, state: UUID.test(noteUuid) ? await flagStateOf(orgId, press, noteUuid) : undefined };
  }
  if (q.rowIds.length > 0) await settle(orgId, q.rowIds, startedAt);
  return { ok: true, state: await flagStateOf(orgId, press, noteUuid) };
}

/* ── "Is <ServiceM8 name> you?" ── */

/** Your answer, for your OWN link and only the link you saw (`remoteId`):
    after an owner relinks you, Yes confirms nothing and says so. Yes never
    sends anything by itself — the box then offers Send reply, and a saved
    row's line follows it with its own Send. "Not me" is kept as a denial. */
export async function confirmMySm8Link(input: { remoteId: string; answer: "yes" | "no" }): Promise<ConfirmResult> {
  const g = await gate(false);
  if (!g.ok) return g;
  const { orgId, press } = g;
  const answer = input?.answer;
  if (answer !== "yes" && answer !== "no") return { ok: false, error: "That isn't an answer." };
  const remoteId = typeof input?.remoteId === "string" ? input.remoteId.trim() : "";
  if (!press.staffId) return { ok: false, error: NOTE_WORDS.press.noCard };
  const state = await readSm8WriteState(orgId);
  if (!state.tenantId) return { ok: false, error: "ServiceM8 isn't connected." };
  const saved = await confirmSm8Link({
    orgId,
    tenantId: state.tenantId,
    staffId: press.staffId,
    userId: press.userId,
    remoteId,
    answer,
  });
  if (!saved.ok) return saved;
  revalidateNotes();
  return { ok: true, sender: await sm8NoteSender(orgId, press.staffId, state.tenantId) };
}

/* ── the card's poll ── */

/** Where each of our notes on this job stands, and each flag — what the
    card asks every few seconds while something is on its way. Null where
    the deployment sends no notes, or the viewer can't open the job. */
export async function readJobNoteStates(input: { jobUuid: string }): Promise<JobNoteStates | null> {
  if (!sm8NotesAllowed()) return null;
  let orgId: string;
  try {
    ({ orgId } = await requireOrg("workboard"));
  } catch {
    return null;
  }
  const press = await sm8PressFromSession();
  if (!press || press.orgId !== orgId) return null;
  const job = typeof input?.jobUuid === "string" ? input.jobUuid.trim() : "";
  if (!job) return null;
  const viewer = await viewerOf(orgId, press);
  const claims = await familyMediaSources(orgId, job);
  const [ours, notes] = await Promise.all([readOurJobNotes(orgId, job, 60, viewer), readJobNotes(orgId, job, claims)]);
  const { flags } = await readFlagStates(orgId, notes, viewer);
  return { ours: Object.fromEntries(ours.map((n) => [n.id, n.state ?? NONE])), flags };
}
