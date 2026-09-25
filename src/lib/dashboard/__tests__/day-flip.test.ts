import { DAY_GROW_MS, DAY_H } from "../day-bar";
import {
  DAY_GROW_EASE,
  flipOf,
  growPlan,
  liftFrames,
  liftOf,
  motionAllowed,
  PANEL_IN,
  shiftFrames,
  skinFrames,
  skinSpan,
  startSpan,
  type CardPose,
} from "../day-flip";

/* YOUR DAY, IN MOTION, as arithmetic: where each card's grow starts, how
   far and how much it is put back, that its lean is held at 45° all the
   way, and that its words only ever slide. The component suite films the
   wiring; this one holds the numbers. */

const pose = (key: string, left: number, width: number, over: Partial<CardPose> = {}): CardPose => ({
  key,
  members: [key],
  span: { left, width },
  parts: {},
  ...over,
});

/* His numbers, as the prototype he walked eased them (`flex-grow .35s
   ease`): a named exemption from law 18's tokens in docs/design.md. */
describe("the grow's clock", () => {
  it("is his 350 ms on his ease", () => {
    expect(DAY_GROW_MS).toBe(350);
    expect(DAY_GROW_EASE).toBe("ease");
  });
});

describe("a skin's box, read off how it is drawn", () => {
  it("takes the slant off: half the bar's height at each side", () => {
    // a 200px card at 100 is drawn 44px wider each side by its 45° lean
    expect(skinSpan({ left: 100 - DAY_H / 2, width: 200 + DAY_H })).toEqual({ left: 100, width: 200 });
  });

  /* Mid-grow the skin is drawn scaled, then leaned: the lean still adds the
     height, so what is read back is the box the grow has reached. */
  it("reads a grow in flight as the box it has reached", () => {
    const at = { centre: 300, width: 200, scale: 0.5 };
    const drawnWidth = at.width * at.scale + DAY_H;
    expect(skinSpan({ left: at.centre - drawnWidth / 2, width: drawnWidth })).toEqual({ left: 250, width: 100 });
  });

  it("never reads a width below nothing", () => {
    expect(skinSpan({ left: 0, width: 10 }).width).toBe(0);
  });
});

describe("how far a skin is put back", () => {
  it("is the move between the two middles, and the old width over the new", () => {
    expect(flipOf({ left: 100, width: 100 }, { left: 150, width: 200 })).toEqual({ dx: -100, s: 0.5 });
    expect(flipOf({ left: 150, width: 200 }, { left: 100, width: 100 })).toEqual({ dx: 100, s: 2 });
  });

  it("is nothing for a skin that has not moved, or moved less than half a pixel", () => {
    expect(flipOf({ left: 100, width: 100 }, { left: 100, width: 100 })).toBeNull();
    expect(flipOf({ left: 100.2, width: 100.3 }, { left: 100, width: 100 })).toBeNull();
  });

  it("is nothing for a skin with no width to grow into", () => {
    expect(flipOf({ left: 100, width: 100 }, { left: 100, width: 0 })).toBeNull();
  });
});

describe("the frames", () => {
  /* The same three functions at both ends, so the browser eases each one
     on its own; the skew is between the move and the scale, so the scale
     is applied first and the lean stays 45° at every frame. */
  it("hold a skin's lean at 45° from the first frame to the last", () => {
    expect(skinFrames({ dx: -12.5, s: 0.75 })).toEqual([
      { transform: "translateX(-12.5px) skewX(45deg) scaleX(0.75)" },
      { transform: "translateX(0px) skewX(45deg) scaleX(1)" },
    ]);
  });

  it("slide a card's words by `translate` alone, never a scale", () => {
    expect(shiftFrames({ dx: 30, dy: -4 })).toEqual([{ translate: "30px -4px" }, { translate: "0px 0px" }]);
  });

  it("carry the body under the day back from where it was, and fade the panel in", () => {
    expect(liftFrames(-95)).toEqual([{ transform: "translateY(-95px)" }, { transform: "translateY(0px)" }]);
    expect(PANEL_IN).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  });
});

describe("where a card's grow starts", () => {
  it("is its own box, when it was on the bar", () => {
    expect(startSpan("a", ["a"], [pose("a", 10, 90), pose("b", 104, 90)])).toEqual({ left: 10, width: 90 });
  });

  it("is its block's box, for a card that opens out of the block", () => {
    const block = pose("group:a", 0, 144, { members: ["a", "b", "c"] });
    expect(startSpan("b", ["b"], [block, pose("d", 148, 300)])).toEqual({ left: 0, width: 144 });
  });

  it("is the cards it took in, end to end, for a block that has just folded", () => {
    const before = [pose("a", 0, 128), pose("b", 132, 48), pose("c", 184, 48), pose("d", 236, 400)];
    expect(startSpan("group:a", ["a", "b", "c"], before)).toEqual({ left: 0, width: 232 });
  });

  it("is a block's too, when a block gives way to a smaller one", () => {
    const before = [pose("group:a", 0, 144, { members: ["a", "b", "c"] })];
    expect(startSpan("group:b", ["b", "c"], before)).toEqual({ left: 0, width: 144 });
  });

  it("is nowhere for a card that was nowhere: it is simply there", () => {
    expect(startSpan("z", ["z"], [pose("a", 0, 100)])).toBeNull();
    expect(startSpan("group:y", ["y", "z"], [pose("a", 0, 100)])).toBeNull();
  });
});

describe("the plan of a grow", () => {
  it("moves nothing when nothing moved", () => {
    const bar = [pose("a", 0, 100, { parts: { mid: { x: 50, y: 53 } } }), pose("b", 104, 100)];
    expect(growPlan(bar, bar)).toEqual([]);
  });

  it("grows the card that opened and gives way beside it, each from where it stood", () => {
    const before = [pose("a", 0, 300), pose("b", 304, 300)];
    const after = [pose("a", 0, 200), pose("b", 204, 400)];
    expect(growPlan(before, after)).toEqual([
      { key: "a", skin: { dx: 50, s: 1.5 }, parts: {} },
      { key: "b", skin: { dx: 50, s: 0.75 }, parts: {} },
    ]);
  });

  /* Opened, the place name goes from the card's left to its middle: it
     slides there from where it was, by its own path, not the card's. */
  it("slides each of a card's words from its own place before", () => {
    const before = [pose("a", 0, 200, { parts: { tag: { x: 20, y: 19 }, mid: { x: 109, y: 53 }, tick: { x: 205, y: 72 } } })];
    const after = [pose("a", 0, 300, { parts: { tag: { x: 161, y: 23 }, mid: { x: 159, y: 53 }, tick: { x: 305, y: 72 } } })];
    expect(growPlan(before, after)).toEqual([
      {
        key: "a",
        skin: { dx: -50, s: 0.6667 },
        parts: { tag: { dx: -141, dy: -4 }, mid: { dx: -50, dy: 0 }, tick: { dx: -100, dy: 0 } },
      },
    ]);
  });

  it("carries the words of a card that opens out of a block with the card, from the block's middle", () => {
    const before = [pose("group:a", 0, 144, { members: ["a", "b"] })];
    const after = [
      pose("a", 0, 128, { parts: { tick: { x: 116, y: 72 } } }),
      pose("b", 132, 48, { parts: { tick: { x: 172, y: 72 } } }),
    ];
    const plan = growPlan(before, after);
    expect(plan.map((m) => [m.key, m.parts.tick])).toEqual([
      ["a", { dx: 8, dy: 0 }],
      ["b", { dx: -84, dy: 0 }],
    ]);
    // each card and its tick start from the one middle, the block's (72)
    for (const [i, m] of plan.entries()) {
      const to = after[i]!.span!;
      expect(to.left + to.width / 2 + m.skin!.dx).toBe(72);
    }
  });

  it("leaves out a card that was nowhere before, and one with no skin", () => {
    const after = [pose("new", 0, 100), { key: "odd", members: ["odd"], span: null, parts: {} }];
    expect(growPlan([pose("a", 0, 100)], after)).toEqual([]);
  });
});

describe("the body under the day", () => {
  it("is put back to where it stood, or left alone when it has not moved", () => {
    expect(liftOf(300, 420)).toBe(-120);
    expect(liftOf(420, 300)).toBe(120);
    expect(liftOf(300, 300.3)).toBeNull();
  });
});

describe("whether anything moves", () => {
  const animate = Element.prototype.animate;
  let reduced = false;
  beforeEach(() => {
    reduced = false;
    window.matchMedia = ((q: string) => ({ matches: reduced && q.includes("reduce") })) as typeof window.matchMedia;
  });
  afterEach(() => {
    Element.prototype.animate = animate;
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it("is never without the animation API", () => {
    expect(typeof Element.prototype.animate).not.toBe("function");
    expect(motionAllowed()).toBe(false);
  });

  it("is never under reduced motion, and is otherwise", () => {
    Element.prototype.animate = (() => ({})) as unknown as typeof Element.prototype.animate;
    expect(motionAllowed()).toBe(true);
    reduced = true;
    expect(motionAllowed()).toBe(false);
  });
});
