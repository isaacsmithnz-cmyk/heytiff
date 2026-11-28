import { designFromPlan, type JobPlan, type JobPlanPage } from "@/lib/jobs/plans";
import { planRoomsOf } from "@/lib/jobs/plan-rooms";
import { createDesign, type DesignDocument, type DesignObject } from "../document";
import type { ReadSpace, SheetReading } from "../reading";
import { readyFromPlans } from "../room-edit";
import { planUpdate, updatePlans, plansValueId } from "../update-plans";
import { buildingTakes, handFields, keptChanges, keptWords, markHand, placeOf, plansWith, spaceAt, takeOnto } from "../building-kept";

/* A ZONE'S FIXES ARE THE BUILDING'S (building-kept.ts; the building mock,
   boards 5 and 6, https://claude.ai/artifact/6xDKm8xV6f2PGZJKVo6M46). 10 mm
   a pixel; the Grand Hall's 6.4 m is the mock's example. */

const rect = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const room = (name: string, outline: { x: number; y: number }[], set?: ReadSpace["set"]): ReadSpace => ({ name, named: true, kind: "room", outline, written: "", existing: false, openTo: "", stair: "", ...(set ? { set } : {}) });
const sheet = (spaces: ReadSpace[]): SheetReading => ({ sheetId: "p1", spaces, openings: [], marks: [], furniture: [], checklist: [], flags: [], planUp: "" });
const page = (ref: string): JobPlanPage => ({ n: 1, kind: "floor", name: "Ground floor", level: 0, ref, preview: null, width: 2000, height: 1400, mmPerPx: 10, scale: "1:100" });
const plan = (id: string, addedAt: string, read: SheetReading): JobPlan => ({
  id,
  jobUuid: "job-1",
  documentId: null,
  attachmentId: null,
  name: id,
  sourceRef: `org/o1/${id}.pdf`,
  sourceKind: "pdf",
  pageCount: 1,
  pages: [page(`org/o1/${id}-p1.png`)],
  reading: { at: addedAt, model: "m", floors: { p1: [{ ...read, sheetId: "p1" }] }, failed: [] },
  state: "read",
  said: null,
  addedBy: null,
  addedAt,
  readAt: addedAt,
});

const issueB = plan("Rev B", "2026-11-01T00:00:00Z", sheet([room("Grand Hall", rect(0, 0, 600, 400)), room("Study", rect(700, 0, 300, 300))]));
const designFrom = (p: JobPlan, id = "dsn_one"): DesignDocument => {
  const made = designFromPlan(p);
  return readyFromPlans({ ...createDesign({ name: "t", mode: "plan" }), id, floors: made.floors, planImport: made.planImport, reading: made.reading });
};
const zone = (d: DesignDocument, name: string) => d.objects.find((o) => o.type === "room" && o.props.name === name)!;
const edit = (d: DesignDocument, id: string, props: DesignObject["props"], hand: Parameters<typeof markHand>[1], back: Parameters<typeof markHand>[2] = []): DesignDocument => ({
  ...d,
  objects: d.objects.map((o) => (o.id === id ? { ...o, props: markHand({ ...o.props, ...props }, hand, back) } : o)),
});
const meta = { by: "Isaac", design: "dsn_one", at: "2026-11-28T00:00:00Z" };

describe("where a zone was read", () => {
  it("is its plan's page and the room's place in her read", () => {
    const d = designFrom(issueB);
    expect(placeOf(d, [issueB], zone(d, "Study"))).toEqual({ planId: "Rev B", n: 1, i: 1 });
    expect(spaceAt([issueB], placeOf(d, [issueB], zone(d, "Study"))!)?.name).toBe("Study");
  });
});

describe("a height set in the design", () => {
  const d = designFrom(issueB);
  const hall = zone(d, "Grand Hall");
  const set = edit(d, hall.id, { ceilingHeightM: 6.4, heightFrom: null }, ["ceilingMm"]);

  it("goes to the room it was read off, and nothing else does", () => {
    expect(keptChanges(d, set, [issueB])).toEqual([{ planId: "Rev B", n: 1, i: 0, zoneId: hall.id, values: { ceilingMm: 6400 }, clear: [] }]);
    expect(keptChanges(d, d, [issueB])).toEqual([]);
    expect(keptWords("Grand Hall", { ceilingMm: 6400 })).toEqual(["Grand Hall height 6.4 m"]);
  });

  it("is kept on the job's plan, once", () => {
    const kept = plansWith([issueB], keptChanges(d, set, [issueB]), meta);
    expect(kept[0].reading!.floors.p1[0].spaces[0].set).toEqual({ ceilingMm: 6400, ...meta });
    expect(keptChanges(set, set, kept)).toEqual([]);
  });

  it("goes back to the plans' when Use the plans' is pressed, and the building lets it go", () => {
    const kept = plansWith([issueB], keptChanges(d, set, [issueB]), meta);
    const back = edit(set, hall.id, { ceilingHeightM: 3.2, heightFrom: "the sections" }, [], ["ceilingMm"]);
    const w = keptChanges(set, back, kept);
    expect(w).toEqual([{ planId: "Rev B", n: 1, i: 0, zoneId: hall.id, values: {}, clear: ["ceilingMm"] }]);
    expect(plansWith(kept, w, meta)[0].reading!.floors.p1[0].spaces[0].set).toBeUndefined();
  });

  it("is a name, what's above, glazing and insulation too, never a value she read", () => {
    const more = edit(d, hall.id, { name: "Hall", glazing: "high", condition: "poor", roomAbove: true }, ["name", "glazing", "condition", "roomAbove"]);
    expect(keptChanges(d, more, [issueB])[0].values).toEqual({ name: "Hall", glazing: "high", condition: "poor", roomAbove: true });
    expect(keptWords("Grand Hall", { name: "Hall", glazing: "high" })).toEqual(["Grand Hall renamed Hall", "Hall glazing high"]);
    /* changed without the hand's mark (a new read, a join): not the building's */
    const read = { ...d, objects: d.objects.map((o) => (o.id === hall.id ? { ...o, props: { ...o.props, glazing: "high" } } : o)) };
    expect(keptChanges(d, read, [issueB])).toEqual([]);
  });
});

describe("another design of the job", () => {
  const kept = plansWith([issueB], [{ planId: "Rev B", n: 1, i: 0, zoneId: "x", values: { ceilingMm: 6400 }, clear: [] }], meta);

  it("takes what the building has as it opens, marked as set", () => {
    const two = designFrom(issueB, "dsn_two");
    const takes = buildingTakes(two, kept);
    expect(takes).toEqual([{ zoneId: zone(two, "Grand Hall").id, values: { ceilingMm: 6400 } }]);
    const took = takeOnto(two, takes);
    expect(zone(took, "Grand Hall").props).toMatchObject({ ceilingHeightM: 6.4, heightFrom: "the building" });
    expect(handFields(zone(took, "Grand Hall"))).toEqual(["ceilingMm"]);
    expect(buildingTakes(took, kept)).toEqual([]);
  });

  it("keeps its own where somebody set it there, and the design that set it takes nothing", () => {
    const two = designFrom(issueB, "dsn_two");
    const own = edit(two, zone(two, "Grand Hall").id, { ceilingHeightM: 5 }, ["ceilingMm"]);
    expect(buildingTakes(own, kept)).toEqual([]);
    expect(buildingTakes(designFrom(issueB, "dsn_one"), kept)).toEqual([]);
  });

  it("made from the plans, starts with it, as the quote reads it", () => {
    const fresh = designFrom(kept[0], "dsn_three");
    expect(zone(fresh, "Grand Hall").props).toMatchObject({ ceilingHeightM: 6.4, heightFrom: "the building" });
    expect(planRoomsOf(kept[0]).floors[0].rooms[0]).toMatchObject({ name: "Grand Hall", ceiling_m: 6.4, set_by_hand: true });
  });
});

describe("new plans", () => {
  const revC = plan("Rev C", "2026-12-04T00:00:00Z", sheet([room("Banquet Hall", rect(0, 0, 600, 400)), room("Study", rect(700, 0, 360, 300))]));
  const d = designFrom(issueB);
  const hall = zone(d, "Grand Hall");
  const named = edit(d, hall.id, { name: "Hall" }, ["name"]);
  const up = { plan: revC, was: issueB };

  it("keep what you set, said under Kept as you set them", () => {
    const u = planUpdate(named, [issueB, revC], up);
    expect(u.kept).toEqual([{ id: plansValueId(hall.id), title: "Hall, the name you gave it", line: "You set it in the design. Rev C calls it Banquet Hall" }]);
    const taken = updatePlans(named, [issueB, revC], up, new Set(u.offers.map((o) => o.id)));
    expect(taken.objects.find((o) => o.id === hall.id)!.props.name).toBe("Hall");
  });

  it("take the plans' where Use the plans' is pressed, no longer marked as set", () => {
    const u = planUpdate(named, [issueB, revC], up);
    const taken = updatePlans(named, [issueB, revC], up, new Set([...u.offers.map((o) => o.id), plansValueId(hall.id)]));
    const z = taken.objects.find((o) => o.id === hall.id)!;
    expect(z.props.name).toBe("Banquet Hall");
    expect(handFields(z)).toEqual([]);
  });
});
