import { resizeGrille, typedGrilleMm } from "../grilles";

describe("a grille's size, typed", () => {
  it("is whole millimetres in range", () => {
    expect(typedGrilleMm(" 825 ")).toBe(825);
    expect(typedGrilleMm("1,200")).toBe(1200);
    expect(typedGrilleMm("20")).toBeNull();
    expect(typedGrilleMm("4000")).toBeNull();
    expect(typedGrilleMm("6.5")).toBeNull();
    expect(typedGrilleMm("")).toBeNull();
  });
});

describe("a grille's edge, dragged", () => {
  const sq = { wMm: 600, hMm: 600 };

  it("keeps the far edge where it was", () => {
    // 10 mm a unit: the face runs x -30..30; the west edge pulled to -50
    const r = resizeGrille({ x: 0, y: 0 }, 0, sq, "w", { x: -50, y: 7 }, 10);
    expect(r.size).toEqual({ wMm: 800, hMm: 600 });
    expect(r.at).toEqual({ x: -10, y: 0 });
  });

  it("works in the grille's own frame once it is turned", () => {
    // turned 90°: its width runs down the plan, so its east edge is below it
    const r = resizeGrille({ x: 0, y: 0 }, 90, sq, "e", { x: 0, y: 45 }, 10);
    expect(r.size).toEqual({ wMm: 750, hMm: 600 });
    expect(r.at.x).toBeCloseTo(0);
    expect(r.at.y).toBeCloseTo(7.5);
  });

  it("never goes below 100 mm, pulled back past the far edge", () => {
    const r = resizeGrille({ x: 0, y: 0 }, 0, sq, "n", { x: 0, y: 80 }, 10);
    expect(r.size).toEqual({ wMm: 600, hMm: 100 });
  });
});
