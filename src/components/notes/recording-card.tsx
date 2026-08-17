"use client";

import { Icon } from "@/components/shell/icon";
import { DictClock, LevelOrb, appendSpoken, type DictationState } from "./dictation";

/* THE RECORDING STAGE, ONCE.

   Every door into the microphone shows this: the Tiff button's sheet, the
   debrief card in Home's journal, and Tiff's own ask bar. Isaac's rule, and
   the reason this file exists — "the input section should be identical
   throughout the software; they just appear in different places."

   IT IS THE CONTENT, NOT THE CONTAINER, and that split is what lets the same
   card stand in three places that are shaped differently. The sheet portals
   itself over a scrim, the debrief and Tiff's composer grow in the page, and
   none of that is decided here. What IS decided here is everything you look
   at while you are talking: what you have said so far, the sphere, the clock,
   and the three ways out.

   THE THREE WAYS OUT ARE ALL THE ENGINE'S, so this needs no callbacks and
   no flow. `handOver` stops and keeps the words for the box, `restart` bins
   this take and opens a fresh mic, `stop` ends it for real — all three come
   off `useDictation`, which every door already holds. That is the whole
   reason a shared card was possible at all: the postures differed, the
   engine never did.

   EVERY BUTTON IS `type="button"`, AND THAT IS LOAD-BEARING. Tiff's composer
   is a `<form>`, and a bare `<button>` inside one defaults to `submit` — so
   the moment this card was reused there, "Start again" would have asked
   Tiff the half-finished question instead of binning the take. The note
   postures never sat in a form and never needed it, which is exactly how a
   shared component inherits a bug from the one place it did not have to
   think about.

   WHAT HAPPENS TO THE WORDS AFTERWARDS IS NOT THIS CARD'S BUSINESS, and it
   genuinely differs. The note flow sorts them and asks you to check what was
   made of them; Tiff drops them in the ask box and waits for you to press
   send, because a question already knows what it is. Identical up to `Done`,
   and deliberately not past it. */

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
  /** The card's `with-words` state; nothing else passes one. */
  className?: string;
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
export function RecordingMeter({ dict, compact, className }: RecordingMeterProps) {
  return (
    <div
      className={
        "wb2-recwave" + (compact ? " compact" : "") + (className ? ` ${className}` : "")
      }
    >
      <DictClock seconds={dict.seconds} big={!compact} />
      <LevelOrb innerRef={dict.barsRef} />
    </div>
  );
}

export type RecordingCardProps = {
  dict: DictationState;
  /** What is already captured — the box's value, whatever box that is. The
      live words are joined onto it here rather than by the caller, so every
      door performs the same join. */
  text: string;
};

export function RecordingCard({ dict, text }: RecordingCardProps) {
  /* WHAT YOU HAVE ALREADY SAID STAYS ON SCREEN (Isaac, 2026-08-10, walking a
     second leg): "if I click talk, it looks like you're starting again
     because it doesn't show you what text it's already got on there."

     It was never starting again — every leg appends, and the words were safe
     the whole time. But this stage REPLACED the box with the meter, so a
     second leg looked exactly like a first one. The card was hiding the only
     evidence that it had kept anything.

     GUARDED, not just called. `appendSpoken` joins with a space and does not
     care that the second half is empty, so calling it with no interim leaves
     a trailing space on every batch recording. */
  const sofar = dict.interim ? appendSpoken(text, dict.interim) : text;
  const words = Boolean(sofar.trim());

  return (
    <div className="wb2-caprec">
      {words && (
        <textarea
          className="wb2-notes wb2-recsofar"
          value={sofar}
          readOnly
          rows={3}
          aria-label="What you have said so far"
        />
      )}
      {/* THE CLOCK HOLDS THE BOTTOM LEFT. It used to stand beside the meter,
          above the words; with the instrument lifted out of this card (the
          field spans stages, so it is mounted by the door — see `Body` in
          ./note-token) there is nothing for it to stand beside. On the actions
          row it needs no wrapper: `.wb2-capact` is flush right, and one auto
          margin pushes everything else across.

          Tabular figures are load-bearing at this size — proportional digits
          make the whole row twitch on every tick. */}
      <div className="wb2-capact">
        <DictClock seconds={dict.seconds} big />
        {/* THE WAY OUT TO THE KEYBOARD, and during a recording it is the only
            thing this slot does. Audited 2026-08-10: the strongest position on
            the row went to a Default switch — a control about what the Tiff
            button does NEXT time, with its Talk half already pressed, half of
            it inert and all of it about later. The preference returns the
            moment the mic closes, which is the only place you can act on it.

            It keeps every word: `handOver` puts what you have said in the box
            rather than routing it, so changing your mind mid-sentence costs
            nothing. */}
        <button type="button" className="pbtn ghost wb2-modeone" onClick={dict.handOver}>
          <Icon name="keyboard" size={15} />
          Type instead
        </button>
        {/* START THAT ONE AGAIN (Isaac, 2026-08-10). The way to redo a fluffed
            recording was to close the card — losing the tag it came with — and
            open it again. It BINS what you have said, on purpose and without
            asking: a confirm step would make the fast path slower than
            starting over by hand, and the two chimes (thrown away, then
            listening) are the receipt.

            Ghost, not primary. It is the recovery, and the card must not offer
            two bright buttons to a person mid-sentence. */}
        <button
          type="button"
          className="pbtn ghost"
          onClick={dict.restart}
          title="Bin this one and start the recording again"
        >
          <Icon name="rotate" size={14} sw={1.9} />
          Start again
        </button>
        {/* DONE, NOT GO (Isaac, 2026-08-10, after walking it on prod:
            "annoyingly you have to push go twice").

            It was Go for half a day, on the argument that both presses are
            simply the way onward. Walking it says otherwise: you press a
            button called Go, and nothing goes — it stops the mic and hands you
            a box to check. Two presses is the design and it is the right one,
            but only ONE of them commits anything, and that is the one allowed
            to be called Go. So this stage ends with `Done` and the next one
            commits. A chat composer works the same way: the mic button stops,
            the send button sends, and nobody confuses them.

            AND THE SQUARE IS GONE. It survived two rounds of argument — "that
            black square next to go is weird", answered by making it smaller,
            thinner and paler — and Isaac's verdict on the third look was that
            it is still stupid. He is right, and the reason is that the
            original defence stopped being true: the glyph was there because
            the word "Go" did not say the microphone was closing. "Done" does.
            A stop mark beside it is the same thing said twice. */}
        <button type="button" className="pbtn wb2-prim" onClick={dict.stop}>
          Done
        </button>
      </div>
    </div>
  );
}
