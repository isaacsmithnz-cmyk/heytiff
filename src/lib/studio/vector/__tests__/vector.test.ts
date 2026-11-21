import { fillsOf, type FillOps } from "../fills";
import { wallsOf } from "../walls";
import { bridged, enclose, outlined, rasterise, simplify } from "../enclose";
import { roomWord, vectorRooms } from "../read";
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
    expect(vectorRooms({ ...input, fills: [] })).toEqual({ none: "Its walls aren't drawn as filled shapes in the file" });
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
