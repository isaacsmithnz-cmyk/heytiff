import { designFromPlan, type JobPlan, type JobPlanPage } from "@/lib/jobs/plans";
import { createDesign, type DesignDocument } from "../document";
import type { ReadOpening, ReadSpace, SheetReading } from "../reading";
import { foundOn, readyFromPlans } from "../room-edit";
import { newerPlan, planUpdate, updatePlans } from "../update-plans";

/* UPDATE PLANS (update-plans.ts): a newer set on the job, what it changed,
   and the design taking it without anything drawn moving. 10 mm a pixel,
   so a 300 by 300 pixel room is 9 m². */

const rect = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const room = (name: string, outline: { x: number; y: number }[]): ReadSpace => ({ name, named: true, kind: "room", outline, written: "", existing: false, openTo: "", stair: "" });
const windowIn = (room: string, facing: string): ReadOpening => ({ kind: "window", tag: "W1", a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, widthMm: 1200, room, external: true, facing });
const sheet = (spaces: ReadSpace[], openings: ReadOpening[] = []): SheetReading => ({ sheetId: "p1", spaces, openings, marks: [], furniture: [], checklist: [], flags: [], planUp: "" });

const page = (ref: string): JobPlanPage => ({ n: 1, kind: "floor", name: "First floor", level: 0, ref, preview: null, width: 2000, height: 1400, mmPerPx: 10, scale: "1:100" });

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

const issueG = plan("Issue G", "2026-11-01T00:00:00Z", sheet([room("Study", rect(0, 0, 300, 300)), room("Kitchen", rect(400, 0, 400, 300)), room("Lounge", rect(0, 400, 500, 400)), room("Bedroom 01", rect(900, 0, 300, 300))]));
const issueH = plan(
  "Issue H",
  "2026-12-02T00:00:00Z",
  sheet([room("Bedroom 05", rect(0, 0, 300, 300)), room("Kitchen", rect(400, 0, 500, 300)), room("Lounge", rect(0, 400, 500, 400)), room("Ensuite", rect(900, 400, 200, 200))], [windowIn("Bedroom 05", "N")])
);

const designFrom = (p: JobPlan): DesignDocument => {
  const made = designFromPlan(p);
  return readyFromPlans({ ...createDesign({ name: "7 Ipsum Rd", mode: "plan" }), floors: made.floors, planImport: made.planImport, reading: made.reading });
};
const rooms = (d: DesignDocument) => d.objects.filter((o) => o.type === "room");
const named = (d: DesignDocument, name: string) => rooms(d).find((o) => o.props.name === name);

describe("a newer set on the job", () => {
  it("is the newest set read since the design's, against the one it shares floors with", () => {
    const d = designFrom(issueG);
    expect(newerPlan(d, [issueG])).toBeNull();
    expect(newerPlan(d, [issueG, issueH])).toEqual({ plan: issueH, was: issueG });
  });

  it("isn't offered while it's being read, nor once it was left unticked, nor when it's older", () => {
    const d = designFrom(issueG);
    expect(newerPlan(d, [issueG, { ...issueH, state: "reading", reading: null }])).toBeNull();
    expect(newerPlan({ ...d, planImport: { ...d.planImport!, passed: ["Issue H"] } }, [issueG, issueH])).toBeNull();
    expect(newerPlan(d, [issueG, { ...issueH, addedAt: "2026-10-01T00:00:00Z" }])).toBeNull();
  });

  it("is nothing to a design with plans of its own", () => {
    const d = { ...designFrom(issueG), planImport: null, floors: designFrom(issueG).floors.map((f) => ({ ...f, plans: [] })) };
    expect(newerPlan(d, [issueG, issueH])).toBeNull();
  });
});

describe("what it changed", () => {
  const d = designFrom(issueG);
  const up = planUpdate(d, [issueG, issueH], { plan: issueH, was: issueG });

  it("says each changed room on its page, by her two reads", () => {
    expect(up.pages).toEqual([
      {
        n: 1,
        title: "First floor, page 1",
        lines: ["Study is Bedroom 05 now, 9.0 m² with a window to the north", "Kitchen is 15 m² now, was 12 m²", "Bedroom 01 is gone", "Ensuite is new, 4.0 m²"],
      },
    ]);
  });

  it("offers each drawn room its change with its load before and after, then the new room", () => {
    expect(up.offers.map((o) => o.title)).toEqual(["Study becomes Bedroom 05", "Kitchen takes the new plans", "Mark Ensuite"]);
    expect(up.offers[0].line).toMatch(/^Its outline and windows off First floor, page 1\. Its load (goes from [\d.]+ kW to [\d.]+ kW|stays [\d.]+ kW)$/);
    expect(up.offers[1].line).toMatch(/^Its outline off First floor, page 1\. Its load goes from [\d.]+ kW to [\d.]+ kW$/);
    expect(up.offers[2].line).toMatch(/^New on First floor, page 1\. Its load is [\d.]+ kW$/);
    expect(up.said).toEqual([{ title: "Bedroom 01 isn't on the new plans", line: "It stays as you drew it" }]);
  });
});

describe("taking it", () => {
  const d = designFrom(issueG);
  const study = named(d, "Study")!;
  const kitchen = named(d, "Kitchen")!;
  const up = { plan: issueH, was: issueG };

  it("puts the new sheet where the old one sat and points the design at the new set", () => {
    const out = updatePlans(d, [issueG, issueH], up, new Set());
    expect(out.floors).toHaveLength(1);
    expect(out.floors[0].plans.map((s) => ({ ref: s.imageRef, x: s.x, y: s.y }))).toEqual([{ ref: "org/o1/Issue H-p1.png", x: d.floors[0].plans[0].x, y: d.floors[0].plans[0].y }]);
    expect(out.planImport?.jobPlanId).toBe("Issue H");
    expect(newerPlan(out, [issueG, issueH])).toBeNull();
  });

  it("takes the ticked changes, keeping each room's id, and leaves the rest as drawn", () => {
    const out = updatePlans(d, [issueG, issueH], up, new Set([study.id, `new:1:3`]));
    const s = out.objects.find((o) => o.id === study.id)!;
    expect(s.props.name).toBe("Bedroom 05");
    expect(s.props.orientation).toBe("N");
    const k = out.objects.find((o) => o.id === kitchen.id)!;
    expect(k.geometry).toEqual(kitchen.geometry);
    expect(named(out, "Ensuite")).toBeTruthy();
    expect(named(out, "Bedroom 01")).toBeTruthy();
    expect(rooms(out)).toHaveLength(rooms(d).length + 1);
  });

  it("leaves nothing she read offered twice: every room drawn points at the new read", () => {
    const out = updatePlans(d, [issueG, issueH], up, new Set());
    const sheetId = out.floors[0].plans[0].id;
    expect(rooms(out).filter((o) => o.props.name !== "Bedroom 01").every((o) => String(o.props.readKey).startsWith(`${sheetId}:`))).toBe(true);
    expect(foundOn(out, out.floors[0].id).map((s) => s.name)).toEqual(["Ensuite"]);
  });
});

/* PLANS UPDATED: the set the design was made from, read again. Its page is
   drawn again as a new picture, her read redone: the Kitchen wider, and a
   roof she couldn't read before. */
describe("the design's own set, read again", () => {
  const roofFace = { floorId: "p1", sheetId: "p1", outline: rect(0, 0, 500, 300), pitchDeg: 40, fall: { x: 0, y: 1 }, eaveMm: 2700, overhangMm: 450, existing: false, page: 2 };
  const again: JobPlan = {
    ...issueG,
    pages: [page("org/o1/Issue G-p1-again.png")],
    readAt: "2026-11-23T00:00:00Z",
    reading: {
      at: "2026-11-23T00:00:00Z",
      model: "m",
      floors: { p1: [sheet([room("Study", rect(0, 0, 300, 300)), room("Kitchen", rect(400, 0, 500, 300)), room("Lounge", rect(0, 400, 500, 400)), room("Bedroom 01", rect(900, 0, 300, 300))])] },
      failed: [],
      roof: { levels: [], parts: [], raked: [], material: "metal", roofSpace: "", faces: [roofFace as never] },
    },
  };
  const d = designFrom(issueG);
  const kitchen = named(d, "Kitchen")!;

  it("is offered as the plans updated, against the read the design holds", () => {
    const up = newerPlan(d, [again])!;
    expect(up.again).toBe(true);
    expect(up.plan).toBe(again);
    expect(up.was?.pages[0].ref).toBe(d.floors[0].plans[0].imageRef);
    expect(planUpdate(d, [again], up).pages).toEqual([{ n: 1, title: "First floor, page 1", lines: ["Kitchen is 15 m² now, was 12 m²"] }]);
  });

  it("isn't offered when the design holds that read already", () => {
    expect(newerPlan({ ...d, reading: { ...d.reading!, at: "2026-11-24T00:00:00Z" } }, [again])).toBeNull();
  });

  it("puts her new read and the new picture under the design, nothing drawn moving", () => {
    const up = newerPlan(d, [again])!;
    const out = updatePlans(d, [again], up, new Set([kitchen.id]));
    const [s] = out.floors[0].plans;
    expect({ id: s.id, ref: s.imageRef, x: s.x, y: s.y }).toEqual({ id: d.floors[0].plans[0].id, ref: "org/o1/Issue G-p1-again.png", x: d.floors[0].plans[0].x, y: d.floors[0].plans[0].y });
    expect(out.floors).toHaveLength(1);
    expect(out.reading?.at).toBe("2026-11-23T00:00:00Z");
    expect(out.reading?.roof?.faces?.map((f) => [f.floorId, f.sheetId])).toEqual([[out.floors[0].id, s.id]]);
    expect(out.planImport?.placed[0]).toBe("org/o1/Issue G-p1-again.png");
    expect(out.objects.find((o) => o.id === kitchen.id)!.geometry).not.toEqual(kitchen.geometry);
    expect(rooms(out)).toHaveLength(rooms(d).length);
    expect(rooms(out).every((o) => String(o.props.readKey).startsWith(`${s.id}:`))).toBe(true);
    expect(newerPlan(out, [again])).toBeNull();
  });
});

/* 3570, 24 November 2026: read again with its door and window schedule, its
   windows had their heights, and its rooms kept the glazing of the read
   before. A Lounge of 20 m² with 2.4 m of window: 2.9 m² of glass at 1.2 m
   (low), 5.8 m² at its scheduled 2.4 m (moderate). */
describe("a set read again with its glass sized", () => {
  const glass = (room: string, widthMm: number, heightMm?: number): ReadOpening => ({ ...windowIn(room, "N"), widthMm, ...(heightMm ? { heightMm } : {}) });
  const spaces = [room("Lounge", rect(0, 0, 500, 400)), room("Study", rect(600, 0, 300, 300))];
  const first = plan("Set A", "2026-11-01T00:00:00Z", sheet(spaces, [glass("Lounge", 2400), glass("Study", 1200)]));
  const again: JobPlan = { ...first, reading: { ...first.reading!, at: "2026-11-05T00:00:00Z", floors: { p1: [sheet(spaces, [glass("Lounge", 2400, 2400), glass("Study", 1200, 1500)])] } } };
  const d = designFrom(first);
  const lounge = named(d, "Lounge")!;
  const study = named(d, "Study")!;
  const up = newerPlan(d, [again])!;

  it("is offered as a set read again", () => {
    expect(lounge.props.glazing).toBe("low");
    expect(study.props.glazing).toBe("moderate");
    expect(up.again).toBe(true);
  });

  it("offers the room whose glazing moves with its load, and says nothing of one whose doesn't", () => {
    const u = planUpdate(d, [again], up);
    expect(u.pages).toEqual([{ n: 1, title: "First floor, page 1", lines: ["Lounge has more glass now"] }]);
    expect(u.offers.map((o) => o.title)).toEqual(["Lounge takes the new plans"]);
    expect(u.offers[0].line).toMatch(/^Its windows off First floor, page 1\. Its load goes from [\d.]+ kW to [\d.]+ kW$/);
  });

  it("gives the ticked room its glazing and leaves its outline as drawn", () => {
    const moved = { ...lounge, geometry: { kind: "polygon" as const, points: rect(10, 10, 480, 380) } };
    const drawn = { ...d, objects: d.objects.map((o) => (o.id === lounge.id ? moved : o)) };
    const out = updatePlans(drawn, [again], up, new Set([lounge.id]));
    const l = out.objects.find((o) => o.id === lounge.id)!;
    expect(l.props.glazing).toBe("moderate");
    expect(l.geometry).toEqual(moved.geometry);
    expect(out.objects.find((o) => o.id === study.id)!.props.glazing).toBe("moderate");
  });

  it("leaves a room left unticked as it was", () => {
    const out = updatePlans(d, [again], up, new Set());
    expect(out.objects.find((o) => o.id === lounge.id)!.props.glazing).toBe("low");
  });
});
