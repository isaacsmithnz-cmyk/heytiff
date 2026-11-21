import type { Fill, Ring } from "../fills";

/* A small plan as a drawing file holds it: three rooms in a row, 300 by 100
   points inside walls 4 points thick (140 mm at 1:100), filled grey. The
   outside walls have window gaps, each wall between two rooms a door gap.
   Words are on the walls' grid, two pixels a point. */

const bar = (x0: number, y0: number, x1: number, y1: number): Ring => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

export const WALLS: Ring[] = [
  /* top, with two windows */
  bar(50, 50, 120, 54),
  bar(140, 50, 260, 54),
  bar(280, 50, 350, 54),
  /* bottom, with two windows */
  bar(50, 146, 100, 150),
  bar(120, 146, 200, 150),
  bar(220, 146, 350, 150),
  /* left, with a window; right */
  bar(50, 54, 54, 90),
  bar(50, 110, 54, 146),
  bar(346, 54, 350, 146),
  /* between the rooms, each with a door */
  bar(148, 54, 152, 100),
  bar(148, 125, 152, 146),
  bar(248, 54, 252, 100),
  bar(248, 125, 252, 146),
];

export const threeRooms = (): Fill[] => [
  ...WALLS.map((r) => ({ colour: "#808080", rings: [r] })),
  /* paving outside, paler and square */
  ...[0, 1, 2, 3].map((i) => ({ colour: "#c0c0c0", rings: [bar(60 + i * 40, 170, 90 + i * 40, 200)] })),
  /* a legend's box, black and on its own */
  { colour: "#000000", rings: [bar(370, 250, 380, 260)] },
];

export const roomWords = [
  { text: "BED 1", at: { x: 200, y: 200 } },
  { text: "LIVING", at: { x: 400, y: 200 } },
  { text: "ENSUITE", at: { x: 600, y: 200 } },
  /* a note inside the living room is no room's name */
  { text: "SMOKE ALARM TO AS3786", at: { x: 400, y: 250 } },
  { text: "FFL 194.000", at: { x: 400, y: 270 } },
];
