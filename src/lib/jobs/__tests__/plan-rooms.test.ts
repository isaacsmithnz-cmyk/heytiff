import type { ReadSpace, SheetReading } from "@/lib/studio/reading";
import type { JobPlan, JobPlanPage } from "../plans";
import { pageScale, planRoomsOf, planRoomsSaid, scaleFromWritten } from "../plan-rooms";

/* THE ROOMS OFF THE JOB'S PLANS, WITH THEIR SIZES (lib/jobs/plan-rooms.ts):
   a room's m² is its outline at the page's scale, and the scale is the
   title block's, the printed dimensions', or the rooms' own written sizes. */

const box = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const space = (name: string, outline = box(0, 0, 100, 100), over: Partial<ReadSpace> = {}): ReadSpace => ({ name, named: true, kind: "room", outline, written: "", existing: false, openTo: "", stair: "", ...over });
const sheet = (spaces: ReadSpace[]): SheetReading => ({ sheetId: "p1", spaces, openings: [], marks: [], furniture: [], checklist: [], flags: [], planUp: "" });
const page = (over: Partial<JobPlanPage> = {}): JobPlanPage => ({ n: 1, kind: "floor", name: "Ground floor", level: 0, ref: "org/o1/p.png", preview: null, width: 1600, height: 900, mmPerPx: null, scale: null, ...over });
const plan = (p: JobPlanPage, spaces: ReadSpace[], over: Partial<JobPlan> = {}): JobPlan => ({
  id: "jplan_1",
  jobUuid: "job-1",
  documentId: "doc-1",
  attachmentId: null,
  name: "Plan.jpg",
  sourceRef: "org/o1/src.jpeg",
  sourceKind: "image",
  pageCount: 1,
  pages: [p],
  reading: { at: "2026-11-11T00:00:00Z", model: "claude-opus-5-5", floors: { p1: [sheet(spaces)] }, failed: [] },
  state: "read",
  said: null,
  addedBy: null,
  addedAt: "2026-11-11T00:00:00Z",
  readAt: "2026-11-11T00:01:00Z",
  ...over,
});

/* 3465's photo: BED. 1 at 205 × 167 px, the scale 24.4 mm a pixel off its 7440, 3300 and 2400 */
const measured = { mmPerPx: 24.4, from: "the 7440, 3300 and 2400 mm printed on it", sure: true };

describe("a plan's rooms and their sizes", () => {
  it("sizes each room off the page's printed dimensions, and leaves cupboards and outside out", () => {
    const spaces = [space("BED. 1", box(100, 100, 205, 167)), space("ROBE", box(0, 0, 40, 40), { kind: "cupboard" }), space("VERANDAH", box(0, 0, 400, 100), { kind: "outdoor" }), space("ENTRY", box(400, 100, 100, 180), { kind: "circulation" })];
    const out = planRoomsOf(plan(page({ measured }), spaces));
    expect(out).toEqual({
      plan: "Plan.jpg",
      state: "read",
      floors: [
        {
          floor: "Ground floor",
          page: 1,
          sized_by: "the 7440, 3300 and 2400 mm printed on it",
          sure: true,
          rooms: [
            { name: "BED. 1", kind: "room", area_m2: 20.4, about: "about 5 × 4.1 m" },
            { name: "ENTRY", kind: "circulation", area_m2: 10.7, about: "about 4.4 × 2.4 m" },
          ],
        },
      ],
    });
  });

  it("takes the title block's scale first, and says one figure alone is one alone", () => {
    expect(pageScale(page({ mmPerPx: 17.5, scale: "1:100 @ A3", measured }), [])).toEqual({ mmPerPx: 17.5, from: "the plan's printed scale, 1:100 @ A3", sure: true });
    expect(pageScale(page({ measured: { mmPerPx: 24.4, from: "the 7440 mm printed on it", sure: false } }), [])).toEqual({ mmPerPx: 24.4, from: "the 7440 mm printed on it, one figure alone", sure: false });
    expect(pageScale(page({ measured: null }), [])).toBeNull();
  });

  it("scales a page off the sizes written in its rooms, two that fit their rooms at least", () => {
    /* 20 mm a pixel: 4.1 × 2.7 m is 205 × 135 px, 3.6 × 3.0 m is 180 × 150 px */
    const bed = space("Bed 2", box(0, 0, 205, 135), { written: "4.1m x 2.7m" });
    const study = space("Study", box(300, 0, 150, 180), { written: "3.0 x 3.6" });
    /* a table's size written in the living room is not the room's */
    const living = space("Living", box(0, 300, 400, 300), { written: "2.4 x 0.9m" });
    expect(scaleFromWritten([bed, study, living])).toEqual({ mmPerPx: 20, rooms: 2 });
    expect(scaleFromWritten([bed, living])).toBeNull();
    const out = planRoomsOf(plan(page({ measured: null }), [bed, study, living]));
    expect(out.floors[0]).toMatchObject({ sized_by: "the sizes written in 2 of its rooms", sure: true, rooms: [{ area_m2: 11.1 }, { area_m2: 10.8 }, { name: "Living", area_m2: 48 }] });
  });

  it("with no scale keeps a room's written size, and says a room with none has none", () => {
    const out = planRoomsOf(plan(page({ measured: null }), [space("Bed 1", box(0, 0, 200, 160), { written: "4.1m x 2.7m" }), space("Living", box(300, 0, 300, 200))]));
    expect(out.floors[0]).toMatchObject({ sized_by: "the size written in each room that has one", rooms: [{ name: "Bed 1", area_m2: 11.1, written: "4.1m x 2.7m" }, { name: "Living", area_m2: null }] });
    expect(planRoomsSaid([out])).toContain("A room with no m² has nothing on the plan to size it");
  });

  it("says what to do with no plan, one still being read, and one that couldn't be", () => {
    expect(planRoomsSaid([])).toContain("No plan is in this job's Plans");
    const reading = planRoomsOf(plan(page(), [], { state: "reading", reading: null, pages: [] }));
    expect(planRoomsSaid([reading])).toBe("Plan.jpg is still being read: say it will be a minute or two, and to ask again.");
    const failed = planRoomsOf(plan(page(), [], { state: "failed", said: "The plans couldn't be read", reading: null, pages: [] }));
    expect(failed).toMatchObject({ said: "The plans couldn't be read", floors: [] });
    expect(planRoomsSaid([failed])).toContain("ask for the room sizes");
  });
});
