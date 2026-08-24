/* ── Reading a wheel event ──
   A MacBook trackpad and a mouse wheel arrive as the SAME event type, with no
   field naming the device. Both are `wheel` with ctrlKey false. So the canvas
   has to guess, and it has been wrong in both directions:

   The FIRST bug (fixed by the classifier this replaces): every wheel event
   zoomed, so the two-finger scroll everyone reaches for to cross a sheet made
   the sheet bigger instead, and a sideways swipe (deltaY 0) read as "not < 0"
   and zoomed OUT.

   The SECOND bug (this pass): the classifier demanded |deltaY| >= 50 before it
   would call something a notch — the quantised ~100–120 that Windows sends.
   macOS does not send that. It runs the mouse wheel through the same scroll
   ACCELERATION curve as everything else, so an unhurried notch arrives as a
   handful of pixels: integral, deltaX 0, and far under the threshold. Which is
   also the shape of a slow pad scroll — so the tie was going to the pad and a
   mouse wheel could not zoom the canvas at all.

   Nothing about a single small event separates the two. So this reads the
   GESTURE rather than the event, and the tie now goes to zoom:

     · A pad gives itself away — deltaX moves (two fingers are never perfectly
       aligned), or deltaY arrives fractional. One such event LATCHES the pad
       for PAD_LATCH_MS, so the rest of that swipe pans even where individual
       events come back integral and axis-locked. A pinch latches it too: it
       proves a touch surface is under the hand.
     · Anything else zooms. A mouse can't fake a fractional delta or a second
       axis, so it reaches the zoom branch on its first notch.
     · Line/page units (deltaMode 1/2, Firefox) are a mouse outright — a
       trackpad only ever reports pixels.

   The tie has to go to zoom because the two failures are not equal. A notch
   that pans leaves a mouse with no zoom at all; a stray pad event that zooms
   moves the view a few percent and is swallowed by the latch on the very next
   event — which is also why a sub-notch delta zooms PROPORTIONALLY rather than
   by the full step: the misfire is then too small to read as a jump.

   A Magic Mouse is a touch surface, not a wheel, and is deliberately read as a
   pad: its scroll has the momentum and the two live axes of one. */

import { clamp } from "./geometry";

/** the fixed step a full wheel notch zooms by — the canvas's long-standing feel */
const NOTCH = 1.12;
/** continuous zoom: how much of the delta becomes zoom, per pixel */
const PINCH_K = 0.01;
/** no single continuous event may zoom more than this, however big the delta */
const PINCH_MAX = 1.25;
/** |deltaY| at or above this is a full, unaccelerated notch — step, don't scale */
const NOTCH_FULL_PX = 50;
/** how long one pad-shaped event keeps the rest of the gesture reading as a pad */
const PAD_LATCH_MS = 400;

/** the fields of a WheelEvent this reads — kept structural so tests need no DOM */
export interface WheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  /** monotonic ms (the browser's own `event.timeStamp`) — drives the latch */
  timeStamp: number;
}

export type WheelGesture =
  /** multiply the viewport zoom by `factor`, anchored at the cursor */
  | { kind: "zoom"; factor: number }
  /** move the viewport by `dx`/`dy` SCREEN px (divide by zoom for world units) */
  | { kind: "pan"; dx: number; dy: number };

/** deltaMode 1 is lines and 2 is pages; normalise both to pixels. */
function toPixels(delta: number, mode: number): number {
  if (mode === 1) return delta * 16;
  if (mode === 2) return delta * 400;
  return delta;
}

/** Does this event carry something only a touch surface produces — a live
    second axis, or a fractional pixel delta? A wheel has neither. */
export function hasPadShape(e: WheelLike): boolean {
  if (e.deltaMode !== 0) return false; // lines/pages are a mouse outright
  if (e.deltaX !== 0) return true;
  return !Number.isInteger(e.deltaY);
}

/** The zoom a delta this size deserves: a full notch steps, anything smaller
    (macOS's accelerated notches, a pinch) scales with the delta. */
function zoomFactor(dy: number, stepped: boolean): number {
  if (stepped) return dy < 0 ? NOTCH : 1 / NOTCH;
  return clamp(Math.exp(-dy * PINCH_K), 1 / PINCH_MAX, PINCH_MAX);
}

/**
 * A reader with a memory of the gesture in progress — one per canvas, since
 * the pad latch is state. Returns what each wheel event means: zoom by a
 * factor, or pan by screen pixels.
 */
export function createWheelReader(): (e: WheelLike) => WheelGesture {
  /** when a pad last proved itself; -Infinity until one does */
  let padAt = -Infinity;

  return function readWheel(e: WheelLike): WheelGesture {
    const dx = toPixels(e.deltaX, e.deltaMode);
    const dy = toPixels(e.deltaY, e.deltaMode);
    const pad = hasPadShape(e);
    if (pad) padAt = e.timeStamp;

    /* a full notch keeps the fixed step; line/page units are one notch however
       small the number, so 3 lines must not be read as an accelerated nudge */
    const stepped = e.deltaMode !== 0 || Math.abs(dy) >= NOTCH_FULL_PX;

    /* ctrl is what macOS synthesises for a pinch, and what Windows sends for
       ctrl+wheel; cmd+wheel is the Mac user's explicit "zoom, not pan" */
    if (e.ctrlKey || e.metaKey) return { kind: "zoom", factor: zoomFactor(dy, stepped) };

    // the pad's own gesture, and the tail of it that stops looking like one
    if (pad || e.timeStamp - padAt < PAD_LATCH_MS) return { kind: "pan", dx, dy };

    return { kind: "zoom", factor: zoomFactor(dy, stepped) };
  };
}
