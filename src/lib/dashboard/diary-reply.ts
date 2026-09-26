/* YOUR REPLY IN THE DIARY — pure (two-way phase 2, on the new Home).

   A reply you send from a job card (#826), and a task's Done, is HeyTiff's
   own row (workboard_notes, `reply_to_sm8_note_uuid` naming the note it
   answers) queued to ServiceM8 as you. The Diary shows it ONCE, where it
   belongs: in the conversation that holds the note it answers, as "You to
   Luke", from the moment it is saved — not only once the sync has brought
   ServiceM8's copy back. That copy (a note whose uuid is one HeyTiff minted
   for it, sm8-echo) is the same thing, and never drawn beside it. A reply
   whose note no conversation holds (older than the mentions reach, removed
   in ServiceM8, a note that didn't mention you) stays one of your entries:
   never dropped.

   WHEREVER IT IS DRAWN it says where it stands with ServiceM8 in the job's
   diary's own words (sm8-note-plan's noteState, read with the job card's
   `noteLinesOf`), with the doors the job card and the task's page offer:
   Send again — Try again on one that failed — and Try again on one still
   in ServiceM8 after a take-back; and "Is <name> you?", with Yes and Not
   me, while your link waits on that answer. Undo stays the job card's.

   Nothing here exists where the deployment sends files only
   (SM8_WRITES=1): the read that fills it asks sm8NotesAllowed() first. */

import type { NoteSender } from "@/lib/integrations/links";
import type { NoteState } from "@/lib/integrations/sm8-note-plan";
import { NOTE_WORDS } from "@/lib/integrations/sm8-note-words";

/** Where a reply of yours stands with ServiceM8, and its doors. */
export type ReplyLine = {
  /** The job's diary's sentence: "In ServiceM8", "Not sent to ServiceM8. …". */
  text: string;
  /** The state's colour, on the sentence and nowhere else. */
  tone: "ok" | "warn" | "bad" | null;
  /** The door that presses it again: Send again (Try again on one that
      failed) sends it; Try again on one still in ServiceM8 takes it out. */
  again: { act: "send_again" | "take_out_again"; label: string } | null;
  /** "Is <name> you?" waits on your answer: the ServiceM8 person Yes and
      Not me answer for. Yes then sends it. */
  ask: string | null;
};

/** A reply of yours among your entries (journal-query's listDiaryEntries):
    what the conversation threads it by, and what it draws. */
export type DiaryReply = {
  /** The ServiceM8 note it answers. */
  to: string;
  /** The job its row is on: what a press on its line names. */
  jobUuid: string;
  /** Its words in the job's diary — English, with the handle it opens on
      ("@lukeingold on my way", "@lukeingold Done."). */
  words: string;
  /** Null when it says nothing about ServiceM8, or that couldn't be read. */
  line: ReplyLine | null;
};

/** The line a state gives the person who sent it — the task page's rules
    (task-sm8-line), where `sender` is who they are in ServiceM8 now: a row
    refused for want of the link's answer simply goes again once it is
    given, and asks for it while it isn't. Null when the state says
    nothing. */
export function replyLine(state: NoteState | null | undefined, sender: NoteSender | null): ReplyLine | null {
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
