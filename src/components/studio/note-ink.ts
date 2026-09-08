"use client";
/* ── the ink the NEXT note is drawn in ──
   A drawing office marks up in more than one colour and usually stays in one
   for a while: this trade's clouds in one ink, this revision's in another, a
   query in red. Isaac, drawing three in a row:

     "I want the note colour to be whatever the last colour selected was. So
      you don't have to keep clicking. If you want to have three purple notes
      in a row, you don't have to keep clicking in to change the colour back."

   THE HOLE WAS NOT THE ONE IT LOOKS LIKE. The armed ink already survived from
   note to note within a sitting — it was `useState` in the editor. What it did
   not survive was the way the colour is actually CHOSEN. Two gaps, and the
   phrase "clicking IN" names the first exactly:

     · Picking a colour from the swatch row INSIDE an open note recoloured that
       note and told the bench nothing, so the next note came out graphite
       again. That is the natural place to choose — the note is open, the
       swatches are right there — and it was the one place that did not stick.
     · Being component state, it died on any reload. A deploy reloads open
       tabs, and this is a design surface somebody sits in for an hour.

   So the rule is one rule: THE LAST COLOUR CHOSEN ANYWHERE IS WHAT THE NEXT
   NOTE IS DRAWN IN. Both doors write here.

   It lives in localStorage rather than on the design for the same reason the
   wheel mode does: it is what the person at this machine is marking up in
   right now, not a fact about the drawing. Every note keeps its OWN hex on the
   document once drawn (see `noteInkOf`), so re-arming can never re-tint work
   that already exists. */

import { useSyncExternalStore } from "react";
import { DEFAULT_NOTE_INK, NOTE_INKS } from "@/lib/studio/notes";

const INK_KEY = "ht-note-ink";

/** Only a colour still ON the palette is remembered as the armed one.

    This is the one place membership is checked, and it is deliberately the
    opposite of `noteInkOf`, which validates well-formedness only so a note
    printed a year from now keeps the colour it was drawn in. A DRAWN note is a
    record; the armed ink is a control, and a control offering a swatch that is
    no longer in the row would have nothing to light up. */
function readInk(): string {
  try {
    const v = localStorage.getItem(INK_KEY);
    return NOTE_INKS.some((k) => k.hex === v) ? (v as string) : DEFAULT_NOTE_INK;
  } catch {
    return DEFAULT_NOTE_INK; // storage unavailable — the hueless default
  }
}
/* localStorage does not exist on the server, so the markup that hydrates has
   to be the default and only then become the stored choice. */
const serverInk = () => DEFAULT_NOTE_INK;

const listeners = new Set<() => void>();

/** Arm an ink. Called from BOTH doors — the bench flyout and the swatch row
    inside an open note — because either one is somebody choosing a colour. */
export function setArmedInk(hex: string) {
  try {
    localStorage.setItem(INK_KEY, hex);
  } catch {
    /* private mode — the choice won't survive a reload, but it works now */
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/** What the next note will be drawn in, live across every canvas and tab. */
export function useArmedInk(): string {
  return useSyncExternalStore(subscribe, readInk, serverInk);
}
