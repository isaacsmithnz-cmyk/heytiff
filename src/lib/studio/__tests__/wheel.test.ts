/* A trackpad and a mouse wheel arrive as the same event. These are the real
   shapes each device emits, so the classifier is pinned against samples rather
   than against its own rules. */

import { createWheelReader, hasPadShape, type WheelLike } from "../wheel";

let clock = 1000;
const ev = (p: Partial<WheelLike>): WheelLike => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  timeStamp: clock,
  ...p,
});
/** the same event a moment later — the reader's latch is measured in ms */
const after = (ms: number, e: WheelLike): WheelLike => ({ ...e, timeStamp: e.timeStamp + ms });

/* Chrome/Windows: one notch, quantised and unaccelerated. */
const NOTCH_DOWN = ev({ deltaY: 120 });
const NOTCH_UP = ev({ deltaY: -120 });
/* Firefox reports the same notch in lines. */
const NOTCH_LINES = ev({ deltaY: 3, deltaMode: 1 });
/* Chrome/macOS: the SAME wheel, turned unhurriedly. macOS runs a mouse through
   its scroll acceleration curve, so a gentle notch lands as a few integral px —
   the shape that used to be read as a pad, leaving a mouse unable to zoom. */
const NOTCH_SLOW_DOWN = ev({ deltaY: 12 });
const NOTCH_SLOW_UP = ev({ deltaY: -12 });
/* MacBook trackpad, two fingers: small, fractional, both axes live. */
const PAD_DOWN = ev({ deltaY: 4.5 });
const PAD_SIDEWAYS = ev({ deltaX: -12.5, deltaY: 0 });
const PAD_DIAGONAL = ev({ deltaX: 3.25, deltaY: -8.75 });
/* macOS synthesises ctrlKey for a pinch. */
const PINCH_IN = ev({ deltaY: -6.5, ctrlKey: true });
const PINCH_OUT = ev({ deltaY: 6.5, ctrlKey: true });

/** a fresh reader — the pad latch is per-gesture state, so tests can't share one */
const reader = () => createWheelReader();

describe("hasPadShape", () => {
  it("reads a live second axis or a fractional delta as a touch surface", () => {
    expect(hasPadShape(PAD_DOWN)).toBe(true);
    expect(hasPadShape(PAD_SIDEWAYS)).toBe(true);
    expect(hasPadShape(PAD_DIAGONAL)).toBe(true);
  });

  it("reads an axis-locked integral delta as a wheel, at any size", () => {
    expect(hasPadShape(NOTCH_DOWN)).toBe(false);
    // THE BUG: this is a macOS notch, and it used to fail the size test
    expect(hasPadShape(NOTCH_SLOW_DOWN)).toBe(false);
  });

  it("reads line and page units as a wheel — a trackpad is always pixels", () => {
    expect(hasPadShape(NOTCH_LINES)).toBe(false);
    expect(hasPadShape(ev({ deltaY: 1, deltaMode: 2 }))).toBe(false);
  });
});

describe("wheel reader", () => {
  /* THE FIRST BUG: every wheel event used to zoom, so the gesture a trackpad
     user reaches for to cross a sheet made the sheet bigger instead. */
  it("pans on a bare trackpad scroll", () => {
    const read = reader();
    expect(read(PAD_DOWN)).toEqual({ kind: "pan", dx: 0, dy: 4.5 });
    expect(read(PAD_DIAGONAL)).toEqual({ kind: "pan", dx: 3.25, dy: -8.75 });
  });

  /* the worst of it: a sideways swipe has deltaY 0, which the old ternary read
     as "not < 0" and answered by zooming OUT */
  it("pans sideways instead of zooming out on a horizontal swipe", () => {
    expect(reader()(PAD_SIDEWAYS)).toEqual({ kind: "pan", dx: -12.5, dy: 0 });
  });

  it("zooms on a bare mouse notch, at the canvas's existing step", () => {
    const read = reader();
    expect(read(NOTCH_UP)).toEqual({ kind: "zoom", factor: 1.12 });
    expect(read(NOTCH_DOWN)).toEqual({ kind: "zoom", factor: 1 / 1.12 });
  });

  /* THE SECOND BUG, and the reason for this pass: on macOS the same wheel
     reports a fraction of that delta, and the canvas panned instead. */
  it("zooms on a macOS accelerated notch, which is small and integral", () => {
    const read = reader();
    const zin = read(NOTCH_SLOW_UP);
    const zout = read(NOTCH_SLOW_DOWN);
    expect(zin.kind).toBe("zoom");
    expect(zout.kind).toBe("zoom");
    if (zin.kind !== "zoom" || zout.kind !== "zoom") return;
    expect(zin.factor).toBeGreaterThan(1);
    expect(zout.factor).toBeLessThan(1);
  });

  /* a small delta zooms PROPORTIONALLY, so the one pad event that slips past
     the shape test moves the view a few percent rather than a whole step */
  it("scales a sub-notch zoom with the delta, and steps only a full notch", () => {
    const soft = reader()(ev({ deltaY: -4 }));
    const firm = reader()(ev({ deltaY: -40 }));
    if (soft.kind !== "zoom" || firm.kind !== "zoom") throw new Error("expected zoom");
    expect(soft.factor).toBeLessThan(firm.factor);
    expect(soft.factor).toBeLessThan(1.12); // gentler than a full notch
    expect(reader()(NOTCH_UP)).toEqual({ kind: "zoom", factor: 1.12 });
  });

  it("normalises a line-unit notch to the same zoom step", () => {
    expect(reader()(NOTCH_LINES)).toEqual({ kind: "zoom", factor: 1 / 1.12 });
  });

  /* the latch: one pad-shaped event says a hand is on a touch surface, so the
     axis-locked integral events in the SAME swipe keep panning rather than
     punctuating the pan with zooms */
  it("keeps panning through a swipe once the pad has given itself away", () => {
    const read = reader();
    expect(read(PAD_DIAGONAL).kind).toBe("pan");
    // mid-swipe the fingers track true: integral, one axis — a notch's shape
    expect(read(after(16, ev({ deltaY: 9 })))).toEqual({ kind: "pan", dx: 0, dy: 9 });
    expect(read(after(48, ev({ deltaY: 6 }))).kind).toBe("pan");
  });

  it("lets go of the latch once the swipe is over, so the wheel zooms again", () => {
    const read = reader();
    expect(read(PAD_DIAGONAL).kind).toBe("pan");
    expect(read(after(1200, NOTCH_SLOW_UP)).kind).toBe("zoom");
  });

  /* a pinch proves a touch surface is under the hand, so the scroll that
     follows it is a pad's however it looks */
  it("latches the pad from a pinch too", () => {
    const read = reader();
    expect(read(PINCH_IN).kind).toBe("zoom");
    expect(read(after(20, ev({ deltaY: 8 }))).kind).toBe("pan");
  });

  it("zooms on a pinch, continuously rather than in notches", () => {
    const zin = reader()(PINCH_IN);
    const zout = reader()(PINCH_OUT);
    expect(zin.kind).toBe("zoom");
    expect(zout.kind).toBe("zoom");
    if (zin.kind !== "zoom" || zout.kind !== "zoom") return;
    expect(zin.factor).toBeGreaterThan(1); // fingers apart -> closer
    expect(zout.factor).toBeLessThan(1);
    // a gentler pinch moves less than a firmer one — a notch can't do this
    const soft = reader()(ev({ deltaY: -1, ctrlKey: true }));
    if (soft.kind !== "zoom") return;
    expect(soft.factor).toBeLessThan(zin.factor);
  });

  /* a fast pinch can carry a huge delta; without the clamp one event would
     swallow the whole zoom range */
  it("clamps a violent pinch to a sane step", () => {
    const g = reader()(ev({ deltaY: -900, ctrlKey: true }));
    if (g.kind !== "zoom") throw new Error("expected zoom");
    expect(g.factor).toBeLessThanOrEqual(1.25);
    const out = reader()(ev({ deltaY: 900, ctrlKey: true }));
    if (out.kind !== "zoom") throw new Error("expected zoom");
    expect(out.factor).toBeGreaterThanOrEqual(1 / 1.25);
  });

  it("lets cmd force a zoom out of a trackpad scroll", () => {
    expect(reader()(ev({ deltaY: -6.5, metaKey: true })).kind).toBe("zoom");
  });

  it("keeps cmd zooming mid-swipe, when the pad latch is what's holding", () => {
    const read = reader();
    expect(read(PAD_DIAGONAL).kind).toBe("pan");
    expect(read(after(16, ev({ deltaY: -6, metaKey: true }))).kind).toBe("zoom");
  });

  it("keeps ctrl+wheel zooming for a mouse on Windows", () => {
    expect(reader()(ev({ deltaY: -120, ctrlKey: true }))).toEqual({
      kind: "zoom",
      factor: 1.12,
    });
  });
});
