"use client";

import { useRef, useState, type RefObject } from "react";
import { Icon } from "@/components/shell/icon";
import { LiveWords, appendSpoken, useDictation } from "./dictation";
import { RecordingMeter } from "./recording-card";
import { READING_BACK_NOTE } from "./waits";
import { Waiting } from "@/components/ui/orb";
import { useNoteScope } from "./note-context";
import { useTiff } from "@/components/tiff/modal/tiff-context";
import { sniff } from "@/lib/notes/sniff";

/* ONE TOKEN, EVERYWHERE.

   Five controls used to do some subset of "hear a person and do something
   with the words": a pill that routed, a box that appended, a one-liner that
   appended, a bridge button that carried text from the second to the first,
   and — on most of the app — nothing at all. This is all of them.

   THE ONLY THING THAT VARIES IS POSTURE, and posture is about where the
   token is standing, not about what it can do:

     strip    a row that lives with the notes it joins. Commits at once,
              and offers Tiff afterwards when what it added smells
              actionable.
     field    a textarea with the token on it. Fills the box and shuts up;
              only offers Tiff when the words smell actionable.
     line     the same, one line, commits an item at a time.

   WHAT TIFF DOES WITH THE WORDS is the Tiff modal's (components/tiff/modal).
   The offer's "Have a look" opens it on them, and it reads what the screen
   underneath reported (./note-context): on a job card the note lands on that
   job, anywhere else it is a universal note taker. No caller passes a target.

   THE CAPTURE CARD IS NOT IN HERE ANY MORE (2026-09-27). The postures used
   to open a card of their own over the page, or grow one in place: a Talk or
   Type door, a ribbon with the tag on it, and a review of what the words
   became, to tick and save — and the Diary's `entry` row was the same card
   in a row's clothes. The Tiff modal replaced all of it for every Tiff
   button once the new Home was everyone's: it talks rather than showing a
   review, files the moment nothing is left to ask, and has Undo for what
   landed. What is left here is the part that was never the card's: a
   microphone that fills a box.

   THE CORNER TOKEN IS NOT IN HERE EITHER. It was the `capsule` posture — a
   keyboard|mic pill mounted by two workboard screens — and it has become the
   Tiff button in ./tiff-button, which stands in the app FRAME and is on every
   screen rather than two. The postures left are the ones that belong to a
   place on a page; the corner belongs to the frame.

   THE MIC IS ALWAYS AN ENHANCEMENT. No key, no permission, no MediaRecorder —
   every posture is still a control you can type into. */

export type Posture = "strip" | "field" | "line";

function Strip({
  label,
  placeholder,
  value,
  onChange,
  onCommit,
  disabled,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (next: string) => void;
  onCommit?: () => void;
  disabled: boolean;
}) {
  const mic = useFieldMic(value, onChange);
  const { dict } = mic;
  const field = useRef<HTMLInputElement | null>(null);
  const busy = disabled || dict.recording || dict.transcribing;
  /* WHEN THE FIELD HANDS ITS BOX TO THE RIVER. Any time there are live words,
     and from the start of a recording that already has something to show —
     but NOT on an empty field with nothing heard yet, because "Listening…" is
     the only thing saying so until the first word lands, and a placeholder
     needs the field it belongs to.

     `dict.interim` on its own, not `recording &&`: the words are still on
     screen through the read-back, and swapping back to the field for that
     second and then forward again is two moves where the design has none. */
  const river = Boolean(dict.interim) || (dict.recording && value.trim() !== "");

  const commit = () => {
    /* AN EMPTY + STILL ANSWERS. It was disabled until something was typed,
       and a + beside a microphone that won't press reads as broken ("it
       doesn't let me select it"). Pressed empty, it puts the cursor where
       the note goes. */
    if (!value.trim()) {
      field.current?.focus();
      return;
    }
    onCommit?.();
    /* Sniff what was just committed, not what's in the box — the box is
       about to be cleared by the caller. */
    mic.check(value);
  };

  return (
    <>
      <div className={"wb2-strip" + (dict.recording ? " live" : "")}>
        {dict.recording && <span className="wb2-recdot" aria-hidden="true" />}
        {/* THE WORDS ARRIVE IN THE FIELD'S OWN BOX, not in the field. An
            <input> can only take the sentence as one string, so every partial
            swapped the lot — and worse here than on the card: a disabled input
            never scrolls, so on one line the words being spoken sat off the
            right-hand edge where nobody could read them. The river carries
            `.wb2-stripin` so it is the same 30px box, and it rides SIDEWAYS.

            Only once there is something to show: the field keeps the frame
            while the box is empty, because "Listening…" is the only thing
            saying so before the first word lands. */}
        {river ? (
          <LiveWords line className="wb2-stripin" label={label} said={value} text={dict.interim} />
        ) : (
          <input
            ref={field}
            className="wb2-stripin"
            value={value}
            placeholder={dict.recording ? "Listening…" : (placeholder ?? "Add a note, or say it…")}
            aria-label={label}
            disabled={busy}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              commit();
            }}
          />
        )}
        {mic.voiceEnabled && dict.recording ? (
          <>
            {/* THE CARD'S INSTRUMENT, COMPACT. This row showed an orb and a
                clock and nothing else — the two readings a bar has room for
                — while the capture card three doors away showed a third:
                whether anything is actually reaching the microphone. That
                third one is the whole reason the meter was rebuilt, and it
                was missing from every posture that lives on a page. Same
                component, laid along the line instead of stacked. */}
            <RecordingMeter dict={dict} compact />
            <button
              type="button"
              className="wb2-striprnd stop"
              onClick={dict.stop}
              aria-label={`Stop dictating — ${label}`}
            >
              <Icon name="square" size={13} />
            </button>
            <button
              type="button"
              className="wb2-striprnd"
              onClick={dict.cancel}
              aria-label={`Discard the recording — ${label}`}
            >
              <Icon name="x" size={13} />
            </button>
          </>
        ) : (
          <>
            {mic.voiceEnabled && (
              <button
                type="button"
                className="wb2-striprnd"
                aria-label={`Say ${label}`}
                disabled={disabled || dict.transcribing}
                onClick={dict.start}
              >
                <Icon name="mic" size={15} />
              </button>
            )}
            {/* filled once there is something to add — the state is in the
                paint, never in a button that won't press */}
            <button
              type="button"
              className={"wb2-striprnd" + (value.trim() ? " go" : "")}
              aria-label={`Add ${label}`}
              disabled={busy}
              onClick={commit}
            >
              <Icon name="plus" size={15} />
            </button>
          </>
        )}
      </div>
      {dict.transcribing && <Waiting note={READING_BACK_NOTE} className="wb2-dicthint" />}
      {mic.err && <p className="wb2-dicterr">{mic.err}</p>}
      {mic.found && <Nudge words={mic.found} back={field} onDismiss={mic.dismiss} />}
    </>
  );
}

/* ── postures: field and line ──

   These FILL A BOX. A mic on "site requirements" is not a note-taker: what
   you dictate belongs to that field and saves with the form around it, so
   routing every gate code would file a task nobody asked for.

   "Smart, but only when it finds something" (Isaac, 2026-08-05) is the
   middle path, and `sniff` is what makes it affordable — deciding the
   question properly costs an Opus call, so a free local sieve decides
   whether to ask. The offer that appears is dismissible and ignoring it
   costs nothing; the field has already saved either way. */

function useFieldMic(value: string, onChange: (next: string) => void, onSpoken?: () => void) {
  const scope = useNoteScope();
  const [err, setErr] = useState<string | null>(null);
  const [found, setFound] = useState<string | null>(null);

  const dict = useDictation({
    onTranscript: (spoken) => {
      setErr(null);
      const next = appendSpoken(value, spoken);
      onChange(next);
      onSpoken?.();
      /* The sieve runs on the WHOLE box, not just the new sentence: dictation
         appends, so "Luke needs to" and "order the grilles before Monday" can
         arrive as two presses and only read as a job together. */
      setFound(sniff(next, scope.staffFirstNames).actionable ? next : null);
    },
    onError: setErr,
  });

  return {
    dict,
    err,
    setErr,
    found,
    /** Run the sieve over words the caller already has — the strip commits
        and clears in one gesture, so by the time it asks, `value` is gone. */
    check: (words: string) => setFound(sniff(words, scope.staffFirstNames).actionable ? words : null),
    dismiss: () => setFound(null),
    voiceEnabled: scope.voiceEnabled,
  };
}

/** The offer. Deliberately quiet: a dashed hairline, no colour shift on the
    field, and a dismiss that leaves nothing behind.

    "HAVE A LOOK" OPENS THE TIFF MODAL ON THE WORDS (2026-09-27; it opened the
    capture card's review until that went). They are the first turn and go to
    Tiff at once, as the entry box's Sort it out sends them, and the modal
    reads the screen's tag like every Tiff button. The offer goes only once
    the modal has opened: one that could not (another is already open) stays
    where it was, and costs nothing. Focus comes back to the field, because
    the button pressed goes with the offer. */
function Nudge({
  words,
  back,
  onDismiss,
}: {
  words: string;
  /** The field: where focus goes when the modal closes. */
  back: RefObject<HTMLElement | null>;
  onDismiss: () => void;
}) {
  const tiff = useTiff();
  return (
    <div className="wb2-nudge">
      {/* a task was spotted, so the glyph is a task list. The sparkle said
          "something clever happened here", which is not the offer — the offer
          is that there is work buried in what you just wrote. */}
      <Icon name="listCheck" size={15} />
      <span className="wb2-nudgetext">There&apos;s something to do in this.</span>
      <button
        type="button"
        className="pbtn sm"
        onClick={(e) => {
          /* A click with no pointer behind it came from the keyboard, and
             nothing flies from a keyboard press (law 8). */
          const opened = tiff.open({
            from: e.currentTarget,
            back: back.current ?? undefined,
            words,
            keyboard: e.detail === 0,
          });
          if (opened) onDismiss();
        }}
      >
        Have a look
      </button>
      <button
        type="button"
        className="wb2-ico"
        onClick={onDismiss}
        aria-label="Close — leave it as a note"
      >
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}

/* ── the component ── */

export function NoteToken({
  as,
  label = "a note",
  value,
  onChange,
  onCommit,
  placeholder,
  rows = 3,
  disabled = false,
  className,
  offer = true,
  onSpoken,
}: {
  /** Where this one is standing. No default: the corner — the only posture
      that was ever the obvious one — is now the Tiff button in the frame. */
  as: Posture;
  /** field/line only — whether words that smell like work offer Tiff. False
      where the words have a job already: a reply to somebody's note is a
      reply, not a task to sort out. */
  offer?: boolean;
  /** field/line only — told when dictation lands words in the box, so a
      caller can record that they were said rather than typed. */
  onSpoken?: () => void;
  /** What the token's accessible names say it's for — "a note for this
      visit", "access notes". Never an icon alone. */
  label?: string;
  /** field/line only — the box's own value. */
  value?: string;
  onChange?: (next: string) => void;
  /** line only — Enter, or the +. */
  onCommit?: () => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  className?: string;
}) {
  if (as === "strip")
    return (
      <Strip
        label={label}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={onChange ?? (() => {})}
        onCommit={onCommit}
        disabled={disabled}
      />
    );

  return (
    <FieldPosture
      as={as}
      label={label}
      value={value ?? ""}
      onChange={onChange ?? (() => {})}
      onCommit={onCommit}
      placeholder={placeholder}
      rows={rows}
      disabled={disabled}
      className={className}
      offer={offer}
      onSpoken={onSpoken}
    />
  );
}

function FieldPosture({
  as,
  label,
  value,
  onChange,
  onCommit,
  placeholder,
  rows,
  disabled,
  className,
  offer: offering,
  onSpoken,
}: {
  as: Posture;
  label: string;
  value: string;
  onChange: (next: string) => void;
  onCommit?: () => void;
  placeholder?: string;
  rows: number;
  disabled: boolean;
  className?: string;
  offer: boolean;
  onSpoken?: () => void;
}) {
  const mic = useFieldMic(value, onChange, onSpoken);
  const { dict } = mic;
  const line = useRef<HTMLInputElement | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const busy = disabled || dict.recording || dict.transcribing;
  /* the strip's rule: never a + that won't press — empty, it puts the cursor
     in the field */
  const addLine = () => (value.trim() === "" ? line.current?.focus() : onCommit?.());
  /* WHEN THE FIELD HANDS ITS BOX TO THE RIVER. Any time there are live words,
     and from the start of a recording that already has something to show —
     but NOT on an empty field with nothing heard yet, because "Listening…" is
     the only thing saying so until the first word lands, and a placeholder
     needs the field it belongs to.

     `dict.interim` on its own, not `recording &&`: the words are still on
     screen through the read-back, and swapping back to the field for that
     second and then forward again is two moves where the design has none. */
  const river = Boolean(dict.interim) || (dict.recording && value.trim() !== "");

  const offer = offering && mic.found && (
    <Nudge words={mic.found} back={as === "line" ? line : box} onDismiss={mic.dismiss} />
  );

  if (as === "line") {
    return (
      <div className="wb2-dictline">
        <div className="wb2-addrow">
          {/* Same swap as the strip, in the other one-line posture — see the
              note there. `.wb2-fi` is a 34px box either way. */}
          {river ? (
            <LiveWords line className="wb2-fi" label={label} said={value} text={dict.interim} />
          ) : (
            <input
              ref={line}
              className="wb2-fi"
              placeholder={dict.recording ? "Listening…" : placeholder}
              value={value}
              disabled={busy}
              aria-label={label}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                onCommit?.();
              }}
            />
          )}
          {mic.voiceEnabled && dict.recording ? (
            <>
              {/* THE CARD'S INSTRUMENT, COMPACT. This row showed an orb and a
                clock and nothing else — the two readings a bar has room for
                — while the capture card three doors away showed a third:
                whether anything is actually reaching the microphone. That
                third one is the whole reason the meter was rebuilt, and it
                was missing from every posture that lives on a page. Same
                component, laid along the line instead of stacked. */}
              <RecordingMeter dict={dict} compact />
              <button
                type="button"
                className="wb2-micgo on"
                onClick={dict.stop}
                title="Stop and read it back"
                aria-label={`Stop dictating — ${label}`}
              >
                <Icon name="square" size={12} />
              </button>
              <button
                type="button"
                className="wb2-dictx"
                onClick={dict.cancel}
                title="Throw it away"
                aria-label={`Discard the recording — ${label}`}
              >
                <Icon name="x" size={12} />
              </button>
            </>
          ) : (
            <>
              {mic.voiceEnabled && (
                <button
                  type="button"
                  className="wb2-micgo"
                  onClick={dict.start}
                  disabled={disabled || dict.transcribing}
                  title="Say it instead"
                  aria-label={`Dictate — ${label}`}
                >
                  <Icon name="mic" size={14} />
                </button>
              )}
              <button
                type="button"
                className={"wb2-addgo" + (value.trim() === "" ? " idle" : "")}
                disabled={disabled || dict.transcribing}
                title="Add it"
                aria-label={`Add — ${label}`}
                onClick={addLine}
              >
                <Icon name="plus" size={14} />
              </button>
            </>
          )}
        </div>
        {dict.transcribing && <Waiting note={READING_BACK_NOTE} className="wb2-dicthint" />}
        {mic.err && <p className="wb2-dicterr">{mic.err}</p>}
        {offer}
      </div>
    );
  }

  return (
    <div className={"wb2-dict" + (className ? ` ${className}` : "")}>
      {/* And the same again in the posture closest to the capture card. A
          paragraph has no `rows`, so it is handed the number and the sheet
          works out the height the textarea would have had — measured, 74px
          either way at rows=3. */}
      {river ? (
        <LiveWords
          className="wb2-notes"
          rows={rows}
          label={label}
          said={value}
          text={dict.interim}
        />
      ) : (
        <textarea
          ref={box}
          className="wb2-notes"
          rows={rows}
          placeholder={dict.recording ? "Listening…" : placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={busy}
        />
      )}
      {mic.voiceEnabled && (
        <div className="wb2-dictbar">
          {dict.recording ? (
            <>
              <button
                type="button"
                className="wb2-dictmic on"
                onClick={dict.stop}
                title="Stop and read it back"
                aria-label={`Stop dictating — ${label}`}
              >
                <Icon name="square" size={13} />
              </button>
              {/* THE CARD'S INSTRUMENT, COMPACT. This row showed an orb and a
                clock and nothing else — the two readings a bar has room for
                — while the capture card three doors away showed a third:
                whether anything is actually reaching the microphone. That
                third one is the whole reason the meter was rebuilt, and it
                was missing from every posture that lives on a page. Same
                component, laid along the line instead of stacked. */}
              <RecordingMeter dict={dict} compact />
              <button
                type="button"
                className="wb2-dictx"
                onClick={dict.cancel}
                title="Throw it away"
                aria-label={`Discard the recording — ${label}`}
              >
                <Icon name="x" size={12} />
              </button>
            </>
          ) : dict.transcribing ? (
            <Waiting note={READING_BACK_NOTE} className="wb2-dicthint" />
          ) : (
            <button
              type="button"
              className="wb2-dictmic"
              onClick={dict.start}
              disabled={disabled}
              title="Say it instead"
              aria-label={`Dictate — ${label}`}
            >
              <Icon name="mic" size={13} />
              Say it
            </button>
          )}
        </div>
      )}
      {mic.err && <p className="wb2-dicterr">{mic.err}</p>}
      {offer}
    </div>
  );
}
