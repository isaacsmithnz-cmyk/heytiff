/* The next flow's air side (board 7 to 11 of the Studio rework mocks):
   grilles by kind and where they sit, rigid and flex ducts that end on
   grilles, and sensors and controllers placed on the plan. The house: a
   PEAD-M100JAA(D) in the hall ceiling serving four rooms. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { createDesign, newId, type DesignDocument, type DesignObject, type Point } from "../document";
import { addBandUnit, allocationsOf, placeAllocation } from "../builder";
import { claimZone, newSystem } from "../zones";
import { grille, grilleShape } from "../grilles";
import { reconcileAttachedRuns } from "../attach";
import { device } from "../devices";
import { smoothedLength, unitsToMeters } from "../geometry";
import { setZoning } from "../zoning";
import { ductLines } from "../duct-materials";

const SEED_DIR = join(__dirname, "../../../../data/packs/mitsubishi-electric@2026.1");
function loadPack(): DataPack {
  const meta = JSON.parse(readFileSync(join(SEED_DIR, "meta.json"), "utf8")) as PackMeta;
  const sections: PackSource["sections"] = {};
  for (const s of PACK_SECTIONS) {
    const f = join(SEED_DIR, `${s}.json`);
    if (existsSync(f)) sections[s] = JSON.parse(readFileSync(f, "utf8"));
  }
  return assemblePack({ meta, sections });
}
const pack = loadPack();
const m = (v: number) => v * 100;

function house(placed: boolean): DesignDocument {
  const doc = createDesign({ name: "12 Example St", mode: "blank" });
  doc.floors[0] = { ...doc.floors[0], scaleMmPerUnit: 10 };
  const room = (id: string, name: string, x: number, y: number, w: number, h: number) =>
    doc.objects.push({
      id,
      type: "room",
      systemId: null,
      floorId: doc.floors[0].id,
      plane: "room",
      geometry: { kind: "polygon", points: [{ x: m(x), y: m(y) }, { x: m(x + w), y: m(y) }, { x: m(x + w), y: m(y + h) }, { x: m(x), y: m(y + h) }] },
      props: { name },
    } as DesignObject);
  room("living", "Living", 0, 0, 7, 5.5);
  room("kitchen", "Kitchen", 7, 0, 5, 5.5);
  room("master", "Master", 0, 5.5, 4, 4.5);
  room("bed2", "Bed 2", 4, 7, 4, 3);
  const made = newSystem(doc, pack.meta.version);
  let d = made.doc;
  for (const z of ["living", "kitchen", "master", "bed2"]) d = claimZone(d, made.systemId, z);
  d = addBandUnit(d, pack, { systemId: made.systemId, iduModel: "PEAD-M100JAA(D)" });
  if (!placed) return d;
  const unit = allocationsOf(d.systems[0]).find((a) => a.role === "idu")!;
  return placeAllocation(d, pack, made.systemId, unit.id, d.floors[0].id, { x: m(6), y: m(6.25) });
}

/** a duct the person drew, in plan units */
function duct(d: DesignDocument, points: Point[], diaMm: number, stream: "supply" | "return", more: Record<string, unknown> = {}): DesignDocument {
  const run = {
    id: newId("obj"),
    type: "duct-run",
    systemId: d.systems[0].id,
    floorId: d.floors[0].id,
    plane: "ceiling-cavity",
    geometry: { kind: "polyline", points },
    props: { diaMm, stream, ...more },
  } as DesignObject;
  return { ...d, objects: [...d.objects, run] };
}
const put = (d: DesignDocument, o: DesignObject): DesignDocument => ({ ...d, objects: [...d.objects, o] });

describe("the air side, next flow", () => {
  it("a duct that ends on a grille follows it when the grille moves", () => {
    let d = house(true);
    const g = grille(d.floors[0].id, d.systems[0].id, { x: m(3), y: m(3) }, "supply", { wMm: 300, hMm: 300 });
    d = put(d, g);
    d = duct(d, [{ x: m(6), y: m(6) }, { x: m(6), y: m(3) }, { x: m(3), y: m(3) }], 250, "supply", {
      form: "rigid",
      endAttach: { kind: "grille", id: g.id },
    });
    const moved = d.objects.map((o) => (o.id === g.id && o.geometry.kind === "point" ? { ...o, geometry: { ...o.geometry, at: { x: m(2), y: m(2) } } } : o));
    const run = reconcileAttachedRuns(moved, new Set([g.id])).find((o) => o.type === "duct-run")!;
    const pts = run.geometry.kind === "polyline" ? run.geometry.points : [];
    /* the end is on the grille, and the last leg stays square */
    expect(pts.at(-1)).toEqual({ x: m(2), y: m(2) });
    expect(pts.at(-2)).toEqual({ x: m(6), y: m(2) });
  });

  it("a flex duct is measured along its curve, a rigid one as drawn, and they are two parts", () => {
    let d = house(true);
    const bend = [{ x: m(6), y: m(6) }, { x: m(6), y: m(3) }, { x: m(3), y: m(3) }];
    d = duct(d, bend, 200, "supply", { form: "flex" });
    d = duct(d, [{ x: m(6), y: m(6) }, { x: m(9), y: m(6) }], 300, "supply", { form: "rigid" });
    const curve = unitsToMeters(smoothedLength(bend), 10);
    /* the curve through the three dots, not the 6 m of straight legs */
    expect(Math.abs(curve - 6)).toBeGreaterThan(0.05);
    expect(ductLines(d, pack, d.systems[0])).toEqual([
      { shelf: "ductwork", name: "Rigid duct Ø300", sub: "Supply, as drawn", qty: "3 m" },
      { shelf: "ductwork", name: "Flexible duct Ø200", sub: "Supply, as drawn", qty: `${Math.ceil(curve * 10 - 1e-6) / 10} m` },
    ]);
  });

  it("grilles by kind and by where they sit: a round one by its neck", () => {
    let d = house(true);
    const f = d.floors[0].id;
    const sys = d.systems[0].id;
    d = put(d, grille(f, sys, { x: m(1), y: m(1) }, "supply", { wMm: 250, hMm: 250 }, 0, { style: "round", mount: "ceiling" }));
    d = put(d, grille(f, sys, { x: m(2), y: m(1) }, "supply", { wMm: 1200, hMm: 100 }, 0, { style: "linear", mount: "floor" }));
    d = put(d, grille(f, sys, { x: m(3), y: m(1) }, "supply", { wMm: 1200, hMm: 100 }, 0, { style: "linear", mount: "wall" }));
    d = put(d, grille(f, sys, { x: m(4), y: m(1) }, "supply", { wMm: 1200, hMm: 100 }, 0, { style: "linear", mount: "wall" }));
    expect(ductLines(d, pack, d.systems[0])).toEqual([
      { shelf: "grilles", name: "Linear bar grille 1200 × 100", sub: "Supply outlet, floor", qty: "1" },
      { shelf: "grilles", name: "Linear bar grille 1200 × 100", sub: "Supply outlet, wall", qty: "2" },
      { shelf: "grilles", name: "Round diffuser Ø250", sub: "Supply outlet, ceiling", qty: "1" },
    ]);
  });

  it("a round diffuser draws its rim round, a square one its corners", () => {
    expect(grilleShape({ x: 0, y: 0 }, 0, "supply", { wMm: 250, hMm: 250 }, 10, "round").outline).toHaveLength(32);
    expect(grilleShape({ x: 0, y: 0 }, 0, "supply", { wMm: 300, hMm: 300 }, 10, "square").outline).toHaveLength(4);
  });

  it("one sensor a zone reaches the materials, however many are placed", () => {
    const h = house(true);
    const unitId = allocationsOf(h.systems[0]).find((a) => a.role === "idu")!.id;
    const zoned = setZoning(h, h.systems[0].id, unitId, { control: "temperature" });
    const before = ductLines(zoned, pack, zoned.systems[0]);
    let d = zoned;
    for (let i = 0; i < 6; i++) d = put(d, device(d.floors[0].id, d.systems[0].id, { x: m(i), y: m(9) }, "zone-sensor"));
    d = put(d, device(d.floors[0].id, d.systems[0].id, { x: m(5), y: m(5) }, "wall-controller"));
    expect(ductLines(d, pack, d.systems[0])).toEqual(before);
    expect(before.some((l) => /sensor/i.test(l.name))).toBe(true);
  });
});
