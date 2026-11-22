import type { Line } from "../fills";
import { arrowsOf, pitchOf, riseOf, roofLines, type RoofWord } from "../roof";
import { placeFaces, type FloorUnder } from "../roof-place";
import { faceMesh } from "../../roof3d";
import type { ReadRoofPart, ReadSpace } from "../../reading";

/* A ROOF PLAN DRAWN BY CODE, as an architect draws one: a hip roof 200 by
   100 points, its eaves, ridge and four hips as thin black lines, and in
   each face its pitch with an arrow down its fall (a shaft and two head
   strokes heavier than the outlines, as 3570's A104 draws them). */
const ink = (a: [number, number], b: [number, number], width = 0.24): Line => ({ colour: "#000000", width, a, b });
const arrow = (from: [number, number], dir: [number, number]): Line[] => {
  const tip: [number, number] = [from[0] + dir[0] * 14, from[1] + dir[1] * 14];
  const head = (turn: number): [number, number] => {
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    return [tip[0] - (dir[0] * c - dir[1] * s) * 5, tip[1] - (dir[0] * s + dir[1] * c) * 5];
  };
  return [ink(from, tip), ink(tip, head(0.4), 1.4), ink(tip, head(-0.4), 1.4)];
};
const hipRoof = (pitches: [number, number, number, number] = [30, 30, 30, 30]) => {
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

describe("a printed roof pitch", () => {
  it.each([
    ["40.0°", 40],
    ["5°", 5],
    ["FALL 8°", 8],
    ["PITCH 22.5 DEG", 22.5],
    ["roof pitch 15°", 15],
  ])("%s is %d degrees", (text, deg) => expect(pitchOf(text)).toBe(deg));
  it.each(["RL 67.550", "90°", "W1.3", "8", "FALL"])("%s is no pitch", (text) => expect(pitchOf(text)).toBeNull());
});

describe("arrows on a roof plan", () => {
  it("a shaft with two mirrored head strokes is an arrow, pointing to its tip", () => {
    const [a] = arrowsOf(arrow([0, 0], [1, 0]));
    expect(a.dir[0]).toBeCloseTo(1, 5);
    expect(a.dir[1]).toBeCloseTo(0, 5);
    expect(a.mid).toEqual([7, 0]);
  });
  it("three lines meeting at a corner are no arrow", () => {
    expect(arrowsOf([ink([0, 0], [20, 0]), ink([0, 0], [0, 20]), ink([0, 0], [14, 14])])).toEqual([]);
  });
});

describe("the roof's faces off its lines", () => {
  it("each face the lines close round a pitch, with its fall from its arrow", () => {
    const r = roofLines(hipRoof());
    if ("none" in r) throw new Error(r.none);
    expect(r.faces).toHaveLength(4);
    expect(r.left).toEqual([]);
    const north = r.faces.find((f) => f.fall[1] < -0.9)!;
    expect(north.pitchDeg).toBe(30);
    /* the north face: a trapezoid, eave along y 100, ridge along y 150 */
    const ys = north.outline.map((p) => p[1]);
    expect(Math.min(...ys)).toBeCloseTo(100, 0);
    expect(Math.max(...ys)).toBeCloseTo(150, 0);
  });
  it("the faces rise to one ridge: a hip roof's faces meet at the same height", () => {
    const r = roofLines(hipRoof());
    if ("none" in r) throw new Error(r.none);
    const tops = r.faces.map((f) => Math.max(...riseOf(f.outline, f.fall, f.pitchDeg)));
    for (const t of tops) expect(t).toBeCloseTo(50 * Math.tan(Math.PI / 6), 0);
  });
  it("a page with no arrows by its pitches gives no roof", () => {
    const { lines, ...rest } = hipRoof();
    const r = roofLines({ ...rest, lines: lines.filter((l) => l.width < 1 && Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]) > 20) });
    expect("none" in r).toBe(true);
  });
  it("two pitches in one shape (a line missing between them) are left out, said why", () => {
    const roof = hipRoof();
    /* the ridge gone: the north and south faces one shape */
    const lines = roof.lines.filter((l) => !(l.a[1] === 150 && l.b[1] === 150));
    const r = roofLines({ ...roof, lines: lines.filter((l) => !(l.a[0] === 100 && l.b[0] === 150) && !(l.a[0] === 300 && l.b[0] === 250)) });
    if ("none" in r) return;
    expect(r.left.some((l) => /another pitch/.test(l.why))).toBe(true);
  });
});

describe("a face's rise", () => {
  it("a plane face rises up its fall from its longest eave line; a stepped-out eave sits lower", () => {
    /* eave along y 0 for 100, then stepped out to y -10 for 20: one plane falling to -y */
    const outline: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, -10],
      [120, -10],
      [120, 50],
      [0, 50],
    ];
    const rise = riseOf(outline, [0, -1], 45);
    expect(rise[0]).toBeCloseTo(0, 5);
    expect(rise[2]).toBeCloseTo(-10, 5);
    expect(rise[4]).toBeCloseTo(50, 5);
  });
  it("a face with no eave square to its fall rises from its lowest corner", () => {
    const rise = riseOf(
      [
        [0, 0],
        [10, 10],
        [0, 20],
      ],
      [-1, 0],
      45,
    );
    expect(rise.map((r) => Math.round(r))).toEqual([0, 10, 0]);
  });
});

describe("the roof plan's faces set over the floors", () => {
  const room = (name: string, x0: number, y0: number, x1: number, y1: number): ReadSpace => ({
    name,
    named: true,
    kind: "room",
    outline: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
    written: "",
    existing: false,
    openTo: "",
    stair: "",
  });
  const ground: FloorUnder = { floorId: "g", sheetId: "g", level: 0, pxPerPt: 1, spaces: [room("Living", 110, 110, 290, 190)], ceilingMm: 2700, mmPerPx: 35 };
  const part: ReadRoofPart = {
    floorId: "g",
    sheetId: "g",
    form: "hip",
    outline: [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 200 },
      { x: 100, y: 200 },
    ],
    ridge: "across",
    fallsTo: "",
    pitchDeg: 30,
    eaveMm: 2550,
    overhangMm: 450,
    existing: false,
    source: "Sections",
  };
  it("each face onto the floor under it, its eave height the read's of the part it sits in", () => {
    const r = roofLines(hipRoof());
    if ("none" in r) throw new Error(r.none);
    const placed = placeFaces(r.faces, 4, [ground], [part]);
    if ("none" in placed) throw new Error(placed.none);
    expect(placed.faces).toHaveLength(4);
    expect(placed.faces.every((f) => f.floorId === "g" && f.eaveMm === 2550 && f.page === 4)).toBe(true);
    /* no walls drawn in the file: the eave sits at the wall line, not the read's guessed overhang */
    expect(placed.faces.every((f) => f.overhangMm === 0)).toBe(true);
  });
  it("a roof plan the rooms don't stand under isn't put over them", () => {
    const r = roofLines(hipRoof());
    if ("none" in r) throw new Error(r.none);
    const away = { ...ground, spaces: [room("Living", 500, 500, 600, 600)] };
    expect(placeFaces(r.faces, 4, [away], [part])).toEqual({ none: expect.stringContaining("0 of the 1 rooms") });
  });
  it("a face that doesn't meet its neighbours at one height is left out", () => {
    /* the east face printed at 60°: its hips stand far above the faces it meets */
    const r = roofLines(hipRoof([30, 30, 30, 60]));
    if ("none" in r) throw new Error(r.none);
    const placed = placeFaces(r.faces, 4, [ground], [part]);
    if ("none" in placed) throw new Error(placed.none);
    expect(placed.faces).toHaveLength(3);
    expect(placed.faces.some((f) => f.pitchDeg === 60)).toBe(false);
    expect(placed.left).toBe(1);
  });
});

describe("a face's mesh", () => {
  it("a notched face is cut into triangles covering it once", () => {
    const pts: [number, number, number][] = [
      [0, 0, 0],
      [4, 0, 0],
      [4, 0, 1],
      [1, 0, 1],
      [1, 0, 3],
      [0, 0, 3],
    ];
    const m = faceMesh(pts);
    expect(m.tris).toHaveLength(3 * 4);
    let area = 0;
    for (let i = 0; i < m.tris.length; i += 3) {
      const [a, b, c] = [m.verts[m.tris[i]], m.verts[m.tris[i + 1]], m.verts[m.tris[i + 2]]];
      area += Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) / 2;
    }
    expect(area).toBeCloseTo(4 + 2, 5);
  });
});
