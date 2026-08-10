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
  /** When the routing call actually started — see `markRouting`. */
  routing?: number;
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

/* THERE IS A PERSON IN THE MIDDLE NOW. A transcript lands in the box to be
   checked, and routing does not start until `Go` is pressed — so
   the two links stopped being one continuous wait. Measuring the second one
   from the stop would bank however long someone spent reading their own
   note as time the ROUTER spent, which is the "real number attached to the
   wrong conclusion" this file was written to avoid. Each leg is timed from
   its own beginning, and there is no TOTAL, because there is no longer a
   single wait for one to describe. */
export function markRouting(): void {
  if (!run) run = { stopped: now() };
  run.routing = now();
}

/** The review card has something to show — the end of the routing wait. */
export function markProposal(): void {
  if (!run) return;
  console.info(
    `[voice] ${run.transport ?? "typed"} · heard ${secs(run.heard ?? 0)} · routed ${secs(
      now() - (run.routing ?? run.stopped)
    )}`
  );
  run = null;
}

/** Nothing to time — the note was discarded or never got that far. */
export function clearRun(): void {
  run = null;
}
