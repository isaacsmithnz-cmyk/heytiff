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
  orphanedRefs,
  previewInsertLevel,
  removePageFromRows,
  restackLevels,
  setAnchorLevel,
  trayPageIdxs,
  placeSheets,
  regionFromPoints,
  regionFromRect,
  regionOutline,
  sharedPlanRefs,
  splitFloorOffSheet,
  withRegion,
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
      id, name: id, level, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [],
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

  it("a page two floors share shows on the first floor only, so no card is in two rows", () => {
    // a split plan: floors a and b both show r0 (different crops)
    const floors = [floorWith("a", 0, ["r0"]), floorWith("b", 1, ["r0"])];
    const rows = builderRowsFromFloors(floors, [pageWithRef("r0")]);
    expect(rows.map((r) => [r.floorId, r.pageIdxs])).toEqual([
      ["a", [0]],
      ["b", []],
    ]);
    // …and the page is not also waiting in the tray
    expect(trayPageIdxs(rows, [0])).toEqual([]);
  });

  it("one floor holding the same image twice lists the page once", () => {
    const rows = builderRowsFromFloors([floorWith("a", 0, ["r0", "r0"])], [pageWithRef("r0")]);
    expect(rows[0].pageIdxs).toEqual([0]);
  });

  it("re-committing a rehydrated split keeps both floors' sheets", () => {
    const floors = [floorWith("a", 0, ["r0"]), floorWith("b", 1, ["r0"])];
    const rows = builderRowsFromFloors(floors, [pageWithRef("r0")]);
    const committed = applyBuilderRows(rows, uploadsFor([upl("r0")], [0]), floors);
    expect(committed.map((f) => [f.id, f.plans.length])).toEqual([
      ["a", 1],
      ["b", 1],
    ]);
  });
});

describe("orphanedRefs", () => {
  const floor = (id: string, refs: string[]): Floor => ({
    id,
    name: id,
    level: 0,
    scaleMmPerUnit: 10,
    northDeg: null,
    northPos: null,
    plans: refs.map((r, i) => ({
      id: `${id}_${i}`,
      imageRef: r,
      pageNumber: 1,
      name: r,
      width: 100,
      height: 100,
      x: 0,
      y: 0,
    })),
  });

  it("returns every ref of the floor when nothing else uses them", () => {
    expect(orphanedRefs([floor("a", ["r0", "r1"]), floor("b", ["r2"])], "a")).toEqual(["r0", "r1"]);
  });

  it("keeps a ref another floor still shows (a split plan)", () => {
    expect(orphanedRefs([floor("a", ["r0"]), floor("b", ["r0"])], "a")).toEqual([]);
    // once the last floor holding it goes, the image is orphaned
    expect(orphanedRefs([floor("b", ["r0"])], "b")).toEqual(["r0"]);
  });

  it("lists a ref once, and nothing for an unknown floor", () => {
    expect(orphanedRefs([floor("a", ["r0", "r0"])], "a")).toEqual(["r0"]);
    expect(orphanedRefs([floor("a", ["r0"])], "zzz")).toEqual([]);
  });
});

describe("areas drawn on a sheet", () => {
  const page = { w: 2000, h: 1000 };

  it("a dragged rectangle is clamped to the page", () => {
    expect(regionFromRect({ x: -50, y: 10, w: 900, h: 2000 }, page)).toEqual({
      rect: { x: 0, y: 10, w: 850, h: 990 },
    });
  });

  it("a stray click or a sliver is not an area", () => {
    expect(regionFromRect({ x: 100, y: 100, w: 3, h: 300 }, page)).toBeNull();
    expect(regionFromRect({ x: 5000, y: 0, w: 100, h: 100 }, page)).toBeNull();
  });

  it("clicked corners are an outline, with their bounding box as the rect", () => {
    const pts = [
      { x: 100, y: 100 },
      { x: 900, y: 150 },
      { x: 700, y: 800 },
      { x: 120, y: 600 },
    ];
    expect(regionFromPoints(pts, page)).toEqual({
      rect: { x: 100, y: 100, w: 800, h: 700 },
      shape: pts,
    });
  });

  it("clamps outline corners to the page", () => {
    const r = regionFromPoints(
      [
        { x: -100, y: 100 },
        { x: 500, y: 100 },
        { x: 500, y: 1500 },
      ],
      page
    )!;
    expect(r.shape).toEqual([
      { x: 0, y: 100 },
      { x: 500, y: 100 },
      { x: 500, y: 1000 },
    ]);
    expect(r.rect).toEqual({ x: 0, y: 100, w: 500, h: 900 });
  });

  it("two corners, a line of corners, or a speck is not an area", () => {
    expect(regionFromPoints([{ x: 0, y: 0 }, { x: 500, y: 500 }], page)).toBeNull();
    expect(
      regionFromPoints([{ x: 0, y: 0 }, { x: 250, y: 250 }, { x: 500, y: 500 }], page)
    ).toBeNull();
    expect(
      regionFromPoints([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }], page)
    ).toBeNull();
  });

  it("an area's outline is its corners, or the rectangle's four", () => {
    expect(regionOutline({ rect: { x: 10, y: 20, w: 30, h: 40 } })).toEqual([
      { x: 10, y: 20 },
      { x: 40, y: 20 },
      { x: 40, y: 60 },
      { x: 10, y: 60 },
    ]);
    const shape = [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 0, y: 9 }];
    expect(regionOutline({ rect: { x: 0, y: 0, w: 9, h: 9 }, shape })).toBe(shape);
  });

  it("withRegion sets the crop and outline, and a rectangle clears an old outline", () => {
    const sheet = {
      id: "s",
      imageRef: "r",
      pageNumber: 1,
      name: "s",
      width: 2000,
      height: 1000,
      x: 0,
      y: 0,
    };
    const shape = [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 0, y: 900 }];
    const free = withRegion(sheet, { rect: { x: 0, y: 0, w: 900, h: 900 }, shape });
    expect(free.crop).toEqual({ x: 0, y: 0, w: 900, h: 900 });
    expect(free.shape).toBe(shape);
    const rect = withRegion(free, { rect: { x: 5, y: 5, w: 50, h: 50 } });
    expect(rect.crop).toEqual({ x: 5, y: 5, w: 50, h: 50 });
    expect("shape" in rect).toBe(false);
  });
});

describe("splitFloorOffSheet", () => {
  const sheet = {
    id: "sht_a",
    imageRef: "org/o1/p1.png",
    pageNumber: 1,
    name: "Both levels",
    width: 2000,
    height: 1000,
    x: 30,
    y: 40,
  };
  const mk = () => {
    const d = createDesign({ name: "Split", mode: "plan" });
    d.floors.push(
      {
        id: "flr_g",
        name: "Ground floor",
        level: 0,
        heightM: 3.2,
        scaleMmPerUnit: 12,
        northDeg: 45,
        northPos: { x: 1500, y: 100 },
        plans: [sheet],
      },
      {
        id: "flr_1",
        name: "Level 1",
        level: 1,
        scaleMmPerUnit: 10,
        northDeg: null,
        northPos: null,
        plans: [],
      }
    );
    return d;
  };
  const ids = { newFloorId: "flr_new", newSheetId: "sht_new" };
  const left = { rect: { x: 0, y: 0, w: 900, h: 1000 } };
  const right = { rect: { x: 1000, y: 0, w: 1000, h: 1000 } };
  const run = (over: Partial<Parameters<typeof splitFloorOffSheet>[1]> = {}, doc = mk()) =>
    splitFloorOffSheet(doc, {
      floorId: "flr_g",
      sheetId: "sht_a",
      keep: left,
      other: right,
      place: "above",
      ...ids,
      ...over,
    });

  it("keeps the first area on this floor and gives the second to a new floor above", () => {
    const out = run();
    const g = out.floors.find((f) => f.id === "flr_g")!;
    const nf = out.floors.find((f) => f.id === "flr_new")!;
    expect(g.plans[0].crop).toEqual(left.rect);
    expect(nf.plans).toHaveLength(1);
    expect(nf.plans[0]).toMatchObject({
      id: "sht_new",
      imageRef: "org/o1/p1.png", // same image — nothing re-uploaded
      x: 30,
      y: 40,
      width: 2000,
      height: 1000,
      crop: right.rect,
    });
    // above the ground floor: level 1 → the old Level 1 moves up to 2
    expect([g.level, nf.level]).toEqual([0, 1]);
    expect(out.floors.find((f) => f.id === "flr_1")).toMatchObject({ level: 2, name: "Level 2" });
    expect(nf.name).toBe("Level 1");
  });

  it("the areas needn't be strips: a diagonal pair lands on the floors they were drawn for", () => {
    // top-left for this floor, bottom-right for the new one — the old "rest of
    // the page" guess gave the new floor the wrong arm of the L
    const tl = { rect: { x: 0, y: 0, w: 800, h: 450 } };
    const br = { rect: { x: 1200, y: 550, w: 800, h: 450 } };
    const out = run({ keep: tl, other: br });
    expect(out.floors.find((f) => f.id === "flr_g")!.plans[0].crop).toEqual(tl.rect);
    expect(out.floors.find((f) => f.id === "flr_new")!.plans[0].crop).toEqual(br.rect);
  });

  it("a freeform area is stored as its outline, with the bounding box as the crop", () => {
    const shape = [
      { x: 1000, y: 0 },
      { x: 2000, y: 0 },
      { x: 2000, y: 600 },
      { x: 1400, y: 1000 },
    ];
    const other = { rect: { x: 1000, y: 0, w: 1000, h: 1000 }, shape };
    const out = run({ other });
    const nf = out.floors.find((f) => f.id === "flr_new")!;
    expect(nf.plans[0].crop).toEqual(other.rect);
    expect(nf.plans[0].shape).toBe(shape);
    // this floor's rectangle carries no outline
    expect(out.floors.find((f) => f.id === "flr_g")!.plans[0].shape).toBeUndefined();
  });

  it("splitting an already-freeform sheet replaces its outline", () => {
    const d = mk();
    d.floors[0].plans[0] = {
      ...sheet,
      crop: { x: 0, y: 0, w: 500, h: 500 },
      shape: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 0, y: 500 }],
    };
    const out = run({}, d);
    expect("shape" in out.floors.find((f) => f.id === "flr_g")!.plans[0]).toBe(false);
    expect("shape" in out.floors.find((f) => f.id === "flr_new")!.plans[0]).toBe(false);
  });

  it("below: the new floor takes this level and this floor moves up with its name", () => {
    const out = run({ place: "below" });
    const g = out.floors.find((f) => f.id === "flr_g")!;
    const nf = out.floors.find((f) => f.id === "flr_new")!;
    expect([nf.level, nf.name]).toEqual([0, "Ground floor"]);
    // a floor on its position's default name follows it up — never "Ground floor" at L1
    expect([g.level, g.name]).toEqual([1, "Level 1"]);
    expect(out.floors.find((f) => f.id === "flr_1")).toMatchObject({ level: 2, name: "Level 2" });
  });

  it("leaves a typed floor name alone when its level moves", () => {
    const d = mk();
    d.floors[0].name = "Plant deck";
    const out = run({ place: "below" }, d);
    expect(out.floors.find((f) => f.id === "flr_g")!.name).toBe("Plant deck");
  });

  it("carries scale, height and north across; the arrow goes with its area", () => {
    // arrow at world x 1500 = sheet x 1470, inside the right area
    const nf = run().floors.find((f) => f.id === "flr_new")!;
    expect(nf).toMatchObject({ scaleMmPerUnit: 12, heightM: 3.2, northDeg: 45, northPos: { x: 1500, y: 100 } });
    // new floor takes the left area instead → no arrow there
    const out2 = run({ keep: right, other: left });
    expect(out2.floors.find((f) => f.id === "flr_new")!.northPos).toBeNull();
  });

  it("changes nothing else: other sheets, rooms and the import session stay put", () => {
    const d = mk();
    d.floors[0].plans.push({ ...sheet, id: "sht_b", imageRef: "org/o1/p2.png", x: 3000 });
    const out = run({}, d);
    const g = out.floors.find((f) => f.id === "flr_g")!;
    expect(g.plans.map((s) => s.id)).toEqual(["sht_a", "sht_b"]);
    expect(g.plans[1].crop).toBeUndefined();
    expect(out.objects).toBe(d.objects);
    expect(out.planImport).toBe(d.planImport);
  });

  it("returns the document untouched when the ids don't match", () => {
    const d = mk();
    expect(run({ floorId: "nope" }, d)).toBe(d);
    expect(run({ sheetId: "nope" }, d)).toBe(d);
  });
});

describe("sharedPlanRefs", () => {
  const f = (id: string, refs: string[]): Floor => ({
    id,
    name: id,
    level: 0,
    scaleMmPerUnit: 10,
    northDeg: null,
    northPos: null,
    plans: refs.map((r, i) => ({
      id: `${id}_${i}`,
      imageRef: r,
      pageNumber: 1,
      name: r,
      width: 100,
      height: 100,
      x: 0,
      y: 0,
    })),
  });

  it("names the images this floor shares with another floor", () => {
    const floors = [f("a", ["r0", "r1"]), f("b", ["r0"]), f("c", ["r9"])];
    expect([...sharedPlanRefs(floors, "a")]).toEqual(["r0"]);
    expect([...sharedPlanRefs(floors, "c")]).toEqual([]);
    expect([...sharedPlanRefs(floors, "zzz")]).toEqual([]);
  });
});
