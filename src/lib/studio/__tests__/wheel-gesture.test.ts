/* THE TRACKPAD FLICK, REPLAYED ON THE PLAN.

   The canvas defaults to pan, so this bug hides: it only bites once the wheel
   is set to zoom. But that setting is ONE per machine and a machine can carry
   both devices — set it for the mouse, pick up the trackpad, and every flick
   used to bury the drawing at MAX_ZOOM. So the budget is what makes the wrong
   setting survivable, and these pin it.

   None of it needs a device or a real clock: readCanvasWheel is a pure
   function of (event, mode, timestamp, previous state), which is the whole
   reason it is a module and not a closure inside the canvas. */

import {
  GESTURE_BUDGET,
  GESTURE_GAP_MS,
  readCanvasWheel,
  type WheelGestureState,
} from "../wheel-gesture";
import type { WheelMode } from "../wheel";

const ev = (
  deltaY: number,
  over: Partial<{ deltaX: number; ctrlKey: boolean; metaKey: boolean; deltaMode: number }> = {}
) => ({
  deltaX: 0,
  deltaY,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  ...over,
});

/** One macOS two-finger flick: sixty events, ramping then decaying through
    the momentum tail, ~10ms apart. The shape that asks for hundreds. */
function flick(): number[] {
  return Array.from({ length: 60 }, (_, i) => {
    const t = i / 59;
    return -(2 + 22 * Math.sin(Math.PI * Math.min(1, t * 1.4)) * (1 - t * 0.75));
  });
}

/** A mouse detent on macOS: acceleration shrinks it to a few integral px, and
    a high-resolution wheel spreads it over a short burst. */
const DETENT = [-4, -9, -6];

function run(
  deltas: number[],
  gap: number,
  opts: { mode?: WheelMode; ctrl?: boolean; meta?: boolean; dx?: number } = {}
) {
  let state: WheelGestureState | null = null;
  let now = 1000;
  let zoom = 1;
  let panned = { x: 0, y: 0 };
  let spentEvents = 0;
  for (const dy of deltas) {
    const read = readCanvasWheel(
      ev(dy, { ctrlKey: !!opts.ctrl, metaKey: !!opts.meta, deltaX: opts.dx ?? 0 }),
      opts.mode ?? "zoom",
      now,
      state
    );
    state = read.state;
    if (read.gesture.kind === "zoom") zoom *= read.gesture.factor;
    if (read.gesture.kind === "pan") {
      panned = { x: panned.x + read.gesture.dx, y: panned.y + read.gesture.dy };
    }
    if (read.gesture.kind === "spent") spentEvents++;
    now += gap;
  }
  return { zoom, panned, spentEvents };
}

describe("a trackpad flick with the wheel set to zoom", () => {
  /* THE BUG. Every event of a flick zoomed, so the plan hit the ceiling
     before the fingers had left the glass and there was no scale in between
     you could stop on. */
  it("is bounded to one gesture's budget, not sixty events' worth", () => {
    const { zoom } = run(flick(), 10);
    expect(zoom).toBeGreaterThan(1.5);
    expect(zoom).toBeLessThanOrEqual(GESTURE_BUDGET * 1.2);
  });

  /* What that same flick was worth unbudgeted — kept as a NUMBER so the size
     of the problem is on the record rather than in a commit message. It is
     well past MAX_ZOOM (12) from any starting scale, which is what "the plan
     disappears" means in practice. */
  it("was worth two orders of magnitude more than that before the budget", () => {
    const unbounded = flick().reduce(
      (acc, dy) => acc * Math.min(1.25, Math.max(1 / 1.25, Math.exp(-dy * 0.01))),
      1
    );
    expect(unbounded).toBeGreaterThan(100);
  });

  it("re-arms on the next flick, so nobody is capped in how far they can go", () => {
    const first = run(flick(), 10).zoom;
    const second = run(flick(), 10).zoom; // a fresh gesture, fresh budget
    expect(second).toBeCloseTo(first, 6);
  });

  it("swallows the tail rather than fighting it — the spend stops, the plan holds", () => {
    const { spentEvents } = run(flick(), 10);
    expect(spentEvents).toBeGreaterThan(0);
  });
});

/* THE PROPERTY THAT KEEPS THIS A GESTURE RULE AND NOT A DEVICE RULE IN
   DISGUISE. Nothing here asks what the hardware is, so the only defence
   against it punishing a mouse is that a mouse cannot reach the budget by
   doing anything a person actually does. */
describe("a mouse loses nothing to it", () => {
  it("spends almost nothing on a single detent", () => {
    const one = run(DETENT, 8).zoom;
    expect(one).toBeGreaterThan(1.1);
    expect(one).toBeLessThan(1.35);
  });

  it("never swallows an event across ten separate detents", () => {
    let total = 1;
    let spent = 0;
    for (let i = 0; i < 10; i++) {
      const r = run(DETENT, 8); // each its own gesture — hand pauses between
      total *= r.zoom;
      spent += r.spentEvents;
    }
    expect(spent).toBe(0);
    expect(total).toBeGreaterThan(5);
  });

  /* Ten detents rolled together WITHOUT a pause is the one mouse gesture that
     can reach the ceiling — and it comes out right at it, which is the
     evidence that the budget was sized for the flick and not against the
     wheel. */
  it("reaches the budget only by spinning ten detents without a pause", () => {
    const { zoom } = run([...DETENT, ...DETENT, ...DETENT, ...DETENT, ...DETENT,
      ...DETENT, ...DETENT, ...DETENT, ...DETENT, ...DETENT], 8);
    expect(zoom).toBeGreaterThan(2.5);
    expect(zoom).toBeLessThanOrEqual(GESTURE_BUDGET * 1.2);
  });

  it("counts a pause of more than the gap as a new gesture", () => {
    let state: WheelGestureState | null = null;
    const a = readCanvasWheel(ev(-9), "zoom", 1000, state);
    state = a.state;
    const b = readCanvasWheel(ev(-9), "zoom", 1000 + GESTURE_GAP_MS + 1, state);
    expect(b.state.spent).toBeLessThanOrEqual(a.state.spent + 1e-9);
  });
});

describe("what the budget deliberately does not touch", () => {
  /* A pinch is direct manipulation with no momentum behind it: every event of
     one is honest, so every event of one counts. */
  it("never budgets a pinch, however many events it carries", () => {
    const { zoom, spentEvents } = run(flick(), 10, { ctrl: true });
    expect(spentEvents).toBe(0);
    expect(zoom).toBeGreaterThan(GESTURE_BUDGET * 1.2);
  });

  it("never budgets cmd+wheel — the mouse's own way of forcing a zoom", () => {
    const { spentEvents } = run(flick(), 10, { meta: true, mode: "pan" });
    expect(spentEvents).toBe(0);
  });

  /* Panning is not budgeted at all. A flick that pans travels as far as the
     fingers asked; the pan CLAMP is what stops it running off the drawing,
     and a budget here would only make the plan feel sticky. */
  it("never budgets a pan, so a flick crosses the plan as asked", () => {
    const { panned, spentEvents } = run(flick(), 10, { mode: "pan" });
    expect(spentEvents).toBe(0);
    const asked = flick().reduce((a, dy) => a + dy, 0);
    expect(panned.y).toBeCloseTo(asked, 6);
  });

  /* A sideways nudge in the middle of a flick must not refund the zoom the
     flick has already spent — otherwise a diagonal gesture buys an unlimited
     budget one axis at a time. */
  it("does not let a pan event refund the gesture's zoom spend", () => {
    let state: WheelGestureState | null = null;
    for (let i = 0; i < 40; i++) {
      const read = readCanvasWheel(ev(-12), "zoom", 1000 + i * 10, state);
      state = read.state;
    }
    const spentBefore = state!.spent;
    // the same gesture, one horizontal event read in pan mode
    const sideways = readCanvasWheel(ev(0, { deltaX: -12 }), "pan", 1000 + 400, state);
    expect(sideways.gesture.kind).toBe("pan");
    expect(sideways.state.spent).toBeCloseTo(spentBefore, 9);
  });
});
