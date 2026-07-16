/* Plans pipeline — pure helpers. The pdf.js raster path is browser-only and
   exercised manually; these pin sequential labelling and floor mapping. */

import { createDesign, type Floor } from "../document";
import {
  applyBuilderRows,
  builderRowsFromFloors,
  builderStackFromFloors,
  computeRowLevels,
  defaultFloorName,
  floorDisplayName,
  dropPageOnRow,
  dropRowAt,
  formatLevel,
  insertPageRow,
  labelPagesSequentially,
  previewInsertLevel,
  removePageFromRows,
  restackLevels,
  setAnchorLevel,
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

  it("fresh designs start empty with every page in the tray", () => {
    const rows = builderStackFromFloors([]);
    expect(rows).toEqual([]);
    expect(trayPageIdxs(rows, [0, 1, 2])).toEqual([0, 1, 2]);
  });

  it("the first placed plan anchors at ground floor; above it counts up", () => {
    let rows = insertPageRow([], 0, "Ground floor", null, "above");
    expect(rows[0].anchorLevel).toBe(0);
    const gfKey = rows[0].key;
    rows = insertPageRow(rows, 1, "Level 1", gfKey, "above");
    const levels = computeRowLevels(rows);
    expect(levels.get(gfKey)).toBe(0);
    expect(levels.get(rows.find((r) => r.name === "Level 1")!.key)).toBe(1);
    expect(trayPageIdxs(rows, [0, 1])).toEqual([]);
  });

  it("the anchor dropdown re-pins the whole stack (first plan set to L1)", () => {
    let rows = insertPageRow([], 0, "First floor", null, "above");
    const key = rows[0].key;
    rows = insertPageRow(rows, 1, "Above", key, "above");
    rows = setAnchorLevel(rows, key, 1);
    const levels = computeRowLevels(rows);
    expect(levels.get(key)).toBe(1); // L1
    expect(levels.get(rows.find((r) => r.name === "Above")!.key)).toBe(2); // L2
  });

  it("placing below the anchor makes subfloors (B1, B2…)", () => {
    let rows = insertPageRow([], 0, "Ground floor", null, "above");
    const gfKey = rows[0].key;
    rows = insertPageRow(rows, 1, "Basement", gfKey, "below");
    rows = insertPageRow(rows, 2, "Carpark", gfKey, "below");
    const levels = computeRowLevels(rows);
    const byName = (n: string) => levels.get(rows.find((r) => r.name === n)!.key);
    expect(byName("Ground floor")).toBe(0);
    // each "directly below the anchor" drop pushes the earlier basement deeper
    expect(byName("Carpark")).toBe(-1);
    expect(byName("Basement")).toBe(-2);
  });

  it("previewInsertLevel labels every drop slot with the level it would create", () => {
    expect(previewInsertLevel([], null, "above")).toBe(0); // first drop = GF
    let rows = insertPageRow([], 0, "Ground floor", null, "above");
    const gfKey = rows[0].key;
    expect(previewInsertLevel(rows, gfKey, "above")).toBe(1); // slot above GF
    expect(previewInsertLevel(rows, gfKey, "below")).toBe(-1); // slot below GF
    rows = insertPageRow(rows, 1, "Level 1", gfKey, "above");
    const l1Key = rows.find((r) => r.name === "Level 1")!.key;
    expect(previewInsertLevel(rows, l1Key, "above")).toBe(2);
    // previewing never mutates: the real stack is unchanged
    expect(rows.filter((r) => r.pageIdxs.includes(-1))).toHaveLength(0);
  });

  it("two pages merged onto one floor become sheets of it (east/west split)", () => {
    let rows = insertPageRow([], 0, "Level 1", null, "above");
    rows = dropPageOnRow(rows, 1, rows[0].key); // West merged onto the card
    expect(rows).toHaveLength(1);
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

  it("an un-named floor takes its stack-position name, never the page label", () => {
    // a page dropped as a fresh floor with NO typed name
    const rows = insertPageRow([], 0, "", null, "above");
    const floors = applyBuilderRows(rows, uploadsFor([sheet("Page 6", 6)], [0]), []);
    expect(floors).toHaveLength(1);
    expect(floors[0].name).toBe("Ground floor"); // stack position, NOT "Page 6"
    expect(floors[0].level).toBe(0);
  });

  it("defaultFloorName maps stack position → floor name", () => {
    expect(defaultFloorName(0)).toBe("Ground floor");
    expect(defaultFloorName(2)).toBe("Level 2");
    expect(defaultFloorName(-1)).toBe("Basement 1");
  });

  it("floorDisplayName falls back to stack position for raw page labels", () => {
    // a floor still carrying a "Page N" label (old designs) reads as its position
    expect(floorDisplayName({ name: "Page 6", level: 1 })).toBe("Level 1");
    expect(floorDisplayName({ name: "  ", level: 0 })).toBe("Ground floor");
    // typed names are left exactly as the installer set them
    expect(floorDisplayName({ name: "Ground floor", level: 0 })).toBe("Ground floor");
    expect(floorDisplayName({ name: "Page 6 — East wing", level: 1 })).toBe(
      "Page 6 — East wing"
    );
  });

  it("restackLevels permutes floor→level, preserving the level set", () => {
    const flr = (id: string, level: number): Floor => ({
      id, name: id, level, scaleMmPerUnit: 10, northDeg: null, northPos: null, simplePlan: null, plans: [],
    });
    const floors = [flr("a", 0), flr("b", 1), flr("c", -1)]; // GF, L1, B1
    // new top-to-bottom order: A (top), C, B (bottom)
    const out = restackLevels(floors, ["a", "c", "b"]);
    const lvl = (id: string) => out.find((f) => f.id === id)!.level;
    // the set {-1,0,1} is re-dealt bottom-up: B=-1, C=0, A=1
    expect(lvl("b")).toBe(-1);
    expect(lvl("c")).toBe(0);
    expect(lvl("a")).toBe(1);
  });

  it("existing floors anchor the numbering; placing below the lowest makes a basement", () => {
    const doc = createDesign({ name: "x", mode: "blank" }); // Ground @ L0
    let rows = builderStackFromFloors(doc.floors);
    expect(rows[0].floorId).toBe(doc.floors[0].id);
    rows = insertPageRow(rows, 0, "Basement plan", rows[0].key, "below");
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
      northDeg: null, northPos: null,
      simplePlan: null,
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
    let rows = insertPageRow([], 0, "Real ground", null, "above");
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

  it("removing the anchor promotes the lowest survivor so levels don't jump", () => {
    let rows = insertPageRow([], 0, "Ground floor", null, "above");
    rows = insertPageRow(rows, 1, "Level 1", rows[0].key, "above");
    rows = removePageFromRows(rows, 0); // pull the anchor back to the tray
    expect(rows).toHaveLength(1);
    expect(computeRowLevels(rows).get(rows[0].key)).toBe(1); // Level 1 stays L1
    expect(rows[0].anchorLevel).toBe(1);
    expect(trayPageIdxs(rows, [0, 1])).toEqual([0]);
  });

  it("placed floors reorder by drag; the anchor keeps its pinned level", () => {
    let rows = insertPageRow([], 0, "A", null, "above"); // anchor GF
    rows = insertPageRow(rows, 1, "B", rows.find((r) => r.name === "A")!.key, "above");
    rows = insertPageRow(rows, 2, "C", rows.find((r) => r.name === "B")!.key, "above");
    // move A (the anchor) above C: A stays GF, the rest fall below ground
    rows = dropRowAt(rows, rows.find((r) => r.name === "A")!.key, rows.find((r) => r.name === "C")!.key, "above");
    const levels = computeRowLevels(rows);
    const byName = (n: string) => levels.get(rows.find((r) => r.name === n)!.key);
    expect(byName("A")).toBe(0);
    expect(byName("C")).toBe(-1);
    expect(byName("B")).toBe(-2);
  });

  it("unplaced/removed pages are simply not imported", () => {
    let rows = insertPageRow([], 0, "Roof", null, "above");
    rows = removePageFromRows(rows, 0);
    expect(applyBuilderRows(rows, uploadsFor([sheet("Roof", 5)], [0]), [])).toEqual([]);
  });
});

describe("rehydrating a saved import", () => {
  const uploadsFor = (sheets: UploadedSheet[], idxs: number[]) =>
    new Map(idxs.map((idx, k) => [idx, sheets[k]]));
  const upl = (ref: string): UploadedSheet => ({
    label: ref,
    ref,
    pageNumber: 1,
    width: 2000,
    height: 1400,
  });
  const pageWithRef = (ref: string): PageImage => ({
    pageNumber: 1,
    label: ref,
    thumbUrl: `blob:${ref}`,
    width: 2000,
    height: 1400,
    ref,
  });
  const floorWith = (id: string, level: number, refs: string[]): Floor => ({
    id,
    name: defaultFloorName(level),
    level,
    scaleMmPerUnit: 10,
    northDeg: null, northPos: null,
    simplePlan: null,
    plans: refs.map((r, i) => ({
      id: `sht_${id}_${i}`,
      imageRef: r,
      pageNumber: 1,
      name: r,
      width: 2000,
      height: 1400,
      x: 0,
      y: 0,
    })),
  });

  it("builderRowsFromFloors re-populates each floor row with its pages by ref", () => {
    const floors = [floorWith("a", 0, ["r0"]), floorWith("b", 1, ["r1", "r2"])];
    const pages = [pageWithRef("r0"), pageWithRef("r1"), pageWithRef("r2"), pageWithRef("r3")];
    const rows = builderRowsFromFloors(floors, pages);
    expect(rows.map((r) => [r.floorId, r.pageIdxs])).toEqual([
      ["a", [0]],
      ["b", [1, 2]],
    ]);
    // r3 is uploaded but on no floor → it waits in the tray
    expect(trayPageIdxs(rows, [0, 1, 2, 3])).toEqual([3]);
  });

  it("re-committing a rehydrated stack is idempotent — no duplicate sheets", () => {
    const floors = [floorWith("a", 0, ["r0"])];
    const rows = builderRowsFromFloors(floors, [pageWithRef("r0")]);
    const committed = applyBuilderRows(rows, uploadsFor([upl("r0")], [0]), floors);
    expect(committed).toHaveLength(1);
    expect(committed[0].plans).toHaveLength(1); // not re-added
  });

  it("dropping a NEW page onto a rehydrated floor still adds it", () => {
    const floors = [floorWith("a", 0, ["r0"])];
    let rows = builderRowsFromFloors(floors, [pageWithRef("r0"), pageWithRef("r1")]);
    rows = dropPageOnRow(rows, 1, rows[0].key); // add r1 to floor a
    const committed = applyBuilderRows(rows, uploadsFor([upl("r0"), upl("r1")], [0, 1]), floors);
    expect(committed[0].plans.map((s) => s.imageRef)).toEqual(["r0", "r1"]);
  });
});
