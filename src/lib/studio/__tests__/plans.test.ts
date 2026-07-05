/* Plans pipeline — pure helpers. The pdf.js raster path is browser-only and
   exercised manually; these pin the label guessing and floor mapping. */

import { createDesign, type Floor } from "../document";
import {
  applyBuilderRows,
  builderRowsFromPages,
  guessFloorLabel,
  movePageToNewRow,
  movePageToRow,
  moveRow,
  placeSheets,
  removePageFromRows,
  type BuilderRow,
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

  it("each row becomes a floor; stack order sets the levels above existing floors", () => {
    const doc = createDesign({ name: "x", mode: "blank" }); // Ground @ L0
    const pages = [{ label: "Level 1" }, { label: "Level 2" }];
    const rows = builderRowsFromPages(pages, [0, 1], doc.floors);
    // existing Ground floor is a fixed bottom row
    expect(rows[0].floorId).toBe(doc.floors[0].id);
    const floors = applyBuilderRows(
      rows,
      uploadsFor([sheet("Level 1", 2), sheet("Level 2", 3)], [0, 1]),
      doc.floors
    );
    expect(floors.map((f: Floor) => f.level)).toEqual([0, 1, 2]);
    expect(floors[1].name).toBe("Level 1");
    expect(floors[1].scaleMmPerUnit).toBeNull();
    expect(floors[1].plans[0].imageRef).toBe("org/o1/plan_Level 1.png");
  });

  it("two pages dragged onto one row become sheets of ONE floor (east/west split)", () => {
    const pages = [{ label: "Level 1 East" }, { label: "Level 1 West" }];
    let rows = builderRowsFromPages(pages, [0, 1], []);
    rows = movePageToRow(rows, 1, rows[0].key); // drag West onto East's row
    expect(rows).toHaveLength(1); // West's empty row vanished
    const floors = applyBuilderRows(
      rows,
      uploadsFor([sheet("Level 1 East", 2), sheet("Level 1 West", 3)], [0, 1]),
      []
    );
    expect(floors).toHaveLength(1);
    expect(floors[0].plans.map((s) => s.name)).toEqual([
      "Level 1 East",
      "Level 1 West",
    ]);
    // auto-placed side by side, ready to drag into alignment
    expect(floors[0].plans[1].x).toBe(2060);
  });

  it("dropping a page on an existing floor row adds a sheet to that floor", () => {
    const doc = createDesign({ name: "x", mode: "blank" });
    const pages = [{ label: "GF West" }];
    let rows = builderRowsFromPages(pages, [0], doc.floors);
    rows = movePageToRow(rows, 0, rows[0].key); // onto the existing Ground floor
    const floors = applyBuilderRows(
      rows,
      uploadsFor([sheet("GF West", 4)], [0]),
      doc.floors
    );
    expect(floors).toHaveLength(1);
    expect(floors[0].plans).toHaveLength(1);
    expect(floors[0].name).toBe("Ground floor");
  });

  it("moveRow reorders new rows but never sinks below existing floors", () => {
    const doc = createDesign({ name: "x", mode: "blank" });
    const pages = [{ label: "A" }, { label: "B" }];
    let rows: BuilderRow[] = builderRowsFromPages(pages, [0, 1], doc.floors);
    // A (idx 1) up past B
    rows = moveRow(rows, rows[1].key, 1);
    expect(rows.map((r) => r.name)).toEqual(["Ground floor", "B", "A"]);
    // B cannot sink into the existing block
    expect(moveRow(rows, rows[1].key, -1)).toBe(rows);
    // existing rows never move
    expect(moveRow(rows, rows[0].key, 1)).toBe(rows);
  });

  it("movePageToNewRow starts a fresh top row; removePageFromRows drops the page", () => {
    const pages = [{ label: "East" }, { label: "West" }];
    let rows = builderRowsFromPages(pages, [0, 1], []);
    rows = movePageToRow(rows, 1, rows[0].key); // one combined row
    rows = movePageToNewRow(rows, 1, "West again"); // split back out on top
    expect(rows).toHaveLength(2);
    expect(rows[1].name).toBe("West again");
    rows = removePageFromRows(rows, 1);
    expect(rows).toHaveLength(1); // its row vanished with it
  });

  it("unplaced/removed pages are simply not imported", () => {
    const pages = [{ label: "Roof" }];
    const rows = removePageFromRows(builderRowsFromPages(pages, [0], []), 0);
    expect(applyBuilderRows(rows, uploadsFor([sheet("Roof", 5)], [0]), [])).toEqual([]);
  });
});
