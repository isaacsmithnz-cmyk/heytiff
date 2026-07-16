/* Simple-plan renderer — the accuracy contract. The interesting fixtures are
   REAL: `realTwelveFf` is the live "12 ff" document's traced geometry, which
   carries a 63 mm trace misalignment (must weld) and a 1.25 m corridor gap
   (must NOT weld). */

import { buildSimplePlan, renderSimplePlanSVG, SIMPLE_PLAN } from "../simple-plan";
import { realTwelveFf, syntheticHouse } from "./fixtures/simple-plan-fixtures";

const horizontal = (w: { a: { y: number }; b: { y: number } }) =>
  Math.abs(w.a.y - w.b.y) < 1e-6;
const vertical = (w: { a: { x: number }; b: { x: number } }) =>
  Math.abs(w.a.x - w.b.x) < 1e-6;

describe("buildSimplePlan — real traced document (12 ff)", () => {
  const { doc, floorId } = realTwelveFf();
  const model = buildSimplePlan(doc, floorId);
  const mm = model.scaleMmPerUnit!;

  it("welds the 63 mm misalignment between Room 1 and Room 2 left edges", () => {
    // both rooms' left walls must land on ONE x (the length-weighted mean),
    // strictly between the two traced lines
    const lefts = model.walls.filter((w) => vertical(w) && w.a.x < 800);
    const leftXs = [...new Set(lefts.map((w) => Math.round(w.a.x * 100) / 100))];
    expect(leftXs).toHaveLength(1);
    const min = Math.min(642.4696100246538, 638.8631801495866);
    const max = Math.max(642.4696100246538, 638.8631801495866);
    expect(leftXs[0]).toBeGreaterThan(min - 0.01);
    expect(leftXs[0]).toBeLessThan(max + 0.01);
    // FOUR welds surface in this trace: the left pair (63 mm), the right
    // pair (100 mm), and — across the corridor — Room 1's top with
    // Living/Dining's top (56 mm) and Room 2's top with L/D's bottom
    // (54 mm). The rooms really do sit on shared architectural wall lines.
    expect(model.welds).toHaveLength(4);
    for (const weld of model.welds) {
      expect(weld.mm).toBeGreaterThan(40);
      expect(weld.mm).toBeLessThan(120);
    }
  });

  it("does NOT bridge the 1.25 m corridor gap between the two rooms", () => {
    // Room 1 bottom (y≈561.6) and the welded Room-2-top/L-D-bottom line
    // (y≈631.4) stay separate walls
    const yLines = [
      ...new Set(
        model.walls.filter(horizontal).map((w) => Math.round(w.a.y))
      ),
    ].sort((a, b) => a - b);
    expect(yLines).toContain(562);
    expect(yLines).toContain(631);
    // and the welded left wall line has two segments with a gap, not one run
    const lefts = model.walls
      .filter((w) => vertical(w) && w.a.x < 800)
      .sort((a, b) => Math.min(a.a.y, a.b.y) - Math.min(b.a.y, b.b.y));
    expect(lefts).toHaveLength(2);
    const gapU =
      Math.min(lefts[1].a.y, lefts[1].b.y) - Math.max(lefts[0].a.y, lefts[0].b.y);
    expect(gapU * mm).toBeGreaterThan(1000); // the corridor survives, in mm
  });

  it("classifies Room 1's marked edges external and the rest boundary", () => {
    // edge 0 (top) and edge 3 (left) of Room 1 were marked external. Room 1's
    // top welded onto L/D's top line (y≈395) but stays its own SEGMENT there,
    // so the external mark survives while L/D's stretch stays boundary.
    const top = model.walls.find(
      (w) =>
        horizontal(w) &&
        Math.round(w.a.y) === 395 &&
        Math.min(w.a.x, w.b.x) < 900
    );
    const bottom = model.walls.find(
      (w) => horizontal(w) && Math.round(w.a.y) === 562
    );
    expect(top?.kind).toBe("external");
    expect(bottom?.kind).toBe("boundary");
    expect(top!.thicknessU * mm).toBeCloseTo(SIMPLE_PLAN.EXT_MM, 0);
    expect(bottom!.thicknessU * mm).toBeCloseTo(SIMPLE_PLAN.INT_MM, 0);
  });

  it("computes calibrated areas (Room 1 ≈ 11.3 m²)", () => {
    const r1 = model.rooms.find((r) => r.name === "Room 1")!;
    expect(r1.areaM2).toBeCloseTo(11.34, 1);
    expect(r1.sizeM!.w).toBeCloseTo(3.87, 2);
    expect(r1.sizeM!.h).toBeCloseTo(2.93, 2);
  });

  it("emits overall dimension chains from calibration", () => {
    expect(model.dims).toHaveLength(2);
    const top = model.dims.find((d) => d.side === "top")!;
    // full extent ≈ (1463.99 − 638.86) × 17.362 mm ≈ 14.33 m
    expect(top.label).toBe("14.33 m");
  });
});

describe("buildSimplePlan — synthetic six-room floor", () => {
  const { doc, floorId } = syntheticHouse();
  const model = buildSimplePlan(doc, floorId);

  it("welds Bed 2's 40 mm-off left edge onto the hall wall line", () => {
    // four edges share this line: hall right x=500 (len 610), bed2 left
    // x=504 (len 290), bed3 left x=500 (len 320), bath right x=500 (len
    // 190) → length-weighted line at 706160 / 1410 ≈ 500.82
    const weldedX = 706160 / 1410;
    const welded = model.walls.filter(
      (w) => vertical(w) && Math.abs(w.a.x - weldedX) < 0.01
    );
    expect(welded.length).toBeGreaterThan(0);
    // …and the one line carries BOTH kinds: shared through the bedrooms,
    // external along the bathroom's outside stretch
    expect(new Set(welded.map((w) => w.kind))).toEqual(
      new Set(["shared", "external"])
    );
    expect(model.welds.some((w) => w.mm === 40)).toBe(true);
  });

  it("shared stretches beat external marks (WIR bottom over the bathroom)", () => {
    // WIR marked its whole bottom edge external, but x 200–500 of that line
    // borders the bathroom → shared; only x 0–200 stays external
    const line = model.walls.filter((w) => horizontal(w) && Math.round(w.a.y) === 610);
    const kinds = line
      .map((w) => ({ x0: Math.min(w.a.x, w.b.x), kind: w.kind }))
      .sort((a, b) => a.x0 - b.x0);
    expect(kinds[0].kind).toBe("external");
    expect(kinds[1].kind).toBe("shared");
  });

  it("heals the 40 mm daylight in the top external wall", () => {
    // hall top ends at x=500, bed2 top starts at x=504 — same line, same
    // kind, sub-tolerance gap → one continuous external run to x=870
    const top = model.walls.filter((w) => horizontal(w) && Math.round(w.a.y) === 0);
    expect(top).toHaveLength(1);
    expect(Math.max(top[0].a.x, top[0].b.x)).toBeCloseTo(870, 0);
    expect(top[0].kind).toBe("external");
  });

  it("drops sliver walls under the minimum", () => {
    // bed3's top edge pokes 4 units (40 mm < 80 mm min) past bed2's bottom
    const y290 = model.walls.filter((w) => horizontal(w) && Math.round(w.a.y) === 290);
    for (const w of y290) {
      expect(Math.abs(w.b.x - w.a.x)).toBeGreaterThan(8);
    }
  });

  it("corners meet exactly after endpoint snapping", () => {
    // master top-left corner: the top wall's start and left wall's start
    // land on the same point
    const top = model.walls.find(
      (w) => horizontal(w) && Math.round(w.a.y) === 0 && Math.min(w.a.x, w.b.x) < 1
    )!;
    const left = model.walls.find(
      (w) => vertical(w) && Math.round(w.a.x) === 0
    )!;
    const topStart = top.a.x < top.b.x ? top.a : top.b;
    const leftStart = left.a.y < left.b.y ? left.a : left.b;
    expect(Math.hypot(topStart.x - leftStart.x, topStart.y - leftStart.y)).toBeLessThan(
      0.01
    );
  });
});

describe("renderSimplePlanSVG", () => {
  it("renders the real document to standalone SVG", () => {
    const { doc, floorId } = realTwelveFf();
    const svg = renderSimplePlanSVG(buildSimplePlan(doc, floorId), {
      title: "12 ff — ground floor",
    });
    expect(svg).toContain("<svg");
    expect(svg).toContain("Living / Dining");
    // the simple view carries no measurements — names only
    expect(svg).not.toContain("m²");
    expect(svg).not.toContain("mono"); // Jakarta only, no mono anywhere
  });

  it("handles floors with no rooms", () => {
    const { doc } = realTwelveFf();
    const svg = renderSimplePlanSVG(buildSimplePlan(doc, doc.floors[0].id + "x"));
    expect(svg).toContain("No plan geometry");
  });
});
