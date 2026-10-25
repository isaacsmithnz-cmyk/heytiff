"use client";

import type { ReactNode, Ref } from "react";
import { Button, IconButton } from "@/components/parts/button";
import { DictClock, LiveWords, type DictationState } from "@/components/notes/dictation";
import { READING_BACK_NOTE } from "@/components/notes/waits";
import { Waiting } from "@/components/ui/orb";

/* THE BOX AT THE FOOT (the board v2-board-conversations): the words at 16
   (rule 13), then the microphone, icon-only (rule 27), and the blue main
   button with its word on the right (rule 22, Q6). It says Send.

   Enter sends and Shift+Enter starts a new line, as every chat box does.
   While Tiff works, Send fades until she's done (6-revisions.md, "While
   Tiff works"); the words you type meanwhile wait in the box.

   THE MICROPHONE IS THE SHARED ONE. While it listens the box hands its space
   to the recording card every other door shows, and gets it back when the
   words land in it ("the input section should be identical throughout the
   software", Isaac). The engine is the caller's `useDictation`, so what the
   words become is the caller's business too. */

export function CvBox({
  value,
  onChange,
  onSubmit,
  label,
  placeholder,
  sendWord,
  sendLabel,
  waiting = false,
  dict,
  voiceError,
  ranOut = false,
  boxRef,
  before,
  lead,
  extra,
  worded = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  /** The box's name for a screen reader. */
  label: string;
  placeholder: string;
  /** The main button's word: Send, Save. */
  sendWord: string;
  /** The main button's full name, when its word alone is too short to say it. */
  sendLabel?: string;
  /** Tiff is working, or the note is saving: the main button fades and waits. */
  waiting?: boolean;
  /** The microphone, when this deployment can hear; null hides it. */
  dict: DictationState | null;
  voiceError?: string | null;
  /** The last recording stopped at the two-minute ceiling. */
  ranOut?: boolean;
  boxRef?: Ref<HTMLTextAreaElement>;
  /** Anything the box carries above its words: the document it is scoped to. */
  before?: ReactNode;
  /** On the bar's left, before the microphone's side: a job's Add photo. */
  lead?: ReactNode;
  /** A second way to press, beside the main button: a job's Keep as typed. */
  extra?: ReactNode;
  /** The main button says its word, blue, as a job's Overview draws it
      (Isaac, 25 October 2026, "Yes, build the refined Overview A"); the
      arrow otherwise, as Claude's. */
  worded?: boolean;
}) {
  const listening = !!dict && (dict.recording || dict.transcribing);
  const empty = !value.trim();
  return (
    <form
      className="cv-box"
      onSubmit={(e) => {
        e.preventDefault();
        if (!waiting && !empty) onSubmit();
      }}
    >
      {before}
      {/* RECORDING IN THE BOX, AS CLAUDE'S DOES (Isaac, 20 October 2026: "no
          Type instead, Start again, Done"): what you say comes into the box
          as you say it; the bar below has the red dot, the time and Stop. */}
      {dict?.recording ? (
        <div className="cv-words cv-live" role="group" aria-label="Recording" aria-live="polite">
          <LiveWords said={value} text={dict.interim} />
        </div>
      ) : (
        <textarea
          ref={boxRef}
          className="cv-words"
          rows={1}
          value={value}
          aria-label={label}
          placeholder={placeholder}
          disabled={listening}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            if (!waiting && !empty) onSubmit();
          }}
        />
      )}
      {dict?.transcribing && <Waiting note={READING_BACK_NOTE} className="cv-say" />}
      {ranOut && !listening && (
        <p className="cv-say" role="status">
          That recording reached two minutes, the most one can be. Press the microphone to carry on.
        </p>
      )}
      {voiceError && (
        <p className="cv-say cv-say--bad" role="alert">
          {voiceError}
        </p>
      )}
      <div className="cv-boxbar">
        {dict?.recording && (
          <span className="tc-rec">
            <span className="tc-recdot" aria-hidden="true" />
            <DictClock seconds={dict.seconds} />
          </span>
        )}
        {lead}
        <span className="tc-sp" />
        {dict?.recording ? (
          <button type="button" className="pt-btn pt-btn--second pt-btn--32 pt-btn--icon tc-stop" aria-label="Stop" onClick={dict.stop}>
            <span aria-hidden="true" />
          </button>
        ) : dict ? (
          <IconButton glyph="mic" label="Speak instead of typing" size={32} disabled={dict.transcribing} onClick={dict.start} />
        ) : null}
        {extra}
        {worded ? (
          <Button
            kind="main"
            size={32}
            type="submit"
            aria-label={sendLabel ?? sendWord}
            className={`cv-send${waiting ? " cv-send--wait" : ""}`}
            aria-busy={waiting || undefined}
            disabled={waiting || listening || empty}
          >
            {sendWord}
          </Button>
        ) : (
          /* Send as Claude's: an arrow, grey until there is something to send */
          <IconButton
            glyph="send"
            kind="main"
            size={32}
            type="submit"
            label={sendLabel ?? sendWord}
            className={`cv-send${waiting ? " cv-send--wait" : ""}`}
            aria-busy={waiting || undefined}
            disabled={waiting || listening || empty}
          />
        )}
      </div>
    </form>
  );
}
