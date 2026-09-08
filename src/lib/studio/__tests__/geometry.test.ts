/* Stage-1 lock gate: calibration accuracy + area-from-polygon fixtures
   (design-studio-plan.md Part 3, Stage 1). Areas are hand-worked. */

import {
  polygonArea,
  polygonCentroid,
  polylineLength,
  pointInPolygon,
  distToSegment,
  snapToGrid,
  orthoSnap,
  nearestVertexIndex,
  boundsOfPoints,
  worldToScreen,
  screenToWorld,
  zoomAt,
  fitBounds,
  fitZoom,
  clampViewport,
  PAN_KEEP_PX,
  mmPerUnitFromCalibration,
  areaUnitsToM2,
  unitsToMeters,
  isAxisAlignedRect,
  rectDragVertex,
  boundingRect,
  smoothPathD,
  smoothedLength,
  distToSmoothed,
  type Viewport,
  type Bounds,
} from "../geometry";

const rect = (w: number, h: number, x = 0, y = 0) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

describe("polygon fixtures (hand-worked)", () => {
  it("rectangle 100×80 units = 8000 units²", () => {
    expect(polygonArea(rect(100, 80))).toBe(8000);
  });

  it("L-shape: 10×10 minus 5×5 notch = 75 units²", () => {
    // 10×10 square with the top-right 5×5 removed
    const L = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 5 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(polygonArea(L)).toBe(75);
  });

  it("triangle 3-4-5: area 6", () => {
    expect(
      polygonArea([
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 0, y: 3 },
      ])
    ).toBe(6);
  });

  it("winding direction doesn't matter", () => {
    const p = rect(20, 30);
    expect(polygonArea([...p].reverse())).toBe(600);
  });

  it("degenerate rings have zero area", () => {
    expect(polygonArea([])).toBe(0);
    expect(polygonArea(rect(10, 10).slice(0, 2))).toBe(0);
  });

  it("centroid of a rectangle is its centre", () => {
    expect(polygonCentroid(rect(100, 80, 50, 10))).toEqual({ x: 100, y: 50 });
  });

  it("polyline length sums segments", () => {
    expect(
      polylineLength([
        { x: 0, y: 0 },
        { x: 3, y: 4 },
        { x: 3, y: 14 },
      ])
    ).toBe(15);
  });

  it("point-in-polygon: inside, outside, and in the L notch", () => {
    const L = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 5 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 2, y: 2 }, L)).toBe(true);
    expect(pointInPolygon({ x: 8, y: 8 }, L)).toBe(true);
    expect(pointInPolygon({ x: 8, y: 2 }, L)).toBe(false); // the notch
    expect(pointInPolygon({ x: -1, y: 5 }, L)).toBe(false);
  });
});

describe("calibration accuracy (the lock-gate case)", () => {
  it("500 units over 5 real metres = 10 mm/unit", () => {
    expect(
      mmPerUnitFromCalibration({ x: 100, y: 100 }, { x: 600, y: 100 }, 5)
    ).toBe(10);
  });

  it("diagonal calibration uses true distance", () => {
    // 300/400 → 500 units over 10 m = 20 mm/unit
    expect(
      mmPerUnitFromCalibration({ x: 0, y: 0 }, { x: 300, y: 400 }, 10)
    ).toBe(20);
  });

  it("calibrated scale derives real areas: 300×200 units @10mm/unit = 3m×2m = 6 m²", () => {
    const areaUnits = polygonArea(rect(300, 200));
    expect(areaUnitsToM2(areaUnits, 10)).toBeCloseTo(6, 10);
    expect(unitsToMeters(300, 10)).toBe(3);
  });

  it("rejects degenerate input", () => {
    expect(mmPerUnitFromCalibration({ x: 1, y: 1 }, { x: 1, y: 1 }, 5)).toBeNull();
    expect(mmPerUnitFromCalibration({ x: 0, y: 0 }, { x: 10, y: 0 }, 0)).toBeNull();
  });

  it("re-calibrating rescales derived areas proportionally (areas are computed, never stored)", () => {
    const areaUnits = polygonArea(rect(300, 200));
    const before = areaUnitsToM2(areaUnits, 10);
    const after = areaUnitsToM2(areaUnits, 20); // scale doubled → area ×4
    expect(after / before).toBeCloseTo(4, 10);
  });
});

describe("snapping + hit helpers", () => {
  it("snapToGrid rounds to the nearest intersection", () => {
    expect(snapToGrid({ x: 12, y: 38 }, 25)).toEqual({ x: 0, y: 50 });
    expect(snapToGrid({ x: 13, y: 37 }, 25)).toEqual({ x: 25, y: 25 });
  });

  it("orthoSnap locks to the dominant axis", () => {
    const prev = { x: 0, y: 0 };
    expect(orthoSnap(prev, { x: 100, y: 8 })).toEqual({ x: 100, y: 0 });
    expect(orthoSnap(prev, { x: 8, y: 100 })).toEqual({ x: 0, y: 100 });
  });

  it("nearestVertexIndex respects the max distance", () => {
    const pts = rect(100, 100);
    expect(nearestVertexIndex({ x: 98, y: 3 }, pts, 5)).toBe(1);
    expect(nearestVertexIndex({ x: 50, y: 50 }, pts, 5)).toBe(-1);
  });

  it("distToSegment: perpendicular and beyond-endpoint cases", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(distToSegment({ x: 5, y: 3 }, a, b)).toBe(3);
    expect(distToSegment({ x: 14, y: 3 }, a, b)).toBe(5);
    expect(distToSegment({ x: 5, y: 0 }, a, a)).toBe(5); // zero-length segment
  });

  it("boundsOfPoints", () => {
    expect(boundsOfPoints(rect(10, 20, 5, 5))).toEqual({
      minX: 5,
      minY: 5,
      maxX: 15,
      maxY: 25,
    });
    expect(boundsOfPoints([])).toBeNull();
  });
});

describe("rectangle-aware vertex editing", () => {
  const r = rect(100, 80, 10, 20); // corners (10,20)(110,20)(110,100)(10,100)

  it("recognises axis-aligned rectangles in either winding", () => {
    expect(isAxisAlignedRect(r)).toBe(true);
    expect(isAxisAlignedRect([...r].reverse())).toBe(true);
  });

  it("rejects non-rectangles", () => {
    expect(isAxisAlignedRect(r.slice(0, 3))).toBe(false); // triangle
    expect(
      isAxisAlignedRect([
        { x: 0, y: 0 },
        { x: 100, y: 5 }, // skewed edge
        { x: 100, y: 80 },
        { x: 0, y: 80 },
      ])
    ).toBe(false);
    expect(isAxisAlignedRect([r[0], r[1], r[2], r[2]])).toBe(false); // degenerate
  });

  it("dragging a corner keeps the shape rectangular, anchored on the opposite corner", () => {
    // drag corner 0 (10,20) → (0,0); corner 2 (110,100) stays fixed
    const out = rectDragVertex(r, 0, { x: 0, y: 0 });
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 110, y: 0 },
      { x: 110, y: 100 },
      { x: 0, y: 100 },
    ]);
    expect(isAxisAlignedRect(out)).toBe(true);
  });

  it("boundingRect snaps any shape back to its axis-aligned rectangle", () => {
    const skewed = [
      { x: 0, y: 0 },
      { x: 100, y: 25 },
      { x: 100, y: 100 },
      { x: 25, y: 100 },
    ];
    const out = boundingRect(skewed);
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    expect(isAxisAlignedRect(out)).toBe(true);
    expect(boundingRect([])).toEqual([]);
  });

  it("works for every corner", () => {
    for (let i = 0; i < 4; i++) {
      const out = rectDragVertex(r, i, { x: 47, y: 63 });
      expect(isAxisAlignedRect(out)).toBe(true);
      expect(out[i]).toEqual({ x: 47, y: 63 });
      // opposite corner untouched
      expect(out[(i + 2) % 4]).toEqual(r[(i + 2) % 4]);
    }
  });
});

describe("viewport", () => {
  const vp: Viewport = { x: 100, y: 50, zoom: 2 };

  it("world↔screen round-trips", () => {
    const w = { x: 250, y: 175 };
    expect(screenToWorld(worldToScreen(w, vp), vp)).toEqual(w);
  });

  it("zoomAt keeps the world point under the cursor stationary", () => {
    const cursor = { x: 320, y: 240 };
    const worldBefore = screenToWorld(cursor, vp);
    const zoomed = zoomAt(vp, cursor, 1.5);
    const worldAfter = screenToWorld(cursor, zoomed);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 9);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 9);
    expect(zoomed.zoom).toBe(3);
  });

  it("zoomAt clamps at the limits and returns the same viewport", () => {
    const maxed = zoomAt(vp, { x: 0, y: 0 }, 1e9);
    expect(zoomAt(maxed, { x: 0, y: 0 }, 2)).toBe(maxed);
  });

  it("fitBounds contains the bounds with padding", () => {
    const b = { minX: 0, minY: 0, maxX: 1000, maxY: 500 };
    const fitted = fitBounds(b, 800, 600, 40);
    const tl = worldToScreen({ x: b.minX, y: b.minY }, fitted);
    const br = worldToScreen({ x: b.maxX, y: b.maxY }, fitted);
    expect(tl.x).toBeGreaterThanOrEqual(39.9);
    expect(tl.y).toBeGreaterThanOrEqual(39.9);
    expect(br.x).toBeLessThanOrEqual(760.1);
    expect(br.y).toBeLessThanOrEqual(560.1);
    // centred on the longer axis
    expect(tl.x + br.x).toBeCloseTo(800, 6);
  });

  it("fitZoom matches fitBounds' zoom (width-bound here)", () => {
    const b = { minX: 0, minY: 0, maxX: 1000, maxY: 500 };
    // width binds: (800 - 80) / 1000 = 0.72
    expect(fitZoom(b, 800, 600, 40)).toBeCloseTo(0.72, 9);
    expect(fitZoom(b, 800, 600, 40)).toBe(fitBounds(b, 800, 600, 40).zoom);
  });

  it("zoomAt won't zoom out below the supplied minZoom (fit floor)", () => {
    const start: Viewport = { x: 0, y: 0, zoom: 1 };
    const min = 0.6;
    // try to zoom way out; clamps at min, not the absolute MIN_ZOOM
    const out = zoomAt(start, { x: 400, y: 300 }, 1e-6, min);
    expect(out.zoom).toBe(min);
  });
});

/* ── The pan clamp ──
   Zoom has always had a floor; pan had none, so the drawing could be dragged
   into empty grid until only Fit could find it again. These pin the rule from
   its SPEC — "a strip of the drawing this many screen px wide stays visible" —
   by measuring the overlap that comes back, never by rebuilding the formula.
   That is what lets them fail when the arithmetic is wrong rather than when it
   merely changes. */
describe("pan clamp", () => {
  const W = 800;
  const H = 600;
  const PLAN: Bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 700 };

  /** how much of `b` the view actually shows, in SCREEN px on each axis */
  const stripPx = (vp: Viewport, b: Bounds) => {
    const overlap = (lo: number, hi: number, from: number, span: number) =>
      Math.max(0, Math.min(from + span / vp.zoom, hi) - Math.max(from, lo)) * vp.zoom;
    return {
      x: overlap(b.minX, b.maxX, vp.x, W),
      y: overlap(b.minY, b.maxY, vp.y, H),
    };
  };

  const runaway = (zoom: number, sx: number, sy: number): Viewport => ({
    zoom,
    x: sx * 1e6,
    y: sy * 1e6,
  });

  it("leaves a view that already frames the drawing exactly where it was", () => {
    const fitted = fitBounds(PLAN, W, H, 60);
    expect(clampViewport(fitted, PLAN, W, H)).toEqual(fitted);
  });

  it("stops a runaway pan in every direction with the drawing still on screen", () => {
    for (const [sx, sy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
    ]) {
      const strip = stripPx(clampViewport(runaway(1, sx, sy), PLAN, W, H), PLAN);
      expect(strip.x).toBeGreaterThan(0);
      expect(strip.y).toBeGreaterThan(0);
    }
  });

  /* And the amount is the stated one. Only the axis actually run away on is
     held — travelling straight down must not drag the view sideways, which is
     why the directions above can only promise "something is visible". */
  it("leaves exactly the stated strip on the axis it stopped", () => {
    const right = stripPx(clampViewport(runaway(1, 1, 0), PLAN, W, H), PLAN);
    expect(right.x).toBeCloseTo(PAN_KEEP_PX, 6);
    const down = stripPx(clampViewport(runaway(1, 0, 1), PLAN, W, H), PLAN);
    expect(down.y).toBeCloseTo(PAN_KEEP_PX, 6);
  });

  it("does not touch the axis that never moved", () => {
    const start: Viewport = { x: 120, y: 1e6, zoom: 1 };
    expect(clampViewport(start, PLAN, W, H).x).toBe(120);
  });

  /* THE POINT OF A SCREEN MEASURE. A cap in plan-widths is a fraction of the
     screen at 12x and many screens at 0.1x — it would clamp hard while you
     work on detail and not at all while you travel. */
  it("keeps the same strip at every zoom, which a world-measured cap cannot", () => {
    // 0.3x and up: the plan is wider than the strip, so the strip is the rule
    for (const zoom of [0.3, 1, 4, 12]) {
      const strip = stripPx(clampViewport(runaway(zoom, 1, 1), PLAN, W, H), PLAN);
      expect(strip.x).toBeCloseTo(PAN_KEEP_PX, 6);
      expect(strip.y).toBeCloseTo(PAN_KEEP_PX, 6);
    }
  });

  /* Zoomed far enough out, the WHOLE plan is narrower than the strip — 96px is
     more than there is to give. The requirement caps at the drawing's own size
     and the answer gets better rather than unsatisfiable: all of it stays. */
  it("keeps the whole drawing when the drawing is smaller than the strip", () => {
    const zoom = 0.05; // a 1000-unit plan is 50px wide here
    const strip = stripPx(clampViewport(runaway(zoom, 1, 1), PLAN, W, H), PLAN);
    expect(strip.x).toBeCloseTo((PLAN.maxX - PLAN.minX) * zoom, 6);
    expect(strip.y).toBeCloseTo((PLAN.maxY - PLAN.minY) * zoom, 6);
  });

  /* A blank floor has no bounds at all; the caller hands over a zero-size box
     at the origin and the same arithmetic degenerates into "the origin stays
     touching the viewport". No special case, and no way to get lost. */
  it("won't let a blank grid lose the origin either", () => {
    const nothing: Bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    for (const [sx, sy] of [
      [1, 1],
      [-1, -1],
    ]) {
      const held = clampViewport(runaway(0.56, sx, sy), nothing, W, H);
      const at = worldToScreen({ x: 0, y: 0 }, held);
      expect(at.x).toBeGreaterThanOrEqual(-1e-6);
      expect(at.x).toBeLessThanOrEqual(W + 1e-6);
      expect(at.y).toBeGreaterThanOrEqual(-1e-6);
      expect(at.y).toBeLessThanOrEqual(H + 1e-6);
    }
  });

  /* One small room at low zoom is narrower than the strip, so the requirement
     caps at the content's own size instead of becoming unsatisfiable. */
  it("asks for no more than the drawing has to give", () => {
    const speck: Bounds = { minX: 0, minY: 0, maxX: 4, maxY: 4 };
    const held = clampViewport(runaway(1, 1, 1), speck, W, H);
    const strip = stripPx(held, speck);
    expect(strip.x).toBeCloseTo(4, 6);
    expect(strip.y).toBeCloseTo(4, 6);
  });

  it("holds still once held — clamping again changes nothing", () => {
    const once = clampViewport(runaway(2, -1, 1), PLAN, W, H);
    expect(clampViewport(once, PLAN, W, H)).toEqual(once);
  });

  it("never moves the zoom", () => {
    for (const zoom of [0.02, 1, 12]) {
      expect(clampViewport(runaway(zoom, 1, -1), PLAN, W, H).zoom).toBe(zoom);
    }
  });

  /* The clamp and the fit have to agree, or pressing Fit would land the view
     somewhere the clamp immediately drags it away from. Guaranteed by the
     caller passing a SUPERSET of the fit's own content — pinned here on the
     plain case so a change to either function has to face it. */
  it("cannot fight Fit", () => {
    for (const pad of [40, 60, 120]) {
      const fitted = fitBounds(PLAN, W, H, pad);
      expect(clampViewport(fitted, PLAN, W, H)).toEqual(fitted);
    }
  });
});

/* ── Smoothed runs (Draw tools) — the spline the soft pipe / cable renders ── */
describe("smoothed runs", () => {
  const dots = [
    { x: 0, y: 0 },
    { x: 100, y: 80 },
    { x: 220, y: 20 },
  ];

  it("smoothPathD passes through every placed dot", () => {
    const d = smoothPathD(dots);
    // M at the first dot, one C per segment, each landing on the next dot
    expect(d.startsWith("M 0 0")).toBe(true);
    expect(d).toContain("100 80");
    expect(d.endsWith("220 20")).toBe(true);
    expect(d.match(/C /g)).toHaveLength(2);
  });

  it("smoothPathD of two dots is the straight line between them", () => {
    const d = smoothPathD([dots[0], dots[2]]);
    expect(smoothedLength([dots[0], dots[2]])).toBeCloseTo(
      polylineLength([dots[0], dots[2]]),
      6
    );
    expect(d.startsWith("M 0 0")).toBe(true);
  });

  it("a curve through a bend is longer than its chords, shorter than absurd", () => {
    const curveLen = smoothedLength(dots);
    const chordLen = polylineLength(dots);
    expect(curveLen).toBeGreaterThan(chordLen);
    expect(curveLen).toBeLessThan(chordLen * 1.5);
  });

  it("collinear dots smooth to the straight line (no invented wiggle)", () => {
    const line = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
    ];
    expect(smoothedLength(line)).toBeCloseTo(200, 4);
  });

  it("distToSmoothed is ~0 on a dot and near the chord midpoint offset off-curve", () => {
    expect(distToSmoothed(dots[1], dots)).toBeLessThan(0.5);
    // far away is far
    expect(distToSmoothed({ x: 0, y: 500 }, dots)).toBeGreaterThan(300);
    // one dot degenerates to point distance
    expect(distToSmoothed({ x: 3, y: 4 }, [{ x: 0, y: 0 }])).toBeCloseTo(5, 6);
  });
});
