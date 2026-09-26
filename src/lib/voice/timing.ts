/* Where the seconds actually go, from the stop to the words.

   Built for one question: is the live transport worth it? That can't be
   answered by feel, so the leg the transport owns is timed on every note —

     stop → transcript     the bit the flag changes

   The other expensive link, the Opus 5 routing call in note-brain.ts, was
   timed here too, from the capture card's `Go` to its review
   (`markRouting`, `markProposal`); that card went with the old capture UI
   (2026-09-27), so the transport's leg is what is left to time here.

   Console only, one line per note, no storage and nothing sent anywhere.
   Deliberately not behind the flag — the batch baseline has to be
   measurable too, or there's nothing to compare against. */

export type Transport = "live" | "batch";

type Run = {
  stopped: number;
  heard?: number;
  transport?: Transport;
};

/* Module-level rather than a ref: a note's timings outlive the component
   that started them, and there is only ever one note in flight. */
let run: Run | null = null;

const now = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

const secs = (ms: number): string => `${(ms / 1000).toFixed(2)}s`;

/** The moment the person stopped talking. Everything is measured from here
    because it is the moment they start waiting. */
export function markStopped(): void {
  run = { stopped: now() };
}

/** Words in hand, by whichever transport got them there. */
export function markTranscript(transport: Transport): void {
  if (!run) return;
  run.heard = now() - run.stopped;
  run.transport = transport;
  console.info(`[voice] ${transport}, heard in ${secs(run.heard)}`);
}

/** Nothing to time — the note was discarded or never got that far. */
export function clearRun(): void {
  run = null;
}
