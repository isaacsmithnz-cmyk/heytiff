"use client";

import { DictClock, LevelOrb, type DictationState } from "./dictation";

/* THE RECORDING INSTRUMENT, ONCE.

   Every door into the microphone showed the same stage: the Tiff button's
   sheet, the debrief card in Home's journal, and Tiff's own ask bar. Isaac's
   rule, and the reason this file exists: "the input section should be
   identical throughout the software; they just appear in different places."
   The sheet and the debrief went in September 2026, and the Library's ask
   bar, the card's last door, in November; what is left is the meter the
   note postures carry in their rows. */

export type RecordingMeterProps = {
  dict: DictationState;
  /* WHERE THE MIC IS A ROW, NOT A CARD. The three note postures put their
     microphone in a strip, a dictation bar or an add row — one line each,
     alongside a box you can still see your words in — and growing those into
     a 680px card mid-sentence would break the promise the strip is built on
     (a job card's note row must not make somebody wait to write down a gate
     code). So the instrument comes to them instead of the other way round:
     same three readings, laid out along a line rather than stacked.

     What compact DROPS is what the row already has. There is no "what you
     have said so far" box because the posture's own box is right there with
     the live words joined into it, and no Type/Start again/Done row because
     the bar carries its own stop and discard. */
  compact?: boolean;
};

/* THE INSTRUMENT — the sphere, and the clock beside it.

   Audited 2026-08-10: the capture card was 680 × 201px, 86% of it empty, with
   a 36 × 34px meter marooned in the middle. The one element proving the
   microphone works was the smallest thing on the screen, and at silence its
   resting state was indistinguishable from a dead mic.

   THERE WAS A THIRD THING HERE AND IT IS GONE. A line under the clock read
   "HEARING YOU" or "NOT HEARING ANYTHING", written for the five-bar meter
   because six pixels of bar could not say either — the words had to carry
   both halves. The orb carries them now: it turns because the mic is open and
   swells as you speak, continuously, which is more than a binary label ever
   said.

   And it read badly (Isaac): "it just looks like it's not a reliable product
   if it has to suggest it". He is right. A meter that keeps offering to
   explain that it might not be working is hedging in the one moment the
   product should be confident, and the hedge was redundant besides — an orb
   sitting still IS the bad news, demonstrated rather than disclaimed. */
export function RecordingMeter({ dict, compact }: RecordingMeterProps) {
  return (
    <div className={"wb2-recwave" + (compact ? " compact" : "")}>
      <DictClock seconds={dict.seconds} big={!compact} />
      <LevelOrb innerRef={dict.barsRef} />
    </div>
  );
}
