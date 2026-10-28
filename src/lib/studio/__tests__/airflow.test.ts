/* The air a ducted unit sends, room by room (airflow.ts): its share of the
   unit's airflow by load, the outlets that carry it at 3 m/s with Ø250 the
   largest neck, and the return at 2.5 m/s with Ø400 the largest run. The
   figures are the mock Isaac said yes to (2026-10-28): Living's 212 L/s takes
   two Ø250s, a PEAD-M100's 567 L/s comes back down two Ø400s. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { createDesign, type DesignDocument, type DesignObject } from "../document";
import type { RoomObj } from "../loads-room";
import { roomLoadKw } from "../loads-room";
import { addBandUnit, addHead, setRoomsServed } from "../builder";
import { allocationsOf } from "../allocations";
import { claimZone, newSystem } from "../zones";
import { setDuctsDrawn,
  ductCapacityLs,
  outletsText,
  returnGrilleFor,
  sizeForLs,
  splitForLs,
  systemAir,
  RETURN_MS,
  SUPPLY_MS,
  OUTLET_MAX_MM,
  RETURN_MAX_MM,
} from "../airflow";

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

describe("the velocity rule", () => {
  it("a round duct carries its area at the speed", () => {
    expect(ductCapacityLs(250, SUPPLY_MS)).toBeCloseTo(147.3, 1);
    expect(ductCapacityLs(200, SUPPLY_MS)).toBeCloseTo(94.2, 1);
    expect(ductCapacityLs(400, RETURN_MS)).toBeCloseTo(314.2, 1);
  });

  it("the smallest size that carries it", () => {
    expect(sizeForLs(130, SUPPLY_MS)).toBe(250);
    expect(sizeForLs(89, SUPPLY_MS)).toBe(200);
    expect(sizeForLs(65, SUPPLY_MS)).toBe(200);
    expect(sizeForLs(212, SUPPLY_MS)).toBe(300);
    expect(sizeForLs(212, SUPPLY_MS, 250)).toBeNull();
  });

  it("more air than the largest neck takes another outlet, each the size its part needs", () => {
    expect(splitForLs(212, SUPPLY_MS, OUTLET_MAX_MM)).toEqual({ count: 2, diaMm: 250, lsEach: 106 });
    expect(splitForLs(130, SUPPLY_MS, OUTLET_MAX_MM)).toMatchObject({ count: 1, diaMm: 250 });
    expect(splitForLs(567, RETURN_MS, RETURN_MAX_MM)).toMatchObject({ count: 2, diaMm: 400 });
    expect(splitForLs(0, SUPPLY_MS, OUTLET_MAX_MM).count).toBe(0);
  });

  it("the return grille whose face takes the air at 2 m/s", () => {
    expect(returnGrilleFor(567)).toEqual({ wMm: 750, hMm: 400 });
    expect(returnGrilleFor(150)).toEqual({ wMm: 300, hMm: 300 });
  });
});

/* rooms on a calibrated floor, each its own size so each has its own load */
function house(names: [string, number, number][]): { doc: DesignDocument; ids: string[] } {
  const doc = createDesign({ name: "house", mode: "blank" });
  doc.floors[0] = { ...doc.floors[0], scaleMmPerUnit: 10 };
  const floorId = doc.floors[0].id;
  let x = 0;
  const ids = names.map(([name, w, h]) => {
    const id = name.toLowerCase().replace(/\s/g, "");
    doc.objects.push({
      id,
      type: "room",
      systemId: null,
      floorId,
      plane: "room",
      geometry: { kind: "polygon", points: [{ x, y: 0 }, { x: x + w, y: 0 }, { x: x + w, y: h }, { x, y: h }] },
      props: { name },
    } as RoomObj as DesignObject);
    x += w + 50;
    return id;
  });
  return { doc, ids };
}

describe("a ducted unit on the band", () => {
  it("shares its airflow among every zone by load, and sends it back down its return", () => {
    const h = house([["Living", 700, 550], ["Kitchen", 500, 450], ["Master", 400, 400], ["Bed 2", 350, 350]]);
    const made = newSystem(h.doc, pack.meta.version);
    let d = made.doc;
    for (const id of h.ids) d = claimZone(d, made.systemId, id);
    d = addBandUnit(d, pack, { systemId: made.systemId, iduModel: "PEAD-M100JAA(D)" });
    const sys = d.systems.find((s) => s.id === made.systemId)!;
    const [air] = systemAir(d, pack, sys);
    expect(air.model).toBe("PEAD-M100JAA(D)");
    expect(air.ls).toBe(567);
    const loads = h.ids.map((id) => roomLoadKw(d, d.objects.find((o) => o.id === id) as RoomObj)!);
    const total = loads.reduce((a, b) => a + b, 0);
    air.rooms.forEach((r, i) => {
      expect(r.ls).toBeCloseTo((567 * loads[i]) / total, 6);
      // every outlet carries its part at 3 m/s or less, none over Ø250
      expect(r.outlets.neckMm).toBeLessThanOrEqual(250);
      expect(ductCapacityLs(r.outlets.neckMm, SUPPLY_MS) * r.outlets.count).toBeGreaterThanOrEqual(r.ls - 1e-6);
    });
    expect(air.rooms.reduce((a, r) => a + r.ls, 0)).toBeCloseTo(567, 6);
    expect(air.ret).toEqual({ runs: 2, diaMm: 400, grille: { wMm: 750, hMm: 400 }, filter: true });
  });

  it("a wall head sends no air", () => {
    const h = house([["Bed 1", 400, 400]]);
    const made = newSystem(h.doc, pack.meta.version);
    const d = addHead(made.doc, pack, { systemId: made.systemId, zoneId: h.ids[0], iduModel: "MSZ-AP25VGD2" });
    expect(systemAir(d, pack, d.systems.find((s) => s.id === made.systemId)!)).toEqual([]);
  });

  it("a filter left to the unit's own is off on its return", () => {
    const h = house([["Living", 700, 550]]);
    const made = newSystem(h.doc, pack.meta.version);
    let d = claimZone(made.doc, made.systemId, h.ids[0]);
    d = addBandUnit(d, pack, { systemId: made.systemId, iduModel: "PEAD-M100JAA(D)" });
    const sys = d.systems.find((s) => s.id === made.systemId)!;
    const id = allocationsOf(sys).find((a) => a.role === "idu")!.id;
    const off = { ...sys, settings: { ...sys.settings, returnFilter: { [id]: false } } };
    expect(systemAir(d, pack, off)[0].ret.filter).toBe(false);
  });
});

describe("a ducted unit given a group of rooms", () => {
  it("shares its airflow among its rooms only", () => {
    const h = house([["Bed 1", 380, 350], ["Living", 650, 520], ["Kitchen", 420, 360], ["Dining", 380, 360]]);
    const made = newSystem(h.doc, pack.meta.version);
    let d = made.doc;
    for (const id of h.ids) d = claimZone(d, made.systemId, id);
    d = addHead(d, pack, { systemId: made.systemId, zoneId: "bed1", iduModel: "PEFY-P32VMS1-E" });
    d = addHead(d, pack, { systemId: made.systemId, zoneId: "living", iduModel: "PEFY-P100VMA-E4" });
    const vma = allocationsOf(d.systems.find((s) => s.id === made.systemId)!).find((a) => a.model === "PEFY-P100VMA-E4")!;
    d = setRoomsServed(d, pack, { systemId: made.systemId, allocationId: vma.id, roomIds: ["living", "kitchen", "dining"] });
    const air = systemAir(d, pack, d.systems.find((s) => s.id === made.systemId)!);
    const group = air.find((a) => a.model === "PEFY-P100VMA-E4")!;
    expect(group.rooms.map((r) => r.name)).toEqual(["Living", "Kitchen", "Dining"]);
    expect(group.rooms.reduce((a, r) => a + r.ls, 0)).toBeCloseTo(533, 6);
    expect(outletsText(group.rooms[0])).toMatch(/^\d+ outlets?, Ø\d+$/);
    // the bedroom's bulkhead blows straight in until it's given ductwork,
    // then sends its own air to its own room
    expect(air.find((a) => a.model === "PEFY-P32VMS1-E")).toBeUndefined();
    const vms = allocationsOf(d.systems.find((s) => s.id === made.systemId)!).find((a) => a.model === "PEFY-P32VMS1-E")!;
    d = setDuctsDrawn(d, made.systemId, vms.id, true);
    const ducted = systemAir(d, pack, d.systems.find((s) => s.id === made.systemId)!);
    expect(ducted.find((a) => a.model === "PEFY-P32VMS1-E")!.rooms.map((r) => r.name)).toEqual(["Bed 1"]);
    // and a ducted unit's can be taken off
    d = setDuctsDrawn(d, made.systemId, vma.id, false);
    expect(systemAir(d, pack, d.systems.find((s) => s.id === made.systemId)!).map((a) => a.model)).toEqual(["PEFY-P32VMS1-E"]);
  });
});
