"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode, type Ref } from "react";
import { Button, IconButton } from "@/components/parts/button";
import { DictClock, LiveWords, type DictationState } from "@/components/notes/dictation";
import { READING_BACK_NOTE } from "@/components/notes/waits";
import { Waiting } from "@/components/ui/orb";

/* THE BOX AT THE FOOT (the board v2-board-conversations): the words at 16
   (rule 13), then the microphone, icon-only (rule 27), and the blue main
   button on the right (rule 22): Tiff's, her arrow and her name.

   Enter sends and Shift+Enter starts a new line, as every chat box does.
   While Tiff works, Send fades until she's done (6-revisions.md, "While
   Tiff works"); the words you type meanwhile wait in the box.

   THE MICROPHONE IS THE SHARED ONE. While it listens the box hands its space
   to the recording card every other door shows, and gets it back when the
   words land in it ("the input section should be identical throughout the
   software", Isaac). The engine is the caller's `useDictation`, so what the
   words become is the caller's business too.

   SAVE, AND TIFF (Isaac, 6 November 2026: "Save creates a raw note, tiff
   processes it like she does today"; "You can have tiff on the button with
   the arrow in web"). Where the words can be kept as they are, Save sits
   beside the main button and files them with no Tiff, for nothing; the main
   button is Tiff's, her arrow and her name, and she reads them as she always
   has. A little i on her button says what she does with them, until you
   have read it once ("I symbol can disappear after the first press"). A box
   that only keeps (your own notes) has no Tiff: Save is its main button. */

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
  onSave,
  saving = false,
  tiff = true,
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
  /** A second way to press, beside the main button. */
  extra?: ReactNode;
  /** Save: the words kept as written, with no Tiff. Shown once there are words. */
  onSave?: () => void;
  /** The words are being saved: Save waits. */
  saving?: boolean;
  /** The main button is Tiff's (her arrow and name); false where the box only
      keeps, and its main button says `sendWord`. */
  tiff?: boolean;
}) {
  const listening = !!dict && (dict.recording || dict.transcribing);
  const empty = !value.trim();
  /* SEND WHILE RECORDING STOPS IT AND SENDS (Isaac, 28 October 2026: "I
     couldn't even hit send. I had to wait for the timer to run out"). The
     words are still being read back when Send is pressed, so the send waits
     for them to land in the box, then goes as if pressed then. */
  const [sendOnLand, setSendOnLand] = useState(false);
  const sendPending = useRef(false);
  if (sendOnLand && !listening) setSendOnLand(false);
  useEffect(() => {
    if (!sendPending.current || listening) return;
    sendPending.current = false;
    if (!waiting && !empty) onSubmit();
  }, [listening, waiting, empty, onSubmit]);
  const recording = !!dict?.recording;
  const sendNow = () => {
    dict?.stop();
    sendPending.current = true;
    setSendOnLand(true);
  };
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
        {onSave && tiff && !recording && !empty && (
          <Button kind="second" size={32} onClick={onSave} disabled={saving || waiting} aria-busy={saving || undefined}>
            Save
          </Button>
        )}
        {tiff ? (
          <TiffButton save={!!onSave}>
            <Button
              kind="main"
              size={32}
              icon="send"
              type={recording ? "button" : "submit"}
              onClick={recording ? sendNow : undefined}
              aria-label={sendLabel ?? "Send to Tiff"}
              className={`cv-send${waiting || sendOnLand ? " cv-send--wait" : ""}`}
              aria-busy={waiting || sendOnLand || undefined}
              disabled={recording ? waiting : waiting || listening || empty}
            >
              Tiff
            </Button>
          </TiffButton>
        ) : (
          <Button
            kind="main"
            size={32}
            type="button"
            onClick={onSave ?? onSubmit}
            aria-label={sendLabel ?? sendWord}
            className={`cv-send${saving || waiting ? " cv-send--wait" : ""}`}
            aria-busy={saving || waiting || undefined}
            disabled={saving || waiting || listening || empty}
          >
            {sendWord}
          </Button>
        )}
      </div>
    </form>
  );
}

/** Where the little i is remembered as read, on this device, and read
    through the store hook so the server's first paint (no i) and the
    browser's agree. A device that keeps nothing remembers it for the page. */
const READ_KEY = "heytiff.tiff-info-read";
const readListeners = new Set<() => void>();
let readNow = false;
const infoRead = () => {
  if (readNow) return true;
  try {
    return window.localStorage.getItem(READ_KEY) === "1";
  } catch {
    return false;
  }
};
function useInfoRead(): [boolean, () => void] {
  const read = useSyncExternalStore(
    (fire) => {
      readListeners.add(fire);
      return () => readListeners.delete(fire);
    },
    infoRead,
    () => true,
  );
  const mark = () => {
    readNow = true;
    try {
      window.localStorage.setItem(READ_KEY, "1");
    } catch {
      /* kept for the page only */
    }
    for (const fire of readListeners) fire();
  };
  return [read, mark];
}

/** Tiff's button, with the little i on its corner until it has been read
    once: pressed, a few words over the box say what she does with the words,
    and pressed again, or anywhere else, they go and so does the i. */
function TiffButton({ save, children }: { save: boolean; children: ReactNode }) {
  const [read, markRead] = useInfoRead();
  const [open, setOpen] = useState(false);
  const at = useRef<HTMLSpanElement | null>(null);
  const tipId = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!at.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const show = () => {
    setOpen((o) => !o);
    markRead();
  };
  return (
    <span className="cv-tiffat" ref={at}>
      {children}
      {(!read || open) && (
        <button type="button" className="cv-info" aria-label="What Tiff does with it" aria-expanded={open} aria-controls={open ? tipId : undefined} onClick={show}>
          i
        </button>
      )}
      {open && (
        <span className="cv-tip" id={tipId} role="note">
          <b>Tiff reads it</b>
          And does what it asks: a task, a reminder, a visit, a message to someone.{save ? " Save keeps it as written." : ""}
        </span>
      )}
    </span>
  );
}
