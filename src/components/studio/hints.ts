"use client";
/* ── whether the canvas talks you through the armed tool ──
   The tool hint is a first-time-through thing: "drag a rectangle over the
   room · Esc to cancel" is the whole conversation the canvas has with someone
   who has never drawn one, and it is noise to someone who draws twenty a day.
   So it is a setting, and — like the wheel mode — a setting about the PERSON
   at this machine rather than about the design, which is why it lives in
   localStorage and not in the document.

   On by default: the cost of the hint to an expert is a corner of the canvas,
   and the cost of no hint to a beginner is not knowing that Esc gets them out.

   THE WAY BACK ON is a named line in the View menu (`view-menu.tsx`). It used
   to be a lone info glyph on the zoom strip, and it was reported as doing
   nothing — truthfully, because its only feedback is a window that exists
   just while a tool is armed, and with Select active pressing it changes
   nothing at all. Turning them OFF is still done on the hint itself, where
   the annoyance is. */

import { useSyncExternalStore } from "react";

const HINTS_KEY = "ht-studio-hints";

function readHints(): boolean {
  try {
    return localStorage.getItem(HINTS_KEY) !== "off";
  } catch {
    return true; // storage unavailable — the guided default
  }
}
/* localStorage does not exist on the server, so the markup that hydrates has
   to be the default and only then become the stored choice. */
const serverHints = () => true;

const listeners = new Set<() => void>();
export function setHintsOn(on: boolean) {
  try {
    localStorage.setItem(HINTS_KEY, on ? "on" : "off");
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

/** Whether tool hints show, live across every canvas and browser tab. */
export function useHintsOn(): boolean {
  return useSyncExternalStore(subscribe, readHints, serverHints);
}
