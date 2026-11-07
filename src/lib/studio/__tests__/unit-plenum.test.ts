/* A duct on a unit decides its plenum: every spigot comes from a duct, nothing
   is stored, and a supply plenum is a V whose slope the duct's heading picks. */
import type { DesignDocument, DesignObject } from "../document";
import { anchorPointOf } from "../attach";
import { ductLines } from "../duct-materials";
import { faceProblems, plenumFigure, plenumsFromDucts, seatDuctsOnUnits, unitFaces, faceFrame, type Openings } from "../unit-plenum";
import type { DataPack } from "../packs/schema";

const MM = 10;
const ROW: Openings = { supply_opening: { w_mm: 1325, h_mm: 266 }, return_opening: { spigots: [{ count: 2, dia_mm: 400 }] } };
const rowOf = () => ROW;

const unit: DesignObject = {
  id: "u",
  type: "unit",
  systemId: "s",
  floorId: "f",
  plane: "floor-cavity",
  geometry: { kind: "point", at: { x: 500, y: 500 } },
  props: { role: "idu", model: "PEA-M125HAA", widthMm: 1405, depthMm: 900 },
};

const duct = (id: string, x: number, stream: "supply" | "return" = "supply", diaMm = 400): DesignObject => ({
  id,
  type: "duct-run",
  systemId: "s",
  floorId: "f",
  plane: "room",
  geometry: { kind: "polyline", points: [{ x: 500 + x, y: stream === "supply" ? 545 : 455 }, { x: 500 + x * 3, y: stream === "supply" ? 900 : 100 }] },
  props: { diaMm, stream, form: "flex", startAttach: { kind: "unit", id: "u", off: { x, y: stream === "supply" ? 45 : -45 } } },
});

const docOf = (...runs: DesignObject[]): DesignDocument =>
  ({ floors: [{ id: "f", scaleMmPerUnit: MM }], objects: [unit, ...runs], systems: [{ id: "s", settings: {} }] }) as unknown as DesignDocument;

const supplyFace = (d: DesignDocument) => {
  const f = unitFaces(d.objects, unit, ROW, MM).find((x) => x.end === "supply");
  if (f?.kind !== "plenum") throw new Error("no supply plenum");
  return f;
};

describe("a duct on a unit decides its plenum", () => {
  it("a unit with no duct has nothing", () => {
    expect(plenumsFromDucts([unit], unit, ROW, MM)).toEqual([]);
  });

  it("a duct with no spot on the casing is the shipping flow's: it makes no plenum", () => {
    const run = duct("a", 30);
    run.props = { ...run.props, startAttach: { kind: "unit", id: "u" } };
    expect(plenumsFromDucts([unit, run], unit, ROW, MM)).toEqual([]);
  });

  it("two ducts heading apart come off the V's two slopes, at their own sizes", () => {
    const f = supplyFace(docOf(duct("a", -30, "supply", 400), duct("b", 30, "supply", 350)));
    expect(f.spigots.map((s) => [s.id, s.face, s.diaMm])).toEqual([["a", "left", 400], ["b", "right", 350]]);
    expect(f.body.spigotFaceWMm).toBe(0); // closes to a point
    expect(f.body.overSpigot).toBe(false);
  });

  it("a lone duct heading straight out takes the point; heading off, a slope", () => {
    expect(supplyFace(docOf(duct("a", 5))).spigots[0].face).toBe("front");
    expect(supplyFace(docOf(duct("a", 40))).spigots[0].face).toBe("right");
  });

  it("taking a duct away or changing its size changes the spigots, nothing stored", () => {
    const two = docOf(duct("a", -30), duct("b", 30));
    expect(supplyFace(two).spigots).toHaveLength(2);
    expect(supplyFace(docOf(duct("a", -30))).spigots).toHaveLength(1);
    expect(supplyFace(docOf(duct("a", -30, "supply", 300))).spigots[0].diaMm).toBe(300);
    expect(two.objects.some((o) => o.type === "plenum")).toBe(false);
  });

  it("too much on one slope says so", () => {
    const d = docOf(duct("a", 10), duct("b", 30));
    expect(supplyFace(d).body.overSpigot).toBe(true);
    expect(faceProblems(d, rowOf)[0]).toMatch(/2 supply ducts won't fit/);
  });

  it("factory spigots make no plenum, and ducts sit on them", () => {
    const d = seatDuctsOnUnits(docOf(duct("a", -30, "return"), duct("b", 30, "return")), rowOf);
    expect(plenumsFromDucts(d.objects, unit, ROW, MM)).toEqual([]);
    const off = (id: string) => (d.objects.find((o) => o.id === id)?.props.startAttach as { off: { x: number; y: number } }).off;
    expect(off("a").x).toBeCloseTo(-140.5 / 6); // a third of the way along, as the unit draws them
    expect(off("b").x).toBeCloseTo(140.5 / 6);
    expect(off("a").y).toBeCloseTo(-45);
  });

  it("more ducts than factory spigots, or another size, says so", () => {
    const d = docOf(duct("a", -30, "return"), duct("b", 0, "return"), duct("c", 30, "return", 300));
    const words = faceProblems(d, rowOf).join(" ");
    expect(words).toMatch(/3 return ducts on 2 factory spigots/);
    const e = docOf(duct("a", -30, "return", 300), duct("b", 30, "return"));
    expect(faceProblems(e, rowOf).join(" ")).toMatch(/a Ø300 return duct on a Ø400 factory spigot/);
  });

  it("seats each duct on its takeoff's far end, the place the figure draws, and seating twice changes nothing", () => {
    const d = seatDuctsOnUnits(docOf(duct("a", -30), duct("b", 30)), rowOf);
    expect(seatDuctsOnUnits(d, rowOf)).toBe(d);
    const [p] = plenumsFromDucts(d.objects, unit, ROW, MM);
    const fig = plenumFigure({
      props: p.props,
      widthMm: 1405,
      perMm: 1 / MM,
      opening: ROW.supply_opening ?? null,
      face: faceFrame({ x: 500, y: 500 }, 0, 90, false, "supply"),
    });
    for (const id of ["a", "b"]) {
      const run = d.objects.find((o) => o.id === id)!;
      const sp = fig!.spigots.find((s) => s.id === id)!;
      const far = { x: (sp.rect[1].x + sp.rect[2].x) / 2, y: (sp.rect[1].y + sp.rect[2].y) / 2 };
      const start = run.geometry.kind === "polyline" ? run.geometry.points[0] : null;
      expect(start?.x).toBeCloseTo(far.x);
      expect(start?.y).toBeCloseTo(far.y);
    }
  });

  it("a duct's height on a low opening is no failure on a plenum it made", () => {
    const [p] = plenumsFromDucts([unit, duct("a", -30)], unit, ROW, MM);
    const fig = plenumFigure({ props: p.props, widthMm: 1405, perMm: 0.1, opening: ROW.supply_opening ?? null, face: faceFrame({ x: 0, y: 0 }, 0, 90, false, "supply") });
    expect(fig?.overHeight).toBe(false);
  });

  it("turning the unit carries the seated duct with it", () => {
    const d = seatDuctsOnUnits(docOf(duct("a", -30)), rowOf);
    const at = d.objects.find((o) => o.id === "a")!.props.startAttach as { kind: "unit"; id: string; off: { x: number; y: number } };
    const turned = { ...unit, geometry: { kind: "point" as const, at: { x: 500, y: 500 }, rotation: 90 } };
    const pt = anchorPointOf(new Map([["u", turned]]), at)!;
    expect(pt.x).toBeCloseTo(500 - at.off.y);
    expect(pt.y).toBeCloseTo(500 + at.off.x);
  });

  it("Materials has the plenum and a spigot for each duct, not factory ones", () => {
    const pack = { indoor_units: [{ model: "PEA-M125HAA", ...ROW }], zoning_controllers: [] } as unknown as DataPack;
    const d = docOf(duct("a", -30), duct("b", 30), duct("c", -30, "return"));
    const names = ductLines(d, pack, d.systems[0]).filter((l) => /plenum|Spigot/.test(l.name)).map((l) => [l.name, l.qty]);
    expect(names).toEqual([["Supply plenum 1325 × 266", "1"], ["Spigot Ø400", "2"]]);
  });
});
