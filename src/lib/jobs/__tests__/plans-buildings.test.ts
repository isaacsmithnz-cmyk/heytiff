import { designFromPlan, designFromPlans, floorOptions, type JobPlan, type JobPlanPage } from "../plans";
import { withJobPlans } from "@/lib/studio/job-plan-floors";
import { createDesign } from "@/lib/studio/document";
import { floorBasesM } from "@/lib/studio/graph";

/* A BUILDING'S OWN PAGES (28 November 2026, after join 2: Isaac's "Do one
   and 2 but hold off on api"). A garage's or a cabana's floor plan is a
   floor of that building in a design, its ground floor set against the
   house's by the floor levels each prints: never stacked on the house. */

const page = (n: number, name: string, level: number, ffl: string, building?: string): JobPlanPage => ({
  n,
  kind: "floor",
  name,
  level,
  ...(building ? { building } : {}),
  ref: `org/o1/p${n}.png`,
  preview: null,
  width: 2400,
  height: 1700,
  mmPerPx: 10,
  scale: "1:100",
  words: [{ text: `FFL ${ffl}`, at: { x: 0, y: 0 } }] as JobPlanPage["words"],
});
const plan = (pages: JobPlanPage[]): JobPlan => ({
  id: "set",
  jobUuid: "job-1",
  documentId: null,
  attachmentId: null,
  name: "set",
  sourceRef: "org/o1/set.pdf",
  sourceKind: "pdf",
  pageCount: pages.length,
  pages,
  reading: null,
  state: "read",
  said: null,
  addedBy: null,
  addedAt: "2026-11-20T00:00:00Z",
  readAt: "2026-11-20T00:00:00Z",
});
const set = plan([page(10, "Ground floor", 0, "194.000"), page(11, "Level 1", 1, "197.700"), page(13, "Garage", 0, "193.850", "Garage"), page(14, "Pool & cabana", 0, "193.100", "Pool & cabana")]);

describe("a design from a set with a garage and a cabana", () => {
  const made = designFromPlan(set);

  it("makes each a building, its floor its own and level with nothing of the house's", () => {
    expect(made.buildings?.map((b) => [b.name, b.floorMm])).toEqual([
      ["Garage", -150],
      ["Pool & cabana", -900],
    ]);
    const house = made.floors.filter((f) => !f.buildingId);
    expect(house.map((f) => [f.name, f.level])).toEqual([
      ["Ground floor", 0],
      ["Level 1", 1],
    ]);
    const cabana = made.floors.find((f) => f.name === "Pool & cabana")!;
    expect(cabana).toMatchObject({ level: 0, buildingId: made.buildings![1].id, scaleMmPerUnit: 10 });
    expect(cabana.plans[0].imageRef).toBe("org/o1/p14.png");
  });

  it("stands each where its floor level puts it, the house's floors as they were", () => {
    const at = floorBasesM(made.floors, made.buildings);
    const gf = made.floors.find((f) => f.name === "Ground floor")!;
    const l1 = made.floors.find((f) => f.name === "Level 1")!;
    const cabana = made.floors.find((f) => f.name === "Pool & cabana")!;
    expect(at.get(gf.id)).toBe(0);
    expect(at.get(l1.id)).toBeCloseTo(3.7);
    expect(at.get(cabana.id)).toBeCloseTo(-0.9);
  });

  it("keeps its buildings when several sets make one design, never bumping their floors a level", () => {
    const two = designFromPlans([set, { ...set, id: "set2" }]);
    expect(two.buildings).toHaveLength(4);
    expect(two.floors.filter((f) => f.buildingId).every((f) => f.level === 0)).toBe(true);
  });

  it("leaves the floor menu's levels the house's", () => {
    expect(floorOptions(set).map((o) => o.label)).toEqual(["Basement 1", "Ground floor", "Level 1", "Level 2", "Not a floor plan"]);
  });
});

describe("a building's page newly on a design", () => {
  it("goes to that building's floor, the building made for it", () => {
    const house = plan([page(10, "Ground floor", 0, "194.000")]);
    const made = designFromPlan(house);
    const d = { ...createDesign({ name: "t", mode: "plan" }), floors: made.floors, planImport: made.planImport };
    const after = withJobPlans(d, [house], [set], ["set"]);
    const garage = after.doc.buildings?.find((b) => b.name === "Garage");
    expect(garage).toMatchObject({ name: "Garage", floorMm: -150 });
    const floor = after.doc.floors.find((f) => f.buildingId === garage!.id)!;
    expect(floor.plans.map((s) => s.imageRef)).toEqual(["org/o1/p13.png"]);
    /* the house's ground floor keeps its one sheet */
    expect(after.doc.floors.find((f) => !f.buildingId && f.level === 0)!.plans).toHaveLength(1);
  });
});

describe("a set read again, now finding a garage's page", () => {
  it("is offered to the design, and taking it brings the garage in as a building", async () => {
    const { newerPlan, planUpdate, updatePlans } = await import("@/lib/studio/update-plans");
    const { readyFromPlans } = await import("@/lib/studio/room-edit");
    const sheet = (name: string) => ({ sheetId: "x", spaces: [{ name, named: true, kind: "room" as const, outline: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }], written: "", existing: false, openTo: "", stair: "" }], openings: [], marks: [], furniture: [], checklist: [], flags: [], planUp: "" });
    const before: JobPlan = { ...plan([page(10, "Ground floor", 0, "194.000"), { ...page(13, "", 0, "193.850"), kind: "other", level: null, ref: null }]), reading: { at: "2026-11-20T00:00:00Z", model: "m", floors: { p10: [sheet("Lounge")] }, failed: [] } };
    const made = designFromPlan(before);
    const d = readyFromPlans({ ...createDesign({ name: "t", mode: "plan" }), floors: made.floors, planImport: made.planImport, reading: made.reading });
    const again: JobPlan = { ...plan([page(10, "Ground floor", 0, "194.000"), page(13, "Garage", 0, "193.850", "Garage")]), reading: { at: "2026-12-01T00:00:00Z", model: "m", floors: { p10: [sheet("Lounge")], p13: [sheet("Guest living")] }, failed: [] } };
    const up = newerPlan(d, [again]);
    expect(up?.again).toBe(true);
    const u = planUpdate(d, [again], up!);
    expect(u.said.map((x) => x.title)).toContain("Garage is new on the plans");
    const taken = updatePlans(d, [again], up!, new Set(u.offers.map((o) => o.id)));
    const garage = taken.buildings?.find((b) => b.name === "Garage");
    expect(garage).toMatchObject({ name: "Garage" });
    const floor = taken.floors.find((f) => f.buildingId === garage!.id)!;
    expect(taken.objects.filter((o) => o.type === "room" && o.floorId === floor.id).map((o) => o.props.name)).toEqual(["Guest living"]);
  });
});
