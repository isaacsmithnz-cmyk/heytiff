"use client";

import type { ReactNode, Ref } from "react";
import { Button, IconButton } from "@/components/parts/button";
import { RecordingCard } from "@/components/notes/recording-card";
import type { DictationState } from "@/components/notes/dictation";
import { READING_BACK_NOTE } from "@/components/notes/waits";
import { Waiting } from "@/components/ui/orb";

/* THE BOX AT THE FOOT (the board v2-board-conversations): the words at 16
   (rule 13), then the microphone, icon-only (rule 27), and the blue main
   button with its word on the right (rule 22, Q6). One box for both of the
   place's conversations: asking Tiff, where it says Send, and Only me, where
   it says Save.

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
      {dict?.recording ? (
        <div className="cv-rec" role="group" aria-label="Recording">
          <RecordingCard dict={dict} text={value} />
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
        {dict && !dict.recording && (
          <IconButton glyph="mic" label="Speak instead of typing" size={36} disabled={dict.transcribing} onClick={dict.start} />
        )}
        <Button
          kind="main"
          size={36}
          type="submit"
          className={`cv-send${waiting ? " cv-send--wait" : ""}`}
          aria-label={sendLabel}
          aria-busy={waiting || undefined}
          disabled={waiting || listening}
        >
          {sendWord}
        </Button>
      </div>
    </form>
  );
}
