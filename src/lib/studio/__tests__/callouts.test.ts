/* A unit's own name, said on the drawing at the end of a leader.

   Pure geometry, and that is the point of it: the canvas and the print figure
   lay a callout out through the SAME function, so a label placed on screen
   prints where it was put. The note tool learned that the hard way and these
   pin it — the scale-invariance test below is the one that would actually fail
   if the two surfaces ever started doing their own arithmetic. */

import {
  calloutBounds,
  calloutCloseAt,
  calloutContent,
  calloutLayout,
  calloutOf,
  defaultCalloutOffset,
  hitCallout,
  withCallout,
  withoutCallout,
  type CalloutPlacement,
} from "../callouts";
import type { DesignObject } from "../document";

const unit = (props: Record<string, unknown> = {}): DesignObject => ({
  id: "u1",
  type: "unit",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "point", at: { x: 0, y: 0 } },
  plane: "room",
  props: { role: "idu", model: "MSZ-AP25VGD", widthMm: 800, depthMm: 300, ...props },
});

const FP = { w: 80, h: 30 };
const lay = (offset: CalloutPlacement, fontSize = 10, lines = ["Serves Lounge"]) =>
  calloutLayout({
    at: { x: 0, y: 0 },
    footprint: FP,
    offset,
    content: { model: "MSZ-AP25VGD", lines },
    fontSize,
  });

describe("what a unit says about itself", () => {
  /* EVERY LINE IS A DOCUMENT FACT. plan-figure.tsx is handed the document and
     no data pack — it renders inside renderToStaticMarkup with no DOM — so a
     pack-derived line could be said on screen and not on paper. Capacity is
     the one that costs, and it is left out rather than shown in one renderer
     and missing from the other. */
  it("says the model, the room it serves and its size", () => {
    const c = calloutContent(unit({ roomId: "r1" }), "Lounge");
    expect(c.model).toBe("MSZ-AP25VGD");
    expect(c.lines).toEqual(["Serves Lounge", "800 × 300 mm"]);
  });

  it("says nothing it cannot know — no room, no line about a room", () => {
    const c = calloutContent(unit({ role: "odu" }), null);
    expect(c.lines).toEqual(["800 × 300 mm"]);
  });

  it("carries no capacity, because paper has no catalogue to read it from", () => {
    const c = calloutContent(unit(), "Lounge");
    expect(JSON.stringify(c)).not.toMatch(/kW/i);
  });
});

describe("the placement on the unit", () => {
  it("is absent until somebody puts one there", () => {
    expect(calloutOf(unit())).toBeNull();
  });

  it("round-trips through the object", () => {
    const placed = withCallout(unit(), { x: 120, y: -70 });
    expect(calloutOf(placed)).toEqual({ x: 120, y: -70 });
    expect(calloutOf(withoutCallout(placed))).toBeNull();
  });

  /* A document is data from somewhere else and the drawing has to survive
     whatever is in it — the same reason the note ink is read through a clamp
     rather than validated on the way in. */
  it("treats junk as no placement rather than drawing at NaN", () => {
    for (const bad of [{ x: "left", y: 0 }, { x: 1 }, null, "yes", { x: NaN, y: 0 }]) {
      expect(calloutOf(unit({ callout: bad }))).toBeNull();
    }
  });

  it("leaves every other prop alone when it is taken off", () => {
    const placed = withCallout(unit({ roomLock: true }), { x: 1, y: 2 });
    const bare = withoutCallout(placed);
    expect(bare.props.roomLock).toBe(true);
    expect(bare.props.model).toBe("MSZ-AP25VGD");
  });

  it("is the same object back when there was nothing to remove", () => {
    const u = unit();
    expect(withoutCallout(u)).toBe(u);
  });
});

describe("where a callout first appears", () => {
  /* UP AND TO THE RIGHT, and the direction is load-bearing: the rotate knob
     hangs off the footprint's turned TOP edge, so a default that went straight
     up would land the bubble on the one handle a selected unit already has. */
  it("goes up and to the right, clear of the rotate knob", () => {
    const d = defaultCalloutOffset(FP);
    expect(d.x).toBeGreaterThan(FP.w / 2);
    expect(d.y).toBeLessThan(-FP.h / 2);
  });

  it("scales with the unit, so a head and an AHU both get a real leader", () => {
    const small = defaultCalloutOffset({ w: 40, h: 20 });
    const big = defaultCalloutOffset({ w: 400, h: 200 });
    expect(big.x / small.x).toBeCloseTo(10, 6);
  });
});

describe("the shape of one", () => {
  it("hangs the bubble away from the unit, never back across it", () => {
    expect(lay({ x: 200, y: -100 }).side).toBe(1);
    expect(lay({ x: -200, y: -100 }).side).toBe(-1);
    // and the box sits on that side of the leader end
    expect(lay({ x: 200, y: -100 }).box.x).toBeGreaterThanOrEqual(200);
    const left = lay({ x: -200, y: -100 });
    expect(left.box.x + left.box.w).toBeCloseTo(-200, 6);
  });

  /* a three-line callout points at its middle, not at its first word — the
     same rule the note's margin text follows */
  it("centres the bubble on the leader end's height", () => {
    const l = lay({ x: 200, y: -100 }, 10, ["Serves Lounge", "800 × 300 mm"]);
    expect(l.box.y + l.box.h / 2).toBeCloseTo(-100, 6);
    expect(l.end).toEqual({ x: 200, y: -100 });
  });

  it("starts the leader on the footprint's edge, aimed at the bubble", () => {
    const l = lay({ x: 400, y: 0 });
    // straight out to the right: the edge is half the width away
    expect(l.start.x).toBeCloseTo(FP.w / 2, 6);
    expect(l.start.y).toBeCloseTo(0, 6);
  });

  it("re-aims the leader as the bubble is dragged around the unit", () => {
    const right = lay({ x: 400, y: 0 }).start;
    const down = lay({ x: 0, y: 400 }).start;
    expect(right.x).toBeGreaterThan(0);
    expect(down.y).toBeCloseTo(FP.h / 2, 6);
  });

  it("grows with its longest line and its line count", () => {
    const one = lay({ x: 200, y: 0 }, 10, []);
    const three = lay({ x: 200, y: 0 }, 10, ["Serves Lounge", "800 × 300 mm"]);
    expect(three.box.h).toBeGreaterThan(one.box.h);
    const wide = lay({ x: 200, y: 0 }, 10, ["Serves The Very Long Room Name Indeed"]);
    expect(wide.box.w).toBeGreaterThan(three.box.w);
  });

  /* NEITHER RENDERER CAN MEASURE TEXT, so the box is sized from a character
     estimate — and the head is a MODEL NUMBER, uppercase and set at weight
     800, while the body is mixed case at 600. One estimate for both sized the
     box to the body and let the model hang out past its own border; the walk
     showed it doing exactly that, five units proud. */
  it("sizes the box for the head's own weight, not the body's", () => {
    const headBound = lay({ x: 200, y: 0 }, 10, ["ab"]); // long head, short body
    const bodyBound = lay({ x: 200, y: 0 }, 10, ["MSZ-AP50VGKD-EXTRA-LONG"]);
    expect(bodyBound.box.w).toBeGreaterThan(headBound.box.w);

    // per character, the head is allowed more room than a body line
    const a = calloutLayout({
      at: { x: 0, y: 0 }, footprint: FP, offset: { x: 200, y: 0 },
      content: { model: "XXXXXXXXXX", lines: [] }, fontSize: 10,
    });
    const b = calloutLayout({
      at: { x: 0, y: 0 }, footprint: FP, offset: { x: 200, y: 0 },
      content: { model: "X", lines: ["XXXXXXXXXX"] }, fontSize: 10,
    });
    expect(a.box.w).toBeGreaterThan(b.box.w);
  });

  /* whatever the estimate is, the words have to fit inside the padding — the
     property, rather than the constant, so a retune cannot quietly break it */
  it("never lets a line be wider than the box it is drawn in", () => {
    for (const model of ["M", "MSZ-AP25VGD", "PUZ-ZM125VKA-HANDLES-A-LOT"]) {
      for (const body of [[], ["Serves Lounge"], ["Serves The Long Room Name", "1100 × 325 mm"]]) {
        const l = calloutLayout({
          at: { x: 0, y: 0 }, footprint: FP, offset: { x: 200, y: 0 },
          content: { model, lines: body }, fontSize: 10,
        });
        const widest = Math.max(
          l.lines[0].length * 0.72,
          ...l.lines.slice(1).map((x) => x.length * 0.56),
          0
        ) * l.fontSize;
        expect(l.box.w).toBeGreaterThanOrEqual(widest);
      }
    }
  });

  it("still draws a bubble for a unit with no model yet", () => {
    const l = calloutLayout({
      at: { x: 0, y: 0 },
      footprint: FP,
      offset: { x: 200, y: 0 },
      content: { model: "", lines: [] },
      fontSize: 10,
    });
    expect(l.lines).toEqual(["No model yet"]);
    expect(l.box.w).toBeGreaterThan(0);
  });
});

/* A unit can be turned — [ / ] step it in 90s and the selected one has a
   rotate knob — and BOTH renderers draw the glyph rotated. `leaderStart` only
   understands an axis-aligned rect, so without turning the question into the
   unit's own frame the leader would stop short of the edge you can see, or
   jut past it, on a turned unit. */
describe("a turned unit", () => {
  const started = (rotation: number, offset: CalloutPlacement) =>
    calloutLayout({
      at: { x: 0, y: 0 },
      footprint: FP, // 80 wide, 30 deep
      offset,
      content: { model: "M", lines: [] },
      fontSize: 10,
      rotation,
    }).start;

  it("roots the leader on the edge that is actually facing the bubble", () => {
    // unturned, straight out to the right: half the WIDTH away
    expect(started(0, { x: 400, y: 0 }).x).toBeCloseTo(40, 6);
    // turned a quarter, the same direction now meets the DEPTH
    const turned = started(90, { x: 400, y: 0 });
    expect(turned.x).toBeCloseTo(15, 6);
    expect(turned.y).toBeCloseTo(0, 6);
  });

  it("turns the root with the unit, a right angle at a time", () => {
    const up = started(90, { x: 0, y: -400 });
    expect(up.y).toBeCloseTo(-40, 6);
    expect(up.x).toBeCloseTo(0, 6);
  });

  it("leaves an unturned unit bit-identical, so nothing moved to gain it", () => {
    expect(started(0, { x: 300, y: -200 })).toEqual(
      calloutLayout({
        at: { x: 0, y: 0 },
        footprint: FP,
        offset: { x: 300, y: -200 },
        content: { model: "M", lines: [] },
        fontSize: 10,
      }).start
    );
  });
});

/* ── THE ANTI-DRIFT GUARD ──
   `fontSize` is in the caller's own units — world on the canvas, sheet units
   on paper — and every measure inside is in ems of it. That is the whole
   reason one function can serve both surfaces, and this is what would fail if
   a constant ever crept in in pixels. */
describe("the same shape at any scale", () => {
  it("doubles every measure when the type doubles, and moves no anchor", () => {
    const a = lay({ x: 200, y: -100 }, 10);
    const b = lay({ x: 200, y: -100 }, 20);

    // the world points do not depend on the type size at all
    expect(b.end).toEqual(a.end);
    expect(b.start).toEqual(a.start);

    // and everything the type sizes doubles exactly
    expect(b.box.w / a.box.w).toBeCloseTo(2, 9);
    expect(b.box.h / a.box.h).toBeCloseTo(2, 9);
    expect(b.lineH / a.lineH).toBeCloseTo(2, 9);
    expect((b.box.y - b.end.y) / (a.box.y - a.end.y)).toBeCloseTo(2, 9);
    expect((b.textX - b.end.x) / (a.textX - a.end.x)).toBeCloseTo(2, 9);
    expect((b.firstBaseline - b.end.y) / (a.firstBaseline - a.end.y)).toBeCloseTo(2, 9);
  });
});

describe("grabbing one", () => {
  /* The BOX is the whole target and the leader is NOT — the mirror of the
     note's rule that the middle of a cloud is not a hit target. There the
     cloud is drawn around work that must stay clickable; here the leader
     sweeps across the drawing as the bubble is dragged, and a line that
     grabbed whatever it passed over would make the plan underneath unusable. */
  it("takes a press anywhere on the bubble", () => {
    const l = lay({ x: 200, y: -100 });
    expect(hitCallout(l, { x: l.box.x + l.box.w / 2, y: l.box.y + l.box.h / 2 })).toBe(true);
    expect(hitCallout(l, { x: l.box.x + 1, y: l.box.y + 1 })).toBe(true);
  });

  it("does not take a press on the leader", () => {
    const l = lay({ x: 400, y: 0 });
    const mid = { x: (l.start.x + l.end.x) / 2, y: (l.start.y + l.end.y) / 2 };
    expect(hitCallout(l, mid)).toBe(false);
  });

  it("puts the remove mark on the OUTER top corner, never between leader and unit", () => {
    const right = lay({ x: 200, y: -100 });
    expect(calloutCloseAt(right).x).toBeCloseTo(right.box.x + right.box.w, 6);
    const left = lay({ x: -200, y: -100 });
    expect(calloutCloseAt(left).x).toBeCloseTo(left.box.x, 6);
  });
});

describe("what it occupies", () => {
  /* What the fit has to frame and what the pan clamp has to keep reachable —
     a label dragged clear of the plan must not become a label you cannot get
     back to. */
  it("covers the bubble AND the leader's root on the unit", () => {
    const l = lay({ x: 400, y: -200 });
    const b = calloutBounds(l);
    expect(b.x).toBeLessThanOrEqual(l.start.x);
    expect(b.y).toBeLessThanOrEqual(l.box.y);
    expect(b.x + b.w).toBeGreaterThanOrEqual(l.box.x + l.box.w);
    expect(b.y + b.h).toBeGreaterThanOrEqual(l.start.y);
  });
});
