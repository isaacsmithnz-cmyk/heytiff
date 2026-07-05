/* Plans pipeline — pure helpers. The pdf.js raster path is browser-only and
   exercised manually; these pin the label guessing and floor mapping. */

import { createDesign } from "../document";
import { floorsFromPages, guessFloorLabel } from "../plans";

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

describe("floorsFromPages", () => {
  const page = (label: string, n: number | null) => ({
    label,
    ref: `org/o1/plan_${label}.png`,
    pageNumber: n,
    width: 2000,
    height: 1400,
  });

  it("appends floors with continuing levels and uncalibrated scale", () => {
    const doc = createDesign({ name: "x", mode: "blank" }); // has Ground @ L0
    const floors = floorsFromPages(
      [page("Level 1", 2), page("Level 2", 3)],
      doc.floors
    );
    expect(floors.map((f) => f.level)).toEqual([1, 2]);
    expect(floors.map((f) => f.name)).toEqual(["Level 1", "Level 2"]);
    expect(floors.every((f) => f.scaleMmPerUnit === null)).toBe(true);
    expect(floors[0].plan).toEqual({
      imageRef: "org/o1/plan_Level 1.png",
      pageNumber: 2,
      width: 2000,
      height: 1400,
    });
  });

  it("starts at level 0 for an empty design", () => {
    const floors = floorsFromPages([page("Ground floor", 1)], []);
    expect(floors[0].level).toBe(0);
  });

  it("suffixes duplicate labels, counting existing floors too", () => {
    const doc = createDesign({ name: "x", mode: "blank" });
    doc.floors[0].name = "Floor plan";
    const floors = floorsFromPages(
      [page("Floor plan", 1), page("Floor plan", 2), page("Roof", 3)],
      doc.floors
    );
    expect(floors.map((f) => f.name)).toEqual([
      "Floor plan (2)",
      "Floor plan (3)",
      "Roof",
    ]);
  });
});
