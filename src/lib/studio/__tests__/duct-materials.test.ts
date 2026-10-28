/* What a ducted unit's air side puts on the job (duct-materials.ts), named
   the way the price book's common install items name them, so each line is
   a part a business already prices. The mock's house: a PEAD-M100JAA(D) in
   the hall ceiling serving four rooms. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { createDesign, type DesignDocument, type DesignObject } from "../document";
import { addBandUnit, allocationsOf, placeAllocation } from "../builder";
import { claimZone, newSystem } from "../zones";
import { setDuctsDrawn } from "../airflow";
import { systemDuctwork } from "../ductwork";
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
  const unit = allocationsOf(d.systems[0]).find((a) => a.role === "idu")!;
  d = setDuctsDrawn(d, made.systemId, unit.id, true);
  if (!placed) return d;
  return placeAllocation(d, pack, made.systemId, unit.id, d.floors[0].id, { x: m(6), y: m(6.25) });
}

describe("the ductwork and grilles on the job", () => {
  it("flex by size as laid out, the fittings by name, plenums made for the unit, outlets by neck, the return with its filter", () => {
    const doc = house(true);
    const sys = doc.systems[0];
    const [lay] = systemDuctwork(doc, pack, sys);
    const lines = ductLines(doc, pack, sys);
    const named = (n: string) => lines.find((l) => l.name === n);

    // every size laid out, its metres the runs' summed and rounded up
    const bySize = new Map<number, number>();
    for (const r of [...lay.supply, ...lay.returns]) bySize.set(r.diaMm, (bySize.get(r.diaMm) ?? 0) + r.lengthM);
    for (const [d, metres] of bySize) {
      const l = named(`Flexible duct Ø${d}`)!;
      expect(l.shelf).toBe("ductwork");
      expect(l.qty).toBe(`${Math.ceil(metres * 10) / 10} m`);
    }
    for (const f of lay.fittings) expect(Number(named(f.name)!.qty)).toBeGreaterThan(0);

    expect(named("Supply plenum 1360 × 178")!.sub).toMatch(/^Made for PEAD-M100JAA\(D\), \d × Ø\d+/);
    expect(named("Return plenum 1358 × 210")!.sub).toBe("Made for PEAD-M100JAA(D), 2 × Ø400");
    const outlets = lines.filter((l) => /^Square diffuser, \d+ neck$/.test(l.name));
    expect(outlets.reduce((n, l) => n + Number(l.qty), 0)).toBe(lay.outlets.length);
    expect(outlets.every((l) => l.shelf === "grilles")).toBe(true);
    expect(named("Return air grille 750 × 400, filter")!.qty).toBe("1");
    expect(named("Return air box")!.qty).toBe("1");
  });

  it("before the unit is on the plan, the flex is not measured and says so", () => {
    const lines = ductLines(house(false), pack, house(false).systems[0]);
    expect(lines.find((l) => l.name === "Flexible duct")).toEqual({
      shelf: "ductwork",
      name: "Flexible duct",
      sub: "Place the unit on a scaled plan to measure",
      qty: "—",
    });
    expect(lines.some((l) => l.name.startsWith("Flexible duct Ø"))).toBe(false);
    // what the air alone decides is still there
    expect(lines.some((l) => l.name.startsWith("Square diffuser, "))).toBe(true);
    expect(lines.some((l) => l.name === "Return air grille 750 × 400, filter")).toBe(true);
  });

  it("goes on the sheet's Ductwork and Grilles shelves and into the picklist that goes to the job card", () => {
    const doc = house(true);
    const model = buildSummaryModel(doc, pack);
    const sys = model.systems[0];
    expect(sys.lines.some((l) => l.group === "ductwork" && l.name.startsWith("Flexible duct Ø"))).toBe(true);
    expect(sys.lines.some((l) => l.group === "grilles" && l.name === "Return air box")).toBe(true);
    expect(model.picklist.find((r) => r.name === "Return air grille 750 × 400, filter")).toMatchObject({ group: "grilles", qty: "1" });
    // not measured is not picked
    const unplaced = buildSummaryModel(house(false), pack);
    expect(unplaced.picklist.some((r) => r.name === "Flexible duct")).toBe(false);
  });

  it("names each outlet by its kind and size: a room's outlet made round and another a linear", () => {
    const doc = house(true);
    const sys = doc.systems[0];
    const [lay] = systemDuctwork(doc, pack, sys);
    const [a, b] = lay.outlets;
    const picked = {
      ...doc,
      systems: [{ ...sys, settings: { ...sys.settings, ductOutlet: { [a.key]: { kind: "round" }, [b.key]: { kind: "linear", lengthMm: 1500 } } } }],
    };
    const lines = ductLines(picked, pack, picked.systems[0]);
    expect(lines.find((l) => l.name === `Round diffuser, ${a.neckMm} neck`)).toMatchObject({ shelf: "grilles", qty: "1" });
    expect(lines.find((l) => l.name === "Linear bar grille 1500 × 150")).toMatchObject({ shelf: "grilles", qty: "1" });
    const squares = lines.filter((l) => l.name.startsWith("Square diffuser, ")).reduce((n, l) => n + Number(l.qty), 0);
    expect(squares).toBe(lay.outlets.length - 2);
  });
});
