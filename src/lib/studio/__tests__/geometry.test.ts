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
  mmPerUnitFromCalibration,
  areaUnitsToM2,
  unitsToMeters,
  isAxisAlignedRect,
  rectDragVertex,
  boundingRect,
  type Viewport,
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
