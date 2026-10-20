import { glazingFor, joinOutlines, orientationFor, roomFrom, servedByDefault, suggestionsFor, type Suggestion } from "../rooms-from-reading";
import type { ReadOpening, SheetReading } from "../reading";

const rect = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const win = (room: string, facing: string, widthMm: number, external = true): ReadOpening => ({
  kind: "window",
  tag: "",
  a: { x: 0, y: 0 },
  b: { x: 1, y: 0 },
  widthMm,
  room,
  external,
  facing,
});

describe("what the Rooms page offers", () => {
  const sheet: SheetReading = {
    sheetId: "s1",
    planUp: "N",
    spaces: [
      { name: "Bed 4", named: true, kind: "room", outline: rect(0, 0, 200, 150), written: "", existing: false, openTo: "", stair: "" },
      { name: "Bathroom", named: true, kind: "wet", outline: rect(210, 0, 100, 150), written: "", existing: false, openTo: "", stair: "" },
      { name: "Robe", named: true, kind: "cupboard", outline: rect(0, 160, 200, 40), written: "", existing: false, openTo: "", stair: "" },
      { name: "Patio", named: true, kind: "outdoor", outline: rect(400, 0, 200, 200), written: "", existing: false, openTo: "", stair: "" },
      { name: "Stair", named: true, kind: "stair", outline: rect(320, 0, 60, 150), written: "", existing: false, openTo: "", stair: "" },
      { name: "Garage", named: true, kind: "garage", outline: rect(0, 300, 200, 200), written: "", existing: true, openTo: "", stair: "" },
    ],
    openings: [win("Bed 4", "N", 2400), win("Bed 4", "W", 900), win("Bathroom", "S", 600)],
    marks: [],
    furniture: [],
    checklist: [],
    flags: [{ kind: "label_inside", text: "WC", at: { x: 250, y: 50 }, room: "Bathroom" }],
  };
  const floor = { plans: [{ id: "s1", imageRef: "r", pageNumber: 1, name: "p", width: 1000, height: 800, x: 100, y: 50 }] };

  it("places her rooms on the floor, leaves out outside, stairs and what stays as it is, and ticks the served ones", () => {
    const s = suggestionsFor(floor, [sheet]);
    expect(s.map((x) => [x.name, x.keep])).toEqual([
      ["Bed 4", true],
      ["Bathroom", false],
      ["Robe", false],
    ]);
    expect(s[0].points[0]).toEqual({ x: 100, y: 50 });
    expect(s[1].notes).toEqual(['"WC" is written inside Bathroom: a space of its own?']);
    expect(s[0].windows).toHaveLength(2);
  });

  it("ticks bedrooms, living spaces, kitchens and studies; not wet rooms or cupboards", () => {
    expect(servedByDefault({ kind: "room", name: "Master Bed 1" })).toBe(true);
    expect(servedByDefault({ kind: "room", name: "Living / Dining / Kitchen" })).toBe(true);
    expect(servedByDefault({ kind: "room", name: "Study" })).toBe(true);
    expect(servedByDefault({ kind: "room", name: "Hallway" })).toBe(false);
    expect(servedByDefault({ kind: "wet", name: "Ensuite" })).toBe(false);
  });

  it("glazing by the fixed cut-offs, and facing the wall with the most glass", () => {
    expect(glazingFor(20, 2)).toBe("low");
    expect(glazingFor(20, 4)).toBe("moderate");
    expect(glazingFor(20, 7)).toBe("high");
    expect(glazingFor(0, 3)).toBeUndefined();
    expect(orientationFor({ windows: [win("x", "N", 2400), win("x", "W", 900), win("x", "E", 3000, false)] })).toBe("N");
  });

  it("joins a room and its robe across the wall into one outline", () => {
    const joined = joinOutlines(rect(0, 0, 200, 150), rect(0, 160, 120, 40), 15);
    // an L: the room's full width, then the robe's narrower strip under it
    expect(joined).toHaveLength(6);
    const xs = joined.map((p) => p.x);
    const ys = joined.map((p) => p.y);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(200);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(200);
  });

  it("rooms that don't meet join as the hull round both", () => {
    const joined = joinOutlines(rect(0, 0, 100, 100), rect(500, 0, 100, 100), 15);
    expect(joined).toHaveLength(4);
  });

  it("a kept room becomes a Studio room with its load inputs", () => {
    const s: Suggestion = { key: "k", name: "Bed 4", kind: "room", points: rect(0, 0, 300, 250), keep: true, notes: [], windows: [win("Bed 4", "N", 2400)] };
    // 300 x 250 units at 14 mm a unit: 4.2 m x 3.5 m, 14.7 m²; 2.88 m² of glass is 20%: moderate
    const room = roomFrom(s, "f1", 14, true);
    expect(room).toMatchObject({ type: "room", floorId: "f1", systemId: null, plane: "room" });
    expect(room.props).toMatchObject({ name: "Bed 4", glazing: "moderate", orientation: "N", roomAbove: true, hasExternalWalls: true, shape: "rect", fromReading: true });
  });
});
