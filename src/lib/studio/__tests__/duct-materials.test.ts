/* What a system's air side puts on the job (duct-materials.ts): only what
   the person drew, named the way the price book's common install items name
   them. The house: a PEAD-M100JAA(D) in the hall ceiling serving four rooms. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { createDesign, newId, type DesignDocument, type DesignObject, type Point } from "../document";
import { addBandUnit, allocationsOf, placeAllocation } from "../builder";
import { claimZone, newSystem } from "../zones";
import { grille } from "../grilles";
import { ductLines } from "../duct-materials";
import { buildSummaryModel } from "../summary";

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
function duct(d: DesignDocument, points: Point[], diaMm: number, stream: "supply" | "return"): DesignDocument {
  const run = {
    id: newId("obj"),
    type: "duct-run",
    systemId: d.systems[0].id,
    floorId: d.floors[0].id,
    plane: "ceiling-cavity",
    geometry: { kind: "polyline", points },
    props: { diaMm, stream },
  } as DesignObject;
  return { ...d, objects: [...d.objects, run] };
}
const put = (d: DesignDocument, o: DesignObject): DesignDocument => ({ ...d, objects: [...d.objects, o] });

describe("the ductwork and grilles on the job", () => {
  it("a unit on the plan with nothing drawn off it puts nothing on the job", () => {
    const doc = house(true);
    expect(ductLines(doc, pack, doc.systems[0])).toEqual([]);
  });

  it("ducts by size and stream as drawn, grilles by name as placed", () => {
    let d = house(true);
    const sys = d.systems[0].id;
    const f = d.floors[0].id;
    d = duct(d, [{ x: m(6), y: m(6) }, { x: m(6), y: m(3) }, { x: m(3), y: m(3) }], 250, "supply"); // 6 m
    d = duct(d, [{ x: m(6), y: m(6) }, { x: m(9), y: m(6) }], 250, "supply"); // 3 m
    d = duct(d, [{ x: m(6), y: m(7) }, { x: m(8), y: m(7) }], 400, "return"); // 2 m
    d = put(d, grille(f, sys, { x: m(3), y: m(3) }, "supply", { wMm: 300, hMm: 300 }));
    d = put(d, grille(f, sys, { x: m(9), y: m(6) }, "supply", { wMm: 300, hMm: 300 }));
    d = put(d, grille(f, sys, { x: m(2), y: m(1) }, "supply", { wMm: 1200, hMm: 100 }));
    d = put(d, grille(f, sys, { x: m(8), y: m(7) }, "return", { wMm: 750, hMm: 400 }));
    const lines = ductLines(d, pack, d.systems[0]);
    expect(lines).toEqual([
      { shelf: "ductwork", name: "Flexible duct Ø250", sub: "Supply, as drawn", qty: "9 m" },
      { shelf: "ductwork", name: "Flexible duct Ø400", sub: "Return, as drawn", qty: "2 m" },
      { shelf: "grilles", name: "Linear bar grille 1200 × 100", sub: "Supply outlet", qty: "1" },
      { shelf: "grilles", name: "Return air grille 750 × 400", sub: "Return", qty: "1" },
      { shelf: "grilles", name: "Square diffuser 300 × 300", sub: "Supply outlet", qty: "2" },
    ]);
  });

  it("a duct on a plan with no scale is counted but not measured", () => {
    let d = house(true);
    d = { ...d, floors: [{ ...d.floors[0], scaleMmPerUnit: null }] };
    d = duct(d, [{ x: 0, y: 0 }, { x: 100, y: 0 }], 200, "supply");
    expect(ductLines(d, pack, d.systems[0])).toEqual([
      { shelf: "ductwork", name: "Flexible duct Ø200", sub: "Supply, set the plan's scale to measure", qty: "—" },
    ]);
  });

  it("goes on the sheet's Ductwork and Grilles shelves and into the picklist that goes to the job card", () => {
    let d = house(true);
    d = duct(d, [{ x: m(6), y: m(6) }, { x: m(6), y: m(3) }], 250, "supply");
    d = put(d, grille(d.floors[0].id, d.systems[0].id, { x: m(6), y: m(3) }, "supply", { wMm: 300, hMm: 300 }));
    const model = buildSummaryModel(d, pack);
    const sys = model.systems[0];
    expect(sys.lines.some((l) => l.group === "ductwork" && l.name === "Flexible duct Ø250")).toBe(true);
    expect(model.picklist.find((r) => r.name === "Square diffuser 300 × 300")).toMatchObject({ group: "grilles", qty: "1" });
  });
});
