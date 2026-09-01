/* Zooming a photograph with a wheel that might be a trackpad.

   THE VIEWER SHIPPED ASKING THE CANVAS'S READER FOR `"zoom"` ON EVERY EVENT,
   and on a trackpad that is the wrong question. A two-finger flick is not one
   gesture-sized delta: macOS sends sixty-odd events, ~5% of zoom each, and
   keeps sending them through the momentum tail after the fingers have left
   the glass. Replayed against the old reader, one ordinary flick asks for a
   factor of TWO HUNDRED AND FIFTY — so every flick pinned the photo to the
   zoom ceiling and there was no size in between you could stop on. Isaac:
   "fix zoom for trackpad. not working well."

   THE FIX IS NOT ANOTHER DEVICE TEST. That road is already mapped and it is a
   dead end: a trackpad and a mouse arrive as the same event, the canvas
   guessed twice (delta SIZE, then FRACTIONAL deltas) and was wrong twice,
   each guess costing a round trip with Isaac — see lib/studio/wheel.ts.
   Nothing here asks what the hardware is. It asks how long since the last
   event, which is a question about the GESTURE:

     Events closer together than GESTURE_GAP_MS are one gesture, and one
     gesture may only spend GESTURE_BUDGET of zoom. A flick and its whole
     momentum tail is one gesture, so it lands on about 2× instead of 250×.
     Lift and scroll again and that is a second gesture with a full budget,
     so nobody is capped — the budget bounds a RUNAWAY, not a range.

   A MOUSE DETENT IS ONE OR TWO EVENTS and spends almost none of the budget,
   so this is invisible to a mouse. That is the property that makes it a
   gesture rule rather than a device rule in disguise.

   PINCH IS UNBUDGETED. ctrl/cmd is the one signal that never needed guessing
   — macOS synthesises ctrlKey for a pinch, Windows sends it for ctrl+wheel,
   cmd+wheel is a deliberate "zoom this" — and a pinch is direct manipulation
   with no momentum behind it. Every event of one is honest, so every event of
   one counts.

   AN EARLIER DRAFT OF THIS FILE ALSO PANNED, and it was wrong in a way worth
   recording. The rule was "a bare wheel over an already-zoomed photo scrolls
   the stage instead of zooming", which is exactly how Preview behaves and
   felt like the whole trackpad answer. Replayed with a mouse it was a trap:
   the first detent zooms in, and from that moment the photo IS zoomed, so
   every later detent pans and the wheel can never zoom again. The walk
   printed it plainly — four detents, four identical widths. Panning is the
   DRAG's job here (and a pinch still zooms), which costs a trackpad nothing
   it cannot already do with one finger down.

   The delta→factor arithmetic is NOT re-derived here. `readWheel` already
   handles macOS's acceleration curve, Firefox's line units and a
   high-resolution wheel's burst of small events; it was tuned on Isaac's own
   hardware over three PRs, and a second copy of that tuning is a second thing
   to get wrong. This module is policy on top of it. */

import { readWheel, type WheelLike } from "@/lib/studio/wheel";

/** Events this far apart or closer are one gesture. Long enough to swallow a
    momentum tail (those events run ~8–16ms apart), short enough that a
    deliberate second scroll re-arms the budget. */
export const GESTURE_GAP_MS = 80;

/** How much zoom one gesture may spend, as a ratio. Far more than a flick
    should ever have been worth and far less than the ~250× it was.
    THIS IS THE TUNING KNOB if the feel is still off — raise it if zooming
    feels capped, lower it if one flick still overshoots. */
export const GESTURE_BUDGET = 3;

const BUDGET_LOG = Math.log(GESTURE_BUDGET);

export type PhotoWheelGesture =
  /** multiply the zoom by `factor`, anchored under the pointer */
  | { kind: "zoom"; factor: number }
  /** this gesture has spent its budget: swallow the event, change nothing */
  | { kind: "spent" };

export type PhotoWheelState = {
  /** when the last event of this gesture arrived */
  at: number;
  /** zoom spent so far this gesture, in log space so in and out cost alike */
  spent: number;
};

/**
 * What one wheel event means over a photograph.
 *
 * `now` is passed in rather than read, and the whole thing is a pure function
 * of (event, clock, previous state) — which is what makes a trackpad flick
 * something a test can replay exactly, sixty events and all, without a device
 * or a real clock.
 */
export function readPhotoWheel(
  e: WheelLike,
  now: number,
  prev: PhotoWheelState | null
): { gesture: PhotoWheelGesture; state: PhotoWheelState } {
  const g = readWheel(e, "zoom");
  const factor = g.kind === "zoom" ? g.factor : 1;

  /* A pinch is direct and momentum-free: it spends nothing and clears
     whatever a previous scroll had spent, because the fingers doing it are
     not the fingers that were scrolling. */
  if (e.ctrlKey || e.metaKey) {
    return { gesture: { kind: "zoom", factor }, state: { at: now, spent: 0 } };
  }

  const continuing = prev !== null && now - prev.at <= GESTURE_GAP_MS;
  const spent = continuing ? prev.spent : 0;
  if (spent >= BUDGET_LOG) {
    return { gesture: { kind: "spent" }, state: { at: now, spent } };
  }
  return {
    gesture: { kind: "zoom", factor },
    state: { at: now, spent: spent + Math.abs(Math.log(factor)) },
  };
}

/**
 * Where the stage must be scrolled to so the point under the pointer stays
 * under the pointer across a zoom.
 *
 * Without this the photo simply grows from its top-left and whatever you were
 * looking at slides off the screen — you zoom in on a dataplate and end up
 * holding a corner of the roof. The arithmetic is exact while the picture
 * fills the stage, which is the only time there is any scroll to set: below
 * that the CSS centres it and both offsets are zero anyway.
 *
 * `offset` is the pointer's distance from the stage's own top-left edge.
 */
export function anchoredScroll(
  scroll: { left: number; top: number },
  offset: { x: number; y: number },
  ratio: number
): { left: number; top: number } {
  return {
    left: Math.max(0, (scroll.left + offset.x) * ratio - offset.x),
    top: Math.max(0, (scroll.top + offset.y) * ratio - offset.y),
  };
}
