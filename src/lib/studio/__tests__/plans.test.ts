/* Plans pipeline — pure helpers. The pdf.js raster path is browser-only and
   exercised manually; these pin sequential labelling and floor mapping. */

import { createDesign } from "../document";
import {
  applyBuilderRows,
  builderStackFromFloors,
  computeRowLevels,
  dropPageOnRow,
  dropRowOnRow,
  dropRowOnTop,
  formatLevel,
  insertPageRow,
  labelPagesSequentially,
  removePageFromRows,
  trayPageIdxs,
  placeSheets,
  type PageImage,
  type UploadedSheet,
} from "../plans";

describe("labelPagesSequentially", () => {
  it("names pages Page 1, Page 2… by combined order regardless of source", () => {
    const mk = (n: number | null): PageImage => ({
      pageNumber: n,
      label: "whatever",
      blob: new Blob(),
      ext: "png",
      thumbUrl: "blob:x",
      width: 1,
      height: 1,
    });
    const pages = [mk(1), mk(2), mk(null)]; // e.g. a 2-page PDF + one image
    labelPagesSequentially(pages);
    expect(pages.map((p) => p.label)).toEqual(["Page 1", "Page 2", "Page 3"]);
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

  it("formatLevel: ground = GF, upper = L-numbers, basements = B-numbers", () => {
    expect(formatLevel(2)).toBe("L2");
    expect(formatLevel(0)).toBe("GF");
    expect(formatLevel(-1)).toBe("B1");
    expect(formatLevel(-2)).toBe("B2");
  });

  it("fresh designs start with just the ground line and every page in the tray", () => {
    const rows = builderStackFromFloors([]);
    expect(rows.map((r) => r.kind)).toEqual(["ground"]);
    expect(trayPageIdxs(rows, [0, 1, 2])).toEqual([0, 1, 2]);
  });

  it("first page placed above the ground line becomes the ground floor; next above = L1", () => {
    let rows = builderStackFromFloors([]);
    rows = insertPageRow(rows, 0, "Ground floor", "ground", "above");
    const gfKey = rows.find((r) => r.name === "Ground floor")!.key;
    rows = insertPageRow(rows, 1, "Level 1", gfKey, "above");
    const levels = computeRowLevels(rows);
    expect(levels.get(gfKey)).toBe(0); // GF
    expect(levels.get(rows.find((r) => r.name === "Level 1")!.key)).toBe(1);
    // both pages now placed → tray empty
    expect(trayPageIdxs(rows, [0, 1])).toEqual([]);
  });

  it("placing below the ground line makes subfloors (B1, B2…)", () => {
    let rows = builderStackFromFloors([]);
    rows = insertPageRow(rows, 0, "Ground floor", "ground", "above");
    rows = insertPageRow(rows, 1, "Basement", "ground", "below"); // just under the line
    rows = insertPageRow(rows, 2, "Carpark", "ground", "below");
    const levels = computeRowLevels(rows);
    const byName = (n: string) => levels.get(rows.find((r) => r.name === n)!.key);
    expect(byName("Ground floor")).toBe(0);
    // each "below the line" drop pushes the earlier basement deeper
    expect(byName("Carpark")).toBe(-1);
    expect(byName("Basement")).toBe(-2);
  });

  it("two pages merged onto one floor become sheets of it (east/west split)", () => {
    let rows = builderStackFromFloors([]);
    rows = insertPageRow(rows, 0, "Level 1", "ground", "above");
    const key = rows.find((r) => r.name === "Level 1")!.key;
    rows = dropPageOnRow(rows, 1, key); // West merged onto the Level 1 card
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

  it("existing floors anchor the numbering; placing below the lowest makes a basement", () => {
    const doc = createDesign({ name: "x", mode: "blank" }); // Ground @ L0
    let rows = builderStackFromFloors(doc.floors);
    expect(rows.find((r) => r.kind === "ground")).toBeUndefined();
    const gfKey = rows[0].key;
    rows = insertPageRow(rows, 0, "Basement plan", gfKey, "below");
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
    let rows = builderStackFromFloors(doc.floors);
    const groundKey = rows.find((r) => r.name === "Ground floor")!.key;
    rows = insertPageRow(rows, 0, "Mezzanine", groundKey, "above");
    const floors = applyBuilderRows(rows, uploadsFor([sheet("Mezzanine", 4)], [0]), doc.floors);
    expect(floors.map((f) => [f.name, f.level])).toEqual([
      ["Ground floor", 0],
      ["Mezzanine", 1],
      ["Level 1", 2], // renumbered up
    ]);
  });

  it("name is display-only: a floor named 'Ground floor' placed at the top stays L2", () => {
    let rows = builderStackFromFloors([]);
    rows = insertPageRow(rows, 0, "Real ground", "ground", "above");
    rows = insertPageRow(rows, 1, "Mid", rows.find((r) => r.name === "Real ground")!.key, "above");
    // mislabelled page dropped at the very top
    rows = insertPageRow(rows, 2, "Ground floor", rows.find((r) => r.name === "Mid")!.key, "above");
    const floors = applyBuilderRows(
      rows,
      uploadsFor([sheet("a", 1), sheet("b", 2), sheet("c", 3)], [0, 1, 2]),
      []
    );
    const top = floors.find((f) => f.name === "Ground floor")!;
    expect(top.level).toBe(2); // position wins; the name is just a label
  });

  it("dragging a placed floor to the tray un-places it; only placed pages import", () => {
    let rows = builderStackFromFloors([]);
    rows = insertPageRow(rows, 0, "Ground floor", "ground", "above");
    rows = insertPageRow(rows, 1, "Roof", rows.find((r) => r.name === "Ground floor")!.key, "above");
    expect(trayPageIdxs(rows, [0, 1])).toEqual([]);
    rows = removePageFromRows(rows, 1); // Roof back to the tray
    expect(trayPageIdxs(rows, [0, 1])).toEqual([1]);
    const floors = applyBuilderRows(
      rows,
      uploadsFor([sheet("a", 1), sheet("b", 2)], [0, 1]),
      []
    );
    expect(floors.map((f) => f.name)).toEqual(["Ground floor"]); // Roof not imported
  });

  it("placed floors still reorder by drag (row moves)", () => {
    let rows = builderStackFromFloors([]);
    rows = insertPageRow(rows, 0, "A", "ground", "above");
    rows = insertPageRow(rows, 1, "B", rows.find((r) => r.name === "A")!.key, "above");
    rows = insertPageRow(rows, 2, "C", rows.find((r) => r.name === "B")!.key, "above");
    // move A above C
    rows = dropRowOnRow(rows, rows.find((r) => r.name === "A")!.key, rows.find((r) => r.name === "C")!.key);
    expect(rows.filter((r) => r.kind === "floor").map((r) => r.name)).toEqual(["B", "C", "A"]);
    rows = dropRowOnTop(rows, rows.find((r) => r.name === "B")!.key);
    expect(rows.filter((r) => r.kind === "floor").map((r) => r.name)).toEqual(["C", "A", "B"]);
  });
});
