import type { Line } from "../fills";
import { arrowsOf, pitchOf, riseOf, roofLines, type RoofFace } from "../roof";
import { placeFaces, type FloorUnder } from "../roof-place";
import { faceMesh } from "../../roof3d";
import type { ReadRoofPart, ReadSpace } from "../../reading";
import { arrow, hipRoof, ink } from "../__fixtures__/hip-roof";

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
  it("a shape a hip runs into and stops short in is no face, though only one pitch is printed in it", () => {
    /* two hip roofs on the page: the first's north-west hip drawn with a gap half way and its west face's arrow left off, so its north and west faces are one shape with one pitch; the second whole */
    const gapped = hipRoof();
    const west = arrow([120, 150], [-1, 0]);
    const same = (l: Line, m: Line) => l.a[0] === m.a[0] && l.a[1] === m.a[1] && l.b[0] === m.b[0] && l.b[1] === m.b[1];
    const lines = gapped.lines.filter((l) => !same(l, ink([100, 100], [150, 150])) && !west.some((w) => same(l, w)));
    lines.push(ink([100, 100], [122, 122]), ink([128, 128], [150, 150]));
    const whole = hipRoof();
    const r = roofLines({
      lines: [...lines, ...whole.lines.map((l): Line => ({ ...l, a: [l.a[0] + 300, l.a[1]], b: [l.b[0] + 300, l.b[1]] }))],
      words: [...gapped.words, ...whole.words.map((w) => ({ ...w, at: { x: w.at.x + 300, y: w.at.y } }))],
      width: 700,
      height: 300,
    });
    if ("none" in r) throw new Error(r.none);
    /* the whole roof's four faces and the gapped one's south and east: its north isn't built over its west */
    expect(r.faces).toHaveLength(6);
    expect(r.faces.every((f) => f.outline.length <= 4)).toBe(true);
    expect(r.left.map((l) => l.why).sort()).toEqual(["a line stops short inside its shape, so two faces may run into one", "no arrow of its own beside it"]);
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
  const box = (x0: number, y0: number, x1: number, y1: number) => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  const room = (name: string, x0: number, y0: number, x1: number, y1: number): ReadSpace => ({
    name,
    named: true,
    kind: "room",
    outline: box(x0, y0, x1, y1),
    written: "",
    existing: false,
    openTo: "",
    stair: "",
  });
  /* the file's walls round a room, 7.5 px thick, their outside 12.5 px in from the hip roof's eaves; `dx` sets them off it */
  const walled = (dx = 0): Pick<FloorUnder, "spaces" | "walls"> => ({
    spaces: [room("Living", 120 + dx, 120, 280 + dx, 180)],
    walls: [[box(112.5 + dx, 112.5, 287.5 + dx, 187.5), box(120 + dx, 120, 280 + dx, 180)]],
  });
  const ground: FloorUnder = { floorId: "g", sheetId: "g", level: 0, pxPerPt: 1, ...walled(), ceilingMm: 2700, mmPerPx: 35 };
  const part: ReadRoofPart = {
    floorId: "g",
    sheetId: "g",
    form: "hip",
    outline: box(100, 100, 300, 200),
    ridge: "across",
    fallsTo: "",
    pitchDeg: 30,
    eaveMm: 2550,
    overhangMm: 450,
    existing: false,
    source: "Sections",
  };
  const facesOf = (pitches?: [number, number, number, number]) => {
    const r = roofLines(hipRoof(pitches));
    if ("none" in r) throw new Error(r.none);
    return r.faces;
  };
  const moved = (faces: RoofFace[], dx: number): RoofFace[] => faces.map((f) => ({ ...f, outline: f.outline.map(([x, y]) => [x + dx, y] as [number, number]), at: [f.at[0] + dx, f.at[1]] }));

  it("each face onto the floor under it, its eave height the read's of the part it sits in, its overhang off the file's walls", () => {
    const placed = placeFaces(facesOf(), 4, [ground], [part]);
    if ("none" in placed) throw new Error(placed.none);
    expect(placed.faces).toHaveLength(4);
    expect(placed.faces.every((f) => f.floorId === "g" && f.eaveMm === 2550 && f.page === 4)).toBe(true);
    /* 13 px at 35 mm a pixel, not the read's guessed 450 */
    expect(placed.faces.map((f) => f.overhangMm)).toEqual([455, 455, 455, 455]);
  });
  it("with no walls drawn in the file its overhang can't be measured, so its faces are left out and the read's boxes stand", () => {
    const { walls: _walls, ...bare } = ground;
    expect(placeFaces(facesOf(), 4, [bare], [part])).toEqual({ none: expect.stringContaining("No overhang could be measured") });
  });
  it("a roof plan the rooms don't stand under isn't put over them", () => {
    const away = { ...ground, spaces: [room("Living", 500, 500, 600, 600)] };
    expect(placeFaces(facesOf(), 4, [away], [part])).toEqual({ none: expect.stringContaining("0 of the 1 rooms") });
  });
  it("a roof plan set off the floor under it isn't put over it, though the floor's rooms still stand under it", () => {
    /* the floor 10 px (350 mm) east of the roof plan: its west eave 805 mm out past the wall, its east one 105 */
    expect(placeFaces(facesOf(), 4, [{ ...ground, ...walled(10) }], [part])).toEqual({ none: expect.stringContaining("didn't measure alike on opposite sides") });
  });
  it("a roof plan set off along a floor whose eaves measured one way across only isn't put over it", () => {
    /* walls along the north and south alone, so the east and west eaves meet none in an eave's reach; the floor 10 px east, which the north and south eaves can't tell */
    const ns: FloorUnder = { ...ground, spaces: [room("Living", 130, 120, 290, 180)], walls: [[box(122.5, 112.5, 297.5, 120)], [box(122.5, 180, 297.5, 187.5)]] };
    expect(placeFaces(facesOf(), 4, [ns], [part])).toEqual({ none: expect.stringContaining("didn't measure alike on opposite sides both ways across") });
  });
  it("a face that doesn't meet its neighbours at one height is left out", () => {
    /* two hip roofs over the ground floor, the first's east face printed at 60°: its hips stand far above the faces it meets.
       The second's eaves measure the floor east and west, where the first's own west eave has none opposite it */
    const two: FloorUnder = {
      ...ground,
      spaces: [room("Living", 120, 120, 280, 180), room("Dining", 420, 120, 580, 180)],
      walls: [
        [box(112.5, 112.5, 287.5, 187.5), box(120, 120, 280, 180)],
        [box(412.5, 112.5, 587.5, 187.5), box(420, 120, 580, 180)],
      ],
    };
    const placed = placeFaces([...facesOf([30, 30, 30, 60]), ...moved(facesOf(), 300)], 4, [two], [part]);
    if ("none" in placed) throw new Error(placed.none);
    expect(placed.faces).toHaveLength(7);
    expect(placed.faces.some((f) => f.pitchDeg === 60)).toBe(false);
    expect(placed.left).toBe(1);
  });
  it("goes on the floor under most of it, though its middle falls in the wall between two rooms", () => {
    /* level 1's cross wall runs under the ridge's middle, where all four faces have theirs */
    const upper: FloorUnder = {
      floorId: "u",
      sheetId: "u",
      level: 1,
      pxPerPt: 1,
      spaces: [room("Bed 1", 120, 120, 197, 180), room("Bed 2", 203, 120, 280, 180)],
      walls: [[box(112.5, 112.5, 287.5, 187.5), box(120, 120, 197, 180), box(203, 120, 280, 180)]],
      ceilingMm: 2400,
      mmPerPx: 35,
    };
    const placed = placeFaces(facesOf(), 4, [ground, upper], [part]);
    if ("none" in placed) throw new Error(placed.none);
    expect(placed.faces.map((f) => [f.floorId, f.eaveMm])).toEqual([
      ["u", 2400],
      ["u", 2400],
      ["u", 2400],
      ["u", 2400],
    ]);
  });
  it("a face standing half on the floor above and half past it is left out, not dropped a storey", () => {
    /* two hip roofs side by side over the ground floor; level 1 under all the first and under only the second's west end */
    const wide: FloorUnder = { ...ground, spaces: [room("Living", 120, 120, 580, 180)], walls: [[box(112.5, 112.5, 587.5, 187.5), box(120, 120, 580, 180)]] };
    const upper: FloorUnder = {
      floorId: "u",
      sheetId: "u",
      level: 1,
      pxPerPt: 1,
      spaces: [room("Bed 1", 120, 120, 280, 180), room("Bed 2", 420, 120, 470, 180)],
      walls: [
        [box(112.5, 112.5, 287.5, 187.5), box(120, 120, 280, 180)],
        [box(412.5, 112.5, 477.5, 187.5), box(420, 120, 470, 180)],
      ],
      ceilingMm: 2400,
      mmPerPx: 35,
    };
    const placed = placeFaces([...facesOf(), ...moved(facesOf(), 300)], 4, [wide, upper], []);
    if ("none" in placed) throw new Error(placed.none);
    /* the first roof and the second's west end on level 1; the second's north and south faces stand half on it,
       and its east end alone on the ground floor has no eave opposite it measured there */
    expect(placed.faces).toHaveLength(5);
    expect(placed.faces.every((f) => f.floorId === "u")).toBe(true);
    expect(placed.left).toBe(3);
  });
  it("finds a floor's walls with more points than can be spread into an argument list", () => {
    /* a long curved wall well off the roof: 300,000 points */
    const n = 300_000;
    const curve = Array.from({ length: n }, (_, i) => ({ x: 2000 + 50 * Math.cos((i / n) * 2 * Math.PI), y: 2000 + 50 * Math.sin((i / n) * 2 * Math.PI) }));
    const placed = placeFaces(facesOf(), 4, [{ ...ground, walls: [...ground.walls!, [curve]] }], [part]);
    expect("faces" in placed && placed.faces).toHaveLength(4);
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
