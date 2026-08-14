/* ── Reading a wheel event ──
   A MacBook trackpad and a mouse wheel arrive as the SAME event type, with no
   field naming the device. Both are `wheel` with ctrlKey false. So a canvas
   that treats every wheel event as a zoom leaves a trackpad with no pan
   gesture at all — the two-finger scroll everyone reaches for to move across a
   sheet zooms instead, and a sideways swipe (deltaY 0) reads as "not < 0" and
   zooms OUT.

   The devices are still distinguishable from the SHAPE of the event:

     mouse wheel   one notch, quantised: |deltaY| ~100–120, integral, deltaX
                   exactly 0, no momentum tail. Some browsers report it in
                   line/page units (deltaMode 1/2), which a trackpad never does.
     trackpad      pixel units, small and often fractional, both axes live, and
                   a decaying tail of events after the fingers lift.

   So: a wheel notch zooms, a two-finger scroll pans, and neither device has to
   learn a modifier. ctrl/cmd always forces zoom on top of that — macOS
   synthesises ctrlKey for a pinch, and cmd+wheel is the explicit override.

   The heuristic is not infallible: a hard trackpad flick can produce a large
   integral deltaY with deltaX 0 and be read as a notch. That misfire zooms
   when a pan was wanted, which the next scroll undoes. */

import { clamp } from "./geometry";

/** the fixed step a single wheel notch zooms by — the canvas's long-standing feel */
const NOTCH = 1.12;
/** pinch is continuous, so its factor scales with the delta rather than stepping */
const PINCH_K = 0.01;
/** no single pinch event may zoom more than this, however big the delta */
const PINCH_MAX = 1.25;
/** |deltaY| at or above this, integral and axis-locked, reads as a wheel notch */
const NOTCH_MIN_PX = 50;

/** the fields of a WheelEvent this reads — kept structural so tests need no DOM */
export interface WheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
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

/** Does this event carry the fingerprint of a mouse wheel rather than a pad? */
export function isWheelNotch(e: WheelLike): boolean {
  // only a wheel reports in lines or pages — a trackpad is always pixels
  if (e.deltaMode !== 0) return true;
  // a wheel has one axis; a trackpad drives both
  if (e.deltaX !== 0) return false;
  // trackpad pixel deltas are routinely fractional, notches never are
  if (!Number.isInteger(e.deltaY)) return false;
  return Math.abs(e.deltaY) >= NOTCH_MIN_PX;
}

/** What a wheel event means: zoom by a factor, or pan by screen pixels. */
export function readWheel(e: WheelLike): WheelGesture {
  const dx = toPixels(e.deltaX, e.deltaMode);
  const dy = toPixels(e.deltaY, e.deltaMode);
  const notch = isWheelNotch(e);

  /* ctrl is what macOS synthesises for a pinch, and what Windows sends for
     ctrl+wheel; cmd+wheel is the Mac user's explicit "zoom, not pan" */
  if (e.ctrlKey || e.metaKey) {
    return {
      kind: "zoom",
      factor: notch
        ? dy < 0
          ? NOTCH
          : 1 / NOTCH
        : clamp(Math.exp(-dy * PINCH_K), 1 / PINCH_MAX, PINCH_MAX),
    };
  }

  // a bare notch keeps the zoom a mouse user already expects
  if (notch) return { kind: "zoom", factor: dy < 0 ? NOTCH : 1 / NOTCH };

  // everything else is a trackpad scroll: pan, both axes, sign as the OS sends
  return { kind: "pan", dx, dy };
}
