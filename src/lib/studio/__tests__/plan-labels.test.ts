/* Where the plan's words go (plan-labels.ts; Isaac, 2026-09-30: "clashing
   titles … is it smart enough to know where it's been placed and if
   something's on top of it?"). */

import { footprintBox, layoutPlanLabels, roomLabelFixed, roomLabelOffset, textWidthPx, type LabelSpot, type RoomLabelIn } from "../plan-labels";
import type { Point } from "../document";

const square = (x0: number, y0: number, s: number): Point[] => [
  { x: x0, y: y0 },
  { x: x0 + s, y: y0 },
  { x: x0 + s, y: y0 + s },
  { x: x0, y: y0 + s },
];
const room = (id: string, polygon: Point[], name = "Office 2", area = "30.0 m², oversized"): RoomLabelIn => ({
  id,
  polygon,
  lineGap: 16,
  lines: [
    { text: name, size: 13 },
    { text: area, size: 11 },
  ],
});
/* the box a placed label covers, as the layout reckons it (px = 1) */
const boxOf = (spot: LabelSpot, text: string, size: number, lines = 1, widthSize = size) => {
  const w = textWidthPx(text, widthSize);
  const x0 = spot.anchor === "middle" ? spot.x - w / 2 : spot.anchor === "start" ? spot.x : spot.x - w;
  return { x0, x1: x0 + w, y0: spot.y - size * 0.78, y1: spot.y + (lines - 1) * 16 + size * 0.24 };
};
const crosses = (b: { x0: number; x1: number; y0: number; y1: number }, x: number, y0: number, y1: number) =>
  b.x0 < x && x < b.x1 && b.y0 < y1 && y0 < b.y1;

describe("the plan's words", () => {
  /* A ROOM'S NAME IS A TAB ON ITS WALL (room-tab.ts; Isaac, 2026-10-07): out
     of the middle of the room, where the plan's own words are */
  it("a room with nothing in it has its name in a tab tucked into its top-left corner", () => {
    const out = layoutPlanLabels({ rooms: [room("r", square(0, 0, 600))], runs: [], solids: [], px: 1 });
    const r = out.rooms.get("r")!;
    expect(r.tab?.att).toEqual({ top: true, right: false, bottom: false, left: true });
    expect([r.box.x0, r.box.y0]).toEqual([0, 0]);
    // the words start at the tab's padding, inside it
    expect(r.anchor).toBe("start");
    expect(r.x).toBeGreaterThan(r.box.x0);
    expect(r.y).toBeLessThan(r.box.y1);
  });

  it("a room no level or plumb wall of which can carry a tab keeps its name in its middle", () => {
    const diamond = [{ x: 300, y: 0 }, { x: 600, y: 300 }, { x: 300, y: 600 }, { x: 0, y: 300 }];
    const r = layoutPlanLabels({ rooms: [room("r", diamond)], runs: [], solids: [], px: 1 }).rooms.get("r")!;
    expect(r.tab).toBeUndefined();
    expect(r).toMatchObject({ x: 300, y: 300, anchor: "middle" });
  });

  it("a pipe down through the room's centre moves the name off it, and the pipe's words go beside the copper, clear of the name", () => {
    // the walk: Office 2 with its head's pipe dropping through the middle
    const pipe = { id: "p", points: [{ x: 300, y: 60 }, { x: 300, y: 560 }], text: '3.18 m, 3/8" / 5/8"', size: 11 };
    const out = layoutPlanLabels({ rooms: [room("r", square(0, 0, 600))], runs: [pipe], solids: [], px: 1 });
    // the room's block: the 13 px name over the wider 11 px area line
    const name = boxOf(out.rooms.get("r")!, "30.0 m², oversized", 13, 2, 11);
    expect(crosses(name, 300, 60, 560)).toBe(false);
    const spot = out.runs.get("p")!;
    // upright pipe: the words run from beside it, not across it
    expect(spot.anchor).not.toBe("middle");
    const words = boxOf(spot, pipe.text, 11);
    expect(crosses(words, 300, 60, 560)).toBe(false);
    const overlap = !(words.x1 <= name.x0 || name.x1 <= words.x0 || words.y1 <= name.y0 || name.y1 <= words.y0);
    expect(overlap).toBe(false);
  });

  it("a level pipe's words sit above it, and slide along it off a unit", () => {
    const pipe = { id: "p", points: [{ x: 0, y: 1000 }, { x: 1000, y: 1000 }], text: "5.91 m, 3/8\" / 3/4\"", size: 11 };
    const free = layoutPlanLabels({ rooms: [], runs: [pipe], solids: [], px: 1 }).runs.get("p")!;
    expect(free).toMatchObject({ x: 500, anchor: "middle" });
    expect(free.y).toBeLessThan(1000);
    // a unit sitting over the middle of the pipe: the words move along
    const unit = footprintBox({ x: 500, y: 985 }, 200, 60);
    const moved = layoutPlanLabels({ rooms: [], runs: [pipe], solids: [unit], px: 1 }).runs.get("p")!;
    const words = boxOf(moved, pipe.text, 11);
    expect(words.x1 <= unit.x0 || unit.x1 <= words.x0 || words.y1 <= unit.y0 || unit.y1 <= words.y0).toBe(true);
  });

  it("two pipes side by side do not write over each other", () => {
    const a = { id: "a", points: [{ x: 0, y: 100 }, { x: 400, y: 100 }], text: "4.00 m, 3/8\" / 5/8\"", size: 11 };
    const b = { id: "b", points: [{ x: 0, y: 118 }, { x: 400, y: 118 }], text: "4.00 m, 1/4\" / 1/2\"", size: 11 };
    const out = layoutPlanLabels({ rooms: [], runs: [a, b], solids: [], px: 1 });
    const A = boxOf(out.runs.get("a")!, a.text, 11);
    const B = boxOf(out.runs.get("b")!, b.text, 11);
    expect(A.x1 <= B.x0 || B.x1 <= A.x0 || A.y1 <= B.y0 || B.y1 <= A.y0).toBe(true);
  });

  it("keeps every word even where nothing is clear: the least-crowded spot wins", () => {
    // a tiny room, crossed both ways
    const runs = [
      { id: "h", points: [{ x: 0, y: 20 }, { x: 40, y: 20 }], text: "0.40 m", size: 11 },
      { id: "v", points: [{ x: 20, y: 0 }, { x: 20, y: 40 }], text: "0.40 m", size: 11 },
    ];
    const out = layoutPlanLabels({ rooms: [room("r", square(0, 0, 40))], runs, solids: [], px: 1 });
    expect(out.rooms.has("r")).toBe(true);
    expect(out.runs.has("h")).toBe(true);
    expect(out.runs.has("v")).toBe(true);
  });

  it("keeps its size on screen: at half the zoom the words cover twice the plan", () => {
    const pipe = { id: "p", points: [{ x: 300, y: 60 }, { x: 300, y: 560 }], text: "3.18 m", size: 11 };
    const at1 = layoutPlanLabels({ rooms: [], runs: [pipe], solids: [], px: 1 }).runs.get("p")!;
    const at2 = layoutPlanLabels({ rooms: [], runs: [pipe], solids: [], px: 2 }).runs.get("p")!;
    expect(Math.abs(at2.x - 300)).toBeCloseTo(Math.abs(at1.x - 300) * 2);
  });

  it("a tab put on a wall by hand stays there, and the other words go round it (Isaac: a kitchen island under it)", () => {
    const polygon = square(0, 0, 600);
    // clockwise from the first corner: the bottom wall runs 1200–1800, so its middle is 0.625 of the way
    const pipe = { id: "p", points: [{ x: 60, y: 580 }, { x: 560, y: 580 }], text: "5.00 m", size: 11 };
    const out = layoutPlanLabels({ rooms: [{ ...room("r", polygon), edge: 0.625 }], runs: [pipe], solids: [], px: 1 });
    const r = out.rooms.get("r")!;
    expect(r.tab?.att.bottom).toBe(true);
    expect((r.box.x0 + r.box.x1) / 2).toBeCloseTo(300, 0);
    // the pipe's words, which would sit at its middle, stay off the tab
    const words = out.runs.get("p")!.box;
    expect(words.x1 <= r.box.x0 || r.box.x1 <= words.x0 || words.y1 <= r.box.y0 || r.box.y1 <= words.y0).toBe(true);
  });

  it("a name put by hand the OLD way, inside the room, takes its tab to the nearest wall", () => {
    const polygon = square(0, 0, 600);
    // nearer the bottom wall (120 off) than the left one (150 off)
    const r = layoutPlanLabels({ rooms: [{ ...room("r", polygon), fixed: { x: 150, y: 480 } }], runs: [], solids: [], px: 1 }).rooms.get("r")!;
    expect(r.tab?.att.bottom).toBe(true);
    expect((r.box.x0 + r.box.x1) / 2).toBeCloseTo(150, 0);
  });

  it("is kept on the room as an offset from its centre, so it travels with the room", () => {
    const polygon = square(0, 0, 600);
    const labelAt = roomLabelOffset({ x: 150, y: 480 }, polygon);
    expect(labelAt).toEqual({ dx: -150, dy: 180 });
    expect(roomLabelFixed({ labelAt }, polygon)).toEqual({ x: 150, y: 480 });
    // the room moved 1000 across: the name comes with it
    expect(roomLabelFixed({ labelAt }, square(1000, 0, 600))).toEqual({ x: 1150, y: 480 });
    // nothing stored, or something that is not an offset: placed automatically
    expect(roomLabelFixed({}, polygon)).toBeUndefined();
    expect(roomLabelFixed({ labelAt: { dx: "1" } }, polygon)).toBeUndefined();
  });

  it("keeps a name off a unit's flanges, not just its footprint (Walk A, Level 1)", () => {
    // a ducted head 70 × 73 in a room whose centre is just under it
    const unit = footprintBox({ x: 111, y: 59 }, 70, 73.2);
    // the box reaches past the footprint's bottom edge (95.6), where the flange is drawn
    expect(unit.y1).toBeGreaterThan(59 + 73.2 / 2 + 6);
    const polygon = [
      { x: -198, y: -94 },
      { x: 470, y: -94 },
      { x: 470, y: 322 },
      { x: -198, y: 322 },
    ];
    const out = layoutPlanLabels({ rooms: [room("z6", polygon, "Zone 6", "27.7 m²")], runs: [], solids: [unit], px: 1.1 });
    const b = out.rooms.get("z6")!.box;
    expect(b.x1 <= unit.x0 || unit.x1 <= b.x0 || b.y1 <= unit.y0 || unit.y1 <= b.y0).toBe(true);
  });
});
