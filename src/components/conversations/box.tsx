"use client";

import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type Ref } from "react";
import { Icon } from "@/components/shell/icon";
import { appendSpoken, LiveWords, type DictationState } from "@/components/notes/dictation";
import { Fixing, SpeakBar } from "@/components/conversations/speak-bar";
import { usePeople } from "@/components/notes/use-people";
import { nameRuns } from "@/lib/staff/people-named";

/* THE BOX, THE PHONE'S (heytiff-mobile src/components/Talk.tsx, `Composer`).
   Isaac, 9 November 2026: "I want to make the web entry box the same as the
   mobile one. It's much nicer", then "I want the boxes to pretty much be
   identical". Round ends, the words at 16 (rule 13), round buttons on a soft
   grey (the plus where a box takes a file, the microphone), Save a rounded
   button beside Tiff's blue ↑, the little i on its corner.

   Enter sends and Shift+Enter starts a new line, as a desk keyboard expects:
   the one way the web's box is not the phone's. While Tiff works, ↑ waits
   until she's done; the words you type meanwhile wait in the box.

   SPEAKING, the words sit on their own over the bar, which is its own box
   (./speak-bar): ✕, the blue wave, the time in the last thirty seconds, ■,
   and ↑ to send them as they are. At ■ the words stay where they were, grey,
   until they land, then black: nothing blanks and nothing says "Thinking".
   The engine is the caller's `useDictation`, so what the words become is the
   caller's business too.

   SAVE, AND TIFF (Isaac, 6 November 2026: "Save creates a raw note, tiff
   processes it like she does today"). Where the words can be kept as they
   are, Save sits beside Tiff's ↑ and files them with no Tiff, for nothing;
   ↑ is Tiff's, and she reads them as she always has. A little i on it says
   what she does with them, until you have read it once ("I symbol can
   disappear after the first press"). A box that only keeps (your own notes)
   has no Tiff: Save is its main button, in blue. */

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
  /** The last recording stopped at the four-minute ceiling. */
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
  const sendNow = () => {
    dict?.stop();
    sendPending.current = true;
    setSendOnLand(true);
  };
  /* speaking from the moment the mic is opening, as every surface that shows
     a recording does (`arming` in dictation.tsx) */
  const speaking = !!dict && (dict.recording || dict.arming);
  /* stopped, the words on their way into the box: they stay where they were,
     grey, until they land (the phone's `hearing`) */
  const hearing = !!dict?.transcribing;
  const shown = hearing && dict?.interim ? appendSpoken(value, dict.interim) : value;
  /* A PERSON ON THE WORKSPACE, TYPED: their name in blue, so you can see
     Tiff has them, as the phone's box (Isaac, 11 November 2026). The words
     are drawn again behind the textarea with the name in blue (shell.css,
     `.cv-mirror`), and kept level with it as it scrolls. */
  const people = usePeople();
  const runs = nameRuns(shown, people);
  const named = runs.some((r) => r.name);
  const mirror = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const m = mirror.current;
    const t = m?.nextElementSibling;
    if (m && t) m.scrollTop = t.scrollTop;
  });
  return (
    <form
      className={`cv-box${speaking ? " cv-box--speaking" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!waiting && !empty && !speaking) onSubmit();
      }}
    >
      {speaking && dict ? (
        /* SPEAKING, THE WORDS SIT ON THEIR OWN OVER THE BAR, which is its own
           box (the phone's Composer): what you'd typed in ink, then what
           you're saying in grey, each word morphing into the right one. */
        <div className="cv-speak">
          {before}
          <div className="cv-live" role="group" aria-label="Recording">
            {value.trim() || dict.interim ? (
              <LiveWords said={value} text={dict.interim} />
            ) : (
              <p className="cv-listening" role="status">
                Listening
              </p>
            )}
          </div>
          <SpeakBar dict={dict} onSendNow={tiff ? sendNow : undefined} sendLabel={sendLabel ?? "Send to Tiff"} waiting={waiting} />
        </div>
      ) : (
        <div className="cv-field">
          {before}
          <div className="cv-wordsat">
            {named && (
              <div ref={mirror} className={`cv-words cv-mirror${hearing ? " cv-words--hearing" : ""}`} aria-hidden="true">
                {runs.map((r, i) =>
                  r.name ? (
                    <span key={i} className="cv-named">
                      {r.text}
                    </span>
                  ) : (
                    <Fragment key={i}>{r.text}</Fragment>
                  ),
                )}
                {/* a textarea keeps the height of a last empty line; a div only with something on it */}
                {shown.endsWith("\n") ? "​" : null}
              </div>
            )}
            <textarea
              ref={boxRef}
              className={`cv-words${hearing ? " cv-words--hearing" : ""}${named ? " cv-words--named" : ""}`}
              rows={1}
              value={shown}
              aria-label={label}
              placeholder={placeholder}
              disabled={hearing}
              onChange={(e) => onChange(e.target.value)}
              onScroll={(e) => {
                if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop;
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
                e.preventDefault();
                if (!waiting && !empty) onSubmit();
              }}
            />
          </div>
          {hearing && <Fixing />}
          <div className="cv-boxbar">
            {lead}
            <span className="tc-sp" />
            {dict ? (
              <button type="button" className="cv-rnd" aria-label="Speak instead of typing" disabled={hearing || waiting} onClick={dict.start}>
                <Icon name="mic" size={20} />
              </button>
            ) : null}
            {extra}
            {onSave && tiff && !empty && !hearing && (
              <button type="button" className="cv-save" onClick={onSave} disabled={saving || waiting} aria-busy={saving || undefined}>
                Save
              </button>
            )}
            {tiff ? (
              <TiffButton save={!!onSave}>
                <button
                  type="submit"
                  className={`cv-rnd cv-rnd--main cv-send${waiting || sendOnLand ? " cv-send--wait" : ""}`}
                  aria-label={sendLabel ?? "Send to Tiff"}
                  aria-busy={waiting || sendOnLand || undefined}
                  disabled={waiting || hearing || empty}
                >
                  <Icon name="arrowUp" size={18} sw={2.2} />
                </button>
              </TiffButton>
            ) : (
              <button
                type="button"
                onClick={onSave ?? onSubmit}
                aria-label={sendLabel ?? sendWord}
                className={`cv-save cv-save--main cv-send${saving || waiting ? " cv-send--wait" : ""}`}
                aria-busy={saving || waiting || undefined}
                disabled={saving || waiting || hearing || empty}
              >
                {sendWord}
              </button>
            )}
          </div>
        </div>
      )}
      {ranOut && !speaking && (
        <p className="cv-say" role="status">
          That recording reached four minutes, the most one can be. Press the microphone to carry on.
        </p>
      )}
      {voiceError && (
        <p className="cv-say cv-say--bad" role="alert">
          {voiceError}
        </p>
      )}
    </form>
  );
}

/** Where the little i is remembered as read: for the person, on the server
    (api/tiff/info-read), so pressed on the phone it's gone here too, and on
    this device as well, so it never flashes in. Read through the store hook
    so the server's first paint (no i) and the browser's agree; until the
    server has said, an i this device hasn't seen read stays hidden. A device
    that keeps nothing remembers it for the page. */
const READ_KEY = "heytiff.tiff-info-read";
const readListeners = new Set<() => void>();
let readNow = false;
/** What the server said: true, false, or null for "not kept" (each device for itself). */
let serverRead: boolean | null | undefined;
const localRead = () => {
  if (readNow) return true;
  try {
    return window.localStorage.getItem(READ_KEY) === "1";
  } catch {
    return false;
  }
};
const keepLocal = () => {
  readNow = true;
  try {
    window.localStorage.setItem(READ_KEY, "1");
  } catch {
    /* kept for the page only */
  }
};
const infoRead = () => localRead() || serverRead === undefined || serverRead === true;
let asked = false;
const askServer = () => {
  if (asked) return;
  asked = true;
  void Promise.resolve()
    .then(() => fetch("/api/tiff/info-read", { cache: "no-store" }))
    .then((r) => (r.ok ? (r.json() as Promise<{ read?: boolean | null }>) : { read: null }))
    .catch(() => ({ read: null }))
    .then((b) => {
      serverRead = typeof b.read === "boolean" ? b.read : null;
      if (serverRead) keepLocal();
      for (const fire of readListeners) fire();
    });
};
function useInfoRead(): [boolean, () => void] {
  const read = useSyncExternalStore(
    (fire) => {
      readListeners.add(fire);
      if (!localRead()) askServer();
      return () => readListeners.delete(fire);
    },
    infoRead,
    () => true,
  );
  const mark = () => {
    keepLocal();
    serverRead = true;
    void Promise.resolve()
      .then(() => fetch("/api/tiff/info-read", { method: "POST" }))
      .catch(() => undefined);
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
