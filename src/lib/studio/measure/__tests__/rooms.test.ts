import type { ReadSpace } from "../../reading";
import { agreement, parseCorners, snapRooms, type NamedRoom } from "../rooms";
import { gridOf, wallSizes, type Walls, type WallSeg } from "../walls";

/* two rooms side by side, 20 mm a pixel: outside walls 16 px thick on lines
   x 100 / 700 and y 100 / 500, the wall between them 10 px on x 400 */
const z = wallSizes(900, 20);
const segs: WallSeg[] = [
  { dir: "h", c: 100, a: 92, b: 708, t: 16 },
  { dir: "h", c: 500, a: 92, b: 708, t: 16 },
  { dir: "v", c: 100, a: 92, b: 508, t: 16 },
  { dir: "v", c: 700, a: 92, b: 508, t: 16 },
  { dir: "v", c: 400, a: 100, b: 250, t: 10 },
  { dir: "v", c: 400, a: 300, b: 500, t: 10 },
  /* a short return no grid line runs through */
  { dir: "h", c: 300, a: 400, b: 440, t: 10 },
];
const walls: Walls = { shade: 128, segs, grid: gridOf(segs, z), run: 3000 };
const same = (v: number) => v;
const room = (
  name: string,
  corners: string,
  over: Partial<NamedRoom> = {},
): NamedRoom => ({
  name,
  named: true,
  kind: "room",
  corners,
  openTo: "",
  stair: "",
  ...over,
});
const snap = (
  rooms: NamedRoom[],
  words: { text: string; at: { x: number; y: number } }[] = [],
) =>
  snapRooms(rooms, walls, z, { backX: same, backY: same, words, mmPerPx: 20 });

describe("corners", () => {
  it("are a line's number or a bare pixel, an x then a y", () => {
    expect(walls.grid).toEqual({ x: [100, 400, 700], y: [100, 500] });
    expect(
      parseCorners("x0,y0 x1,y0 x1,312 x0,y1", walls.grid, same, same),
    ).toEqual([
      { x: { v: 100, line: 0 }, y: { v: 100, line: 0 } },
      { x: { v: 400, line: 1 }, y: { v: 100, line: 0 } },
      { x: { v: 400, line: 1 }, y: { v: 312, line: null } },
      { x: { v: 100, line: 0 }, y: { v: 500, line: 1 } },
    ]);
  });
  it("aren't, when a y is given for an x, a line doesn't exist, or there are fewer than three", () => {
    expect(
      parseCorners("y0,x0 x1,y0 x1,y1", walls.grid, same, same),
    ).toBeNull();
    expect(
      parseCorners("x0,y0 x9,y0 x1,y1", walls.grid, same, same),
    ).toBeNull();
    expect(parseCorners("x0,y0 x1,y1", walls.grid, same, same)).toBeNull();
  });
  it("come back from her picture's pixels to the sheet's", () => {
    expect(
      parseCorners(
        "50,60 x1,y0 x1,y1",
        walls.grid,
        (v) => v * 2 + 10,
        (v) => v * 2,
      )![0],
    ).toEqual({ x: { v: 110, line: null }, y: { v: 120, line: null } });
  });
});

describe("rooms set on the walls", () => {
  it("stand on the inside face of each wall they name", () => {
    const { spaces, problems } = snap([
      room("Lounge", "x0,y0 x1,y0 x1,y1 x0,y1"),
      room("Bed", "x1,y0 x2,y0 x2,y1 x1,y1"),
    ]);
    expect(problems).toEqual([]);
    /* half of 16 in from the outside walls, half of 10 from the wall between */
    expect(spaces[0].outline).toEqual([
      { x: 108, y: 108 },
      { x: 395, y: 108 },
      { x: 395, y: 492 },
      { x: 108, y: 492 },
    ]);
    expect(spaces[1].outline[0]).toEqual({ x: 405, y: 108 });
  });
  it("put a bare pixel onto the wall it was meant for", () => {
    /* 296 given for the short return on y 300 */
    const { spaces } = snap([
      room("Robe", "x1,296 x2,296 x2,y1 x1,y1", { kind: "cupboard" }),
    ]);
    expect(spaces[0].outline[0].y).toBe(305);
  });
  it("go round the same whichever way the corners are given", () => {
    const a = snap([room("Lounge", "x0,y0 x1,y0 x1,y1 x0,y1")]).spaces[0]
      .outline;
    const b = snap([room("Lounge", "x0,y0 x0,y1 x1,y1 x1,y0")]).spaces[0]
      .outline;
    expect(new Set(b.map((p) => `${p.x},${p.y}`))).toEqual(
      new Set(a.map((p) => `${p.x},${p.y}`)),
    );
  });
  it("keep an outdoor space on the lines given, with no wall to step in from", () => {
    const { spaces } = snap([
      room("Terrace", "x0,y1 x2,y1 x2,600 x0,600", { kind: "outdoor" }),
    ]);
    expect(spaces[0].outline[0]).toEqual({ x: 100, y: 500 });
  });
});

describe("what a reading is checked for", () => {
  it("two rooms holding the same floor", () => {
    const { problems } = snap([
      room("Lounge", "x0,y0 x2,y0 x2,y1 x0,y1"),
      room("Bed", "x1,y0 x2,y0 x2,y1 x1,y1"),
    ]);
    expect(problems.map((p) => p.kind)).toEqual(["overlap"]);
    expect(problems[0].said).toBe(
      "Lounge and Bed overlap. One of them is between the wrong lines.",
    );
  });
  it("but not a stair inside the hall it rises from", () => {
    const { problems } = snap([
      room("Hall", "x0,y0 x1,y0 x1,y1 x0,y1", { kind: "circulation" }),
      room("Stair", "150,150 250,150 250,300 150,300", {
        kind: "stair",
        named: false,
      }),
    ]);
    expect(problems).toEqual([]);
  });
  it("a room most of whose sides run along no wall", () => {
    const { problems } = snap([
      room("Study", "200,200 350,200 350,400 200,400"),
    ]);
    expect(problems.map((p) => p.kind)).toEqual(["off_wall"]);
  });
  it("a name the plan writes somewhere else", () => {
    const words = [{ text: "BED", at: { x: 550, y: 300 } }];
    const { problems } = snap([room("Bed", "x0,y0 x1,y0 x1,y1 x0,y1")], words);
    expect(problems.map((p) => p.kind)).toEqual(["label"]);
    expect(
      snap([room("Bed", "x1,y0 x2,y0 x2,y1 x1,y1")], words).problems,
    ).toEqual([]);
  });
  it("corners that aren't corners, or that enclose nothing: said, and the room left out", () => {
    const { spaces, problems } = snap([
      room("Lounge", "between the walls"),
      room("Niche", "x0,y0 x0,y0 x0,y1"),
    ]);
    expect(spaces).toEqual([]);
    expect(problems.map((p) => p.kind)).toEqual(["shape", "small"]);
  });
});

describe("two readings of one floor", () => {
  const sq = (name: string, x: number, y: number, w = 100): ReadSpace => ({
    name,
    named: true,
    kind: "room",
    outline: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + w },
      { x, y: y + w },
    ],
    written: "",
    existing: false,
    openTo: "",
    stair: "",
  });
  it("agree on a room each sets round the other's middle, and say what only one found", () => {
    const a = [
      sq("Bed 1", 0, 0),
      sq("Ensuite", 200, 0),
      sq("Ensuite", 600, 0),
      sq("Study", 400, 400),
    ];
    const b = [
      sq("BED 1", 10, 10),
      sq("Ensuite", 610, 5),
      sq("Ensuite", 900, 900),
      sq("Robe", 0, 400),
    ];
    expect(agreement(a, b)).toEqual({
      both: 3,
      agree: 2,
      onlyA: ["Study"],
      onlyB: ["Robe"],
    });
  });
});
