"use client";

import { useEffect, useRef, useState } from "react";
import type { FlagState, NoteState } from "@/lib/integrations/sm8-note-plan";

/* WHILE A NOTE IS ON ITS WAY, THE CARD LOOKS AGAIN (two-way phase 2).

   A press sends its own note in the foreground for a few seconds and hands
   the rest to the queue, so "Sending to ServiceM8…" can outlive the answer.
   While any line on the card says something is on its way, the card asks
   where things stand every POLL_MS, at most POLL_MAX times per press, and
   stops the moment nothing is waiting — a line that has landed is not
   polled, and a card left open on a paused workspace doesn't ask forever. */

export const POLL_MS = 10_000;
export const POLL_MAX = 6;

/** The lines that mean "on its way": a note going, waiting or being taken
    out, and a mark going on or coming off. */
const WAITING: ReadonlySet<string> = new Set([
  "line.sending",
  "line.waitingWhy",
  "line.takingOut",
  "flag.marking",
  "flag.waitingWhy",
  "flag.unmarking",
]);

/** Whether anything on the card is on its way to ServiceM8. */
export function somethingWaiting(
  ours: readonly { state?: NoteState | null }[] | null,
  flags: Record<string, FlagState> | null | undefined
): boolean {
  if ((ours ?? []).some((n) => !!n.state?.key && WAITING.has(n.state.key))) return true;
  return Object.values(flags ?? {}).some((f) => !!f.key && WAITING.has(f.key));
}

/** Ask `read` every POLL_MS while `waiting`, at most POLL_MAX times since
    the last `kick` (each press kicks: its own note gets its own looks). */
export function useNoteStatePoll(opts: { waiting: boolean; kick: number; read: () => Promise<void> }): void {
  const { waiting, kick, read } = opts;
  const left = useRef(POLL_MAX);
  const [round, setRound] = useState(0);
  const readRef = useRef(read);
  useEffect(() => {
    readRef.current = read;
  }, [read]);
  useEffect(() => {
    left.current = POLL_MAX;
  }, [kick]);
  useEffect(() => {
    if (!waiting || left.current <= 0) return;
    const t = setTimeout(() => {
      left.current -= 1;
      void readRef
        .current()
        .catch(() => {})
        .finally(() => setRound((r) => r + 1));
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [waiting, kick, round]);
}
