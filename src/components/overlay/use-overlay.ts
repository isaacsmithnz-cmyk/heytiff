"use client";

import { useEffect, useEffectEvent, useState, useSyncExternalStore, type RefObject } from "react";

/* THE OVERLAY STACK — which dialog is in front, for every dialog at once.

   Each sheet and modal used to carry its own copy of the same plumbing: a
   document Escape listener, first focus, and nothing else. None of them knew
   about the others, so "innermost first" was written out by hand in the job
   card's Escape chain, a dialog inside a card closed the card with it unless
   that chain remembered to step aside, Tab walked out of every dialog but
   Tiff's into the page underneath, and the two places that must not answer
   an Escape a dialog owns (the board's inspector, Home's open day) found out
   by searching the page for `[aria-modal]`.

   Now a dialog says it is open (`useOverlay`) for as long as it is mounted,
   and the stack answers for all of them:

     ESCAPE goes to the dialog in front, and only to it. A dialog under
     another one hears nothing. A key something inside the dialog already
     took (an input clearing itself, a menu closing) is left alone: the
     stack listens last, on the way out, and steps aside for a key whose
     default was prevented.

     TAB GOES ROUND inside the dialog in front: from the last stop to the
     first and back, and from anywhere outside it to its first stop. Inside
     it the browser moves focus as it always does.

     FOCUS GOES BACK to what had it when the dialog opened, when the dialog
     took it along on the way out (focus on nothing, or on something that
     went with it). A host that puts focus back itself has already done so,
     and is left alone.

   In front means opened last: a dialog drawn inside another is drawn after
   it, so it is in front of it even when both arrive in one commit.

   Tiff's modal keeps its own keys (it is caught on the way down, before
   everything) and joins the stack only so the others know it is there. */

type Layer = { seq: number; el: HTMLElement | null };

let layers: readonly Layer[] = [];
const watchers = new Set<() => void>();
/** Render order. A parent renders before what it draws, and a later dialog
    after an earlier one, so this orders the stack the way it is seen. */
let drawn = 0;
const nextDrawn = () => ++drawn;

function changed() {
  for (const w of watchers) w();
}

function add(layer: Layer) {
  layers = [...layers, layer].sort((a, b) => a.seq - b.seq);
  changed();
}

function remove(layer: Layer) {
  layers = layers.filter((l) => l !== layer);
  changed();
}

const front = (): Layer | undefined => layers[layers.length - 1];

/** The dialog in front, or null. For a key that belongs to one dialog only
    while nothing is over it (the job card's J and K). */
export function frontOverlay(): HTMLElement | null {
  return front()?.el ?? null;
}

/** True while any dialog is open. For a handler on the page underneath that
    must leave a key to whatever is over it. */
export function overlayOpen(): boolean {
  return layers.length > 0;
}

function subscribe(watch: () => void) {
  watchers.add(watch);
  return () => {
    watchers.delete(watch);
  };
}

/** `overlayOpen()`, as state: the component re-renders when a dialog opens
    or closes over it. */
export function useOverlayOpen(): boolean {
  return useSyncExternalStore(subscribe, overlayOpen, () => false);
}

const STOPS = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled):not([type='hidden'])",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(", ");

/** What Tab can land on inside `el`: not a face that is hidden, not a part
    that is inert. Read off the markup, not the layout, so it holds where
    nothing is laid out. */
function stopsIn(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>(STOPS)].filter((s) => !s.closest("[hidden], [inert]"));
}

function goRound(e: KeyboardEvent, el: HTMLElement) {
  const stops = stopsIn(el);
  const at = document.activeElement;
  if (!stops.length) {
    e.preventDefault();
    return;
  }
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (!(at instanceof Node) || !el.contains(at)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (e.shiftKey && (at === first || at === el)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && at === last) {
    e.preventDefault();
    first.focus();
  }
}

/** What had focus when the dialog opened, if it is something to go back to. */
function opener(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const el = document.activeElement;
  return el instanceof HTMLElement && el !== document.body ? el : null;
}

export type OverlayOptions = {
  /** Escape, when this dialog is in front and nothing inside it took the
      key first. Without it the dialog answers Escape itself, or not at all. */
  onEscape?: () => void;
  /** Tab goes round inside it. Off for a dialog that keeps its own Tab. */
  trap?: boolean;
  /** Focus goes back to what had it when it opened. Off for a dialog whose
      host decides where focus goes. */
  restoreFocus?: boolean;
};

/** Say this dialog is open for as long as the caller is mounted. Call it in
    the component that draws the dialog, and mount that component only while
    the dialog is up. `ref` is the dialog's own element (the
    `role="dialog"` one). */
export function useOverlay(ref: RefObject<HTMLElement | null>, options: OverlayOptions = {}): void {
  const { trap = true, restoreFocus = true } = options;
  /* Taken while rendering, before the dialog's own first focus moves it. */
  const [seq] = useState(nextDrawn);
  const [from] = useState(opener);

  const onKey = useEffectEvent((e: KeyboardEvent, layer: Layer) => {
    if (front() !== layer) return;
    if (e.key === "Escape") {
      if (e.defaultPrevented || !options.onEscape) return;
      e.preventDefault();
      options.onEscape();
      return;
    }
    if (e.key === "Tab" && trap && !e.defaultPrevented && layer.el) goRound(e, layer.el);
  });

  useEffect(() => {
    /* The element now, not the ref later: on the way out React has let go
       of the ref before this cleanup runs. */
    const layer: Layer = { seq, el: ref.current };
    add(layer);
    const listen = (e: KeyboardEvent) => onKey(e, layer);
    document.addEventListener("keydown", listen);
    return () => {
      document.removeEventListener("keydown", listen);
      remove(layer);
      if (!restoreFocus || !from?.isConnected) return;
      const now = document.activeElement;
      const lost = !now || now === document.body || !now.isConnected || !!layer.el?.contains(now);
      if (lost) from.focus({ preventScroll: true });
    };
  }, [seq, ref, from, restoreFocus]);
}

/** The same, for a dialog that stays mounted and opens and shuts on a class
    (the palette): draw this while it is open, pointed at the dialog. */
export function OverlayWhileOpen({ of, ...options }: { of: RefObject<HTMLElement | null> } & OverlayOptions): null {
  useOverlay(of, options);
  return null;
}
