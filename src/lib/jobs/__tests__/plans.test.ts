import type { PlanReading, SheetReading } from "@/lib/studio/reading";
import { designFromPlan, designFromPlans, floorNamesOf, guessPageByWords, levelOfTitle, pagesWordOf, planLine, planReadLine, stackLevels, stateOfRead, startablePlans, type JobPlan, type JobPlanPage, type JobPlanRead } from "../plans";

/* PLANS ON THE JOB, the pure side (lib/jobs/plans.ts): which pages are
   floors by their words, what a read came to, what the row says, and a
   design made from a plan with Tiff's reading moved onto its floors. */

const words = (...texts: string[]) => texts.map((text) => ({ text, at: { x: 0, y: 0 } }));

const page = (n: number, over: Partial<JobPlanPage> = {}): JobPlanPage => ({
  n,
  kind: "floor",
  name: n === 3 ? "Ground floor" : "Level 1",
  level: n === 3 ? 0 : 1,
  ref: `org/o1/plan_${n}.png`,
  preview: `org/o1/pv_${n}.jpeg`,
  width: 2400,
  height: 1697,
  mmPerPx: 17.52,
  scale: "1:50 @ A1",
  ...over,
});

const room = (name: string): SheetReading["spaces"][number] => ({ name, named: true, kind: "room", outline: [], written: "", existing: false, openTo: "", stair: "" });
const sheet = (id: string, rooms: string[]): SheetReading => ({ sheetId: id, spaces: rooms.map(room), openings: [], marks: [], furniture: [], checklist: [], flags: [], planUp: "" });

const reading = (over: Partial<PlanReading> = {}): PlanReading => ({
  at: "2026-11-09T02:14:00Z",
  model: "claude-opus-5-5",
  floors: { p3: [sheet("p3", ["Living", "Kitchen", "Bed 1"])], p4: [sheet("p4", ["Bed 2", "Bed 3"])] },
  failed: [],
  roof: { levels: [{ floorId: "p3", ceilingMm: 2700, floorZoneMm: 300, source: "section A" }], parts: [], raked: [], material: "tiles", roofSpace: "" },
  site: { floorId: "p3", sheetId: "p3", boundary: [], surfaces: [], street: null, neighbours: [], fences: [] },
  ...over,
});

const plan = (over: Partial<JobPlanRead> = {}): JobPlanRead => ({
  id: "jplan_1",
  jobUuid: "job-1",
  documentId: "doc-1",
  attachmentId: null,
  name: "90 bondi BEACH- Suttor.pdf",
  sourceRef: "org/o1/plan_src.pdf",
  sourceKind: "pdf",
  pageCount: 4,
  pages: [page(1, { kind: "other", name: "", level: null, ref: null, preview: null }), page(2, { kind: "site", name: "", level: null, ref: null, preview: null }), page(3), page(4)],
  reading: reading(),
  state: "read",
  said: null,
  addedBy: "Isaac Smith",
  addedAt: "2026-11-09T01:00:00Z",
  readAt: "2026-11-09T02:14:00Z",
  thumbs: { 3: "https://x/3", 4: "https://x/4" },
  usedBy: 2,
  ...over,
});

describe("which pages are floors, by their words", () => {
  it("reads the title block's kind of plan and its level", () => {
    expect(guessPageByWords(words("SUTTOR", "GROUND FLOOR PLAN", "1:100 @ A3", "A-103"))).toEqual({ kind: "floor", name: "Ground floor", level: 0 });
    expect(guessPageByWords(words("FIRST FLOOR PLAN"))).toEqual({ kind: "floor", name: "Level 1", level: 1 });
    expect(guessPageByWords(words("LEVEL 2 PLAN"))).toEqual({ kind: "floor", name: "Level 2", level: 2 });
    expect(guessPageByWords(words("BASEMENT PLAN"))).toEqual({ kind: "floor", name: "Basement", level: -1 });
    expect(guessPageByWords(words("SITE PLAN", "1:200"))).toEqual({ kind: "site", name: "", level: null });
    expect(guessPageByWords(words("ROOF PLAN"))).toEqual({ kind: "roof", name: "", level: null });
    expect(guessPageByWords(words("NORTH ELEVATION", "SOUTH ELEVATION"))).toEqual({ kind: "elevation", name: "", level: null });
    expect(guessPageByWords(words("SECTION A-A"))).toEqual({ kind: "section", name: "", level: null });
  });
  it("leaves a plan of something other than the rooms out, and says nothing of a page with no words", () => {
    expect(guessPageByWords(words("GROUND FLOOR DEMOLITION PLAN"))).toEqual({ kind: "other", name: "", level: null });
    expect(guessPageByWords(words("GROUND FLOOR ELECTRICAL PLAN"))).toEqual({ kind: "other", name: "", level: null });
    expect(guessPageByWords(words("COVER SHEET", "DRAWING LIST"))).toBeNull();
    expect(guessPageByWords([])).toBeNull();
    expect(guessPageByWords(null)).toBeNull();
  });
  it("names the levels a title can carry", () => {
    expect(levelOfTitle("LOWER GROUND FLOOR PLAN")).toEqual({ level: -1, name: "Lower ground" });
    expect(levelOfTitle("MEZZANINE PLAN")).toEqual({ level: 1, name: "Mezzanine" });
    expect(levelOfTitle("L3 PLAN")).toEqual({ level: 3, name: "Level 3" });
    expect(levelOfTitle("DETAILS")).toBeNull();
  });
  it("stacks two floors that share a level", () => {
    const out = stackLevels([
      { n: 3, kind: "floor" as const, level: 0 },
      { n: 4, kind: "floor" as const, level: 0 },
      { n: 5, kind: "site" as const, level: null },
    ]);
    expect(out.map((p) => p.level)).toEqual([0, 1, null]);
  });
});

describe("what the read came to", () => {
  it("is Read when every floor read as one", () => {
    expect(stateOfRead(plan().pages, reading())).toEqual({ state: "read", said: null });
  });
  it("asks for a look when a page read has no rooms on it, or a page failed", () => {
    expect(stateOfRead(plan().pages, reading({ floors: { p3: [sheet("p3", ["Living", "Kitchen"])], p4: [sheet("p4", [])] } }))).toEqual({
      state: "check",
      said: "Page 4 has no rooms on it, so it may not be a floor plan",
    });
    expect(stateOfRead(plan().pages, reading({ failed: [{ floorId: "p4", sheetId: "p4", reason: "Tiff declined to read this plan" }] })).said).toBe("Page 4 couldn't be read: Tiff declined to read this plan");
  });
  it("asks for a look when the set had no floor plan, and fails without a reading", () => {
    expect(stateOfRead([page(1, { kind: "other", ref: null })], reading({ floors: {} }))).toEqual({ state: "check", said: "No floor plan found on its page" });
    expect(stateOfRead(plan().pages, null).state).toBe("failed");
  });
});

describe("what the row says", () => {
  it("names the floors, the roof and the site, when, and who uses it", () => {
    expect(floorNamesOf(plan())).toBe("Ground floor and Level 1");
    expect(planLine(plan())).toBe("Ground floor and Level 1, the roof and the site, read on Mon 9 Nov. Used by 2 designs");
    expect(planLine(plan({ usedBy: 1, reading: reading({ roof: null, site: null }) }))).toBe("Ground floor and Level 1, read on Mon 9 Nov. Used by 1 design");
  });
  it("says who is adding it while Tiff reads", () => {
    expect(planLine(plan({ state: "reading", reading: null, readAt: null, usedBy: 0 }), "2026-11-09")).toBe("Added to Plans by Isaac Smith today");
    expect(planLine(plan({ state: "reading", reading: null, readAt: null, usedBy: 0, addedBy: null }), "2026-11-10")).toBe("Added to Plans Mon 9 Nov");
  });
  it("says what was read and what to check", () => {
    expect(planLine(plan({ state: "check", said: "Page 4 has no rooms on it, so it may not be a floor plan", usedBy: 0 }))).toBe(
      "Pages 3 and 4 read: Ground floor and Level 1, the roof and the site. Page 4 has no rooms on it, so it may not be a floor plan"
    );
    expect(planLine(plan({ state: "failed", said: "The plans couldn't be read: the file couldn't be fetched", usedBy: 0 }))).toBe("Couldn't be read: the file couldn't be fetched");
    expect(pagesWordOf([4, 3])).toBe("Pages 3 and 4");
  });
  it("tells New design the rooms she found", () => {
    expect(planReadLine(plan())).toBe("Read on Mon 9 Nov: Ground floor and Level 1, 5 rooms, the roof and the site");
    expect(planReadLine(plan({ reading: reading({ floors: { p3: [sheet("p3", ["A", "B"])], p4: [sheet("p4", ["C", "D"])] } }) }))).toBe("Read on Mon 9 Nov: Ground floor and Level 1, 2 rooms each, the roof and the site");
    expect(planReadLine(plan({ state: "reading", reading: null }))).toBe("Tiff is reading the plans");
  });
  it("offers a read plan to start from, not one still being read", () => {
    expect(startablePlans([plan(), plan({ id: "b", state: "reading", reading: null }), plan({ id: "c", state: "check" })]).map((p) => p.id)).toEqual(["jplan_1", "c"]);
  });
});

describe("a design from a plan", () => {
  it("makes a floor per floor page at its level, the sheet its raster, the scale the title block's", () => {
    const made = designFromPlan(plan());
    expect(made.floors.map((f) => [f.name, f.level, f.scaleMmPerUnit])).toEqual([
      ["Ground floor", 0, 17.52],
      ["Level 1", 1, 17.52],
    ]);
    expect(made.floors[0].plans).toHaveLength(1);
    expect(made.floors[0].plans[0]).toMatchObject({ imageRef: "org/o1/plan_3.png", pageNumber: 3, width: 2400, height: 1697 });
    expect(made.planImport).toMatchObject({ sources: [{ ref: "org/o1/plan_src.pdf", kind: "pdf" }], chosen: [2, 3], jobPlanId: "jplan_1" });
    expect(made.planImport.placed).toEqual({ 2: "org/o1/plan_3.png", 3: "org/o1/plan_4.png" });
  });
  it("moves her reading onto the design's floors and sheets, points untouched", () => {
    const made = designFromPlan(plan());
    const [ground, level1] = made.floors;
    expect(Object.keys(made.reading!.floors).sort()).toEqual([ground.id, level1.id].sort());
    expect(made.reading!.floors[ground.id][0].sheetId).toBe(ground.plans[0].id);
    expect(made.reading!.floors[ground.id][0].spaces.map((s) => s.name)).toEqual(["Living", "Kitchen", "Bed 1"]);
    expect(made.reading!.roof!.levels[0]).toMatchObject({ floorId: ground.id, ceilingMm: 2700 });
    expect(made.reading!.site).toMatchObject({ floorId: ground.id, sheetId: ground.plans[0].id });
  });
  it("leaves the reading off a plan that has none", () => {
    expect(designFromPlan(plan({ reading: null })).reading).toBeNull();
  });
  it("stacks a second plan's floors above the first's", () => {
    const two = plan({ id: "jplan_2", pages: [page(3), page(4)] });
    const made = designFromPlans([plan(), two]);
    expect(made.floors.map((f) => f.level)).toEqual([0, 1, 2, 3]);
    expect(Object.keys(made.reading!.floors)).toHaveLength(4);
    expect(made.planImport.jobPlanId).toBe("jplan_1");
  });
  it("makes nothing from no plans", () => {
    expect(designFromPlans([]).floors).toEqual([]);
  });
});

/* the JobPlan type is the row as stored; a read adds thumbs and use */
const _typed: JobPlan = plan();
void _typed;
