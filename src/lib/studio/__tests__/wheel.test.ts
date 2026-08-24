/* A trackpad and a mouse wheel arrive as the same event, and two separate
   attempts to tell them apart by shape both shipped broken (see wheel.ts). So
   the mode is the user's, and these pin what each one does — against the real
   event shapes each device emits, not against the classifier's own rules. */

import { readWheel, type WheelLike } from "../wheel";

const ev = (p: Partial<WheelLike>): WheelLike => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  ...p,
});

/* Chrome/Windows: one notch, quantised and unaccelerated. */
const NOTCH_DOWN = ev({ deltaY: 120 });
const NOTCH_UP = ev({ deltaY: -120 });
/* Firefox reports the same notch in lines. */
const NOTCH_LINES = ev({ deltaY: 3, deltaMode: 1 });
/* Chrome/macOS: the same wheel, turned unhurriedly — acceleration shrinks the
   notch to a few integral pixels. Guess #1 read this as a trackpad. */
const NOTCH_SLOW_UP = ev({ deltaY: -12 });
/* A high-resolution wheel (Logitech and friends): fractional, many per detent.
   Guess #2 read THIS as a trackpad — the report that ended the guessing. */
const NOTCH_HIRES_UP = ev({ deltaY: -4.8 });
/* MacBook trackpad, two fingers: small, fractional, both axes live. */
const PAD_DOWN = ev({ deltaY: 4.5 });
const PAD_SIDEWAYS = ev({ deltaX: -12.5, deltaY: 0 });
const PAD_DIAGONAL = ev({ deltaX: 3.25, deltaY: -8.75 });
/* macOS synthesises ctrlKey for a pinch. */
const PINCH_IN = ev({ deltaY: -6.5, ctrlKey: true });
const PINCH_OUT = ev({ deltaY: 6.5, ctrlKey: true });

describe("readWheel in zoom mode", () => {
  it("zooms on every wheel a mouse can produce, whatever the delta looks like", () => {
    expect(readWheel(NOTCH_UP, "zoom")).toEqual({ kind: "zoom", factor: 1.12 });
    expect(readWheel(NOTCH_DOWN, "zoom")).toEqual({ kind: "zoom", factor: 1 / 1.12 });
    // the two shapes the old device-guessing sent to the pan branch
    expect(readWheel(NOTCH_SLOW_UP, "zoom").kind).toBe("zoom");
    expect(readWheel(NOTCH_HIRES_UP, "zoom").kind).toBe("zoom");
  });

  it("keeps the direction the same at every delta size", () => {
    for (const e of [NOTCH_UP, NOTCH_SLOW_UP, NOTCH_HIRES_UP]) {
      const g = readWheel(e, "zoom");
      if (g.kind !== "zoom") throw new Error("expected zoom");
      expect(g.factor).toBeGreaterThan(1); // away from the user -> closer in
    }
    const out = readWheel(ev({ deltaY: 4.8 }), "zoom");
    if (out.kind !== "zoom") throw new Error("expected zoom");
    expect(out.factor).toBeLessThan(1);
  });

  /* a high-resolution wheel fires many small events per detent, so each one
     has to be worth less than a full notch or a single detent would bolt */
  it("scales a sub-notch delta and steps only a full one", () => {
    const hires = readWheel(NOTCH_HIRES_UP, "zoom");
    const full = readWheel(NOTCH_UP, "zoom");
    if (hires.kind !== "zoom" || full.kind !== "zoom") throw new Error("expected zoom");
    expect(hires.factor).toBeLessThan(full.factor);
    expect(full.factor).toBe(1.12);
  });

  it("normalises a line-unit notch to the full step, not a nudge", () => {
    expect(readWheel(NOTCH_LINES, "zoom")).toEqual({ kind: "zoom", factor: 1 / 1.12 });
  });

  /* a trackpad set to zoom is a choice, and a sideways swipe must not become a
     zoom OUT — the way it did when deltaY 0 met `deltaY < 0 ? in : out` */
  it("does not zoom out on a sideways swipe that carries no deltaY", () => {
    const g = readWheel(PAD_SIDEWAYS, "zoom");
    if (g.kind !== "zoom") throw new Error("expected zoom");
    expect(g.factor).toBe(1); // no vertical delta, no zoom
  });
});

describe("readWheel in pan mode", () => {
  it("pans on a bare scroll, both axes, sign as the OS sends", () => {
    expect(readWheel(PAD_DOWN, "pan")).toEqual({ kind: "pan", dx: 0, dy: 4.5 });
    expect(readWheel(PAD_DIAGONAL, "pan")).toEqual({ kind: "pan", dx: 3.25, dy: -8.75 });
  });

  /* THE ORIGINAL BUG: a sideways swipe has deltaY 0, which the first
     classifier read as "not < 0" and answered by zooming OUT */
  it("pans sideways instead of zooming out on a horizontal swipe", () => {
    expect(readWheel(PAD_SIDEWAYS, "pan")).toEqual({ kind: "pan", dx: -12.5, dy: 0 });
  });

  it("pans a mouse notch too — the mode is the user's word, not a guess", () => {
    expect(readWheel(NOTCH_UP, "pan")).toEqual({ kind: "pan", dx: 0, dy: -120 });
  });

  it("normalises line and page units before panning by them", () => {
    expect(readWheel(NOTCH_LINES, "pan")).toEqual({ kind: "pan", dx: 0, dy: 48 });
    expect(readWheel(ev({ deltaY: 1, deltaMode: 2 }), "pan")).toEqual({
      kind: "pan",
      dx: 0,
      dy: 400,
    });
  });
});

describe("readWheel modifiers — the half that never needed guessing", () => {
  it("zooms on a pinch in either mode, continuously rather than in notches", () => {
    for (const mode of ["zoom", "pan"] as const) {
      const zin = readWheel(PINCH_IN, mode);
      const zout = readWheel(PINCH_OUT, mode);
      if (zin.kind !== "zoom" || zout.kind !== "zoom") throw new Error("expected zoom");
      expect(zin.factor).toBeGreaterThan(1); // fingers apart -> closer
      expect(zout.factor).toBeLessThan(1);
      // a gentler pinch moves less than a firmer one — a notch can't do this
      const soft = readWheel(ev({ deltaY: -1, ctrlKey: true }), mode);
      if (soft.kind !== "zoom") throw new Error("expected zoom");
      expect(soft.factor).toBeLessThan(zin.factor);
    }
  });

  /* a fast pinch can carry a huge delta; without the clamp one event would
     swallow the whole zoom range */
  it("clamps a violent pinch to a sane step", () => {
    const g = readWheel(ev({ deltaY: -900, ctrlKey: true }), "pan");
    if (g.kind !== "zoom") throw new Error("expected zoom");
    expect(g.factor).toBeLessThanOrEqual(1.25);
    const out = readWheel(ev({ deltaY: 900, ctrlKey: true }), "pan");
    if (out.kind !== "zoom") throw new Error("expected zoom");
    expect(out.factor).toBeGreaterThanOrEqual(1 / 1.25);
  });

  it("lets cmd force a zoom out of a scroll that would otherwise pan", () => {
    expect(readWheel(ev({ deltaY: -6.5, metaKey: true }), "pan").kind).toBe("zoom");
  });

  it("keeps ctrl+wheel zooming for a mouse on Windows", () => {
    expect(readWheel(ev({ deltaY: -120, ctrlKey: true }), "pan")).toEqual({
      kind: "zoom",
      factor: 1.12,
    });
  });
});
