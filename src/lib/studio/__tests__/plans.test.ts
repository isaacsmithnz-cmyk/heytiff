/* Plans pipeline — pure helpers. The pdf.js raster path is browser-only and
   exercised manually; these pin the label guessing and floor mapping. */

import { createDesign, type Floor } from "../document";
import {
  applyPageAllocations,
  guessFloorLabel,
  placeSheets,
  type UploadedSheet,
} from "../plans";

describe("guessFloorLabel", () => {
  const cases: [string, string][] = [
    ["PROPOSED GROUND FLOOR PLAN 1:100", "Ground floor"],
    ["First Floor Plan — Sheet A102", "Level 1"],
    ["SECOND FLOOR layout", "Level 2"],
    ["FOURTH STOREY apartments", "Level 4"],
    ["LEVEL 3 GENERAL ARRANGEMENT", "Level 3"],
    ["Level 12 mechanical services", "Level 12"],
    ["L2 FLOOR PLAN", "Level 2"],
    ["BASEMENT CARPARK", "Basement"],
    ["LOWER GROUND parking", "Lower ground"],
    ["MEZZANINE floor plan", "Mezzanine"],
    ["ROOF PLAN 1:200", "Roof"],
    ["SITE PLAN and location", "Site plan"],
    ["NORTH & SOUTH ELEVATIONS", "Elevations"],
    ["Door schedule notes", "Page 7"],
  ];
  it.each(cases)("labels %j as %s", (text, expected) => {
    expect(guessFloorLabel(text, 7)).toBe(expected);
  });

  it("the page's own repeated title beats a one-off sheet-index mention", () => {
    // a first-floor sheet whose title block mentions the whole set once
    const text = `FIRST FLOOR PLAN scale 1:100  FIRST FLOOR PLAN
      drawing index: site plan, ground floor plan, first floor plan, elevations, sections`;
    expect(guessFloorLabel(text, 3)).toBe("Level 1");
  });

  it("generic 'floor plan' loses to any specific floor name", () => {
    expect(guessFloorLabel("FLOOR PLAN — GROUND FLOOR", 1)).toBe("Ground floor");
  });
});

describe("sheet placement + allocation", () => {
  const sheet = (label: string, n: number | null): UploadedSheet => ({
    label,
    ref: `org/o1/plan_${label}.png`,
    pageNumber: n,
    width: 2000,
    height: 1400,
  });

  it("placeSheets lays new sheets to the right of existing content", () => {
    const first = placeSheets([], [sheet("East", 1)]);
    expect(first[0].x).toBe(0);
    const second = placeSheets(first, [sheet("West", 2)]);
    expect(second[0].x).toBe(2060); // 2000 + 60 gap
    expect(second[0].y).toBe(0);
  });

  it("distinct names become distinct floors with continuing levels", () => {
    const doc = createDesign({ name: "x", mode: "blank" }); // Ground @ L0
    const floors = applyPageAllocations(
      [
        { floorName: "Level 1", sheet: sheet("Level 1", 2) },
        { floorName: "Level 2", sheet: sheet("Level 2", 3) },
      ],
      doc.floors
    );
    expect(floors.map((f: Floor) => f.level)).toEqual([0, 1, 2]);
    expect(floors[1].name).toBe("Level 1");
    expect(floors[1].scaleMmPerUnit).toBeNull();
    expect(floors[1].plans[0].imageRef).toBe("org/o1/plan_Level 1.png");
  });

  it("pages sharing a floor name become sheets of ONE floor (east/west split)", () => {
    const floors = applyPageAllocations(
      [
        { floorName: "Level 1", sheet: sheet("Level 1 East", 2) },
        { floorName: "Level 1", sheet: sheet("Level 1 West", 3) },
      ],
      []
    );
    expect(floors).toHaveLength(1);
    expect(floors[0].plans).toHaveLength(2);
    expect(floors[0].plans.map((s) => s.name)).toEqual([
      "Level 1 East",
      "Level 1 West",
    ]);
    // auto-placed side by side, ready to drag into alignment
    expect(floors[0].plans[1].x).toBe(2060);
  });

  it("a name matching an existing floor adds sheets to it (case/space-insensitive)", () => {
    const doc = createDesign({ name: "x", mode: "blank" });
    const floors = applyPageAllocations(
      [{ floorName: "  ground FLOOR ", sheet: sheet("GF West", 4) }],
      doc.floors
    );
    expect(floors).toHaveLength(1);
    expect(floors[0].plans).toHaveLength(1);
    expect(floors[0].name).toBe("Ground floor"); // keeps the existing name
  });

  it("blank names fall back to the page label", () => {
    const floors = applyPageAllocations(
      [{ floorName: "   ", sheet: sheet("Roof", 5) }],
      []
    );
    expect(floors[0].name).toBe("Roof");
  });
});
