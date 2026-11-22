import { fillsOf, type FillOps } from "../fills";
import { wallsOf } from "../walls";
import { bridged, enclose, gapsOf, joins, outlined, rasterise, simplify } from "../enclose";
import { roomWord, vectorRooms } from "../read";
import { lineWalls } from "../lines";
import { facesOf, snapped } from "../snap";
import type { Line } from "../fills";
import { roomWords, threeRooms, WALLS } from "../__fixtures__/three-rooms";
import { generatedPlan } from "../__fixtures__/generated-plan";

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
    expect(vectorRooms({ ...input, words: [], mmPerPt: 35.28 })).toEqual({ none: "Only 3 rooms closed off between its walls, and it writes no room names as text" });
    expect(vectorRooms({ ...input, fills: [] })).toEqual({ none: "Its walls aren't drawn in the file, filled or in lines" });
  });
  /* a closet walled off against the living room's top wall, `side` points square inside, its walls 4 thick */
  const closet = (side: number) => {
    const y = 54 + side;
    const ring = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    return [...threeRooms(), ...[ring(156, 54, 160, y + 4), ring(160 + side, 54, 164 + side, y + 4), ring(156, y, 164 + side, y + 4)].map((r) => ({ colour: "#808080", rings: [r] }))];
  };
  it("with no scale, a room the plan names is kept however small it is drawn: a WC 1.4 m square at 1:200 is 20 points", () => {
    const words = [...roomWords, { text: "WC", at: { x: 340, y: 128 } }];
    const r = vectorRooms({ ...input, fills: closet(20), words });
    if ("none" in r) throw new Error(r.none);
    expect(r.spaces.map((s) => [s.name, s.kind])).toContainEqual(["WC", "wet"]);
  });
  it("with no scale, a space with no name isn't called a cupboard by its size", () => {
    const at = (mmPerPt: number | null) => {
      const r = vectorRooms({ ...input, fills: closet(36), mmPerPt });
      if ("none" in r) throw new Error(r.none);
      return r.spaces.filter((s) => !s.named).map((s) => s.kind);
    };
    /* 1.3 m square at 1:100 */
    expect(at(35.28)).toEqual(["cupboard"]);
    expect(at(null)).toEqual(["room"]);
  });
  it("with no scale and no room names as text, its spaces can't be told from a wall's cavity, so it isn't trusted", () => {
    expect(vectorRooms({ ...input, words: [] })).toEqual({ none: "It writes no room names as text, and with no scale its rooms can't be told by their size" });
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
  it("a face the file draws as pieces a hair apart across is one face, no piece of it lost", () => {
    /* each face in five pieces, every other one a billionth of a point lower */
    const split = facesOfWalls().flatMap((l) =>
      [0, 1, 2, 3, 4].map((i) => {
        const at = (t: number): [number, number] => [l.a[0] + (l.b[0] - l.a[0]) * t, l.a[1] + (l.b[1] - l.a[1]) * t];
        const [a, b] = [at(i / 5), at((i + 1) / 5)];
        const off = l.a[1] === l.b[1] && i % 2 ? 1e-9 : 0;
        return { ...l, a: [a[0], a[1] + off] as [number, number], b: [b[0], b[1] + off] as [number, number] };
      }),
    );
    const round = (w: ReturnType<typeof lineWalls>) => w!.shapes.map((s) => s.map((r) => r.map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6])));
    expect(round(lineWalls(split, null))).toEqual(round(lineWalls(facesOfWalls(), null)));
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
  it("an L-shaped room's inside corner moves onto its own face, not the far one: the room's middle lies outside it", () => {
    /* walls 5 thick, each as its two faces: round the L, and along its two inside sides */
    const wall = (x0: number, y0: number, x1: number, y1: number): Line[] =>
      x1 - x0 >= y1 - y0
        ? [{ colour: "#000000", width: 0.5, a: [x0, y0], b: [x1, y0] }, { colour: "#000000", width: 0.5, a: [x0, y1], b: [x1, y1] }]
        : [{ colour: "#000000", width: 0.5, a: [x0, y0], b: [x0, y1] }, { colour: "#000000", width: 0.5, a: [x1, y0], b: [x1, y1] }];
    const lines = [wall(-5, -5, 105, 0), wall(100, -5, 105, 35), wall(30, 30, 105, 35), wall(30, 30, 35, 105), wall(-5, 100, 35, 105), wall(-5, -5, 0, 105)].flat();
    const faces = facesOf(lines, [], 8, 1, 18);
    const read = [{ x: 2, y: 2 }, { x: 98, y: 2 }, { x: 98, y: 28 }, { x: 28, y: 28 }, { x: 28, y: 98 }, { x: 2, y: 98 }];
    const l = { name: "Living", named: true, kind: "room" as const, written: "", existing: false, openTo: "", stair: "", outline: read };
    const on = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 100 }, { x: 0, y: 100 }];
    expect(snapped([l], faces, 1, 6).spaces[0].outline).toEqual(on);
    /* drawn the other way round, the same */
    expect(snapped([{ ...l, outline: [...read].reverse() }], faces, 1, 6).spaces[0].outline).toEqual([...on].reverse());
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

describe("two nibs facing each other across one room", () => {
  /* a nib down from the living room's top wall and one up from its bottom, near its right side */
  const nib = (y0: number, y1: number) => ({ colour: "#808080", rings: [[[224, y0], [228, y0], [228, y1], [224, y1]] as [number, number][]] });
  it("may be no doorway: at a known scale, a 9 m room with 6.2 m between its nibs is offered as one room with the space past them, both kept apart and the gap kept until the read by picture says", () => {
    /* at 94 mm a point the living room is 96 points (9 m) across */
    const r = vectorRooms({ fills: [...threeRooms(), nib(54, 67), nib(133, 146)], width: 400, height: 300, words: roomWords, mmPerPt: 94, rasterScale: 2 });
    if ("none" in r) throw new Error(r.none);
    expect(r.spaces.map((s) => s.name)).toEqual(["Bed 1", "Living", "Unnamed space", "Ensuite"]);
    expect(r.joins).toHaveLength(1);
    const [j] = r.joins;
    expect([j.into, j.from]).toEqual([1, [2]]);
    const xs = j.outline.map((p) => p.x);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([304, 496]);
    expect(j.gaps.map((g) => r.gaps[g])).toEqual([{ a: { x: 452, y: 134 }, b: { x: 452, y: 266 }, t: 8 }]);
  });
  it("are never offered at an unknown scale: a doorway can't be told from a room's width, so a 2.1 m pair of doors stays a doorway as it does at 1:100", () => {
    const fills = [...threeRooms(), nib(54, 70), nib(130, 146)];
    for (const mmPerPt of [35.28, null]) {
      const r = vectorRooms({ fills, width: 400, height: 300, words: roomWords, mmPerPt, rasterScale: 2 });
      if ("none" in r) throw new Error(r.none);
      expect(r.spaces.map((s) => s.name)).toEqual(["Bed 1", "Living", "Unnamed space", "Ensuite"]);
      expect(r.joins).toEqual([]);
      expect(r.gaps).toContainEqual({ a: { x: 452, y: 140 }, b: { x: 452, y: 260 }, t: 8 });
    }
    /* the 6.2 m between nibs too: with no scale, nothing is offered */
    const wide = vectorRooms({ fills: [...threeRooms(), nib(54, 67), nib(133, 146)], width: 400, height: 300, words: roomWords, mmPerPt: null, rasterScale: 2 });
    if ("none" in wide) throw new Error(wide.none);
    expect(wide.joins).toEqual([]);
  });

  /* a grid walled round, with a wall 2 thick top to bottom at each x in `at`, left open from y to y over each of its `open` */
  const grid = (W: number, H: number, at: number[], open: [number, number][][]) => {
    const g = new Uint8Array(W * H);
    for (let x = 0; x < W; x++) g[x] = g[(H - 1) * W + x] = 1;
    for (let y = 0; y < H; y++) {
      g[y * W] = g[y * W + W - 1] = 1;
      at.forEach((x, k) => {
        if (open[k].every(([a, b]) => y < a || y > b)) g[y * W + x] = g[y * W + x + 1] = 1;
      });
    }
    return g;
  };
  const offered = (g: Uint8Array, W: number, H: number, names: number[], widest = 14) => {
    const e = enclose(g, W, H, widest, 3);
    const id = (x: number) => e.label[5 * W + x];
    return { e, id, joins: joins(e, g, 5, (s) => names.map(id).includes(s)) };
  };
  it("are offered past a doorway's width only, between a named space and a smaller one with no name of its own", () => {
    /* 30 by 20: nibs at x 12 leaving 11 between them, and a wall at x 20 with a door 3 high */
    const W = 30;
    const H = 20;
    const g = grid(W, H, [12, 20], [[[4, 14]], [[8, 10]]]);
    expect(offered(g, W, H, []).joins).toEqual([]);
    /* the middle with no name, smaller than the named left: one room through the nibs' gap, round the nibs; the door to the right isn't among its gaps */
    const { e, id, joins: got } = offered(g, W, H, [5, 25]);
    expect(got).toEqual([
      {
        into: id(5),
        from: [id(16)],
        outline: [[1, 1], [12, 1], [12, 4], [14, 4], [14, 1], [20, 1], [20, 19], [14, 19], [14, 15], [12, 15], [12, 19], [1, 19]],
        gaps: [gapsOf(g, e.wall, W, H).findIndex((p) => p.a[0] === 13)],
      },
    ]);
    /* nothing is opened: the spaces are as they were */
    expect(e.spaces.map((s) => s.n).sort((a, b) => a - b)).toEqual([108, 126, 198]);
    /* both named, or the one with no name the larger: none */
    expect(offered(g, W, H, [5, 16, 25]).joins).toEqual([]);
    expect(offered(g, W, H, [16, 25]).joins).toEqual([]);
  });
  it("aren't offered where the space with no name opens that wide onto two named rooms: which it is part of would be a guess, whichever comes first on the sheet", () => {
    /* left 11 wide, middle 6, right 17, and the same the other way round: nibs either side of the middle */
    for (const [l, r] of [
      [11, 17],
      [17, 11],
    ]) {
      const W = l + 6 + r + 6;
      const g = grid(W, 20, [1 + l, 3 + l + 6], [[[4, 14]], [[4, 14]]]);
      expect(offered(g, W, 20, [5, W - 5]).joins).toEqual([]);
    }
  });
  it("open every wide gap between the two: a pier between two openings stands inside the room, not on a strip of wall the outline wraps round", () => {
    /* 30 by 40: a wall at x 12 from the top to y 3, a pier from 18 to 21, and from 36 to the bottom, 14 open each side of the pier */
    const W = 30;
    const H = 40;
    const g = grid(W, H, [12], [[[4, 17], [22, 35]]]);
    const { e, id, joins: got } = offered(g, W, H, [20], 20);
    expect(gapsOf(g, e.wall, W, H)).toHaveLength(2);
    expect(got).toEqual([{ into: id(20), from: [id(5)], outline: [[1, 1], [12, 1], [12, 4], [14, 4], [14, 1], [29, 1], [29, 39], [14, 39], [14, 36], [12, 36], [12, 39], [1, 39]], gaps: [0, 1] }]);
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

describe("a big sheet's walls, found by looking only near where they can be", () => {
  /* WHAT EACH STEP GAVE BEFORE ITS SCANS LOOKED ONLY NEARBY, fingerprinted
     (23 November 2026): a stair's treads were looked for along every line
     for every wall, a side's wall along every wall, a ring's piece along
     every piece; 50,000 lines took lineWalls nearly three seconds, now a
     tenth of one. The same made-up sheets must give the same, to the last
     digit: a fingerprint that changes is a read that changed */
  const print = (v: unknown) => {
    const s = JSON.stringify(v);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
    return h.toString(16);
  };
  it.each([
    [8, { lines: "734899d9", unscaled: "d36ca6e7", faces: "6a8ea5fd", snapped: "ef86c046", fills: "396c7eb4", fillsUnscaled: "396c7eb4" }],
    [30, { lines: "573778b", unscaled: "60c099ff", faces: "c0ee5055", snapped: "a490fa6", fills: "9e90d404", fillsUnscaled: "9e90d404" }],
  ])("a plan %i rooms square, as before", (n, want) => {
    const p = generatedPlan(n);
    const faces = facesOf(p.lines, p.fills, 300 / 35.28, 70 / 35.28, 650 / 35.28);
    expect({
      lines: print(lineWalls(p.lines, 35.28)),
      unscaled: print(lineWalls(p.lines, null)),
      faces: print(faces),
      snapped: print(snapped(p.rooms, faces, 2, 450 / 35.28)),
      fills: print(wallsOf(p.fills, 35.28)),
      fillsUnscaled: print(wallsOf(p.fills, null)),
    }).toEqual(want);
  });
  it.each([
    [3000, "b6ef4575", "f5a423f"],
    [5000, "7a6ba69b", "3bdaa9b4"],
  ])("%i lines strewn at random, as before", (n, lines, faces) => {
    let seed = 7;
    const r = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const strewn: Line[] = Array.from({ length: n }, () => {
      const [x, y, l] = [r() * 2000, r() * 2000, 10 + r() * 190];
      return { colour: "#000000", width: 0.5, a: [x, y], b: r() < 0.5 ? [x + l, y] : [x, y + l] };
    });
    expect([print(lineWalls(strewn, 35.28)), print(facesOf(strewn, [], 300 / 35.28, 70 / 35.28, 650 / 35.28))]).toEqual([lines, faces]);
  });
});
