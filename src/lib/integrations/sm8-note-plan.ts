/* Notes to ServiceM8 — the decisions, pure (two-way phase 2, PR A).

   sm8-write-plan's sibling for the second kind of write. Everything here is
   a function of its arguments: the subjects a note is queued under, the
   words that go, what an Undo has to do, and what a note's line says to the
   person looking at it. The engine (sm8-note-send, sm8-writes) and the
   queue helpers (app/actions/sm8-note-queue) carry these out; the job card
   (PR B) and the task line (PR C) only draw what noteState and flagState
   say.

   THE RULES THIS FILE HOLDS, whoever draws them:
   - A NOTE GOES AS THE PERSON WHO PRESSED IT, and only they can press it
     again or take it back: every door below is offered to that person only.
   - A TAKE-BACK IS FINAL. A note taken back is never sent again; to say it
     again a person writes a new note.
   - HEYTIFF NEVER SAYS "NOT SENT" OVER A NOTE THAT MAY BE IN SERVICEM8. A
     create whose answer was lost reads `line.unsure`, and a refusal stored
     on the row ranks below every live state of its create.
   - A NOTE SOMEONE REMOVED IN SERVICEM8 IS NEVER POSTED AGAIN BY ITSELF. */

import { dateOrNull } from "./sm8-sync-plan";
import { fillWords, NOTE_WORDS } from "./sm8-note-words";
import type { SendHold, Sm8WriteStatus } from "./sm8-write-plan";

export { NOTE_WORDS, fillWords };

/* ── the switches a live test flips ── */

/** Whether `note.json?$filter=uuid eq '…'` returns a note someone removed
    (active = 0). Until live test 4 proves it does, a uuid of ours read back
    as NOT FOUND can't be told from one a person removed, so HeyTiff never
    posts it again by itself (sm8-note-send). Flipped by a one-line PR. */
export const READBACK_SEES_INACTIVE = false;

/** Whether an empty completer clears a flag's done mark. Until live test 5
    proves it, a mark that went can't be taken back from HeyTiff. Flipped by
    a one-line PR. */
export const FLAG_UNDO_AFTER_SENT = false;

/** A settled note row's words leave the queue this long after it settles;
    HeyTiff's own row keeps them, and a later press puts them back. */
export const NOTE_TEXT_DAYS = 30;

/** The most a note says, in characters — the migration's check. */
export const NOTE_TEXT_MAX = 4000;

/* ── subjects ── */

/** The subject a note's queue row is written under: one per THING, never
    reused for another. A create's subject never changes once the create
    exists — every later press reuses it (sm8-note-queue). */
export const noteSubject = {
  /** A diary note or a reply. */
  create: (noteId: string) => `jobnote:${noteId}`,
  /** A task's Done. `task:none:…` for a Done first queued after its task
      was deleted. The prefix `task:<id>:done` still finds every Done of a
      task (sm8_writes_safety.sql). */
  done: (taskId: string | null, noteId: string) => `task:${taskId ?? "none"}:done:${noteId}`,
  /** One press of Mark done, or of its Undo, on one of ServiceM8's flags. */
  flag: (noteUuid: string, pressId: string) => `flag:${noteUuid}:${pressId}`,
  /** A take-back — one per create, ever. */
  undo: (createRowId: string) => `undo:${createRowId}`,
};

export type ParsedNoteSubject =
  | { via: "note"; noteId: string }
  | { via: "done"; taskId: string | null; noteId: string }
  | { via: "flag"; noteUuid: string; pressId: string }
  | { via: "undo"; createRowId: string };

export function parseNoteSubject(s: string): ParsedNoteSubject | null {
  let m = /^jobnote:(.+)$/.exec(s);
  if (m) return { via: "note", noteId: m[1] };
  m = /^task:([^:]+):done:(.+)$/.exec(s);
  if (m) return { via: "done", taskId: m[1] === "none" ? null : m[1], noteId: m[2] };
  m = /^flag:([^:]+):(.+)$/.exec(s);
  if (m) return { via: "flag", noteUuid: m[1], pressId: m[2] };
  m = /^undo:(.+)$/.exec(s);
  if (m) return { via: "undo", createRowId: m[1] };
  return null;
}

/** Whether a subject is a Done (the day-old rule applies to it). */
export const isDoneSubject = (s: string) => parseNoteSubject(s)?.via === "done";

/* ── labels and words ── */

export type NoteLabelVia = "diary" | "reply" | "done" | "flag_done" | "flag_clear" | "take_back";

/** The name the owner's list, a cancel's note and OLD code after a rollback
    call a note row by: its payload is `{ name: <this> }` and nothing else,
    so no screen ever shows a note's words from the queue. */
export function noteLabel(via: NoteLabelVia): string {
  return NOTE_WORDS.label[via];
}

const cap = (s: string) => s.slice(0, NOTE_TEXT_MAX);

/** A reply as it goes to ServiceM8: "@lukeingold on my way". The @handle
    keeps ServiceM8's mention alert; the words are as said. */
export function replyText(handle: string | null, words: string): string {
  const said = words.trim();
  const h = handle?.trim().toLowerCase();
  return cap(h ? `@${h} ${said}` : said);
}

/** A task's Done: "@lukeingold Done." to whoever asked, or plain "Done."
    when the asker isn't known or is the sender. Handles are lower case
    (sm8-mentions' sm8Handle). */
export function doneText(
  asker: { handle: string | null; sm8Uuid: string | null } | null,
  senderSm8Uuid: string | null
): string {
  if (!asker || !asker.handle?.trim()) return NOTE_WORDS.label.done;
  if (asker.sm8Uuid && senderSm8Uuid && asker.sm8Uuid.toLowerCase() === senderSm8Uuid.toLowerCase()) {
    return NOTE_WORDS.label.done;
  }
  return `@${asker.handle.trim().toLowerCase()} ${NOTE_WORDS.label.done}`;
}

/** The words a note goes to ServiceM8 with, read from HeyTiff's own row
    (`workboard_notes.applied`) on every press, never from a browser:
    `sm8Text` when the row fixed them at save (a reply in the words said,
    with its @handle; a Done), otherwise the kept words the diary shows (a
    diary entry). Trimmed, capped, null when nothing is left. */
export function noteWords(applied: unknown): string | null {
  const a = applied && typeof applied === "object" && !Array.isArray(applied) ? (applied as Record<string, unknown>) : {};
  if (typeof a.sm8Text === "string" && a.sm8Text.trim()) return cap(a.sm8Text.trim());
  const kept = Array.isArray(a.jobNotes)
    ? a.jobNotes.filter((k): k is string => typeof k === "string" && !!k.trim()).map((k) => k.trim())
    : [];
  const words = kept.join("\n\n").trim();
  return words ? cap(words) : null;
}

/* ── the create, and taking it back ── */

/** A note's create row, as far as the plans read it. */
export type CreateRow = {
  id: string;
  status: Sm8WriteStatus | string;
  remote_uuid: string;
  lease_until: string | null;
  maybe_landed: boolean | null;
  verify_uuids: readonly string[] | null;
  taken_back_at?: string | null;
  requested_by?: string | null;
  last_error?: string | null;
  attempts?: number | null;
};

/** Something of the create may be in ServiceM8 although it isn't `sent`: an
    answer was lost (`maybe_landed` — a live claim sets it before anything
    goes, so a lapsed live send always may have landed), or an older uuid
    is still waiting for its check. */
export function mayHaveLanded(create: Pick<CreateRow, "maybe_landed" | "verify_uuids">): boolean {
  return create.maybe_landed === true || (create.verify_uuids?.length ?? 0) > 0;
}

/** A send still holding its claim. */
export function leaseLive(create: Pick<CreateRow, "status" | "lease_until">, now: number): boolean {
  if (create.status !== "sending" || !create.lease_until) return false;
  const until = Date.parse(create.lease_until);
  return !Number.isNaN(until) && until >= now;
}

/** A create that could still go: waiting, stopped short, a trial, or a send
    whose claim lapsed. */
export function createCanStillGo(create: Pick<CreateRow, "status" | "lease_until">, now: number): boolean {
  if (create.status === "queued" || create.status === "failed" || create.status === "trial") return true;
  return create.status === "sending" && !leaseLive(create, now);
}

export type UndoPlan = "nothing" | "cancel" | "delete" | "cancel_and_delete";

/** What an Undo has to do to a note's create:

    | the create                                                    | plan                |
    | none                                                          | nothing             |
    | cancelled, nothing may have landed                            | nothing             |
    | cancelled, it may have landed                                 | delete              |
    | queued, failed, trial or a lapsed send, nothing may have landed | cancel            |
    | the same, and it may have landed                              | cancel_and_delete   |
    | sending under a live claim                                    | delete (once it settles) |
    | sent                                                          | delete              | */
export function undoPlan(create: CreateRow | null, now: number): UndoPlan {
  if (!create) return "nothing";
  if (create.status === "sent") return "delete";
  if (create.status === "cancelled") return mayHaveLanded(create) ? "delete" : "nothing";
  if (leaseLive(create, now)) return "delete";
  return mayHaveLanded(create) ? "cancel_and_delete" : "cancel";
}

/** Whether a plan needs a request to ServiceM8. */
export const planNeedsSm8 = (plan: UndoPlan) => plan === "delete" || plan === "cancel_and_delete";

/** The uuids a take-back deletes: a sent create's own; otherwise its own
    only if it may have landed, and every uuid still waiting for its check. */
export function deleteTargets(create: CreateRow): string[] {
  const out =
    create.status === "sent"
      ? [create.remote_uuid]
      : [...(create.maybe_landed ? [create.remote_uuid] : []), ...(create.verify_uuids ?? [])];
  return [...new Set(out.filter(Boolean))];
}

/* ── flags ── */

/** One of our flag ops (an `update` row) on one ServiceM8 note. */
export type FlagOp = {
  id: string;
  status: Sm8WriteStatus | string;
  /** true: Mark done. false: the Undo that clears it. */
  flag_done: boolean;
  seen_edit_date: string | null;
  landed_edit_date: string | null;
  requested_by: string | null;
  last_error?: string | null;
  /** When it was queued, for ordering. */
  created_at: string;
};

/** Two edit times as the mirror shapes them (dateOrNull): "" and the zero
    date read null, and two nulls are equal. */
export function sameEditDate(a: string | null | undefined, b: string | null | undefined): boolean {
  return dateOrNull(a ?? null) === dateOrNull(b ?? null);
}

const newestFirst = (ops: readonly FlagOp[]) => [...ops].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

/** Our latest Mark done on a note, and whether an Undo pressed after it
    stands. */
function latestDone(ops: readonly FlagOp[]): { op: FlagOp; clearedAfter: boolean } | null {
  const sorted = newestFirst(ops);
  const i = sorted.findIndex((o) => o.flag_done);
  if (i < 0) return null;
  const clearedAfter = sorted
    .slice(0, i)
    .some((o) => !o.flag_done && (o.status === "queued" || o.status === "sending" || o.status === "sent"));
  return { op: sorted[i], clearedAfter };
}

/** Whether OUR latest Mark done still holds the flag as done:
    - it is queued or sending;
    - it is a trial op and sending is still a Trial run (`trialNow`) — once
      the mode leaves Trial run a trial op holds nothing, and the flag
      offers Mark done again;
    - it went, and the mirror's edit time is still the one it saw or the one
      it left. Any other edit time means somebody changed the note after
      us, so a flagged note with no completer is open again. */
export function flagHeldByUs(mirror: { editDate: string | null }, ops: readonly FlagOp[], trialNow: boolean): boolean {
  const done = latestDone(ops);
  if (!done || done.clearedAfter) return false;
  const { op } = done;
  if (op.status === "queued" || op.status === "sending") return true;
  if (op.status === "trial") return trialNow;
  if (op.status === "sent") {
    return sameEditDate(mirror.editDate, op.seen_edit_date) || sameEditDate(mirror.editDate, op.landed_edit_date);
  }
  return false;
}

/* ── what a note's line says ── */

/** The eleven reasons a HeyTiff row may keep for why its note didn't queue
    — exactly the migration's check list (a test reads both). Every other
    refusal is an answer to one press and is never stored. */
export const STORED_REFUSALS = [
  "unlinked",
  "no_card",
  "confirm",
  "denied",
  "inactive",
  "unknown",
  "bad_link",
  "job_gone",
  "capped",
  "unqueued",
  "unreadable",
] as const;

export type StoredRefusal = (typeof STORED_REFUSALS)[number];

export const isStoredRefusal = (v: unknown): v is StoredRefusal =>
  typeof v === "string" && (STORED_REFUSALS as readonly string[]).includes(v);

/** Every refusal a queue helper can answer a press with. */
export type NoteRefusal =
  | StoredRefusal
  | "not_offered"
  | "not_yours"
  | "in_flight"
  | "changed"
  | "not_flagged"
  | "no_note"
  | "removed_there";

/** A stored refusal's words: the press sentence to the person who pressed,
    the row sentence (with their name) to anyone else. */
const REFUSAL_WORDS: Record<StoredRefusal, { press: string; row: string }> = {
  unlinked: { press: NOTE_WORDS.press.unlinked, row: NOTE_WORDS.row.unlinked },
  no_card: { press: NOTE_WORDS.press.noCard, row: NOTE_WORDS.row.noCard },
  confirm: { press: NOTE_WORDS.press.confirm, row: NOTE_WORDS.row.unconfirmed },
  denied: { press: NOTE_WORDS.press.denied, row: NOTE_WORDS.row.denied },
  inactive: { press: NOTE_WORDS.press.inactive, row: NOTE_WORDS.row.inactive },
  unknown: { press: NOTE_WORDS.press.unknown, row: NOTE_WORDS.row.unknown },
  bad_link: { press: NOTE_WORDS.press.badLink, row: NOTE_WORDS.row.badLink },
  job_gone: { press: NOTE_WORDS.press.jobGone, row: NOTE_WORDS.row.jobGone },
  capped: { press: NOTE_WORDS.press.capped, row: NOTE_WORDS.row.capped },
  unqueued: { press: NOTE_WORDS.press.unqueued, row: NOTE_WORDS.row.unqueued },
  unreadable: { press: NOTE_WORDS.press.unreadable, row: NOTE_WORDS.row.unreadable },
};

/** The fall-backs when a name isn't known. */
const SOMEONE = "The person who sent it";
const THEM = "that ServiceM8 person";

export function refusalWords(
  code: StoredRefusal,
  who: { viewerIsSender: boolean; senderName: string | null; sm8Name: string | null }
): string {
  const w = REFUSAL_WORDS[code];
  return fillWords(who.viewerIsSender ? w.press : w.row, {
    name: who.senderName || SOMEONE,
    sm8Name: who.sm8Name || THEM,
  });
}

/** A queue helper's refusal of ONE PRESS, said to the person who pressed —
    the job card's actions and the task's say it in these same words, so a
    refusal reads the same wherever the door was:
    - `doing`: what was pressed — a send (a reply, Send to ServiceM8, Send
      again), a take-back (Undo, Remove, Reopen, Try again), or a flag's mark;
    - `sm8Name`: who the presser is in ServiceM8, for the question and the
      link refusals;
    - `owner`: who sent it, or marked it done, when that is the refusal;
    - `notOffered`: why notes aren't offered, in the owner's order of fixes
      (sendRefusal), for a send. */
export function pressRefusalWords(
  code: NoteRefusal,
  ctx: {
    doing: "send" | "take_back" | "flag";
    sm8Name?: string | null;
    owner?: string | null;
    notOffered?: string | null;
  }
): string {
  const sm8Name = ctx.sm8Name || THEM;
  switch (code) {
    case "unlinked":
      return NOTE_WORDS.press.unlinked;
    case "no_card":
      return NOTE_WORDS.press.noCard;
    case "confirm":
      return fillWords(NOTE_WORDS.press.confirm, { sm8Name });
    case "denied":
      return fillWords(NOTE_WORDS.press.denied, { sm8Name });
    case "inactive":
      return fillWords(NOTE_WORDS.press.inactive, { sm8Name });
    case "unknown":
      return NOTE_WORDS.press.unknown;
    case "bad_link":
      return NOTE_WORDS.press.badLink;
    case "job_gone":
      return NOTE_WORDS.press.jobGone;
    case "capped":
      return NOTE_WORDS.press.capped;
    case "unqueued":
      return NOTE_WORDS.press.unqueued;
    case "unreadable":
      return NOTE_WORDS.press.unreadable;
    case "not_offered":
      return ctx.doing === "take_back" ? NOTE_WORDS.press.takeBackOff : ctx.notOffered || NOTE_WORDS.press.kindOff;
    case "not_yours": {
      if (ctx.doing === "send") return NOTE_WORDS.press.notAuthor;
      const name = ctx.owner || "the person";
      return fillWords(ctx.doing === "flag" ? NOTE_WORDS.press.notMarker : NOTE_WORDS.press.notYours, { name });
    }
    case "in_flight":
      return FLAG_UNDO_AFTER_SENT ? NOTE_WORDS.press.inFlight : NOTE_WORDS.press.inFlightFinal;
    case "changed":
      return NOTE_WORDS.press.changed;
    case "not_flagged":
      return NOTE_WORDS.press.notFlagged;
    case "removed_there":
      return NOTE_WORDS.press.removedThere;
    case "no_note":
    default:
      return NOTE_WORDS.press.noNote;
  }
}

export type NoteKey =
  | "line.sending"
  | "line.waitingWhy"
  | "line.sent"
  | "line.notSent"
  | "line.unsure"
  | "line.trial"
  | "line.takingOut"
  | "line.stillIn"
  | "line.removedThere";

export type NoteAct = "undo" | "send_again" | "take_out_again" | "confirm" | "link_people";

export type NoteState = {
  key: NoteKey | null;
  text: string | null;
  tone: "ok" | "warn" | "bad" | null;
  acts: NoteAct[];
};

const NONE: NoteState = { key: null, text: null, tone: null, acts: [] };

/** HeyTiff's row, as far as its line goes. */
export type NoteRowIn = { removed: boolean; refusal: StoredRefusal | null };

/** A queue row as its line reads it — the create or its take-back. */
export type QueueRowIn = CreateRow & { last_error: string | null; attempts: number };

const holdWhy = (hold: SendHold): string | null =>
  hold === "paused" ? NOTE_WORDS.why.paused : hold === "reconnect" ? NOTE_WORDS.why.reconnect : hold === "off" ? NOTE_WORDS.why.off : null;

const line = (key: NoteKey, text: string, tone: NoteState["tone"], acts: NoteAct[]): NoteState => ({
  key,
  text,
  tone,
  acts,
});

/** What one of our notes says about ServiceM8, and the doors it offers —
    the first case that applies:

    |  # | case                                                                 | line                         |
    |  1 | a take-back queued behind a hold                                     | stillIn + the hold           |
    |  2 | a take-back queued or sending                                        | takingOut                    |
    |  3 | a take-back failed, a trial, or cancelled for any other reason than nothing to take back | stillIn + why, Try again |
    |  4 | a take-back sent, or cancelled with nothing to take back             | none                         |
    |  5 | no take-back row, and something of it may still be in ServiceM8 or could still go | stillIn + why, Try again |
    |  6 | removed or taken back, and nothing of it can be in ServiceM8         | none                         |
    |  7 | the create cancelled because a person removed it in ServiceM8        | removedThere                 |
    |  8 | the create queued behind a hold                                      | waitingWhy + the hold        |
    |  9 | queued with an error                                                 | waitingWhy + the error       |
    | 10 | queued and tried before                                              | waitingWhy + retry           |
    | 11 | queued or sending                                                    | sending                      |
    | 12 | sent                                                                 | sent                         |
    | 13 | not queued, sending or sent, and it may have landed                  | unsure                       |
    | 14 | a stored refusal (no create, or one failed, cancelled or a trial)    | notSent + the refusal        |
    | 15 | failed                                                               | notSent + the error          |
    | 16 | a trial                                                              | trial                        |
    | 17 | cancelled for any other reason                                       | notSent + the reason         |
    | 18 | no create and no refusal                                             | none: a HeyTiff-only entry   |

    Every door is the sender's alone. In cases 7 to 17 the sender always has
    `undo` (Undo on a reply, Remove on a diary entry): a person can withdraw
    a note whatever its state. */
export function noteState(input: {
  row: NoteRowIn;
  create: QueueRowIn | null;
  takeBack: QueueRowIn | null;
  /** sendHold(state, "note"). */
  hold: SendHold;
  /** offersSend(state, "note"). */
  offered: boolean;
  viewerIsSender: boolean;
  senderName: string | null;
  sm8Name: string | null;
}): NoteState {
  const { row, create, takeBack, hold, offered, viewerIsSender } = input;
  const mine = (acts: NoteAct[]): NoteAct[] => (viewerIsSender ? acts : []);
  const who = { viewerIsSender, senderName: input.senderName, sm8Name: input.sm8Name };

  /* ── 1–4: a take-back row ── */
  if (takeBack) {
    const st = takeBack.status;
    if (st === "queued" && holdWhy(hold)) {
      return line("line.stillIn", fillWords(NOTE_WORDS.line.stillIn, { reason: holdWhy(hold) }), "warn", []);
    }
    if (st === "queued" || st === "sending") return line("line.takingOut", NOTE_WORDS.line.takingOut, null, []);
    if (st === "sent") return NONE;
    if (st === "cancelled" && takeBack.last_error === NOTE_WORDS.row.nothingToTakeBack) return NONE;
    const reason = st === "trial" ? NOTE_WORDS.why.trial : takeBack.last_error || NOTE_WORDS.why.notTakenOut;
    return line("line.stillIn", fillWords(NOTE_WORDS.line.stillIn, { reason }), "bad", mine(["take_out_again"]));
  }

  /* ── 5–6: taken back or removed, with no take-back row ── */
  const closed = !!create?.taken_back_at;
  if (row.removed || closed) {
    const maybeThere =
      !!create &&
      ((closed &&
        (create.status === "sending" || create.status === "sent" || mayHaveLanded(create))) ||
        (row.removed &&
          !closed &&
          !(create.status === "cancelled" && !mayHaveLanded(create))));
    if (maybeThere) {
      const reason =
        (row.refusal ? refusalWords(row.refusal, who) : null) ??
        holdWhy(hold) ??
        (!offered ? NOTE_WORDS.why.notSending : NOTE_WORDS.why.notTakenOut);
      return line("line.stillIn", fillWords(NOTE_WORDS.line.stillIn, { reason }), "bad", mine(["take_out_again"]));
    }
    return NONE;
  }

  /* ── 7–13: the create's own state ── */
  if (create) {
    const st = create.status;
    if (st === "cancelled" && create.last_error === NOTE_WORDS.row.noteGone) {
      return line("line.removedThere", NOTE_WORDS.line.removedThere, null, mine(["undo"]));
    }
    if (st === "queued") {
      const why = holdWhy(hold);
      if (why) {
        return line("line.waitingWhy", fillWords(NOTE_WORDS.line.waitingWhy, { why }), hold === "reconnect" ? "warn" : null, mine(["undo"]));
      }
      if (create.last_error) {
        return line("line.waitingWhy", fillWords(NOTE_WORDS.line.waitingWhy, { why: create.last_error }), "warn", mine(["undo"]));
      }
      if ((create.attempts ?? 0) > 0) {
        return line("line.waitingWhy", fillWords(NOTE_WORDS.line.waitingWhy, { why: NOTE_WORDS.why.retry }), "warn", mine(["undo"]));
      }
    }
    if (st === "queued" || st === "sending") return line("line.sending", NOTE_WORDS.line.sending, null, mine(["undo"]));
    if (st === "sent") return line("line.sent", NOTE_WORDS.line.sent, "ok", mine(["undo"]));
    if (mayHaveLanded(create)) return line("line.unsure", NOTE_WORDS.line.unsure, "bad", mine(["send_again", "undo"]));
  }

  /* ── 14: a stored refusal, never over a create that is waiting or went ── */
  if (row.refusal) {
    const text = fillWords(NOTE_WORDS.line.notSent, { reason: refusalWords(row.refusal, who) });
    return line("line.notSent", text, "bad", mine([row.refusal === "confirm" ? "confirm" : "send_again", "undo"]));
  }

  /* ── 15–18 ── */
  if (!create) return NONE;
  if (create.status === "failed") {
    const text = fillWords(NOTE_WORDS.line.notSent, { reason: create.last_error || NOTE_WORDS.row.noteRefused });
    return line("line.notSent", text, "bad", mine(["send_again", "undo"]));
  }
  if (create.status === "trial") return line("line.trial", NOTE_WORDS.line.trial, null, mine(["send_again", "undo"]));
  /* every cancel writes its reason; one that didn't says only "Not sent" */
  const text = create.last_error
    ? fillWords(NOTE_WORDS.line.notSent, { reason: create.last_error })
    : NOTE_WORDS.line.notSent.replace(/\s*\{reason\}$/, "").replace(/\.$/, "") + ".";
  return line("line.notSent", text, null, mine(["send_again", "undo"]));
}

/* ── what a flagged note says ── */

export type FlagKey =
  | "flag.flagged"
  | "flag.marking"
  | "flag.waitingWhy"
  | "flag.done"
  | "flag.doneBy"
  | "flag.notMarked"
  | "flag.unmarking"
  | "flag.trial";

export type FlagAct = "mark_done" | "unmark" | "mark_done_again";

export type FlagState = { key: FlagKey | null; text: string | null; tone: "ok" | "warn" | "bad" | null; acts: FlagAct[] };

const FLAG_NONE: FlagState = { key: null, text: null, tone: null, acts: [] };

/** What one of ServiceM8's flagged notes says, with our marks on it.
    Mark done is offered on a flagged note with no completer that our marks
    don't hold; Mark done again in that state after a mark of ours went.
    Undo (`unmark`) only to whoever pressed the latest mark, while it waits —
    and once it went only when FLAG_UNDO_AFTER_SENT is set. */
export function flagState(input: {
  mirror: { flagged: boolean; completedByName: string | null; completedBy?: string | null; editDate: string | null };
  ops: readonly FlagOp[];
  hold: SendHold;
  trialNow: boolean;
  viewerStaffId: string | null;
}): FlagState {
  const { mirror, ops, hold, trialNow, viewerStaffId } = input;
  const done = latestDone(ops);
  const op = done && !done.clearedAfter ? done.op : null;
  const presser = !!op && viewerStaffId !== null && op.requested_by === viewerStaffId;
  const completed = !!mirror.completedBy || !!mirror.completedByName;
  const open = mirror.flagged && !completed;
  const held = flagHeldByUs({ editDate: mirror.editDate }, ops, trialNow);
  const doneLine = (): FlagState =>
    mirror.completedByName
      ? { key: "flag.doneBy", text: fillWords(NOTE_WORDS.flag.doneBy, { name: mirror.completedByName }), tone: "ok", acts: [] }
      : { key: "flag.done", text: NOTE_WORDS.flag.done, tone: "ok", acts: [] };

  /* an Undo of ours on its way */
  const clearing = newestFirst(ops).find((o) => !o.flag_done && (o.status === "queued" || o.status === "sending"));
  if (clearing && done?.clearedAfter) return { key: "flag.unmarking", text: NOTE_WORDS.flag.unmarking, tone: null, acts: [] };

  if (op) {
    if (op.status === "queued") {
      const why = holdWhy(hold);
      const acts: FlagAct[] = presser ? ["unmark"] : [];
      if (why) return { key: "flag.waitingWhy", text: fillWords(NOTE_WORDS.flag.waitingWhy, { why }), tone: null, acts };
      if (op.last_error) {
        return { key: "flag.waitingWhy", text: fillWords(NOTE_WORDS.flag.waitingWhy, { why: op.last_error }), tone: "warn", acts };
      }
      return { key: "flag.marking", text: NOTE_WORDS.flag.marking, tone: null, acts };
    }
    if (op.status === "sending") return { key: "flag.marking", text: NOTE_WORDS.flag.marking, tone: null, acts: [] };
    if (op.status === "trial" && trialNow) return { key: "flag.trial", text: NOTE_WORDS.flag.trial, tone: null, acts: [] };
    if (op.status === "sent" && held) {
      const line = doneLine();
      return { ...line, acts: FLAG_UNDO_AFTER_SENT && presser ? ["unmark"] : [] };
    }
    if (op.status === "failed" && open) {
      return {
        key: "flag.notMarked",
        text: fillWords(NOTE_WORDS.flag.notMarked, { reason: op.last_error || NOTE_WORDS.row.noteRefused }),
        tone: "bad",
        acts: ["mark_done"],
      };
    }
  }

  if (open && !held) {
    const again = !!op && op.status === "sent";
    return { key: "flag.flagged", text: NOTE_WORDS.flag.flagged, tone: "warn", acts: [again ? "mark_done_again" : "mark_done"] };
  }
  if (completed) return doneLine();
  return FLAG_NONE;
}
