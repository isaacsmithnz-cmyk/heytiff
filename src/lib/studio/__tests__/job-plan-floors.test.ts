import { chooseFloors, designFromPlan, type JobPlan, type JobPlanPage } from "@/lib/jobs/plans";
import { createDesign, type DesignDocument, type DesignObject } from "../document";
import type { PlanReading, SheetReading } from "../reading";
import { plansInDesign, withJobPlans } from "../job-plan-floors";

/* A DESIGN'S PLANS ARE THE JOB'S (job-plan-floors.ts): the Plans dialog's
   save, brought into the design. A page moved to another floor takes what
   she read with it, a page or plan taken out leaves, one newly in arrives
   with its read, and nothing drawn is lost. */

const page = (n: number, level: number | null, over: Partial<JobPlanPage> = {}): JobPlanPage => ({
  n,
  kind: level === null ? "other" : "floor",
  name: level === null ? "" : level === 0 ? "Ground floor" : `Level ${level}`,
  level,
  ref: `org/o1/p${n}.png`,
  preview: null,
  width: 2000,
  height: 1400,
  mmPerPx: 10,
  scale: "1:100 @ A3",
  ...over,
});

const sheet = (id: string, rooms: string[]): SheetReading => ({
  sheetId: id,
  spaces: rooms.map((name) => ({ name, named: true, kind: "room", outline: [], written: "", existing: false, openTo: "", stair: "" })),
  openings: [],
  marks: [],
  furniture: [],
  checklist: [],
  flags: [],
  planUp: "",
});

const reading = (floors: Record<string, SheetReading[]>): PlanReading => ({ at: "2026-11-11T00:00:00Z", model: "m", floors, failed: [] });

const plan = (id: string, pages: JobPlanPage[], over: Partial<JobPlan> = {}): JobPlan => ({
  id,
  jobUuid: "job-1",
  documentId: null,
  attachmentId: null,
  name: `${id}.pdf`,
  sourceRef: `org/o1/${id}.pdf`,
  sourceKind: "pdf",
  pageCount: pages.length,
  pages,
  reading: reading(Object.fromEntries(pages.filter((p) => p.ref).map((p) => [`p${p.n}`, [sheet(`p${p.n}`, [`Room ${p.n}`])]]))),
  state: "read",
  said: null,
  addedBy: null,
  addedAt: "2026-11-11T00:00:00Z",
  readAt: "2026-11-11T00:00:00Z",
  ...over,
});

/* 7 Cutler Rd, as the mock drew it: CD103 and CD105 both on the ground, CD104 one up */
const cutler = plan("set", [page(1, 0, { ref: "org/o1/cd103.png" }), page(2, 1, { ref: "org/o1/cd104.png" }), page(3, 0, { ref: "org/o1/cd105.png", name: "Ground floor" })]);

const designOf = (...plans: JobPlan[]): DesignDocument => {
  const made = designFromPlan(plans[0]);
  return { ...createDesign({ name: "t", mode: "plan" }), floors: made.floors, planImport: made.planImport, reading: made.reading };
};

const sheetsOn = (d: DesignDocument) => d.floors.map((f) => ({ level: f.level, refs: f.plans.map((s) => s.imageRef) }));
const roomsReadOn = (d: DesignDocument) => Object.fromEntries(d.floors.map((f) => [f.level, (d.reading?.floors[f.id] ?? []).flatMap((s) => s.spaces.map((x) => x.name))]));

const chose = (p: JobPlan, chosen: Record<number, string>): JobPlan => ({ ...p, pages: chooseFloors(p.pages, chosen, "Isaac Smith", "x") });

describe("saving the Plans dialog into a design", () => {
  it("takes a ceiling plan out as Not a floor plan, and its read with it", () => {
    const d = designOf(cutler);
    expect(sheetsOn(d)).toEqual([
      { level: 0, refs: ["org/o1/cd103.png", "org/o1/cd105.png"] },
      { level: 1, refs: ["org/o1/cd104.png"] },
    ]);
    const out = withJobPlans(d, [cutler], [chose(cutler, { 3: "none" })], ["set"]);
    expect(sheetsOn(out.doc)).toEqual([
      { level: 0, refs: ["org/o1/cd103.png"] },
      { level: 1, refs: ["org/o1/cd104.png"] },
    ]);
    expect(roomsReadOn(out.doc)).toEqual({ 0: ["Room 1"], 1: ["Room 2"] });
    expect(out.made).toEqual([]);
  });

  it("moves a page to its new floor, made where there's none, with what she read off it", () => {
    const d = designOf(cutler);
    const out = withJobPlans(d, [cutler], [chose(cutler, { 3: "2" })], ["set"]);
    expect(sheetsOn(out.doc)).toEqual([
      { level: 0, refs: ["org/o1/cd103.png"] },
      { level: 1, refs: ["org/o1/cd104.png"] },
      { level: 2, refs: ["org/o1/cd105.png"] },
    ]);
    expect(roomsReadOn(out.doc)).toEqual({ 0: ["Room 1"], 1: ["Room 2"], 2: ["Room 3"] });
    expect(out.made).toHaveLength(1);
    expect(out.doc.floors[2]).toMatchObject({ name: "Level 2", scaleMmPerUnit: 10 });
    /* and the import record says which pages are placed now */
    expect(Object.values(out.doc.planImport!.placed).sort()).toEqual(["org/o1/cd103.png", "org/o1/cd104.png", "org/o1/cd105.png"]);
  });

  it("keeps a floor something is drawn on when its plan leaves, and drops one with nothing on it", () => {
    const d = designOf(cutler);
    const up = d.floors.find((f) => f.level === 1)!;
    const unit = { id: "u1", type: "indoor-unit", floorId: up.id, props: {} } as unknown as DesignObject;
    const off = chose(cutler, { 2: "none" });
    expect(sheetsOn(withJobPlans(d, [cutler], [off], ["set"]).doc)).toEqual([{ level: 0, refs: ["org/o1/cd103.png", "org/o1/cd105.png"] }]);
    const kept = withJobPlans({ ...d, objects: [unit] }, [cutler], [off], ["set"]).doc;
    expect(sheetsOn(kept)).toEqual([
      { level: 0, refs: ["org/o1/cd103.png", "org/o1/cd105.png"] },
      { level: 1, refs: [] },
    ]);
    expect(kept.objects).toEqual([unit]);
  });

  it("brings a newly ticked plan's floors in with its read, and takes an unticked one's out", () => {
    const d = designOf(cutler);
    const issueH = plan("h", [page(1, 0, { ref: "org/o1/h103.png" }), page(2, 1, { ref: "org/o1/h104.png" })]);
    const both = withJobPlans(d, [cutler, issueH], [cutler, issueH], ["set", "h"]).doc;
    expect(sheetsOn(both)).toEqual([
      { level: 0, refs: ["org/o1/cd103.png", "org/o1/cd105.png", "org/o1/h103.png"] },
      { level: 1, refs: ["org/o1/cd104.png", "org/o1/h104.png"] },
    ]);
    expect(roomsReadOn(both)[0]).toEqual(["Room 1", "Room 3", "Room 1"]);
    const swapped = withJobPlans(both, [cutler, issueH], [cutler, issueH], ["h"]).doc;
    expect(sheetsOn(swapped)).toEqual([
      { level: 0, refs: ["org/o1/h103.png"] },
      { level: 1, refs: ["org/o1/h104.png"] },
    ]);
    expect(swapped.planImport?.jobPlanId).toBe("h");
    expect(plansInDesign(swapped, [cutler, issueH])).toEqual(["h"]);
  });

  it("leaves a plan being read again as the design shows it, and plans dropped in by hand alone", () => {
    const d = designOf(cutler);
    const own = { id: "sht_own", imageRef: "org/o1/mine.png", pageNumber: null, name: "Sketch", width: 100, height: 100, x: 0, y: 0 };
    const withOwn = { ...d, floors: d.floors.map((f, i) => (i === 0 ? { ...f, plans: [...f.plans, own] } : f)) };
    const rereading = { ...cutler, state: "reading" as const, pages: [] };
    const out = withJobPlans(withOwn, [cutler], [rereading], ["set"]).doc;
    expect(sheetsOn(out)).toEqual(sheetsOn(withOwn));
    const untick = withJobPlans(withOwn, [cutler], [cutler], []).doc;
    expect(sheetsOn(untick)).toEqual([{ level: 0, refs: ["org/o1/mine.png"] }]);
  });

  it("knows which of the job's plans a design uses, by the pictures it shows", () => {
    const d = designOf(cutler);
    const other = plan("other", [page(1, 0, { ref: "org/o1/elsewhere.png" })]);
    expect(plansInDesign(d, [cutler, other])).toEqual(["set"]);
  });
});
