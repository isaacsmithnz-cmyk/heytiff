/* A trackpad and a mouse wheel arrive as the same event. These are the real
   shapes each device emits, so the classifier is pinned against samples rather
   than against its own rules. */

import { readWheel, isWheelNotch, type WheelLike } from "../wheel";

const ev = (p: Partial<WheelLike>): WheelLike => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  ...p,
});

/* Chrome/macOS: one notch of a USB mouse. */
const NOTCH_DOWN = ev({ deltaY: 120 });
const NOTCH_UP = ev({ deltaY: -120 });
/* Firefox reports the same notch in lines. */
const NOTCH_LINES = ev({ deltaY: 3, deltaMode: 1 });
/* MacBook trackpad, two fingers: small, fractional, both axes live. */
const PAD_DOWN = ev({ deltaY: 4.5 });
const PAD_SIDEWAYS = ev({ deltaX: -12.5, deltaY: 0 });
const PAD_DIAGONAL = ev({ deltaX: 3.25, deltaY: -8.75 });
/* macOS synthesises ctrlKey for a pinch. */
const PINCH_IN = ev({ deltaY: -6.5, ctrlKey: true });
const PINCH_OUT = ev({ deltaY: 6.5, ctrlKey: true });

describe("isWheelNotch", () => {
  it("reads a quantised, axis-locked delta as a mouse wheel", () => {
    expect(isWheelNotch(NOTCH_DOWN)).toBe(true);
    expect(isWheelNotch(NOTCH_UP)).toBe(true);
  });

  it("reads line and page units as a mouse wheel — a trackpad is always pixels", () => {
    expect(isWheelNotch(NOTCH_LINES)).toBe(true);
    expect(isWheelNotch(ev({ deltaY: 1, deltaMode: 2 }))).toBe(true);
  });

  it("reads fractional, two-axis or small deltas as a trackpad", () => {
    expect(isWheelNotch(PAD_DOWN)).toBe(false);
    expect(isWheelNotch(PAD_SIDEWAYS)).toBe(false);
    expect(isWheelNotch(PAD_DIAGONAL)).toBe(false);
    // integral but far too small to be a notch
    expect(isWheelNotch(ev({ deltaY: 12 }))).toBe(false);
  });
});

describe("readWheel", () => {
  /* THE BUG: every wheel event used to zoom, so the gesture a trackpad user
     reaches for to cross a sheet made the sheet bigger instead. */
  it("pans on a bare trackpad scroll", () => {
    expect(readWheel(PAD_DOWN)).toEqual({ kind: "pan", dx: 0, dy: 4.5 });
    expect(readWheel(PAD_DIAGONAL)).toEqual({ kind: "pan", dx: 3.25, dy: -8.75 });
  });

  /* the worst of it: a sideways swipe has deltaY 0, which the old ternary read
     as "not < 0" and answered by zooming OUT */
  it("pans sideways instead of zooming out on a horizontal swipe", () => {
    expect(readWheel(PAD_SIDEWAYS)).toEqual({ kind: "pan", dx: -12.5, dy: 0 });
  });

  it("still zooms on a bare mouse notch, at the canvas's existing step", () => {
    expect(readWheel(NOTCH_UP)).toEqual({ kind: "zoom", factor: 1.12 });
    expect(readWheel(NOTCH_DOWN)).toEqual({ kind: "zoom", factor: 1 / 1.12 });
  });

  it("normalises a line-unit notch to the same zoom step", () => {
    expect(readWheel(NOTCH_LINES)).toEqual({ kind: "zoom", factor: 1 / 1.12 });
  });

  it("zooms on a pinch, continuously rather than in notches", () => {
    const zin = readWheel(PINCH_IN);
    const zout = readWheel(PINCH_OUT);
    expect(zin.kind).toBe("zoom");
    expect(zout.kind).toBe("zoom");
    if (zin.kind !== "zoom" || zout.kind !== "zoom") return;
    expect(zin.factor).toBeGreaterThan(1); // fingers apart -> closer
    expect(zout.factor).toBeLessThan(1);
    // a gentler pinch moves less than a firmer one — a notch can't do this
    const soft = readWheel(ev({ deltaY: -1, ctrlKey: true }));
    if (soft.kind !== "zoom") return;
    expect(soft.factor).toBeLessThan(zin.factor);
  });

  /* a fast pinch can carry a huge delta; without the clamp one event would
     swallow the whole zoom range */
  it("clamps a violent pinch to a sane step", () => {
    const g = readWheel(ev({ deltaY: -900, ctrlKey: true }));
    if (g.kind !== "zoom") throw new Error("expected zoom");
    expect(g.factor).toBeLessThanOrEqual(1.25);
    const out = readWheel(ev({ deltaY: 900, ctrlKey: true }));
    if (out.kind !== "zoom") throw new Error("expected zoom");
    expect(out.factor).toBeGreaterThanOrEqual(1 / 1.25);
  });

  it("lets cmd force a zoom out of a trackpad scroll", () => {
    const g = readWheel(ev({ deltaY: -6.5, metaKey: true }));
    expect(g.kind).toBe("zoom");
  });

  it("keeps ctrl+wheel zooming for a mouse on Windows", () => {
    expect(readWheel(ev({ deltaY: -120, ctrlKey: true }))).toEqual({
      kind: "zoom",
      factor: 1.12,
    });
  });
});
