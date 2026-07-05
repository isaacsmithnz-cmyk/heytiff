/* Plans pipeline — pure helpers. The pdf.js raster path is browser-only and
   exercised manually; these pin the label guessing and floor mapping. */

import { createDesign } from "../document";
import {
  applyBuilderRows,
  builderRowsFromPages,
  computeRowLevels,
  dropPageOnRow,
  dropRowOnRow,
  dropRowOnTop,
  formatLevel,
  guessFloorLabel,
  movePageToNewRow,
  placeSheets,
  removePageFromRows,
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

  const uploadsFor = (sheets: UploadedSheet[], idxs: number[]) =>
    new Map(idxs.map((idx, k) => [idx, sheets[k]]));

  it("formatLevel: basements read as B-numbers", () => {
    expect(formatLevel(2)).toBe("L2");
    expect(formatLevel(0)).toBe("L0");
    expect(formatLevel(-1)).toBe("B1");
    expect(formatLevel(-2)).toBe("B2");
  });

  it("empty designs get a ground line; rows above count up from L0", () => {
    const pages = [{ label: "Ground" }, { label: "Level 1" }];
    const rows = builderRowsFromPages(pages, [0, 1], []);
    expect(rows[0].kind).toBe("ground");
    const levels = computeRowLevels(rows);
    expect(levels.get(rows[1].key)).toBe(0);
    expect(levels.get(rows[2].key)).toBe(1);
  });

  it("dropping a row on the ground line makes it a subfloor (B1, B2…)", () => {
    const pages = [{ label: "Ground" }, { label: "Basement" }, { label: "Carpark" }];
    let rows = builderRowsFromPages(pages, [0, 1, 2], []);
    rows = dropRowOnRow(rows, rows[2].key, "ground"); // Basement below the line
    rows = dropRowOnRow(rows, rows.find((r) => r.name === "Carpark")!.key, "ground");
    const levels = computeRowLevels(rows);
    const byName = (n: string) => levels.get(rows.find((r) => r.name === n)!.key);
    expect(byName("Ground")).toBe(0);
    // each drop lands directly below the line, pushing earlier basements deeper
    expect(byName("Carpark")).toBe(-1);
    expect(byName("Basement")).toBe(-2);
  });

  it("rows reorder by drag: dropping A on B lands A directly above B; top zone stacks highest", () => {
    const pages = [{ label: "A" }, { label: "B" }, { label: "C" }];
    let rows = builderRowsFromPages(pages, [0, 1, 2], []);
    rows = dropRowOnRow(rows, rows[1].key, rows[3].key); // A above C
    expect(rows.filter((r) => r.kind === "floor").map((r) => r.name)).toEqual(["B", "C", "A"]);
    rows = dropRowOnTop(rows, rows.find((r) => r.name === "B")!.key);
    expect(rows.filter((r) => r.kind === "floor").map((r) => r.name)).toEqual(["C", "A", "B"]);
  });

  it("two pages dropped together become sheets of ONE floor (east/west split)", () => {
    const pages = [{ label: "Level 1 East" }, { label: "Level 1 West" }];
    let rows = builderRowsFromPages(pages, [0, 1], []);
    rows = dropPageOnRow(rows, 1, rows[1].key, "Level 1 West"); // West onto East's row
    expect(rows.filter((r) => r.kind === "floor")).toHaveLength(1);
    const floors = applyBuilderRows(
      rows,
      uploadsFor([sheet("Level 1 East", 2), sheet("Level 1 West", 3)], [0, 1]),
      []
    );
    expect(floors).toHaveLength(1);
    expect(floors[0].plans.map((s) => s.name)).toEqual(["Level 1 East", "Level 1 West"]);
    expect(floors[0].plans[1].x).toBe(2060); // side by side, ready to align
    expect(floors[0].level).toBe(0);
  });

  it("existing floors anchor the numbering; dropping below the lowest makes basements", () => {
    const doc = createDesign({ name: "x", mode: "blank" }); // Ground @ L0
    const pages = [{ label: "Basement plan" }];
    let rows = builderRowsFromPages(pages, [0], doc.floors);
    expect(rows.find((r) => r.kind === "ground")).toBeUndefined();
    // drag the new row onto the existing ground row → directly ABOVE it; then
    // move it below by dropping ground... instead drop row on existing row and
    // verify above; then simulate below-lowest via dropRowOnRow on the bottom:
    rows = [rows[1], rows[0]]; // manually order: new row below existing Ground
    const levels = computeRowLevels(rows);
    expect(levels.get(rows[0].key)).toBe(-1); // below L0 → B1
    expect(levels.get(rows[1].key)).toBe(0); // Ground keeps its level
    const floors = applyBuilderRows(
      rows,
      uploadsFor([sheet("Basement plan", 9)], [0]),
      doc.floors
    );
    expect(floors.map((f) => [f.name, f.level])).toEqual([
      ["Basement plan", -1],
      ["Ground floor", 0],
    ]);
  });

  it("inserting between existing floors renumbers the stack (mezzanine)", () => {
    const doc = createDesign({ name: "x", mode: "blank" });
    doc.floors.push({
      id: "flr_l1",
      name: "Level 1",
      level: 1,
      scaleMmPerUnit: null,
      northDeg: null,
      plans: [],
    });
    const pages = [{ label: "Mezzanine" }];
    let rows = builderRowsFromPages(pages, [0], doc.floors);
    // drop the mezzanine row on the existing Ground row → sits directly above it
    rows = dropRowOnRow(rows, rows[2].key, rows[0].key);
    const floors = applyBuilderRows(
      rows,
      uploadsFor([sheet("Mezzanine", 4)], [0]),
      doc.floors
    );
    expect(floors.map((f) => [f.name, f.level])).toEqual([
      ["Ground floor", 0],
      ["Mezzanine", 1],
      ["Level 1", 2], // renumbered up
    ]);
  });

  it("dropping a page on an existing floor row adds a sheet to that floor", () => {
    const doc = createDesign({ name: "x", mode: "blank" });
    const pages = [{ label: "GF West" }];
    let rows = builderRowsFromPages(pages, [0], doc.floors);
    rows = dropPageOnRow(rows, 0, rows[0].key, "GF West");
    const floors = applyBuilderRows(rows, uploadsFor([sheet("GF West", 4)], [0]), doc.floors);
    expect(floors).toHaveLength(1);
    expect(floors[0].plans).toHaveLength(1);
    expect(floors[0].name).toBe("Ground floor");
  });

  it("dropping a page on the ground line starts a subfloor row", () => {
    const pages = [{ label: "Ground" }, { label: "Storage" }];
    let rows = builderRowsFromPages(pages, [0, 1], []);
    rows = dropPageOnRow(rows, 1, "ground", "Storage");
    const levels = computeRowLevels(rows);
    expect(levels.get(rows.find((r) => r.name === "Storage")!.key)).toBe(-1);
  });

  it("movePageToNewRow splits a page back out on top; removePageFromRows drops it", () => {
    const pages = [{ label: "East" }, { label: "West" }];
    let rows = builderRowsFromPages(pages, [0, 1], []);
    rows = dropPageOnRow(rows, 1, rows[1].key, "West");
    rows = movePageToNewRow(rows, 1, "West again");
    expect(rows.filter((r) => r.kind === "floor")).toHaveLength(2);
    rows = removePageFromRows(rows, 1);
    expect(rows.filter((r) => r.kind === "floor")).toHaveLength(1);
  });

  it("unplaced/removed pages are simply not imported", () => {
    const pages = [{ label: "Roof" }];
    const rows = removePageFromRows(builderRowsFromPages(pages, [0], []), 0);
    expect(applyBuilderRows(rows, uploadsFor([sheet("Roof", 5)], [0]), [])).toEqual([]);
  });
});
