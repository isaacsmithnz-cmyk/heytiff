/* Plans pipeline — pure helpers. The pdf.js raster path is browser-only and
   exercised manually; these pin the label guessing and floor mapping. */

import { createDesign } from "../document";
import { floorsFromPages, guessFloorLabel } from "../plans";

describe("guessFloorLabel", () => {
  const cases: [string, string][] = [
    ["PROPOSED GROUND FLOOR PLAN 1:100", "Ground floor"],
    ["First Floor Plan — Sheet A102", "Level 1"],
    ["SECOND FLOOR layout", "Level 2"],
    ["LEVEL 3 GENERAL ARRANGEMENT", "Level 3"],
    ["Level 12 mechanical services", "Level 12"],
    ["BASEMENT CARPARK", "Basement"],
    ["Lower Ground parking", "Basement"],
    ["ROOF PLAN 1:200", "Roof"],
    ["SITE PLAN and location", "Site plan"],
    ["Electrical schedule notes", "Page 7"],
  ];
  it.each(cases)("labels %j as %s", (text, expected) => {
    expect(guessFloorLabel(text, 7)).toBe(expected);
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
});
