import { createDesign, type DesignDocument, type DesignObject } from "../document";
import { grille, grilleName, grilleSplit, halfOf, isGrille, pulledGrille, respotSplitRuns, splitSideOff, supplyAtWidth } from "../grilles";
import { roomOfPoint } from "../air-view";
import { anchorPointOf } from "../attach";
import { buildSystemGraph } from "../graph";

const room = (id: string, x0: number, y0: number, x1: number, y1: number): DesignObject => ({
  id,
  type: "room",
  systemId: null,
  floorId: "gf",
  plane: "room",
  geometry: { kind: "polygon", points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] },
  props: { name: id },
});
const doc = (objects: DesignObject[]): DesignDocument => ({ ...createDesign({ name: "t", mode: "plan" }), objects });

describe("one grille, supply and return", () => {
  const mm = 10;
  test("a pull sets its width on the step, its centre between the ends, supply at the end it began", () => {
    const p = pulledGrille({ x: 100, y: 500 }, { x: 100, y: 261.3 }, 100, mm);
    expect(p.size).toEqual({ wMm: 2375, hMm: 100 });
    expect(p.deg).toBe(270);
    expect(p.at.x).toBeCloseTo(100);
    expect(p.at.y).toBeCloseTo(500 - 237.5 / 2);
    const g = grille("gf", "s", p.at, "supply", p.size, p.deg, { style: "linear", supplyMm: halfOf(p.size.wMm) });
    const off = splitSideOff(p.size, grilleSplit(g)!.supplyMm, "supply", mm);
    expect(anchorPointOf(new Map([[g.id, g]]), { kind: "grille", id: g.id, off })!.y).toBeGreaterThan(p.at.y);
  });

  test("the sides add up to the face and neither falls under 100 mm", () => {
    const g = grille("gf", "s", { x: 0, y: 0 }, "supply", { wMm: 2400, hMm: 100 }, 0, { supplyMm: 2350 });
    expect(grilleSplit(g)).toEqual({ supplyMm: 2300, returnMm: 100 });
    expect(supplyAtWidth(1200, 2400, 2100)).toBe(1050);
  });

  test("a grille that does one thing has no sides, and the sheet names a combined one", () => {
    expect(grilleSplit(grille("gf", "s", { x: 0, y: 0 }, "supply", { wMm: 1200, hMm: 100 }))).toBeNull();
    expect(grilleName("supply", { wMm: 2400, hMm: 100 }, "linear", 1200)).toBe("Linear grille 2400 × 100, supply 1200 and return 1200");
  });

  test("a duct on a side stays on it when the face changes width", () => {
    const g = grille("gf", "s", { x: 500, y: 100 }, "supply", { wMm: 2000, hMm: 100 }, 0, { supplyMm: 1000 });
    const run: DesignObject = {
      id: "r",
      type: "duct-run",
      systemId: "s",
      floorId: "gf",
      plane: "room",
      geometry: { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 550, y: 100 }] },
      props: { stream: "return", endAttach: { kind: "grille", id: g.id, off: { x: 50, y: 0 } } },
    };
    const wider = { ...g, props: { ...g.props, wMm: 3000, supplyMm: 1500 } };
    const out = respotSplitRuns([wider, run], new Set([g.id]), mm);
    expect((out[1].props.endAttach as { off: unknown }).off).toEqual({ x: 75, y: 0 });
    expect(isGrille(out[0])).toBe(true);
  });
});

describe("a duct up a riser", () => {
  const floors = [
    { id: "gf", name: "Ground", level: 0, scaleMmPerUnit: 10, northDeg: 0, northPos: null, plans: [] },
    { id: "l1", name: "Level 1", level: 1, scaleMmPerUnit: 10, northDeg: 0, northPos: null, plans: [] },
  ];
  const riser = (id: string, floorId: string): DesignObject => ({ id, type: "riser", systemId: "s", floorId, plane: "room", geometry: { kind: "point", at: { x: 0, y: 0 } }, props: { group: "A" } });
  const run = (id: string, floorId: string, type: string, attach: string): DesignObject => ({
    id,
    type,
    systemId: "s",
    floorId,
    plane: "room",
    geometry: { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
    props: { stream: "supply", diaMm: 300, startAttach: { kind: "riser", id: attach } },
  });
  const objects = [riser("a", "gf"), riser("b", "l1")];

  test("is no refrigerant pipe; a pipe up one still is", () => {
    const withDuct = buildSystemGraph([...objects, run("d", "gf", "duct-run", "a")], floors, "s");
    expect(withDuct.edges.filter((e) => e.id.startsWith("riser-gap"))).toEqual([]);
    const withPipe = buildSystemGraph([...objects, run("p", "gf", "pipe-run", "a")], floors, "s");
    expect(withPipe.edges.filter((e) => e.id.startsWith("riser-gap"))).toHaveLength(1);
  });
});

describe("a grille's room", () => {
  test("inside it, or on its edge within 300 mm", () => {
    const d = doc([room("a", 0, 0, 100, 100), room("b", 200, 0, 300, 100)]);
    expect(roomOfPoint(d, "gf", { x: 50, y: 50 }, 10)?.id).toBe("a");
    expect(roomOfPoint(d, "gf", { x: 120, y: 50 }, 10)?.id).toBe("a");
    expect(roomOfPoint(d, "gf", { x: 150, y: 50 }, 10)).toBeNull();
  });
});
