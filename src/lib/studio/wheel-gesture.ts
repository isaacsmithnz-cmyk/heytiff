/* Zooming the plan with a wheel that might be a trackpad.

   `readWheel` answers one event at a time, and for a mouse that is the whole
   story: a detent is one or two events worth about 1.12× and you stop where
   you meant to. A trackpad flick is not one delta. macOS sends sixty-odd
   events of ~5% each and keeps sending them through the momentum tail after
   the fingers have left the glass — so with the wheel set to zoom, one
   ordinary flick asks for a factor in the hundreds and the plan pins to
   MAX_ZOOM every time. There is no size in between you can stop on.

   The photo viewer had exactly this bug and it was reported in exactly those
   words ("fix zoom for trackpad. not working well"). This is that fix, on the
   canvas: `lib/workboard/photo-zoom.ts` is the same policy over the same
   reader, walked on Isaac's own trackpad and confirmed to feel right.

   THIS IS NOT A DEVICE TEST, AND THAT IS THE POINT. Telling a trackpad from a
   mouse off a wheel event has been tried twice here and failed twice — once
   on delta SIZE, once on FRACTIONAL deltas — because the two devices emit
   overlapping shapes and the peripheral that breaks each guess is the one
   already on the desk (see wheel.ts). Nothing in this file asks what the
   hardware is. It asks how long since the last event, which is a question
   about the GESTURE:

     Events closer together than GESTURE_GAP_MS are one gesture, and one
     gesture may only spend GESTURE_BUDGET of zoom. A flick and its whole
     momentum tail is one gesture, so it lands near 3× instead of the ceiling.
     Lift and scroll again and that is a second gesture with a full budget, so
     no range is capped — the budget bounds a RUNAWAY, not a reach.

   A MOUSE DETENT SPENDS ALMOST NONE OF IT, which is the property that keeps
   this a gesture rule rather than a device rule in disguise: ten detents in a
   row come to 3.1×, i.e. the ceiling is only reached by the gesture that had
   no business getting there.

   WHY IT MATTERS MORE HERE THAN IT LOOKS. The canvas defaults to pan, so a
   trackpad flick does not zoom out of the box. But the wheel mode is ONE
   setting per machine, and a machine can have both devices on it — set it to
   zoom for the mouse, pick up the trackpad, and every flick used to bury the
   drawing at 12×. The budget is what makes the wrong setting survivable
   instead of catastrophic, and it is why this ships whether or not anything
   ever tries to detect the device.

   PINCH IS UNBUDGETED. ctrl/cmd is direct manipulation with no momentum
   behind it — every event of one is honest, so every event of one counts.

   The delta→factor arithmetic is NOT re-derived here. `readWheel` already
   handles macOS's acceleration curve, Firefox's line units and a
   high-resolution wheel's burst of small events, tuned over three PRs on the
   real hardware; a second copy of that tuning is a second thing to get wrong.
   This module is policy on top of it. */

import { readWheel, type WheelGesture, type WheelLike, type WheelMode } from "./wheel";

/** Events this far apart or closer are one gesture. Long enough to swallow a
    momentum tail (those events run ~8–16ms apart), short enough that a
    deliberate second scroll re-arms the budget.

    DECLARED HERE RATHER THAN IMPORTED from the photo viewer, which uses the
    same two numbers. They mean the same thing today, but the viewer's are a
    live tuning knob for how a photograph feels under the hand — and a feel
    adjustment there must not silently retune the plan. */
export const GESTURE_GAP_MS = 80;

/** How much zoom one gesture may spend, as a ratio. THIS IS THE TUNING KNOB
    if the feel is off: raise it if zooming feels capped, lower it if one
    flick still overshoots. */
export const GESTURE_BUDGET = 3;

const BUDGET_LOG = Math.log(GESTURE_BUDGET);

export type CanvasWheelGesture =
  | WheelGesture
  /** this gesture has spent its zoom budget: swallow the event, change nothing */
  | { kind: "spent" };

export type WheelGestureState = {
  /** when the last event of this gesture arrived */
  at: number;
  /** zoom spent so far this gesture, in log space so in and out cost alike */
  spent: number;
};

/**
 * What one wheel event means on the plan.
 *
 * `now` is passed in rather than read, and the whole thing is a pure function
 * of (event, mode, clock, previous state) — which is what lets a test replay a
 * trackpad flick exactly, sixty events and all, with no device and no real
 * clock. The canvas passes the event's own `timeStamp`.
 *
 * Panning is never budgeted. A flick that pans travels as far as the fingers
 * asked and the pan clamp is what stops it running off the drawing — a budget
 * there would just make the plan feel sticky.
 */
export function readCanvasWheel(
  e: WheelLike,
  mode: WheelMode,
  now: number,
  prev: WheelGestureState | null
): { gesture: CanvasWheelGesture; state: WheelGestureState } {
  const g = readWheel(e, mode);

  /* a pan costs nothing and clears nothing: the gesture's zoom spend has to
     survive a stray sideways event in the middle of a flick */
  if (g.kind === "pan") {
    const carry = prev !== null && now - prev.at <= GESTURE_GAP_MS ? prev.spent : 0;
    return { gesture: g, state: { at: now, spent: carry } };
  }

  /* A pinch is direct and momentum-free: it spends nothing and clears
     whatever a previous scroll had spent, because the fingers doing it are
     not the fingers that were scrolling. */
  if (e.ctrlKey || e.metaKey) {
    return { gesture: g, state: { at: now, spent: 0 } };
  }

  const continuing = prev !== null && now - prev.at <= GESTURE_GAP_MS;
  const spent = continuing ? prev.spent : 0;
  if (spent >= BUDGET_LOG) {
    return { gesture: { kind: "spent" }, state: { at: now, spent } };
  }
  return {
    gesture: g,
    state: { at: now, spent: spent + Math.abs(Math.log(g.factor)) },
  };
}
