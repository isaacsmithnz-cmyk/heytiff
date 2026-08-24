/* ── Reading a wheel event ──
   A MacBook trackpad and a mouse wheel arrive as the SAME event type, with no
   field naming the device. Both are `wheel` with ctrlKey false. The canvas
   guessed which was which from the shape of the event, and the guess was wrong
   twice in a fortnight:

     · First it demanded |deltaY| >= 50 before it would call something a notch —
       the quantised ~120 Windows sends. macOS runs a mouse wheel through its
       scroll ACCELERATION curve, so an unhurried notch lands as a handful of
       pixels, and the wheel panned instead of zooming.
     · Then it read a fractional delta as proof of a touch surface. A
       high-resolution mouse wheel (Logitech's, among others) reports fractional
       deltas too, so that wheel STILL panned.

   There is no field left to guess with. The shapes genuinely overlap, and every
   rule that separates the two devices today is one peripheral away from being
   wrong again. So the canvas stops guessing and asks: `WheelMode` is a setting
   the user holds — the toggle sits in the zoom HUD — and this module obeys it.

   It defaults to "pan", which is the trackpad's answer: two fingers move across
   the plan and PINCH is the zoom, the way every other design tool behaves. It
   shipped defaulting to "zoom" for one day and that was wrong — a trackpad has
   no other pan gesture, so scroll-to-zoom left it unable to cross a drawing.
   A mouse set to pan loses nothing it can't reach another way (cmd+wheel zooms,
   middle-drag pans) while its owner flips the toggle once.

   The one thing that never needed guessing is ctrl/cmd. macOS synthesises
   ctrlKey for a pinch, Windows sends it for ctrl+wheel, and cmd+wheel is the
   Mac user's explicit "zoom, not pan" — so a modifier zooms in either mode.
   That leaves a trackpad able to pinch-zoom while the wheel is set to pan, and
   a mouse able to force a zoom while it is set to pan.

   Panning without the wheel: middle-drag, hold-Space and drag, or drag past the
   tap slop with a placement tool armed. */

import { clamp } from "./geometry";

/** what a bare wheel/scroll gesture does to the canvas — the user's choice */
export type WheelMode = "zoom" | "pan";

/** the fixed step a full, unaccelerated notch zooms by — the canvas's long-standing feel */
const NOTCH = 1.12;
/** continuous zoom: how much of a sub-notch delta becomes zoom, per pixel */
const CONTINUOUS_K = 0.01;
/** no single continuous event may zoom more than this, however big the delta */
const CONTINUOUS_MAX = 1.25;
/** |deltaY| at or above this is a full notch — step, don't scale */
const NOTCH_FULL_PX = 50;

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

/**
 * How much zoom a delta this size is worth.
 *
 * A full notch steps by the fixed amount the canvas has always used. Anything
 * smaller scales with the delta instead, which is what keeps the three ways a
 * device can spell "one notch" — a single 120px event, a single accelerated
 * 12px one, or a high-resolution wheel's burst of small ones — within sight of
 * each other rather than an order of magnitude apart. A pinch lands here too,
 * and a violent one is clamped so one event can't swallow the whole range.
 */
function zoomFactor(dy: number, stepped: boolean): number {
  if (stepped) return dy < 0 ? NOTCH : 1 / NOTCH;
  return clamp(Math.exp(-dy * CONTINUOUS_K), 1 / CONTINUOUS_MAX, CONTINUOUS_MAX);
}

/** What a wheel event means in this mode: zoom by a factor, or pan by screen px. */
export function readWheel(e: WheelLike, mode: WheelMode): WheelGesture {
  const dx = toPixels(e.deltaX, e.deltaMode);
  const dy = toPixels(e.deltaY, e.deltaMode);

  /* line/page units are one notch however small the number, so Firefox's
     "3 lines" must not be read as an accelerated nudge */
  const stepped = e.deltaMode !== 0 || Math.abs(dy) >= NOTCH_FULL_PX;

  if (mode === "zoom" || e.ctrlKey || e.metaKey) {
    return { kind: "zoom", factor: zoomFactor(dy, stepped) };
  }
  return { kind: "pan", dx, dy };
}
