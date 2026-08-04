/* Where the seconds actually go, from the button to the review card.

   Built for one question: is the live transport worth it? That can't be
   answered by feel, because the chain has TWO expensive links and only one
   of them is the transport —

     stop → transcript     the bit the flag changes
     transcript → proposal the Opus 5 routing call in note-brain.ts

   Measuring only the first would produce a real number attached to the
   wrong conclusion: "live is three seconds faster" is worth very little if
   routing spends eight seconds afterwards either way. So both links are
   timed and printed together, and the total is the number that matters.

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
   that started them (the capture card unmounts and remounts around the
   review), and there is only ever one note in flight. */
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
  console.info(`[voice] ${transport} · heard in ${secs(run.heard)}`);
}

/** The review card has something to show — the end of the wait. */
export function markProposal(): void {
  if (!run) return;
  const total = now() - run.stopped;
  const heard = run.heard ?? 0;
  console.info(
    `[voice] ${run.transport ?? "typed"} · heard ${secs(heard)} · routed ${secs(
      total - heard
    )} · TOTAL ${secs(total)}`
  );
  run = null;
}

/** Nothing to time — the note was discarded or never got that far. */
export function clearRun(): void {
  run = null;
}
