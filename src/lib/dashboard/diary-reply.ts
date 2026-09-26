/* YOUR REPLY IN THE DIARY — pure (two-way phase 2, on the new Home).

   A reply you send from a job card (#826), and a task's Done, is HeyTiff's
   own row (workboard_notes, `reply_to_sm8_note_uuid` naming the note it
   answers) queued to ServiceM8 as you. The Diary shows it ONCE, where it
   belongs: in the conversation that holds the note it answers, as "You to
   Luke", from the moment it is saved — not only once the sync has brought
   ServiceM8's copy back. That copy (a note whose uuid is one HeyTiff minted
   for it, sm8-echo) is the same thing, and never drawn beside it. Your
   replies are read for the conversations on their own, over the mentions'
   reach (journal-query's listDiaryReplies), so one older than your newest
   entries is still in its thread. A reply whose note no conversation
   holds (older than the mentions reach, removed in ServiceM8, a note that
   didn't mention you) stays one of your entries: never dropped.

   WHEREVER IT IS DRAWN it says where it stands with ServiceM8 in the job's
   diary's own words (sm8-note-plan's noteState, read with the job card's
   `noteLinesOf`), with the doors the job card and the task's page offer:
   Send again — Try again on one that failed — and Try again on one still
   in ServiceM8 after a take-back; and "Is <name> you?", with Yes and Not
   me, while your link waits on that answer. One saved but never queued
   (the press's settings read, or its note read, failed after the save)
   says "In HeyTiff", as the job card's chip does, with its Send to
   ServiceM8. One you took back is drawn only while something of it may
   still be in ServiceM8 (decision 8), with its Try again. Undo stays the
   job card's.

   IT IS YOURS, as your entries are (actions/diary): the diary's Delete
   takes it back by the job card's rule, in its thread as in the column,
   and it is never edited here, since ServiceM8 has its words too (the read
   says so, `inSm8`, of every reply). One taken back has only its Try
   again. In a conversation you hid it goes with it, and comes back with it
   (./diary-hidden).

   Nothing here exists where the deployment sends files only
   (SM8_WRITES=1): the read that fills it asks sm8NotesAllowed() first. */

import type { NoteSender } from "@/lib/integrations/links";
import type { NoteState } from "@/lib/integrations/sm8-note-plan";
import { NOTE_WORDS } from "@/lib/integrations/sm8-note-words";

/** What the job card says of a note of ours that never left HeyTiff — its
    chip (job-diary-face) — said the same here. */
export const IN_HEYTIFF = "In HeyTiff";

/** Where a reply of yours stands with ServiceM8, and its doors. */
export type ReplyLine = {
  /** The job's diary's sentence: "In ServiceM8", "Not sent to ServiceM8. …". */
  text: string;
  /** The state's colour, on the sentence and nowhere else. */
  tone: "ok" | "warn" | "bad" | null;
  /** The door that presses it again: Send again (Try again on one that
      failed, Send to ServiceM8 on one that never went) sends it; Try again
      on one still in ServiceM8 takes it out. */
  again: { act: "send_again" | "take_out_again"; label: string } | null;
  /** "Is <name> you?" waits on your answer: the ServiceM8 person Yes and
      Not me answer for. Yes then sends it. */
  ask: string | null;
};

/** A reply of yours among your entries (journal-query's listDiaryEntries
    and listDiaryReplies): what the conversation threads it by, and what it
    draws. */
export type DiaryReply = {
  /** The ServiceM8 note it answers. */
  to: string;
  /** The job its row is on: what a press on its line names. */
  jobUuid: string;
  /** Its words in the job's diary — English, with the handle it opens on
      ("@lukeingold on my way", "@lukeingold Done."). */
  words: string;
  /** When it was saved, to the second, on the account's clock: where it
      threads among ServiceM8's notes, which carry seconds. The entry's own
      stamp keeps the minute. */
  at: string;
  /** When it was saved, as the database says it: what orders two replies
      saved in the same second. */
  savedAt: string;
  /** Null when it says nothing about ServiceM8, or that couldn't be read. */
  line: ReplyLine | null;
  /** Taken back, and drawn only while something of it may still be in
      ServiceM8: its line says so, with Try again. */
  takenBack?: true;
};

/** The line a state gives the person who sent it — the task page's rules
    (task-sm8-line), where `sender` is who they are in ServiceM8 now: a row
    refused for want of the link's answer simply goes again once it is
    given, and asks for it while it isn't. `unsent`: the row was saved and
    never queued. When its state says nothing — no refusal was kept on it
    to say why — it is "In HeyTiff", and, as on the job card, Send to
    ServiceM8 is offered where notes are (`offered`) to someone who can
    send or be asked their link. Null when the state says nothing. */
export function replyLine(
  state: NoteState | null | undefined,
  sender: NoteSender | null,
  opts: { unsent?: boolean; offered?: boolean } = {},
): ReplyLine | null {
  if (!state?.key && opts.unsent) {
    const can = !!opts.offered && (sender?.state === "ready" || sender?.state === "confirm");
    return {
      text: IN_HEYTIFF,
      tone: null,
      again: can ? { act: "send_again", label: NOTE_WORDS.door.sendToSm8 } : null,
      ask: null,
    };
  }
  if (!state?.key || !state.text) return null;
  const acts = state.acts;
  const asking = acts.includes("confirm") && sender?.state === "confirm" ? sender.remoteId : null;
  const send = acts.includes("send_again") || (acts.includes("confirm") && sender?.state === "ready");
  /* a row that failed or was refused is tried again; one that may be
     there already, was a trial, or was cancelled is sent again */
  const failed = state.key === "line.notSent" && state.tone === "bad";
  const again: ReplyLine["again"] = send
    ? { act: "send_again", label: failed ? NOTE_WORDS.door.tryAgain : NOTE_WORDS.door.sendAgain }
    : acts.includes("take_out_again")
      ? { act: "take_out_again", label: NOTE_WORDS.door.tryAgain }
      : null;
  return { text: state.text, tone: state.tone, again, ask: asking };
}
