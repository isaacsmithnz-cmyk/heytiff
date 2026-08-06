/* THE TWO NOTES THAT SAY THE MIC IS LISTENING, AND THAT IT HAS LET GO.

   Synthesised rather than shipped as audio files. Two sine notes cost a few
   lines and nothing at runtime — no asset, no request, no decode, no cache
   header, and nothing to go missing on a phone with one bar of signal in a
   plant room. A .mp3 that fails to load is a mic that silently stops telling
   you what it is doing.

   WHY THERE ARE THREE AND NOT TWO. Starting and stopping are the two Isaac
   asked for, but discarding is also an ending, and if it sounded the same as
   stopping you could not tell by ear whether your note had been kept. That is
   a real ambiguity on a roof with the phone in your pocket, so throwing a
   recording away gets its own flat, unresolved note.

   The intervals are doing the talking:
     start   D5 → A5, a rising fifth. Open, unfinished, something follows.
     stop    A5 → D5, the same fifth falling. The phrase closes.
     discard F#4 alone, low and unresolved. Nothing was completed.

   Kept deliberately quiet (peak gain 0.05) and short (~90ms a note). This
   fires every time anybody presses a microphone anywhere in the app, so the
   bar is "did not notice it was there" rather than "nice sound". */

type Chime = "start" | "stop" | "discard";

/** Hz, in order. One entry is a single note. */
const SCORE: Record<Chime, number[]> = {
  start: [587.33, 880.0],
  stop: [880.0, 587.33],
  discard: [369.99],
};

const NOTE_SECONDS = 0.09;
/** Onset-to-onset, so the notes overlap slightly and read as one gesture. */
const NOTE_GAP = 0.07;
const PEAK_GAIN = 0.05;
/** Long enough that the ramp is inaudible, short enough to not soften the
    attack — below about 8ms a sine start is a click. */
const ATTACK = 0.012;

type Ctor = typeof AudioContext;

/* ONE CONTEXT FOR THE TAB, not one per press. Chrome caps concurrent
   AudioContexts at around six and a mic is pressed far more often than that;
   the first version of this made a fresh one each time and would have gone
   quiet after the sixth note of a long day. Created lazily, which also
   satisfies autoplay policy for free — nothing here runs outside a click. */
let shared: AudioContext | null = null;

function context(): AudioContext | null {
  if (shared) return shared;
  if (typeof window === "undefined") return null;
  const Impl: Ctor | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
  if (!Impl) return null;
  try {
    shared = new Impl();
    return shared;
  } catch {
    return null;
  }
}

/** Play one of the mic's three notes. Silent and harmless wherever Web Audio
    isn't available — this is confirmation of something the screen is already
    showing, never the only way to know. */
export function playChime(kind: Chime): void {
  const ctx = context();
  if (!ctx) return;
  try {
    /* A context created before the first gesture starts suspended, and a
       suspended context plays nothing while reporting no error at all. */
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    for (const [i, hz] of SCORE[kind].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = hz;

      const at = now + i * NOTE_GAP;
      /* An envelope, not a switch. Gating a sine on and off square is the
         click you hear in cheap UI sound. `exponentialRampToValueAtTime`
         cannot reach zero, hence the near-zero floor. */
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, at + ATTACK);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_SECONDS);

      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + NOTE_SECONDS + 0.02);
    }
  } catch {
    /* No sound. Nothing else about the recording changes. */
  }
}

/** Test seam — the scores are the design, so they are worth asserting on. */
export const chimeScore = (kind: Chime): number[] => [...SCORE[kind]];
