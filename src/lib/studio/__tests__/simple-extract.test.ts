/* AI plan-extraction pipeline — validation, orthogonalization, world mapping
   and the full extraction → welded-walls model build, all offline against the
   canned Hollingshed-style fixture. */

import {
  buildSimplePlanFromExtraction,
  dropOverlappingSpaces,
  orthogonalize,
  stitchSpaces,
  validateExtraction,
} from "../simple-extract";
import { renderSimplePlanSVG } from "../simple-plan";
import {
  extractionDoc,
  hollingshedExtraction,
  SCALE_MM_PER_PX,
} from "./fixtures/simple-extract-fixtures";

describe("validateExtraction", () => {
  const raw = hollingshedExtraction();

  it("accepts the fixture unchanged", () => {
    const v = validateExtraction(raw, 2400, 1697, SCALE_MM_PER_PX);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.extraction.spaces).toHaveLength(4);
      expect(v.issues).toHaveLength(0);
    }
  });

  it("rejects a wildly wrong echoed image size", () => {
    const v = validateExtraction({ ...raw, imageWidth: 1200 }, 2400, 1697);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors[0]).toMatch(/coordinates can't be trusted/);
  });

  it("drops a 2-point polygon with an issue", () => {
    const bad = {
      ...raw,
      spaces: [
        ...raw.spaces,
        {
          name: "Sliver",
          kind: "room" as const,
          polygon: [
            { x: 10, y: 10 },
            { x: 20, y: 10 },
          ],
        },
      ],
    };
    const v = validateExtraction(bad, 2400, 1697, SCALE_MM_PER_PX);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.extraction.spaces).toHaveLength(4);
      expect(v.issues.some((i) => i.includes("Sliver"))).toBe(true);
    }
  });

  it("clamps out-of-bounds coordinates into the raster", () => {
    const bad = {
      ...raw,
      spaces: raw.spaces.map((s, i) =>
        i === 0
          ? { ...s, polygon: [...s.polygon.slice(0, 3), { x: -50, y: 5000 }] }
          : s
      ),
    };
    const v = validateExtraction(bad, 2400, 1697, SCALE_MM_PER_PX);
    expect(v.ok).toBe(true);
    if (v.ok) {
      const p = v.extraction.spaces[0].polygon[3];
      expect(p.x).toBe(0);
      expect(p.y).toBe(1697);
    }
  });

  it("drops sub-1 m² spaces when calibrated", () => {
    // 50×50 px at 17.362 mm/px ≈ 0.75 m² — noise
    const bad = {
      ...raw,
      spaces: [
        ...raw.spaces,
        {
          name: "",
          kind: "other" as const,
          polygon: [
            { x: 0, y: 0 },
            { x: 50, y: 0 },
            { x: 50, y: 50 },
            { x: 0, y: 50 },
          ],
        },
      ],
    };
    const v = validateExtraction(bad, 2400, 1697, SCALE_MM_PER_PX);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.extraction.spaces).toHaveLength(4);
      expect(v.issues.some((i) => i.includes("m²"))).toBe(true);
    }
  });

  it("drops zero-width openings and zero-size fixtures", () => {
    const bad = {
      ...raw,
      openings: [{ ...raw.openings[0], widthPx: 0 }],
      fixtures: [{ ...raw.fixtures[0], w: 0 }],
    };
    const v = validateExtraction(bad, 2400, 1697, SCALE_MM_PER_PX);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.extraction.openings).toHaveLength(0);
      expect(v.extraction.fixtures).toHaveLength(0);
      expect(v.issues).toHaveLength(2);
    }
  });
});

describe("orthogonalize", () => {
  it("snaps a jittered near-rectangle to exact axis alignment", () => {
    const out = orthogonalize([
      { x: 0, y: 3 },
      { x: 400, y: 0 },
      { x: 402, y: 300 },
      { x: 2, y: 303 },
    ]);
    expect(out).toHaveLength(4);
    const xs = [...new Set(out.map((p) => p.x))];
    const ys = [...new Set(out.map((p) => p.y))];
    expect(xs).toHaveLength(2); // exactly two x rails
    expect(ys).toHaveLength(2); // exactly two y rails
  });

  it("leaves genuinely angled edges alone", () => {
    // a 45° triangle is nowhere near axis tolerance
    const tri = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 100 },
    ];
    const out = orthogonalize(tri);
    expect(out[2]).toEqual({ x: 50, y: 100 });
  });
});

describe("stitchSpaces", () => {
  it("closes a sub-tolerance seam between neighbouring spaces", () => {
    // right space traced 10 units short of the left space's edge at x=400
    const stitched = stitchSpaces(
      [
        {
          points: [
            { x: 0, y: 0 },
            { x: 400, y: 0 },
            { x: 400, y: 300 },
            { x: 0, y: 300 },
          ],
        },
        {
          points: [
            { x: 410, y: 0 },
            { x: 800, y: 0 },
            { x: 800, y: 300 },
            { x: 410, y: 300 },
          ],
        },
      ],
      20
    );
    expect(stitched[1].points[0].x).toBe(400);
    expect(stitched[1].points[3].x).toBe(400);
    // far edge untouched
    expect(stitched[1].points[1].x).toBe(800);
  });

  it("leaves genuine corridors (beyond tolerance) open", () => {
    const spaces = [
      {
        points: [
          { x: 0, y: 0 },
          { x: 400, y: 0 },
          { x: 400, y: 300 },
          { x: 0, y: 300 },
        ],
      },
      {
        points: [
          { x: 500, y: 0 },
          { x: 800, y: 0 },
          { x: 800, y: 300 },
          { x: 500, y: 300 },
        ],
      },
    ];
    const stitched = stitchSpaces(spaces, 20);
    expect(stitched[1].points[0].x).toBe(500);
  });
});

describe("dropOverlappingSpaces", () => {
  it("drops a zone stacked on top of a larger space, keeping the larger", () => {
    const issues: string[] = [];
    const kept = dropOverlappingSpaces(
      [
        {
          name: "Living",
          points: [
            { x: 0, y: 0 },
            { x: 600, y: 0 },
            { x: 600, y: 400 },
            { x: 0, y: 400 },
          ],
        },
        {
          name: "Dining",
          points: [
            { x: 100, y: 50 },
            { x: 500, y: 50 },
            { x: 500, y: 350 },
            { x: 100, y: 350 },
          ],
        },
      ],
      issues,
      (s) => s.name ?? ""
    );
    expect(kept.map((s) => s.name)).toEqual(["Living"]);
    expect(issues[0]).toContain("Dining");
    expect(issues[0]).toContain("overlapping zones");
  });

  it("keeps genuinely adjacent spaces", () => {
    const issues: string[] = [];
    const kept = dropOverlappingSpaces(
      [
        {
          name: "A",
          points: [
            { x: 0, y: 0 },
            { x: 400, y: 0 },
            { x: 400, y: 300 },
            { x: 0, y: 300 },
          ],
        },
        {
          name: "B",
          points: [
            { x: 400, y: 0 },
            { x: 800, y: 0 },
            { x: 800, y: 300 },
            { x: 400, y: 300 },
          ],
        },
      ],
      issues,
      (s) => s.name ?? ""
    );
    expect(kept).toHaveLength(2);
    expect(issues).toHaveLength(0);
  });
});

describe("buildSimplePlanFromExtraction", () => {
  it("derives shared and external walls from the spaces", () => {
    const { doc, floorId } = extractionDoc();
    const model = buildSimplePlanFromExtraction(doc, floorId);

    // hallway ↔ Bed 2 share the x=1000 line over y 350–450 → a shared wall
    const shared = model.walls.filter(
      (w) =>
        w.kind === "shared" &&
        Math.abs(w.a.x - 1000) < 1 &&
        Math.abs(w.b.x - 1000) < 1
    );
    expect(shared.length).toBeGreaterThan(0);

    // Master's top wall (y=200, single coverage, AI edges are external)
    const top = model.walls.find(
      (w) =>
        w.kind === "external" &&
        Math.abs(w.a.y - 200) < 1 &&
        Math.abs(w.b.y - 200) < 1 &&
        Math.min(w.a.x, w.b.x) < 250
    );
    expect(top).toBeTruthy();
  });

  it("labels spaces with names, kind fallbacks and calibrated areas", () => {
    const { doc, floorId } = extractionDoc();
    const model = buildSimplePlanFromExtraction(doc, floorId);
    const master = model.rooms.find((r) => r.name === "Master Bed 1")!;
    // 400×300 px at 17.362 mm/px → 6.945 × 5.209 m ≈ 36.2 m²
    expect(master.areaM2).toBeCloseTo(36.17, 0);
    expect(model.rooms.some((r) => r.name === "Hall")).toBe(true);
    expect(model.rooms.some((r) => r.name === "Garage")).toBe(true);
  });

  it("snaps the hinged door onto the shared wall with a leaf", () => {
    const { doc, floorId } = extractionDoc();
    const model = buildSimplePlanFromExtraction(doc, floorId);
    const door = model.openings.find((o) => o.kind === "door")!;
    expect(door).toBeTruthy();
    expect(Math.abs(door.a.x - 1000)).toBeLessThan(1);
    expect(Math.abs(door.b.x - 1000)).toBeLessThan(1);
    expect(door.leaf).not.toBeNull();
    // swingToward was on the +x side of the wall → leaf opens into Bed 2
    expect(door.leaf!.free.x).toBeGreaterThan(1000);
  });

  it("keeps windows and cased openings leafless", () => {
    const { doc, floorId } = extractionDoc();
    const model = buildSimplePlanFromExtraction(doc, floorId);
    expect(model.openings.find((o) => o.kind === "window")!.leaf).toBeNull();
    expect(
      model.openings.find((o) => o.kind === "cased-opening")!.leaf
    ).toBeNull();
  });

  it("offsets everything by the sheet's world placement", () => {
    const { doc, floorId } = extractionDoc(100, 50);
    const model = buildSimplePlanFromExtraction(doc, floorId);
    const master = model.rooms.find((r) => r.name === "Master Bed 1")!;
    expect(master.at.x).toBeCloseTo(400 + 100, 0);
    expect(master.at.y).toBeCloseTo(350 + 50, 0);
    const door = model.openings.find((o) => o.kind === "door")!;
    expect(Math.abs(door.a.x - 1100)).toBeLessThan(1);
  });

  it("skips stale sheets (imageRef changed) with an issue", () => {
    const { doc, floorId } = extractionDoc();
    const floor = doc.floors.find((f) => f.id === floorId)!;
    floor.plans[0].imageRef = "org/o/plan_REUPLOADED.png";
    const model = buildSimplePlanFromExtraction(doc, floorId);
    expect(model.walls).toHaveLength(0);
    expect(model.issues.some((i) => i.includes("regenerate"))).toBe(true);
  });

  it("carries fixtures through in world coordinates", () => {
    const { doc, floorId } = extractionDoc();
    const model = buildSimplePlanFromExtraction(doc, floorId);
    const bed = model.fixtures.find((f) => f.kind === "bed")!;
    expect(bed.cx).toBe(250 + 70);
    expect(bed.cy).toBe(230 + 90);
    expect(model.fixtures).toHaveLength(3);
  });
});

describe("renderSimplePlanSVG with extraction model", () => {
  it("draws the door arc, window lines and fixtures", () => {
    const { doc, floorId } = extractionDoc();
    const svg = renderSimplePlanSVG(buildSimplePlanFromExtraction(doc, floorId));
    expect(svg).toContain(" A"); // door swing arc path
    expect(svg).toContain("translate("); // fixture group
    expect(svg).toContain("Master Bed 1");
    // window renders as a pair of thin lines in the gap
    expect((svg.match(/stroke="#5f5e5a"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("carries no measurements — names only", () => {
    const { doc, floorId } = extractionDoc();
    const svg = renderSimplePlanSVG(buildSimplePlanFromExtraction(doc, floorId));
    expect(svg).not.toContain("m²");
    expect(svg).not.toMatch(/\d+\.\d+ m</); // no dim labels like "30.90 m"
  });
});
