import type { PlanReading, SheetReading } from "@/lib/studio/reading";
import { areaM2Of, chooseFloors, floorLevelOf, choosablePages, designFromPlan, floorOptions, floorValueOf, designFromPlans, floorNamesOf, guessPageByWords, levelOfTitle, pagesWordOf, planLine, planReadLine, planStateWord, replacedBy, scaleAsks, scaleSaid, stackLevels, stateOfRead, startablePlans, type JobPlan, type JobPlanPage, type JobPlanRead } from "../plans";

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
  name: "90 fictonia BEACH- Fictor.pdf",
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
    expect(guessPageByWords(words("FICTOR", "GROUND FLOOR PLAN", "1:100 @ A3", "A-103"))).toEqual({ kind: "floor", name: "Ground floor", level: 0 });
    expect(guessPageByWords(words("FIRST FLOOR PLAN"))).toEqual({ kind: "floor", name: "Level 1", level: 1 });
    /* 3570's CDC set (20 November 2026): the house's floors in the architect's shorthand */
    expect(guessPageByWords(words("B", "307 DESERUNT ROAD", "1103", "LGF PLAN", "A101"))).toEqual({ kind: "floor", name: "Lower ground", level: -1 });
    expect(guessPageByWords(words("B", "307 DESERUNT ROAD", "1103", "GF PLAN", "A102"))).toEqual({ kind: "floor", name: "Ground floor", level: 0 });
    expect(guessPageByWords(words("B", "307 DESERUNT ROAD", "1103", "FF PLAN", "A103"))).toEqual({ kind: "floor", name: "Level 1", level: 1 });
    expect(guessPageByWords(words("2ND FLOOR PLAN"))).toEqual({ kind: "floor", name: "Level 2", level: 2 });
    /* and a building of its own on the site isn't taken for a floor of the house, so the 3D doesn't stack it on top */
    expect(guessPageByWords(words("GARGE GROUND FLOOR PLAN", "1", "GARAGE PLAN", "A105"))).toEqual({ kind: "other", name: "", level: null });
    expect(guessPageByWords(words("POOL & CABANA GROUND FLOOR PLAN", "1", "POOL & CABANA PLAN", "A106"))).toEqual({ kind: "other", name: "", level: null });
    /* a room's name beside a house's plan doesn't make it another building's */
    expect(guessPageByWords(words("POOL", "GROUND FLOOR PLAN", "A102"))).toEqual({ kind: "floor", name: "Ground floor", level: 0 });
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
    expect(planLine(plan())).toBe("Ground floor and Level 1, the roof and the site, read on Mon 9 Nov. Scaled off its printed scale, 1:50 @ A1. Used by 2 designs");
    expect(planLine(plan({ usedBy: 1, reading: reading({ roof: null, site: null }) }))).toBe("Ground floor and Level 1, read on Mon 9 Nov. Scaled off its printed scale, 1:50 @ A1. Used by 1 design");
  });
  it("says who is adding it while Tiff reads", () => {
    expect(planLine(plan({ state: "reading", reading: null, readAt: null, usedBy: 0 }), "2026-11-09")).toBe("Added to Plans by Isaac Smith today");
    expect(planLine(plan({ state: "reading", reading: null, readAt: null, usedBy: 0, addedBy: null }), "2026-11-10")).toBe("Added to Plans Mon 9 Nov");
  });
  it("says what was read and what to check", () => {
    expect(planLine(plan({ state: "check", said: "Page 4 has no rooms on it, so it may not be a floor plan", usedBy: 0 }))).toBe(
      "Pages 3 and 4 read: Ground floor and Level 1, the roof and the site. Page 4 has no rooms on it, so it may not be a floor plan. Scaled off its printed scale, 1:50 @ A1"
    );
    expect(planLine(plan({ state: "failed", said: "The plans couldn't be read: the file couldn't be fetched", usedBy: 0 }))).toBe("Couldn't be read: the file couldn't be fetched");
    expect(pagesWordOf([4, 3])).toBe("Pages 3 and 4");
  });
  it("says which of a specification's pages were read for the air", () => {
    const spec = plan({ kind: "spec", pages: [], reading: null, usedBy: 0, spec: { pages: [178, 179, 180, 181, 185], words: "" } });
    expect(planLine(spec)).toBe("The specification's pages 178 to 181 and 185 read for air, ventilation and exhaust, on Mon 9 Nov");
    expect(planLine({ ...spec, state: "check", said: "No page names the air conditioning, ventilation or exhaust" })).toBe("No page names the air conditioning, ventilation or exhaust");
  });
  it("tells New design the rooms she found", () => {
    expect(planReadLine(plan())).toBe("Read on Mon 9 Nov: Ground floor and Level 1, 5 rooms, the roof and the site. Scaled off its printed scale, 1:50 @ A1");
    expect(planReadLine(plan({ reading: reading({ floors: { p3: [sheet("p3", ["A", "B"])], p4: [sheet("p4", ["C", "D"])] } }) }))).toBe("Read on Mon 9 Nov: Ground floor and Level 1, 2 rooms each, the roof and the site. Scaled off its printed scale, 1:50 @ A1");
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
  it("carries Tiff's measured scale for a page that prints none, and leaves the floor unscaled", () => {
    const photo = plan({
      sourceKind: "image",
      pages: [page(1, { name: "Ground floor", level: 0, ref: "org/o1/plan_1.png", width: 855, height: 1183, mmPerPx: null, scale: null, measured: { mmPerPx: 37.037, from: "the 5000 mm printed on it", sure: false } })],
      reading: null,
    });
    const made = designFromPlan(photo);
    expect(made.floors[0].scaleMmPerUnit).toBeNull();
    expect(made.planImport.measured).toEqual({ 0: { mmPerPx: 37.037, from: "the 5000 mm printed on it", sure: false } });
    expect(designFromPlan(plan()).planImport.measured).toBeUndefined();
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

/* THE SCALE A READ PLAN RESTS ON (Isaac, 14 November 2026: "Like plans
   uploaded, tiff read but scale is incomplete?", "Yep"): a page with none
   to be had asks for one, one resting on a single printed figure can be
   checked, and a scale somebody set is the page's from then on. */
describe("a read plan's scale", () => {
  const photo = (over: Partial<JobPlanPage> = {}) => page(3, { mmPerPx: null, scale: null, measured: null, ...over });
  const one = (pages: JobPlanPage[], over: Partial<JobPlanRead> = {}) => plan({ pages, reading: reading({ floors: { p3: [sheet("p3", ["Living", "Kitchen", "Bed 1"])] }, roof: null, site: null }), usedBy: 0, ...over });
  const measured = { mmPerPx: 9.5, from: "the 7440, 3300 and 2400 mm printed on it", sure: true };

  it("asks for a scale on a page with none to be had, in orange", () => {
    const p = one([photo()]);
    expect(scaleAsks(p)).toEqual([{ n: 3, ask: "set" }]);
    expect(planStateWord(p)).toEqual({ word: "Scale needed", tone: "look" });
    expect(planLine(p)).toBe("Ground floor, read on Mon 9 Nov. No scale on the plan, so the rooms have no sizes");
    expect(planReadLine(p)).toBe("Read on Mon 9 Nov: Ground floor, 3 rooms. No scale on the plan, so the rooms have no sizes");
  });

  it("names the page when only one of several has no scale", () => {
    const p = plan({ pages: [page(3), page(4, { mmPerPx: null, scale: null, measured: null })] });
    expect(scaleAsks(p)).toEqual([{ n: 4, ask: "set" }]);
    expect(scaleSaid(p)).toBe("No scale on page 4, so its rooms have no sizes");
  });

  it("stays Read on one printed figure, says so, and can be checked", () => {
    const p = one([photo({ measured: { mmPerPx: 24.4, from: "the 7440 mm printed on it", sure: false } })]);
    expect(scaleAsks(p)).toEqual([{ n: 3, ask: "check" }]);
    expect(planStateWord(p)).toEqual({ word: "Read", tone: "good" });
    expect(scaleSaid(p)).toBe("Scaled off one printed figure, the 7440 mm");
  });

  it("says what a sure scale rests on, and asks nothing", () => {
    const p = one([photo({ measured })]);
    expect(scaleAsks(p)).toEqual([]);
    expect(planStateWord(p)).toEqual({ word: "Read", tone: "good" });
    expect(scaleSaid(p)).toBe("Scaled off the 7440, 3300 and 2400 mm printed on it");
  });

  it("takes the scale somebody set over every other, and names them", () => {
    const set = { mmPerPx: 10, mm: 7440, a: { x: 0, y: 0 }, b: { x: 744, y: 0 }, by: "Isaac Smith", at: "2026-11-14T00:00:00Z" };
    const p = one([photo({ set })]);
    expect(scaleAsks(p)).toEqual([]);
    expect(planStateWord(p)).toEqual({ word: "Read", tone: "good" });
    expect(scaleSaid(p)).toBe("Scaled off the 7440 mm Isaac Smith measured on it");
    /* over a printed scale too, and a design made from it starts at it */
    const printed = one([page(3, { set })]);
    expect(scaleSaid(printed)).toBe("Scaled off the 7440 mm Isaac Smith measured on it");
    expect(designFromPlan(printed).floors[0].scaleMmPerUnit).toBe(10);
    /* a scale measured in a design has no length to name */
    expect(scaleSaid(one([photo({ set: { mmPerPx: 10, mm: null, by: null, at: "2026-11-14T00:00:00Z" } })]))).toBe("Scaled off the scale someone measured in a design");
  });

  it("gives the floor area she read once every page has a scale", () => {
    const sq = (name: string, side: number): SheetReading["spaces"][number] => ({ ...room(name), outline: [{ x: 0, y: 0 }, { x: side, y: 0 }, { x: side, y: side }, { x: 0, y: side }] });
    const floors = { p3: [{ ...sheet("p3", []), spaces: [sq("Living", 500), sq("Bed 1", 300)] }] };
    /* 10 mm a pixel: 5 m by 5 m and 3 m by 3 m */
    const p = one([photo({ measured: { ...measured, mmPerPx: 10 } })], { reading: reading({ floors, roof: null, site: null }) });
    expect(areaM2Of(p)).toBe(34);
    expect(planReadLine(p)).toBe("Read on Mon 9 Nov: Ground floor, 2 rooms, 34 m². Scaled off the 7440, 3300 and 2400 mm printed on it");
    expect(areaM2Of(one([photo()], { reading: reading({ floors, roof: null, site: null }) }))).toBeNull();
  });

  it("asks nothing of a plan still being read, one that failed, or a specification", () => {
    expect(scaleAsks(one([photo()], { state: "reading", reading: null }))).toEqual([]);
    expect(scaleAsks(one([photo()], { state: "failed", reading: null }))).toEqual([]);
    expect(scaleAsks(one([photo()], { kind: "spec" }))).toEqual([]);
    expect(planStateWord(one([photo()], { state: "check", said: "Page 3 has no rooms on it" }))).toEqual({ word: "Check the read", tone: "look" });
  });

  it("carries only the scale's figures into a design, not where its line ran", () => {
    const at = { a: { x: 0, y: 0 }, b: { x: 744, y: 0 }, mm: 7440 };
    const made = designFromPlan(one([photo({ measured: { ...measured, at } })]));
    expect(made.planImport.measured).toEqual({ 2: measured });
  });
});

describe("choosing a page's floor", () => {
  it("offers a basement up to one above the top floor, by the set's names, then Not a floor plan", () => {
    expect(floorOptions(plan())).toEqual([
      { value: "-1", label: "Basement 1" },
      { value: "0", label: "Ground floor" },
      { value: "1", label: "Level 1" },
      { value: "2", label: "Level 2" },
      { value: "none", label: "Not a floor plan" },
    ]);
  });

  it("lists only the pages she drew, and where each sits in its menu", () => {
    const p = plan();
    expect(choosablePages(p).map((pg) => pg.n)).toEqual([3, 4]);
    expect(p.pages.slice(2).map(floorValueOf)).toEqual(["0", "1"]);
  });

  it("moves a page to a level by that level's name, takes one out as Not a floor plan, and marks each as looked at", () => {
    const out = chooseFloors(plan().pages, { 4: "0" }, "Isaac Smith", "2026-11-15T01:00:00Z");
    expect(out[3]).toMatchObject({ kind: "floor", level: 0, name: "Ground floor", picked: { by: "Isaac Smith", at: "2026-11-15T01:00:00Z" } });
    expect(out[2]).toMatchObject({ kind: "floor", level: 0, name: "Ground floor", picked: { by: "Isaac Smith" } });
    expect(out[0]).toEqual(plan().pages[0]);
    const none = chooseFloors(plan().pages, { 3: "none" }, null, "2026-11-15T01:00:00Z");
    expect(none[2]).toMatchObject({ kind: "other", level: null, ref: "org/o1/plan_3.png" });
    /* and back again: a floor plan at its level, called what the level's called */
    expect(chooseFloors(none, { 3: "2" }, null, "x")[2]).toMatchObject({ kind: "floor", level: 2, name: "Level 2" });
  });

  it("stops asking about a page somebody chose, and about one they said isn't a floor plan", () => {
    const thin = reading({ floors: { p3: [sheet("p3", ["Living", "Kitchen"])], p4: [sheet("p4", ["Hall"])] }, failed: [] });
    expect(stateOfRead(plan().pages, thin).state).toBe("check");
    const looked = chooseFloors(plan().pages, {}, "Isaac Smith", "x");
    expect(stateOfRead(looked, thin)).toEqual({ state: "read", said: null });
    const failed = reading({ failed: [{ floorId: "p4", sheetId: "p4", reason: "blank" }] });
    expect(stateOfRead(plan().pages, failed).state).toBe("check");
    expect(stateOfRead(chooseFloors(plan().pages, { 4: "none" }, null, "x"), failed)).toEqual({ state: "read", said: null });
  });
});

describe("a set a later one replaced", () => {
  const g = plan({ id: "g", name: "Issue G.pdf" });
  const h = plan({ id: "h", name: "Issue H.pdf", addedAt: "2026-12-02T01:00:00Z", usedBy: 0 });

  it("is replaced by the newest set read since it that draws one of its floors", () => {
    const j = plan({ id: "j", name: "Issue J.pdf", addedAt: "2026-12-09T01:00:00Z" });
    expect(replacedBy(g, [g, h])?.id).toBe("h");
    expect(replacedBy(g, [g, h, j])?.id).toBe("j");
    expect(replacedBy(h, [g, h])).toBeNull();
  });

  it("isn't replaced by a set still being read, a specification, or one with other floors", () => {
    expect(replacedBy(g, [g, { ...h, state: "reading", reading: null }])).toBeNull();
    expect(replacedBy(g, [g, { ...h, kind: "spec" }])).toBeNull();
    expect(replacedBy(g, [g, { ...h, pages: [page(1, { level: 2, name: "Level 2" })] }])).toBeNull();
  });

  it("says Replaced in grey, by which set and when, and that it's kept while a design uses it", () => {
    expect(planStateWord(g, h)).toEqual({ word: "Replaced", tone: "info" });
    expect(planLine(g, undefined, h)).toBe("Replaced by Issue H.pdf on Wed 2 Dec, and kept: 2 designs still use it");
    expect(planLine({ ...g, usedBy: 1 }, undefined, h)).toBe("Replaced by Issue H.pdf on Wed 2 Dec, and kept: a design still uses it");
    expect(planReadLine({ ...g, usedBy: 0 }, h)).toBe("Replaced by Issue H.pdf on Wed 2 Dec");
    expect(planStateWord(h, replacedBy(h, [g, h]))).toEqual({ word: "Read", tone: "good" });
  });
});


describe("a floor's printed level", () => {
  it("is the FFL it prints most, of two as often the higher, in metres however written", () => {
    expect(floorLevelOf([{ text: "FFL 194.000" }, { text: "FFL 193.850" }])).toBe(194);
    expect(floorLevelOf([{ text: "FFL" }, { text: "+60,240" }, { text: "FFL: 63,360" }, { text: "FFL: 63,360" }])).toBe(63.36);
    expect(floorLevelOf([{ text: "EX FFL +63, 315" }])).toBe(63.315);
    expect(floorLevelOf([{ text: "FINISHED FLOOR LEVEL (FFL)." }, { text: "2400" }])).toBeNull();
    expect(floorLevelOf(null)).toBeNull();
  });
  it("makes each floor as tall as the next floor's level less its own", () => {
    const made = designFromPlan(plan({ pages: [page(3, { words: [{ text: "FFL 194.000", at: { x: 1, y: 1 } }] }), page(4, { words: [{ text: "FFL 197.700", at: { x: 1, y: 1 } }] })] }));
    expect(made.floors.map((f) => f.heightM)).toEqual([3.7, undefined]);
  });
});
