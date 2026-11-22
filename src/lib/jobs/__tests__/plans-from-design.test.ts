import { createDesign, type DesignDocument, type Floor, type PlanSheet } from "@/lib/studio/document";
import type { PlanReading, SheetReading } from "@/lib/studio/reading";
import { designFromPlan, pageKey, stateOfRead, type JobPlan } from "../plans";
import { designPlanGroups, designPlanLine, needsCounts, planFromGroup, sourceStarts } from "../plans-from-design";

/* LINKING MOVES A DESIGN'S PLANS ONTO THE JOB (plans-from-design.ts): each
   file the design was given becomes one of the job's plans, its pages the
   design's own pictures at their floors, her reading moved from the design's
   floors and sheets onto the plan's pages, so nothing is read twice. */

const sheet = (id: string, imageRef: string, pageNumber: number | null, over: Partial<PlanSheet> = {}): PlanSheet => ({ id, imageRef, pageNumber, name: id, width: 2000, height: 1400, x: 0, y: 0, ...over });
const floor = (id: string, name: string, level: number, plans: PlanSheet[], scale: number | null = null): Floor => ({ id, name, level, scaleMmPerUnit: scale, northDeg: null, northPos: null, plans });
const read = (sheetId: string, rooms: string[]): SheetReading =>
  ({ sheetId, spaces: rooms.map((name) => ({ name, named: true, kind: "room", outline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], written: "", existing: false, openTo: "", stair: "" })), openings: [], marks: [], furniture: [], checklist: [], flags: [], planUp: "N" }) as unknown as SheetReading;

/** A design given one PDF of four pages: page 2 the ground floor, page 3 level 1. */
function twoStorey(): DesignDocument {
  const d = createDesign({ name: "7 Ipsum Rd", mode: "plan" as never, now: "2026-11-15T00:00:00Z" });
  d.floors = [floor("flr_l1", "Level 1", 1, [sheet("sht_l1", "org/o/p3.png", 3)]), floor("flr_gf", "Ground floor", 0, [sheet("sht_gf", "org/o/p2.png", 2, { crop: { x: 10, y: 20, w: 1800, h: 1200 } })], 20)];
  d.planImport = {
    sources: [{ ref: "org/o/set.pdf", kind: "pdf", name: "Ipsum DA set.pdf" }],
    placed: { 1: "org/o/p2.png", 2: "org/o/p3.png" },
    chosen: [1, 2],
    names: {},
    words: { 1: [{ text: "GROUND FLOOR PLAN", at: { x: 5, y: 5 } }] },
    measured: { 2: { mmPerPx: 12.5, from: "the 7440 mm printed", sure: true } },
  };
  d.reading = {
    at: "2026-11-14T00:00:00Z",
    model: "m",
    floors: { flr_gf: [read("sht_gf", ["Living", "Bed 1", "Bath"])], flr_l1: [read("sht_l1", ["Bed 2", "Bed 3"])] },
    failed: [],
    roof: { levels: [{ floorId: "flr_gf", ceilingMm: 2700, floorZoneMm: 300, source: "" }], parts: [{ floorId: "flr_l1", sheetId: "sht_l1" } as never], raked: [], material: "tile", roofSpace: "" },
    site: { floorId: "flr_gf", sheetId: "sht_gf", boundary: [], surfaces: [], street: null, neighbours: [], fences: [] },
  } as PlanReading;
  return d;
}

describe("the design's files, as the job's plans", () => {
  it("is one plan per file, its pages at their page in the set, lowest floor first", () => {
    const [g, ...more] = designPlanGroups(twoStorey());
    expect(more).toHaveLength(0);
    expect(g.name).toBe("Ipsum DA set.pdf");
    expect(g.sourceRef).toBe("org/o/set.pdf");
    expect(g.pages.map((p) => [p.n, p.floor.name])).toEqual([
      [2, "Ground floor"],
      [3, "Level 1"],
    ]);
  });

  it("names a file the design kept no name for after the design", () => {
    const d = twoStorey();
    d.planImport!.sources[0] = { ref: "org/o/set.pdf", kind: "pdf" };
    expect(designPlanGroups(d)[0].name).toBe("7 Ipsum Rd plans.pdf");
  });

  it("tells two files apart by where their pages sit, or by their counts", () => {
    const d = twoStorey();
    /* a photo dropped in first, then the PDF: the PDF's pages start at index 1 */
    d.planImport = { ...d.planImport!, sources: [{ ref: "org/o/photo.jpeg", kind: "image" }, { ref: "org/o/set.pdf", kind: "pdf" }], placed: { 0: "org/o/photo.png", 2: "org/o/p2.png", 3: "org/o/p3.png" } };
    d.floors.push(floor("flr_b", "Basement", -1, [sheet("sht_b", "org/o/photo.png", null)]));
    expect(sourceStarts(d)).toEqual([0, 1]);
    const groups = designPlanGroups(d);
    expect(groups.map((g) => [g.sourceRef, g.pages.map((p) => p.n)])).toEqual([
      ["org/o/photo.jpeg", [1]],
      ["org/o/set.pdf", [2, 3]],
    ]);
    expect(groups[0].name).toBe("7 Ipsum Rd plans 1.jpeg");
  });

  it("asks for the counts when a file with no page used hides where the next starts", () => {
    const d = twoStorey();
    d.planImport = { ...d.planImport!, sources: [{ ref: "org/o/spec.pdf", kind: "pdf" }, { ref: "org/o/set.pdf", kind: "pdf" }], placed: { 6: "org/o/p2.png", 7: "org/o/p3.png" } };
    expect(needsCounts(d)).toBe(true);
    expect(designPlanGroups(d, [5, 4]).map((g) => [g.sourceRef, g.pageCount])).toEqual([["org/o/set.pdf", 4]]);
  });

  it("puts a page with no file to go by on as its own picture", () => {
    const d = twoStorey();
    d.planImport = null;
    const groups = designPlanGroups(d);
    expect(groups.map((g) => [g.sourceRef, g.sourceKind, g.name])).toEqual([
      ["org/o/p2.png", "image", "7 Ipsum Rd, Ground floor.png"],
      ["org/o/p3.png", "image", "7 Ipsum Rd, Level 1.png"],
    ]);
  });
});

describe("Link job's line", () => {
  it("says the floors and the rooms read, and that it isn't read again", () => {
    const d = twoStorey();
    expect(designPlanLine(d, designPlanGroups(d)[0])).toBe("Ground floor and Level 1, 5 rooms, as read in this design. Not read again");
  });

  it("says Tiff reads one the design never read", () => {
    const d = { ...twoStorey(), reading: null };
    expect(designPlanLine(d, designPlanGroups(d)[0])).toBe("Ground floor and Level 1. Tiff reads it on the job");
  });
});

describe("the plan made", () => {
  const made = (d = twoStorey()) => planFromGroup(d, designPlanGroups(d)[0], { previews: new Map([[2, "org/o/small2.jpeg"]]), by: "Isaac Smith", at: "2026-11-15T01:00:00Z" });

  it("has the design's pictures for its pages, with their words, crops and scales", () => {
    const { pages } = made();
    const [gf, l1] = pages;
    expect(gf).toMatchObject({ n: 2, kind: "floor", name: "Ground floor", level: 0, ref: "org/o/p2.png", preview: "org/o/small2.jpeg", trim: { x: 10, y: 20, w: 1800, h: 1200 } });
    expect(gf.words).toHaveLength(1);
    /* the ground floor's scale was set in the design: kept as set there */
    expect(gf.set).toMatchObject({ mmPerPx: 20, mm: null, by: "Isaac Smith" });
    /* level 1's is the one she measured: kept as hers */
    expect(l1.measured).toEqual({ mmPerPx: 12.5, from: "the 7440 mm printed", sure: true });
    expect(l1.set).toBeUndefined();
  });

  it("has her reading moved onto its pages, roof and site with them", () => {
    const { reading } = made();
    expect(Object.keys(reading!.floors).sort()).toEqual([pageKey(2), pageKey(3)]);
    expect(reading!.floors[pageKey(2)][0].sheetId).toBe(pageKey(2));
    expect(reading!.roof!.levels[0].floorId).toBe(pageKey(2));
    expect(reading!.roof!.parts[0]).toMatchObject({ floorId: pageKey(3), sheetId: pageKey(3) });
    expect(reading!.site).toMatchObject({ floorId: pageKey(2), sheetId: pageKey(2) });
  });

  it("reads as Read on the job, and makes the same design back", () => {
    const d = twoStorey();
    const { pages, reading } = made(d);
    expect(stateOfRead(pages, reading).state).toBe("read");
    const plan: JobPlan = { id: "jplan_1", jobUuid: "j", documentId: "d", attachmentId: null, name: "x", sourceRef: "org/o/set.pdf", sourceKind: "pdf", pageCount: 4, pages, reading, state: "read", said: null, addedBy: null, addedAt: "", readAt: "" };
    const back = designFromPlan(plan);
    expect(back.floors.map((f) => [f.name, f.level, f.plans[0].imageRef, f.scaleMmPerUnit])).toEqual([
      ["Ground floor", 0, "org/o/p2.png", 20],
      ["Level 1", 1, "org/o/p3.png", null],
    ]);
    const rooms = Object.values(back.reading!.floors).flat().flatMap((s) => s.spaces.map((sp) => sp.name));
    expect(rooms.sort()).toEqual(["Bath", "Bed 1", "Bed 2", "Bed 3", "Living"]);
  });

  it("has no reading for a design never read, so the job reads it", () => {
    expect(made({ ...twoStorey(), reading: null }).reading).toBeNull();
  });
});
