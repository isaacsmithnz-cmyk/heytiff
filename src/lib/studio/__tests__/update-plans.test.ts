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
  return readyFromPlans({ ...createDesign({ name: "7 Cutler Rd", mode: "plan" }), floors: made.floors, planImport: made.planImport, reading: made.reading });
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
