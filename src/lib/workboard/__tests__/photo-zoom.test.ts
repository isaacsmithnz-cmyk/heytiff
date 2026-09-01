import {
  anchoredScroll,
  GESTURE_BUDGET,
  GESTURE_GAP_MS,
  readPhotoWheel,
  type PhotoWheelState,
} from "../photo-zoom";

/* THE TRACKPAD BUG, REPLAYED. None of this needs a device or a real clock —
   the reader is a pure function of (event, timestamp, previous state), which
   is the whole reason it is a module and not a closure inside the viewer. */

const ev = (deltaY: number, over: Partial<{ ctrlKey: boolean; metaKey: boolean }> = {}) => ({
  deltaX: 0,
  deltaY,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  ...over,
});

/** One macOS two-finger flick: sixty events, ramping then decaying through
    the momentum tail, arriving ~10ms apart. This is the shape that used to
    ask for a factor of 250. */
function flick(): number[] {
  return Array.from({ length: 60 }, (_, i) => {
    const t = i / 59;
    return -(2 + 22 * Math.sin(Math.PI * Math.min(1, t * 1.4)) * (1 - t * 0.75));
  });
}

/** Run a burst of deltas `gap` ms apart and return the total zoom applied. */
function run(deltas: number[], gap: number, opts: { ctrl?: boolean } = {}) {
  let state: PhotoWheelState | null = null;
  let now = 1000;
  let total = 1;
  for (const dy of deltas) {
    const read = readPhotoWheel(ev(dy, { ctrlKey: !!opts.ctrl }), now, state);
    state = read.state;
    if (read.gesture.kind === "zoom") total *= read.gesture.factor;
    now += gap;
  }
  return total;
}

describe("a trackpad flick", () => {
  /* THE BUG ITSELF. Every event of a flick used to zoom, so the photo was
     pinned to the ceiling before the fingers had left the glass and there was
     no size in between you could stop on. */
  it("is bounded to one gesture's budget, not sixty events' worth", () => {
    const applied = run(flick(), 10);
    expect(applied).toBeGreaterThan(1.5);
    expect(applied).toBeLessThanOrEqual(GESTURE_BUDGET * 1.2);
  });

  /* What the same flick was worth before the budget — kept as a number so
     the size of the problem is on the record and not just in a commit
     message. (`readWheel`'s own per-event clamp is the 1.25.) */
  it("was worth two orders of magnitude more than that unbounded", () => {
    const unbounded = flick().reduce(
      (acc, dy) => acc * Math.min(1.25, Math.max(1 / 1.25, Math.exp(-dy * 0.01))),
      1
    );
    expect(unbounded).toBeGreaterThan(100);
  });

  it("re-arms on the next flick, so nobody is capped in how far they can go", () => {
    const first = run(flick(), 10);
    // a second flick, its own gesture: the reader starts fresh
    const second = run(flick(), 10);
    expect(second).toBeCloseTo(first, 5);
  });

  /* Spending the budget must not leave the gesture applying a factor of 1
     forever in one direction only — a flick the other way is worth the same. */
  it("bounds zooming out by the same budget", () => {
    const out = run(flick().map((d) => -d), 10);
    expect(out).toBeLessThan(1);
    expect(out).toBeGreaterThanOrEqual(1 / (GESTURE_BUDGET * 1.2));
  });
});

describe("a mouse", () => {
  /* THE PROPERTY THAT MAKES THIS A GESTURE RULE AND NOT A DEVICE RULE IN
     DISGUISE: a detent is one or two events and spends almost none of the
     budget, so a mouse never meets the ceiling at all. */
  it("spends almost nothing of the budget on one detent", () => {
    const read = readPhotoWheel(ev(-120), 1000, null);
    expect(read.gesture.kind).toBe("zoom");
    expect(read.state.spent).toBeLessThan(Math.log(GESTURE_BUDGET) / 4);
  });

  it("keeps zooming detent after detent, in both directions", () => {
    let state: PhotoWheelState | null = null;
    let now = 1000;
    const factors: number[] = [];
    for (let i = 0; i < 8; i++) {
      const read = readPhotoWheel(ev(-120), now, state);
      state = read.state;
      if (read.gesture.kind === "zoom") factors.push(read.gesture.factor);
      now += GESTURE_GAP_MS + 60; // a deliberate roll: past the gap
    }
    expect(factors).toHaveLength(8);
    for (const f of factors) expect(f).toBeCloseTo(1.12, 5);
  });

  /* THE TRAP AN EARLIER DRAFT FELL INTO, pinned so it cannot come back. That
     draft panned instead of zooming whenever the photo was already zoomed,
     which is exactly how Preview behaves — and it meant the first detent
     zoomed in and every detent after it did nothing but scroll. The walk
     printed four identical widths. There is no zoomed/not-zoomed input here
     any more, and this test is why. */
  it("zooms the same whether or not the photo is already zoomed", () => {
    const first = readPhotoWheel(ev(-120), 1000, null);
    const later = readPhotoWheel(ev(-120), 5000, null);
    expect(first.gesture).toEqual(later.gesture);
  });

  /* macOS runs a mouse wheel through its scroll acceleration curve, so an
     unhurried notch is a handful of small events rather than one big one —
     the fact that cost the canvas two wrong guesses. They must add up to a
     usable step, not to nothing. */
  it("adds a macOS-accelerated detent's several small events into one real step", () => {
    const applied = run([-4, -9, -6], 8);
    expect(applied).toBeGreaterThan(1.1);
    expect(applied).toBeLessThan(1.5);
  });
});

describe("a pinch", () => {
  it("zooms unbudgeted — it is direct manipulation with no momentum behind it", () => {
    const applied = run(Array(60).fill(-5), 10, { ctrl: true });
    expect(applied).toBeGreaterThan(GESTURE_BUDGET);
  });

  it("clears what a scroll had spent — different fingers, different gesture", () => {
    let state: PhotoWheelState | null = null;
    let now = 1000;
    for (const dy of flick()) {
      state = readPhotoWheel(ev(dy), now, state).state;
      now += 10;
    }
    expect(state?.spent).toBeGreaterThanOrEqual(Math.log(GESTURE_BUDGET));

    const pinched = readPhotoWheel(ev(-5, { ctrlKey: true }), now + 10, state);
    expect(pinched.gesture.kind).toBe("zoom");
    expect(pinched.state.spent).toBe(0);
  });

  /* cmd+wheel is the Mac user's explicit "zoom, not scroll" and Windows sends
     ctrl for the same intent. Both were always unambiguous. */
  it("treats cmd the same as ctrl", () => {
    const meta = readPhotoWheel(ev(-5, { metaKey: true }), 1000, null);
    expect(meta.state.spent).toBe(0);
  });
});

describe("the gesture boundary", () => {
  it("joins events inside the gap and separates them outside it", () => {
    const first = readPhotoWheel(ev(-40), 1000, null);
    const joined = readPhotoWheel(ev(-40), 1000 + GESTURE_GAP_MS, first.state);
    expect(joined.state.spent).toBeGreaterThan(first.state.spent);

    const separate = readPhotoWheel(ev(-40), 1000 + GESTURE_GAP_MS + 1, first.state);
    expect(separate.state.spent).toBeCloseTo(first.state.spent, 5);
  });

  it("swallows the tail once the budget is gone rather than passing a factor of 1", () => {
    const spent: PhotoWheelState = { at: 1000, spent: Math.log(GESTURE_BUDGET) + 1 };
    const read = readPhotoWheel(ev(-40), 1010, spent);
    expect(read.gesture).toEqual({ kind: "spent" });
  });
});

describe("anchoring the zoom under the pointer", () => {
  /* Without this the photo grows from its top-left and whatever you were
     looking at slides off the screen — you zoom in on a dataplate and end up
     holding a corner of the roof. */
  it("keeps the point under the pointer under the pointer", () => {
    const scroll = { left: 400, top: 300 };
    const offset = { x: 320, y: 240 };
    const ratio = 2;
    const next = anchoredScroll(scroll, offset, ratio);
    // the content coordinate under the pointer, before and after
    expect(scroll.left + offset.x).toBeCloseTo((next.left + offset.x) / ratio, 5);
    expect(scroll.top + offset.y).toBeCloseTo((next.top + offset.y) / ratio, 5);
  });

  it("never asks for a negative scroll — there is nothing above the top edge", () => {
    const next = anchoredScroll({ left: 0, top: 0 }, { x: 50, y: 50 }, 0.5);
    expect(next.left).toBe(0);
    expect(next.top).toBe(0);
  });
});
