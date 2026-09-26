"use client";

import { NOTE_WORDS } from "@/lib/integrations/sm8-note-words";
import type { NoteSender } from "@/lib/integrations/links";
import type { TaskDoneLine } from "@/lib/dashboard/task-done-query";

/* A TASK'S DONE, ON THE TASK (two-way phase 2, PR C).

   Ticking a task made from a ServiceM8 mention files "@lukeingold Done." in
   the job's diary and sends it to ServiceM8 as whoever ticked. This is where
   the task says what became of it: one line per row — the Done, or the
   reply that closed the task; then any Done taken back that is still on its
   way out of ServiceM8 — each the row's words in quotes and then where it
   stands, in the very words the diary uses (noteState), with the state's
   colour on the state and nowhere else.

   THE DOORS ARE THE LINE'S, and each acts on its own row: Send again or Try
   again, and the link question with Yes and Not me. Undo is not drawn here —
   Reopen is the task's Undo — unless a surface asks for it (`onUndo`, for
   the Home redesign). Nothing is offered to anyone but the row's sender;
   noteState gives nobody else a door. */

export type TaskSm8Doors = {
  /** Send again or Try again on a row that didn't go; Try again on one
      still in ServiceM8. */
  onRetry: (noteId: string, act: "send_again" | "take_out_again") => void;
  /** Yes or Not me to "Is <name> you?", for the link the viewer holds. */
  onConfirm: (noteId: string, remoteId: string, answer: "yes" | "no") => void;
  /** Only where a surface draws the task's Undo on the line itself. */
  onUndo?: (noteId: string) => void;
};

export function TaskSm8Line({
  lines,
  sender,
  pending,
  doors,
}: {
  lines: readonly TaskDoneLine[];
  /** Who the viewer is in ServiceM8, for the question's Yes. */
  sender: NoteSender | null;
  pending: boolean;
  doors: TaskSm8Doors;
}) {
  if (lines.length === 0) return null;
  const asking = sender && sender.state === "confirm" ? sender : null;
  return (
    <>
      {lines.map((line) => {
        const { state } = line;
        const acts = state.acts;
        /* the question was answered since (here, or on the job card): the
           row can simply go again */
        const sendAgain = acts.includes("send_again") || (acts.includes("confirm") && sender?.state === "ready");
        /* a row that failed or was refused is tried again; one that may be
           there already, was a trial, or was cancelled is sent again */
        const failed = state.key === "line.notSent" && state.tone === "bad";
        return (
          <p key={line.noteId} className="hd-tk-sm8line" data-note-id={line.noteId}>
            {`“${line.words}”`}
            {state.text && (
              <>
                {" "}
                <b className={state.tone ?? undefined}>{state.text}</b>
              </>
            )}
            {acts.includes("confirm") && asking && (
              <>
                {" "}
                <button
                  type="button"
                  className="hd-tk-sm8door"
                  disabled={pending}
                  onClick={() => doors.onConfirm(line.noteId, asking.remoteId, "yes")}
                >
                  {NOTE_WORDS.door.yes}
                </button>{" "}
                <button
                  type="button"
                  className="hd-tk-sm8door"
                  disabled={pending}
                  onClick={() => doors.onConfirm(line.noteId, asking.remoteId, "no")}
                >
                  {NOTE_WORDS.door.notMe}
                </button>
              </>
            )}
            {sendAgain && (
              <>
                {" "}
                <button
                  type="button"
                  className="hd-tk-sm8door"
                  disabled={pending}
                  onClick={() => doors.onRetry(line.noteId, "send_again")}
                >
                  {failed ? NOTE_WORDS.door.tryAgain : NOTE_WORDS.door.sendAgain}
                </button>
              </>
            )}
            {acts.includes("take_out_again") && (
              <>
                {" "}
                <button
                  type="button"
                  className="hd-tk-sm8door"
                  disabled={pending}
                  onClick={() => doors.onRetry(line.noteId, "take_out_again")}
                >
                  {NOTE_WORDS.door.tryAgain}
                </button>
              </>
            )}
            {acts.includes("undo") && doors.onUndo && (
              <>
                {" "}
                <button type="button" className="hd-tk-sm8door" disabled={pending} onClick={() => doors.onUndo!(line.noteId)}>
                  {NOTE_WORDS.door.undo}
                </button>
              </>
            )}
          </p>
        );
      })}
    </>
  );
}
