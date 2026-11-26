import type { ReadSpace, SpaceKind } from "../reading";
import { footprintSpaces, lineUpShift } from "../line-up";

/* A DESIGN'S FLOORS STACK AS THE HOUSE DOES (Isaac, 26 November 2026):
   job 3608's three floors as Tiff read them, each where its own sheet
   drew it, rooms by their outlines (no names of the client's) */

const space = (name: string, kind: SpaceKind, outline: [number, number][]): ReadSpace => ({
  name,
  named: true,
  kind,
  outline: outline.map(([x, y]) => ({ x, y })),
  written: "",
  existing: false,
  openTo: "",
  stair: "",
});
const box = (name: string, kind: SpaceKind, x0: number, y0: number, x1: number, y1: number) =>
  space(name, kind, [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]);

/* the ground floor, page 8 */
const ground = [
  box("Bed 2", "room", 713, 744, 923, 944),
  box("Bath", "wet", 931, 797, 1052, 978),
  box("Bed 3", "room", 1092, 744, 1259, 976),
  box("Bed 1", "room", 1028, 293, 1272, 460),
  box("Hall", "circulation", 1028, 463, 1272, 736),
  box("Lounge / Dining / Kitchen", "room", 1315, 293, 1610, 885),
  box("Laundry", "wet", 1437, 891, 1610, 989),
  box("Ex. Balcony", "outdoor", 880, 282, 1010, 551),
  box("Entry Patio", "outdoor", 880, 617, 1010, 725),
  box("Rear Patio", "outdoor", 1620, 282, 1817, 808),
];
/* the lower ground, page 6: the same house drawn 407 to the east */
const lower = [
  box("Garage", "garage", 1120, 745, 1664, 958),
  box("Sub Floor (west strip)", "other", 1284, 282, 1413, 728),
  space("Sub Floor", "other", [
    [1430, 292],
    [1664, 292],
    [1664, 556],
    [1935, 556],
    [1935, 813],
    [2138, 813],
    [2138, 980],
    [1680, 980],
    [1680, 739],
    [1430, 739],
  ]),
];
/* level 1, page 9: drawn in line with the ground floor */
const upper = [
  box("Master Bed 4", "room", 1243, 349, 1542, 567),
  box("Study", "room", 1049, 351, 1201, 532),
  box("Stair", "stair", 1025, 544, 1182, 661),
  box("Landing", "circulation", 1182, 476, 1278, 601),
  box("Ensuite", "wet", 1410, 543, 1542, 730),
];

it("moves a floor drawn elsewhere on its sheet onto the floor it's under", () => {
  const s = lineUpShift(ground, lower);
  expect(s).not.toBeNull();
  /* the garage under Bed 2 to Bed 3: 407 west, within a fine cell */
  expect(Math.abs(s!.dx - -407)).toBeLessThanOrEqual(16);
  expect(Math.abs(s!.dy)).toBeLessThanOrEqual(16);
});

it("leaves a floor already in line where it is, though it fits inside many ways", () => {
  expect(lineUpShift(ground, upper)).toBeNull();
});

it("leaves a floor with nothing read on it alone", () => {
  expect(lineUpShift(ground, [])).toBeNull();
  expect(lineUpShift([], lower)).toBeNull();
});

it("stands a floor on its rooms, its garage and a balcony, not on a patio", () => {
  expect(footprintSpaces(ground).map((s) => s.name)).not.toContain("Entry Patio");
  expect(footprintSpaces(ground).map((s) => s.name)).toContain("Ex. Balcony");
  expect(footprintSpaces(lower).map((s) => s.name)).toContain("Garage");
});
