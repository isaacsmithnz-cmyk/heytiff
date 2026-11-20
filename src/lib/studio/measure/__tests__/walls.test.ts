import { buildingsOf, findWalls, gridOf, scaleWalls, wallSizes, withoutStripes, type WallSeg } from "../walls";

/* a drawing made here: white paper, 20 mm a pixel, things drawn as filled boxes */
const W = 900;
const H = 700;
const MM = 20;
function paper() {
  const px = new Uint8Array(W * H * 4).fill(255);
  const box = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    grey: number,
  ) => {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++)
        px.fill(grey, (y * W + x) * 4, (y * W + x) * 4 + 3);
  };
  /** a house of two rooms: outside walls 300 mm (15 px), the wall between them 200 mm (10 px), a door gap in it */
  const house = (grey: number) => {
    box(100, 100, 700, 115, grey);
    box(100, 485, 700, 500, grey);
    box(100, 100, 115, 500, grey);
    box(685, 100, 700, 500, grey);
    box(395, 100, 405, 250, grey);
    box(395, 300, 405, 500, grey);
  };
  return { px, box, house };
}

describe("the walls off a drawing", () => {
  it("are the fill drawn as long bars, pieced and lined up into a grid", () => {
    const p = paper();
    p.house(128);
    const w = findWalls(p.px, W, H, MM)!;
    expect(w.shade).toBe(128);
    expect(w.grid).toEqual({ x: [107, 399.5, 692], y: [107, 492] });
    /* the wall between the rooms is two pieces, either side of its door */
    expect(
      w.segs
        .filter((s) => s.dir === "v" && Math.abs(s.c - 399.5) < 1)
        .map((s) => [s.a, s.b, s.t]),
    ).toEqual([
      [100, 249, 10],
      [300, 499, 10],
    ]);
  });

  it("are solid black as readily as grey", () => {
    const p = paper();
    p.house(0);
    expect(findWalls(p.px, W, H, MM)!.shade).toBe(0);
  });

  it("aren't the paving beside the house, a paler fill cut into strips by its joint lines", () => {
    const p = paper();
    p.house(128);
    /* paving: a field of grey with a white joint every 12 px, right of the house */
    p.box(720, 100, 880, 500, 196);
    for (let y = 110; y < 500; y += 12) p.box(720, y, 880, y + 1, 255);
    const w = findWalls(p.px, W, H, MM)!;
    expect(w.shade).toBe(128);
    expect(w.segs.every((s) => s.c < 705 || s.dir === "v")).toBe(true);
  });

  it("carry on under something faint drawn across them", () => {
    const p = paper();
    p.house(128);
    /* the floor above ghosted over the top wall: a stretch of it a little paler */
    p.box(200, 100, 300, 115, 140);
    const top = findWalls(p.px, W, H, MM)!.segs.find(
      (s) => s.dir === "h" && s.c < 120,
    )!;
    expect([top.a, top.b]).toEqual([100, 699]);
  });

  it("are none on a drawing whose walls are thin lines, or on a blank sheet", () => {
    const p = paper();
    expect(findWalls(p.px, W, H, MM)).toBeNull();
    /* each wall as two 1 px lines */
    p.box(100, 100, 700, 101, 0);
    p.box(100, 114, 700, 115, 0);
    p.box(100, 100, 101, 500, 0);
    p.box(114, 100, 115, 500, 0);
    expect(findWalls(p.px, W, H, MM)).toBeNull();
  });
});

describe("the sizes a wall is judged by", () => {
  it("come from the scale, and without one are wide enough for a sheet at 1:100 or 1:50", () => {
    expect(wallSizes(4768, 17.64).thick).toBeCloseTo(34, 0);
    const blind = wallSizes(2381, null);
    /* a 300 mm wall at 1:100 on A3 drawn 2381 wide is 17 px; at 1:50, 34 */
    expect(blind.thin).toBe(3);
    expect(blind.thick).toBeGreaterThanOrEqual(34);
  });
});

describe("the buildings among the pieces", () => {
  const z = wallSizes(4768, 17.64);
  const boxAt = (x: number, y: number, w: number, h: number): WallSeg[] => [
    { dir: "h", c: y, a: x, b: x + w, t: 14 },
    { dir: "h", c: y + h, a: x, b: x + w, t: 14 },
    { dir: "v", c: x, a: y, b: y + h, t: 14 },
    { dir: "v", c: x + w, a: y, b: y + h, t: 14 },
  ];
  it("keep the house and a garage across the yard, and leave out a logo's lettering in the title block", () => {
    const house = boxAt(1000, 500, 1500, 900);
    const garage = boxAt(200, 500, 400, 400);
    const logo = boxAt(600, 3000, 90, 110);
    /* a wall piece between two wide openings meets nothing, and is the house's all the same */
    const lone: WallSeg = { dir: "h", c: 1400, a: 1300, b: 1400, t: 14 };
    const kept = buildingsOf([...house, ...garage, ...logo, lone], z);
    expect(kept).toHaveLength(9);
    expect(kept.every((s) => s.c < 2900 && s.a < 2900)).toBe(true);
  });
  it("count a wall's pieces either side of a door as one building", () => {
    const pieces: WallSeg[] = [
      { dir: "h", c: 100, a: 0, b: 300, t: 14 },
      { dir: "h", c: 100, a: 360, b: 2000, t: 14 },
    ];
    expect(buildingsOf(pieces, z)).toHaveLength(2);
  });
});

describe("bars side by side", () => {
  const bar = (c: number, t = 8): WallSeg => ({ dir: "h", c, a: 0, b: 200, t });
  it("are hatching when three or more touch, and one cavity wall when two do", () => {
    expect(withoutStripes([bar(10), bar(19), bar(28), bar(37)])).toEqual([]);
    expect(withoutStripes([bar(10), bar(19)])).toEqual([
      { dir: "h", c: 14.5, a: 0, b: 200, t: 17 },
    ]);
    expect(withoutStripes([bar(10), bar(60)])).toHaveLength(2);
  });
});

describe("the grid", () => {
  it("draws a line through pieces standing in line, weighted by their length, and none through a lone short return", () => {
    const z = wallSizes(4768, 17.64);
    const segs: WallSeg[] = [
      { dir: "v", c: 100, a: 0, b: 300, t: 16 },
      { dir: "v", c: 104, a: 400, b: 500, t: 12 },
      { dir: "v", c: 900, a: 0, b: 55, t: 12 },
    ];
    expect(gridOf(segs, z).x).toEqual([101]);
  });
  it("comes back to the drawing's own size from a finer one", () => {
    const w = scaleWalls(
      {
        shade: 1,
        run: 400,
        segs: [{ dir: "h", c: 20, a: 0, b: 200, t: 8 }],
        grid: { x: [10], y: [20] },
      },
      2,
    );
    expect(w).toEqual({
      shade: 1,
      run: 200,
      segs: [{ dir: "h", c: 10, a: 0, b: 100, t: 4 }],
      grid: { x: [5], y: [10] },
    });
  });
});
