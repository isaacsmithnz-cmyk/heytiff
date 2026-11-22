import { fillsOf, type FillOps } from "../fills";
import { wallsOf } from "../walls";
import { bridged, enclose, gapsOf, outlined, rasterise, simplify } from "../enclose";
import { roomWord, vectorRooms } from "../read";
import { lineWalls } from "../lines";
import { facesOf, snapped } from "../snap";
import type { Line } from "../fills";
import { roomWords, threeRooms, WALLS } from "../__fixtures__/three-rooms";

/* pdf.js's OPS numbers, as many as are read */
const O: FillOps = { save: 10, restore: 11, transform: 12, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, setFillRGBColor: 59, setFillGray: 57, eoClip: 39, clip: 38, constructPath: 91, endPath: 28, fill: 22, eoFill: 23, fillStroke: 24, eoFillStroke: 25 };
const path = (op: number, pts: number[][]) => [op, [Float32Array.from(pts.flatMap(([x, y], i) => [i === 0 ? 0 : 1, x, y]).concat([4]))], null];

describe("the filled shapes in a page's drawing", () => {
  it("a grey box masked by a wall-shaped clip is the clip's shape, in the page's points", () => {
    const wall = [[10, 10], [60, 10], [60, 14], [14, 14], [14, 40], [10, 40]];
    const box = [[10, 10], [60, 10], [60, 40], [10, 40]];
    const fns = [O.save, O.eoClip, O.constructPath, O.clip, O.constructPath, O.setFillRGBColor, O.constructPath, O.restore];
    const args = [null, null, path(O.endPath, wall), null, path(O.endPath, [[0, 0], [500, 0], [500, 500], [0, 500]]), ["#808080"], path(O.fill, box), null];
    const fills = fillsOf(fns, args, O, [1, 0, 0, 1, 0, 0]);
    expect(fills).toEqual([{ colour: "#808080", rings: [wall] }]);
  });
  it("a fill under a page-wide clip stays as it is drawn, placed where a form puts it", () => {
    const fns = [O.eoClip, O.constructPath, O.paintFormXObjectBegin, O.setFillGray, O.constructPath, O.paintFormXObjectEnd];
    const args = [null, path(O.endPath, [[0, 0], [500, 0], [500, 500], [0, 500]]), [[2, 0, 0, 2, 100, 0]], [0.5], path(O.fill, [[0, 0], [10, 0], [10, 2], [0, 2]]), null];
    const [f] = fillsOf(fns, args, O, [1, 0, 0, 1, 0, 0]);
    expect(f.colour).toBe("#808080");
    expect(f.rings[0]).toEqual([[100, 0], [120, 0], [120, 4], [100, 4]]);
  });
});

describe("which fills are the walls", () => {
  it("the dark long thin shapes, not the pale paving or a legend's box on its own", () => {
    const w = wallsOf(threeRooms(), null)!;
    expect(w.colours).toEqual(["#808080"]);
    expect(w.shapes).toHaveLength(WALLS.length);
    expect(w.thickness).toBeGreaterThan(3);
    expect(w.thickness).toBeLessThan(4.1);
  });
  it("none, on a plan drawn in lines or a sheet that is a picture", () => {
    expect(wallsOf([{ colour: "#ffffff", rings: WALLS }], null)).toBeNull();
    expect(wallsOf(threeRooms().slice(0, 5), null)).toBeNull();
  });
});

describe("the spaces the walls close off", () => {
  it("a doorway's gap is closed, the open side of a room isn't", () => {
    /* a 20-pixel grid: a wall along the top with a 4-pixel gap, and two walls 10 apart running down */
    const W = 20;
    const g = new Uint8Array(W * W);
    for (let x = 0; x < 20; x++) if (x < 8 || x >= 12) g[2 * W + x] = g[3 * W + x] = 1;
    for (let y = 6; y < 20; y++) g[y * W + 4] = g[y * W + 14] = 1;
    const b = bridged(g, W, W, 6, 3);
    expect([8, 9, 10, 11].every((x) => b[2 * W + x] && b[3 * W + x])).toBe(true);
    /* between the two walls running down: open, they are no doorway */
    expect([5, 9, 13].some((x) => b[10 * W + x])).toBe(false);
  });
  it("outlines a room on its walls' faces, corners only", () => {
    const grid = rasterise(threeRooms().slice(0, WALLS.length).map((f) => f.rings), 400, 300, 2);
    const e = enclose(grid, 800, 600, 274, 22);
    const bed = e.spaces.find((s) => !s.open && s.box[0] === 108)!;
    expect(outlined(e, bed)).toEqual([
      [108, 108],
      [296, 108],
      [296, 292],
      [108, 292],
    ]);
  });
  it("a slanted run of pixel steps comes back as its line", () => {
    const steps: [number, number][] = [[0, 0], [10, 0], [10, 1], [11, 1], [11, 2], [12, 2], [12, 3], [13, 3], [13, 10], [0, 10]];
    expect(simplify(steps)).toEqual([[0, 0], [10, 0], [13, 3], [13, 10], [0, 10]]);
  });
});

describe("a floor's rooms read from its drawing file", () => {
  const input = { fills: threeRooms(), width: 400, height: 300, words: roomWords, mmPerPt: null, rasterScale: 2 };
  it("each room on its walls, named by the plan's own words, a note no name", () => {
    const r = vectorRooms(input);
    if ("none" in r) throw new Error(r.none);
    expect(r.spaces.map((s) => [s.name, s.kind, s.named])).toEqual([
      ["Bed 1", "room", true],
      ["Living", "room", true],
      ["Ensuite", "wet", true],
    ]);
    expect(r.spaces[0].outline).toEqual([
      { x: 108, y: 108 },
      { x: 296, y: 108 },
      { x: 296, y: 292 },
      { x: 108, y: 292 },
    ]);
    expect(r.look).toEqual([]);
    expect(r.found).toMatchObject({ colours: ["#808080"], rooms: 3, named: 3, labels: 3, landed: 3 });
  });
  it("in the sheet's own raster, when it is drawn at another size", () => {
    const r = vectorRooms({ ...input, rasterScale: 1 });
    if ("none" in r) throw new Error(r.none);
    expect(r.spaces[0].outline[0]).toEqual({ x: 54, y: 54 });
  });
  it("two names in one space with no wall between them are said", () => {
    const r = vectorRooms({ ...input, words: [...roomWords, { text: "ROBE", at: { x: 260, y: 160 } }] });
    if ("none" in r) throw new Error(r.none);
    expect(r.spaces[0].name).toBe("Bed 1, Robe");
    expect(r.look).toEqual([{ kind: "label", room: "Bed 1, Robe", said: "Bed 1, Robe: the plan writes 2 names in one space with no wall between them. It may be 2 rooms." }]);
  });
  it("isn't trusted when the room names it writes don't land in rooms", () => {
    expect(vectorRooms({ ...input, words: [] })).toEqual({ none: "Only 3 rooms closed off between its walls, and it writes no room names as text" });
    expect(vectorRooms({ ...input, fills: [] })).toEqual({ none: "Its walls aren't drawn in the file, filled or in lines" });
  });
});

describe("words that name a room", () => {
  it("are a room's words, or a short label in capitals, never a note, a tag or a level", () => {
    expect(["BED 4", "Kitchen", "WIR", "FAMILY ROOM", "Ensuite"].map(roomWord)).toEqual([2, 2, 2, 2, 2]);
    expect(roomWord("MAHJONG")).toBe(2);
    expect(roomWord("SHELF")).toBe(1);
    expect(["W.05", "FFL 194.000", "SMOKE ALARMS TO COMPLY WITH", "2400", "Soundscreen Batts to walls"].map(roomWord)).toEqual([0, 0, 0, 0, 0]);
  });
});

/* the same three rooms drawn as their walls' two faces, in lines */
const facesOfWalls = (): Line[] =>
  WALLS.flatMap((r) => {
    const [[x0, y0], , [x1, y1]] = r;
    const long = x1 - x0 >= y1 - y0;
    return long
      ? [
          { colour: "#000000", width: 0.5, a: [x0, y0] as [number, number], b: [x1, y0] as [number, number] },
          { colour: "#000000", width: 0.5, a: [x0, y1] as [number, number], b: [x1, y1] as [number, number] },
        ]
      : [
          { colour: "#000000", width: 0.5, a: [x0, y0] as [number, number], b: [x0, y1] as [number, number] },
          { colour: "#000000", width: 0.5, a: [x1, y0] as [number, number], b: [x1, y1] as [number, number] },
        ];
  });

describe("walls drawn in lines", () => {
  it("two faces a wall's thickness apart are a wall, and the rooms are read between them", () => {
    const w = lineWalls(facesOfWalls(), null)!;
    expect(w.colours).toEqual(["lines"]);
    expect(w.thickness).toBeCloseTo(4, 1);
    const r = vectorRooms({ fills: [], lines: facesOfWalls(), width: 400, height: 300, words: roomWords, mmPerPt: null, rasterScale: 2 });
    if ("none" in r) throw new Error(r.none);
    expect(r.spaces.map((s) => s.name)).toEqual(["Bed 1", "Living", "Ensuite"]);
    expect(r.spaces[0].outline[0]).toEqual({ x: 108, y: 108 });
  });
  it("a stair's treads, evenly spaced, are no wall", () => {
    const treads: Line[] = Array.from({ length: 12 }, (_, i) => ({ colour: "#000000", width: 0.5, a: [100, 100 + i * 7] as [number, number], b: [130, 100 + i * 7] as [number, number] }));
    expect(lineWalls(treads, null)).toBeNull();
  });
});

describe("a room read by picture, put on the drawing's walls", () => {
  it("each side moves onto the face of the wall along it on the room's side, within reach", () => {
    const faces = facesOf(facesOfWalls(), [], 8, 1, 18);
    const bed = { name: "Bed 1", named: true, kind: "room" as const, written: "", existing: false, openTo: "", stair: "", outline: [{ x: 57, y: 53 }, { x: 146, y: 55 }, { x: 146, y: 144 }, { x: 57, y: 144 }] };
    const { spaces, moved, sides } = snapped([bed], faces, 1, 6);
    expect(spaces[0].outline).toEqual([
      { x: 54, y: 54 },
      { x: 148, y: 54 },
      { x: 148, y: 146 },
      { x: 54, y: 146 },
    ]);
    expect([moved, sides]).toEqual([4, 4]);
  });
  it("a side with no wall in reach stays where it was read", () => {
    const faces = facesOf(facesOfWalls(), [], 8, 1, 18);
    const odd = { name: "Nook", named: true, kind: "room" as const, written: "", existing: false, openTo: "", stair: "", outline: [{ x: 80, y: 80 }, { x: 120, y: 80 }, { x: 120, y: 120 }, { x: 80, y: 120 }] };
    expect(snapped([odd], faces, 1, 6).spaces[0].outline).toEqual(odd.outline);
  });
});

describe("two rooms' names in one space", () => {
  it("are parted where a wall end faces a wall across it: a WC off the living room", () => {
    /* a wall up from the living room's floor, stopping short of the wall across: the WC's open side */
    const fills = [...threeRooms(), { colour: "#808080", rings: [[[200, 100], [204, 100], [204, 146], [200, 146]] as [number, number][]] }];
    const words = [...roomWords.filter((w) => w.text !== "LIVING"), { text: "LIVING", at: { x: 340, y: 160 } }, { text: "WC", at: { x: 450, y: 250 } }];
    const r = vectorRooms({ fills, width: 400, height: 300, words, mmPerPt: null, rasterScale: 2 });
    if ("none" in r) throw new Error(r.none);
    expect(r.spaces.map((s) => [s.name, s.kind])).toEqual([
      ["Bed 1", "room"],
      ["Living", "room"],
      ["WC", "wet"],
      ["Ensuite", "wet"],
    ]);
    expect(r.look).toEqual([]);
  });
});

describe("the walls themselves, and the gaps in them", () => {
  it("come back with the rooms: the file's shapes in the sheet's pixels, and each door's and window's gap jamb to jamb", () => {
    const r = vectorRooms({ fills: threeRooms(), width: 400, height: 300, words: roomWords, mmPerPt: null, rasterScale: 2 });
    if ("none" in r) throw new Error(r.none);
    expect(r.walls).toHaveLength(WALLS.length);
    /* the top wall's first piece, 50,50 to 120,54 points, at two pixels a point */
    expect(r.walls[0][0]).toEqual([{ x: 100, y: 100 }, { x: 240, y: 100 }, { x: 240, y: 108 }, { x: 100, y: 108 }]);
    /* two windows in the top wall, two in the bottom, one in the left, a door in each wall between */
    expect(r.gaps).toHaveLength(7);
    expect(r.gaps).toContainEqual({ a: { x: 240, y: 104 }, b: { x: 280, y: 104 }, t: 8 });
    expect(r.gaps).toContainEqual({ a: { x: 300, y: 200 }, b: { x: 300, y: 250 }, t: 8 });
  });
  it("a gap is a run of closed floor with wall at both its ends", () => {
    const W = 12;
    const wall = new Uint8Array(W * W);
    for (let x = 0; x < W; x++) if (x < 4 || x >= 8) wall[5 * W + x] = wall[6 * W + x] = 1;
    const shut = new Uint8Array(wall);
    for (let x = 4; x < 8; x++) shut[5 * W + x] = shut[6 * W + x] = 1;
    expect(gapsOf(wall, shut, W, W)).toEqual([{ a: [4, 6], b: [8, 6], t: 2 }]);
  });
});
