import type { Line } from "../fills";
import type { RoofWord } from "../roof";

/* A ROOF PLAN DRAWN BY CODE, as an architect draws one: a hip roof 200 by
   100 points, its eaves, ridge and four hips as thin black lines, and in
   each face its pitch with an arrow down its fall (a shaft and two head
   strokes heavier than the outlines, as 3570's A104 draws them). */

export const ink = (a: [number, number], b: [number, number], width = 0.24): Line => ({ colour: "#000000", width, a, b });

export const arrow = (from: [number, number], dir: [number, number]): Line[] => {
  const tip: [number, number] = [from[0] + dir[0] * 14, from[1] + dir[1] * 14];
  const head = (turn: number): [number, number] => {
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    return [tip[0] - (dir[0] * c - dir[1] * s) * 5, tip[1] - (dir[0] * s + dir[1] * c) * 5];
  };
  return [ink(from, tip), ink(tip, head(0.4), 1.4), ink(tip, head(-0.4), 1.4)];
};

/** The roof on a page 400 by 300 points, its eaves at 100 and 300 across and 100 and 200 down; its faces' pitches north, south, west, east. */
export const hipRoof = (pitches: [number, number, number, number] = [30, 30, 30, 30]) => {
  const [x0, y0, x1, y1] = [100, 100, 300, 200];
  const lines: Line[] = [
    ink([x0, y0], [x1, y0]),
    ink([x1, y0], [x1, y1]),
    ink([x1, y1], [x0, y1]),
    ink([x0, y1], [x0, y0]),
    ink([150, 150], [250, 150]),
    ink([x0, y0], [150, 150]),
    ink([x1, y0], [250, 150]),
    ink([x1, y1], [250, 150]),
    ink([x0, y1], [150, 150]),
    /* each face's arrow, its middle in the face, down its fall */
    ...arrow([200, 125], [0, -1]),
    ...arrow([200, 175], [0, 1]),
    ...arrow([120, 150], [-1, 0]),
    ...arrow([280, 150], [1, 0]),
  ];
  const words: RoofWord[] = [
    { text: `${pitches[0]}.0°`, at: { x: 200, y: 115 } },
    { text: `${pitches[1]}.0°`, at: { x: 200, y: 185 } },
    { text: `${pitches[2]}°`, at: { x: 116, y: 140 } },
    { text: `FALL ${pitches[3]}°`, at: { x: 284, y: 140 } },
  ];
  return { lines, words, width: 400, height: 300 };
};
