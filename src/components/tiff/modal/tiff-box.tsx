"use client";

import { useId, useRef, useState } from "react";
import { TiffButton } from "@/components/notes/tiff-button";
import type { TiffRoom } from "@/lib/workboard/note-turns";
import { useTiff } from "./tiff-context";

/* THE ENTRY BOX — one box, in every room (Isaac, 2026-09-24, v8: "just have
   a text entry box, with a tiff button on the end. if text is typed in it
   say save or sort out. then if you hit the tiff button it follows the
   current flow").

   Empty, it is the words to type into and the Tiff button at its end, which
   opens the modal listening, in this box's room. Typing swaps the button
   for two:

     Save          the room's own save, the words filed as typed and Tiff
                   not asked: the diary keeps them (`keepWords`), Tasks makes
                   you a task (`addTask`), the Calendar an event on the day
                   it adds to (`addCalendarEvent`). The room passes it in;
                   the box never knows what it writes.
     Sort it out   the modal, opened on the words, which are your first turn
                   and go to Tiff at once.

   ENTER IS SORT IT OUT in the diary and Tasks (Isaac's call, 2026-09-25),
   and Save a click. The Calendar's box is a calendar's quick add, where
   Enter puts the words on the day (Isaac, 2026-09-26: "simplify it. how
   does a calendar normally add things in?"): a room says so with `enter`,
   and its Sort it out and Tiff button stay as they are. A room that adds
   to a day says which (`day`), and Tiff is told it with the words, so a
   line that names no day goes on it rather than her asking.

   The words leave the box when something has taken them: Save's writer said
   yes, or the modal opened on them. Anything else leaves them where they
   were — a save that failed says why under the box, and a modal that could
   not open (one is already open, or this viewer does not have it yet) takes
   nothing. While a save is out the words hold still (read-only, "Saving…"),
   so the words that leave are the words that were saved: an edit made
   meanwhile would have kept the saved words in the box, looking unsaved,
   for the next press to file again.

   The box is the modal's own reply box, on the page: the same edge, corner,
   words and 36px buttons, taller here (shell.css, `.tm-entry`). */

export type BoxSaved = { ok: true } | { ok: false; error: string };
/** A room's own Save: the words as typed, and whether they were kept. */
export type BoxSave = (text: string) => Promise<BoxSaved>;

/** Said when a save throws rather than answering. */
export const SAVE_FAILED = "Couldn't save that.";

export function TiffBox({
  room,
  placeholder,
  save,
  day,
  enter = "sort",
}: {
  room: TiffRoom;
  placeholder: string;
  save: BoxSave;
  /** The day what is said here is for, ISO, when the words name none. */
  day?: string;
  /** What Enter presses: Sort it out, or the room's own Save. */
  enter?: "sort" | "save";
}) {
  const tiff = useTiff();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A second press before the first one's render is not a second save. */
  const busy = useRef(false);
  const box = useRef<HTMLDivElement | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  const sortButton = useRef<HTMLButtonElement | null>(null);
  const errorId = useId();

  const words = text.trim();
  const typed = words !== "";

  /** Back to the words, unless you have gone somewhere else meanwhile: the
      button you pressed goes with the words, and focus would go with it. */
  const caretBack = () => {
    const at = document.activeElement;
    if (!at || at === document.body || box.current?.contains(at)) field.current?.focus({ preventScroll: true });
  };

  const onSave = async () => {
    if (!typed || busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    let saved: BoxSaved;
    try {
      saved = await save(words);
    } catch {
      saved = { ok: false, error: SAVE_FAILED };
    }
    busy.current = false;
    setSaving(false);
    if (saved.ok) {
      /* The field was read-only while it saved: what is in it is what went. */
      setText("");
    } else {
      setError(saved.error);
    }
    caretBack();
  };

  /** Sort it out: the modal, on the words. `from` is what grows it; focus
      comes back to the box, because the button pressed leaves with them. */
  const sort = (from: HTMLElement, keyboard: boolean) => {
    if (!typed || busy.current) return;
    const opened = tiff.open({ from, words, room, keyboard, back: field.current ?? undefined, day });
    if (!opened) return;
    setText("");
    setError(null);
  };

  return (
    <>
      <div className="tm-box tm-entry" ref={box}>
        <input
          className="tm-in"
          ref={field}
          value={text}
          readOnly={saving}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            /* Enter is Sort it out, or the room's Save — never mid-word in
               an input method, where Enter is choosing the word. */
            if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229) return;
            e.preventDefault();
            if (enter === "save") void onSave();
            else sort(sortButton.current ?? e.currentTarget, true);
          }}
          placeholder={placeholder}
          aria-label={placeholder.replace(/…$/, "")}
          aria-describedby={error ? errorId : undefined}
          autoComplete="off"
        />
        {typed ? (
          <>
            <button type="button" className="pbtn ghost" disabled={saving} onClick={onSave}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="pbtn primary"
              ref={sortButton}
              disabled={saving}
              /* A click with no pointer behind it came from the keyboard,
                 and nothing flies from a keyboard press (law 8). */
              onClick={(e) => sort(e.currentTarget, e.detail === 0)}
            >
              Sort it out
            </button>
          </>
        ) : (
          <TiffButton where="box" room={room} day={day} />
        )}
      </div>
      {error && (
        <p className="tm-err" id={errorId} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
