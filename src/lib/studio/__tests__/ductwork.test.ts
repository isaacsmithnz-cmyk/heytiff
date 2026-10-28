/* The ductwork the Studio lays out for a ducted unit (ductwork.ts; Isaac,
   2026-10-28, A: "the Studio draws them for you … joining neighbours with a
   BTO, and you drag to change"). The mock's house: a PEAD-M100JAA(D) in the
   hall ceiling, five rooms around it, on a plan at 10 mm a unit. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { createDesign, type DesignDocument, type DesignObject, type Point } from "../document";
import { pointInPolygon } from "../geometry";
import type { RoomObj } from "../loads-room";
import { addBandUnit, allocationsOf, placeAllocation } from "../builder";
import { claimZone, newSystem } from "../zones";
import { ductCapacityLs, SUPPLY_MS } from "../airflow";
import { dragDuctEnd, inches, outletSpots, polylineM, systemDuctwork, unitFace } from "../ductwork";

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

/* metres to plan units at 10 mm a unit */
const m = (v: number) => v * 100;
function room(doc: DesignDocument, id: string, name: string, x: number, y: number, w: number, h: number) {
  doc.objects.push({
    id,
    type: "room",
    systemId: null,
    floorId: doc.floors[0].id,
    plane: "room",
    geometry: { kind: "polygon", points: [{ x: m(x), y: m(y) }, { x: m(x + w), y: m(y) }, { x: m(x + w), y: m(y + h) }, { x: m(x), y: m(y + h) }] },
    props: { name },
  } as RoomObj as DesignObject);
}

function house() {
  const doc = createDesign({ name: "12 Example St", mode: "blank" });
  doc.floors[0] = { ...doc.floors[0], scaleMmPerUnit: 10 };
  room(doc, "living", "Living", 0, 0, 7, 5.5);
  room(doc, "kitchen", "Kitchen", 7, 0, 5, 5.5);
  room(doc, "master", "Master", 0, 5.5, 4, 4.5);
  room(doc, "hall", "Hall", 4, 5.5, 8, 1.5);
  room(doc, "bed2", "Bed 2", 4, 7, 4, 3);
  room(doc, "bed3", "Bed 3", 8, 7, 4, 3);
  const made = newSystem(doc, pack.meta.version);
  let d = made.doc;
  for (const z of ["living", "kitchen", "master", "bed2", "bed3"]) d = claimZone(d, made.systemId, z);
  d = addBandUnit(d, pack, { systemId: made.systemId, iduModel: "PEAD-M100JAA(D)" });
  const unit = allocationsOf(d.systems.find((s) => s.id === made.systemId)!).find((a) => a.role === "idu")!;
  return { doc: d, systemId: made.systemId, unitId: unit.id };
}
const sysOf = (d: DesignDocument, id: string) => d.systems.find((s) => s.id === id)!;
const roomOf = (d: DesignDocument, id: string) => d.objects.find((o) => o.id === id) as RoomObj;

describe("before the unit is on the plan", () => {
  it("nothing is laid out", () => {
    const h = house();
    expect(systemDuctwork(h.doc, pack, sysOf(h.doc, h.systemId))).toEqual([]);
  });
});

describe("the unit in the hall ceiling", () => {
  const placed = () => {
    const h = house();
    const doc = placeAllocation(h.doc, pack, h.systemId, h.unitId, h.doc.floors[0].id, { x: m(7.3), y: m(6.25) });
    return { ...h, doc };
  };

  it("puts every room's outlets in that room, as many as its air needs", () => {
    const h = placed();
    const [lay] = systemDuctwork(h.doc, pack, sysOf(h.doc, h.systemId));
    expect(lay.model).toBe("PEAD-M100JAA(D)");
    for (const o of lay.outlets) {
      const r = roomOf(h.doc, o.roomId);
      expect(r.geometry.kind === "polygon" && pointInPolygon(o.at, r.geometry.points)).toBe(true);
      expect(o.neckMm).toBeLessThanOrEqual(250);
    }
    expect(new Set(lay.outlets.map((o) => o.roomId))).toEqual(new Set(["living", "kitchen", "master", "bed2", "bed3"]));
  });

  it("joins neighbours on one trunk with a fitting named in inches, never over Ø300 or its air", () => {
    const h = placed();
    const [lay] = systemDuctwork(h.doc, pack, sysOf(h.doc, h.systemId));
    expect(lay.fittings.length).toBeGreaterThan(0);
    for (const f of lay.fittings) {
      expect(f.name).toBe(`${f.kind === "y" ? "Y" : "BTO"} ${inches(f.inMm)}-${inches(f.outMm[0])}-${inches(f.outMm[1])}`);
      expect(f.inMm).toBeLessThanOrEqual(300);
      const trunk = lay.supply.find((r) => r.key === `trunk:${f.key}`)!;
      expect(ductCapacityLs(trunk.diaMm, SUPPLY_MS)).toBeGreaterThanOrEqual(trunk.ls - 1e-9);
    }
    // a Y joins two outlets in one room; a BTO two rooms
    const [a, b] = lay.fittings[0].key.slice(4).split("+").map((k) => k.split("/")[1]);
    expect(lay.fittings[0].kind).toBe(a === b ? "y" : "bto");
    // one spigot a trunk, every outlet at the end of exactly one run
    expect(lay.spigots).toHaveLength(lay.outlets.length - lay.fittings.length);
    for (const o of lay.outlets) expect(lay.supply.filter((r) => r.key === `run:${o.key}`)).toHaveLength(1);
  });

  it("measures every run along what is drawn", () => {
    const h = placed();
    const [lay] = systemDuctwork(h.doc, pack, sysOf(h.doc, h.systemId));
    for (const r of [...lay.supply, ...lay.returns]) {
      expect(r.lengthM).toBeGreaterThan(0);
      expect(r.lengthM).toBeCloseTo(polylineM(r.points, 10), 9);
    }
  });

  it("sends the air back down two Ø400s from a grille out from the return face", () => {
    const h = placed();
    const [lay] = systemDuctwork(h.doc, pack, sysOf(h.doc, h.systemId));
    expect(lay.returns).toHaveLength(2);
    expect(lay.returns.every((r) => r.diaMm === 400)).toBe(true);
    expect(lay.ret).toMatchObject({ wMm: 750, hMm: 400, filter: true, runs: 2 });
    const unit = h.doc.objects.find((o) => o.id === h.unitId)!;
    const face = unitFace(unit, "return", 10)!;
    // the return face is the other side of the unit from the supply face
    expect(face.out.y).toBe(-unitFace(unit, "supply", 10)!.out.y);
  });

  it("an outlet dragged elsewhere stays there, and its run follows", () => {
    const h = placed();
    const [before] = systemDuctwork(h.doc, pack, sysOf(h.doc, h.systemId));
    const o = before.outlets.find((x) => x.roomId === "master")!;
    const to: Point = { x: m(1), y: m(9) };
    const d = dragDuctEnd(h.doc, h.systemId, o.key, to);
    const [after] = systemDuctwork(d, pack, sysOf(d, h.systemId));
    expect(after.outlets.find((x) => x.key === o.key)!.at).toEqual(to);
    const run = after.supply.find((r) => r.key === `run:${o.key}`)!;
    expect(run.points[run.points.length - 1]).toEqual(to);
  });
});

describe("where a room's outlets go", () => {
  it("along its longer side, through its middle", () => {
    const h = house();
    const living = outletSpots(roomOf(h.doc, "living"), 2);
    [m(7) / 3, (2 * m(7)) / 3].forEach((x, i) => {
      expect(living[i].x).toBeCloseTo(x, 6);
      expect(living[i].y).toBeCloseTo(m(2.75), 6);
    });
    expect(outletSpots(roomOf(h.doc, "master"), 1)).toEqual([{ x: m(2), y: m(7.75) }]);
  });
});
