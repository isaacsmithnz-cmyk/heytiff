/* The ductwork the Studio lays out for a ducted unit (ductwork.ts; Isaac,
   2026-10-28, A: "the Studio draws them for you … and you drag to change";
   then square routes, and every junction "just a circle" named by its ducts,
   a Y or a BTO once picked). The mock's house: a PEAD-M100JAA(D) in the
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
import { ductCapacityLs, setDuctsDrawn, SUPPLY_MS } from "../airflow";
import { dragDuctEnd, fittingName, inches, outletSpots, polylineM, setFittingKind, systemDuctwork, unitFace } from "../ductwork";

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
  d = setDuctsDrawn(d, made.systemId, unit.id, true);
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

  it("joins neighbours on one run, parting at a circle named by its ducts biggest first, never over Ø300 or its air", () => {
    const h = placed();
    const [lay] = systemDuctwork(h.doc, pack, sysOf(h.doc, h.systemId));
    expect(lay.fittings.length).toBeGreaterThan(0);
    for (const f of lay.fittings) {
      expect(f.kind).toBeNull();
      expect(f.ductsMm).toEqual([...f.ductsMm].sort((a, b) => b - a));
      expect(f.name).toBe(`Fitting ${f.ductsMm.map(inches).join("-")}`);
      const trunk = lay.supply.find((r) => r.key === `trunk:${f.key}`)!;
      expect(trunk.diaMm).toBeLessThanOrEqual(300);
      expect(ductCapacityLs(trunk.diaMm, SUPPLY_MS)).toBeGreaterThanOrEqual(trunk.ls - 1e-9);
      // the trunk ends at the circle, and the two runs leave it
      expect(trunk.points[trunk.points.length - 1]).toEqual(f.at);
      const [, a, b] = f.key.match(/^fit:(.+)\+(.+)$/)!;
      for (const k of [a, b]) expect(lay.supply.find((r) => r.key === `run:${k}`)!.points[0]).toEqual(f.at);
    }
    // one collar a run off the plenum, every outlet at the end of exactly one run
    expect(lay.collars).toHaveLength(lay.outlets.length - lay.fittings.length);
    for (const o of lay.outlets) {
      const runs = lay.supply.filter((r) => r.key === `run:${o.key}`);
      expect(runs).toHaveLength(1);
      expect(runs[0].points[runs[0].points.length - 1]).toEqual(o.at);
    }
  });

  it("bends square: every leg runs along or across the unit", () => {
    const h = placed();
    const [lay] = systemDuctwork(h.doc, pack, sysOf(h.doc, h.systemId));
    for (const r of lay.supply) {
      for (let i = 1; i < r.points.length; i++) {
        const dx = Math.abs(r.points[i].x - r.points[i - 1].x);
        const dy = Math.abs(r.points[i].y - r.points[i - 1].y);
        expect(Math.min(dx, dy)).toBeLessThan(1e-6);
      }
    }
  });

  it("no two runs cross", () => {
    const h = placed();
    const [lay] = systemDuctwork(h.doc, pack, sysOf(h.doc, h.systemId));
    type Seg = [Point, Point];
    const segs = (r: { points: Point[] }): Seg[] => r.points.slice(1).map((p, i) => [r.points[i], p]);
    const crosses = ([a, b]: Seg, [c, d]: Seg) => {
      const cr = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
      const d1 = cr(c, d, a);
      const d2 = cr(c, d, b);
      const d3 = cr(a, b, c);
      const d4 = cr(a, b, d);
      return d1 * d2 < 0 && d3 * d4 < 0;
    };
    for (let i = 0; i < lay.supply.length; i++)
      for (let j = i + 1; j < lay.supply.length; j++)
        for (const p of segs(lay.supply[i])) for (const q of segs(lay.supply[j])) expect(crosses(p, q)).toBe(false);
  });

  it("a circle picked as a Y or a BTO takes that name, and goes back to the day", () => {
    const h = placed();
    const [lay] = systemDuctwork(h.doc, pack, sysOf(h.doc, h.systemId));
    const f = lay.fittings[0];
    const asBto = setFittingKind(h.doc, h.systemId, f.key, "bto");
    expect(systemDuctwork(asBto, pack, sysOf(asBto, h.systemId))[0].fittings[0]).toMatchObject({
      kind: "bto",
      name: fittingName(f.ductsMm, "bto"),
    });
    expect(fittingName([250, 350, 250], "y")).toBe("Y 14-10-10");
    const back = setFittingKind(asBto, h.systemId, f.key, null);
    expect(systemDuctwork(back, pack, sysOf(back, h.systemId))[0].fittings[0].name).toBe(f.name);
  });

  it("measures every run along what is drawn", () => {
    const h = placed();
    const [lay] = systemDuctwork(h.doc, pack, sysOf(h.doc, h.systemId));
    for (const r of [...lay.supply, ...lay.returns]) {
      expect(r.lengthM).toBeGreaterThan(0);
      expect(r.lengthM).toBeCloseTo(polylineM(r.points, 10), 9);
    }
  });

  it("puts the return grille under the unit on its box, and runs two Ø400s back once it is dragged away", () => {
    const h = placed();
    const [lay] = systemDuctwork(h.doc, pack, sysOf(h.doc, h.systemId));
    expect(lay.ret).toMatchObject({ wMm: 750, hMm: 400, filter: true, runs: 2, moved: false });
    expect(lay.returns).toEqual([]);
    const unit = h.doc.objects.find((o) => o.id === h.unitId)!;
    const face = unitFace(unit, "return", 10)!;
    // the return face is the other side of the unit from the supply face
    expect(face.out.y).toBe(-unitFace(unit, "supply", 10)!.out.y);
    expect(lay.ret.at.y).toBeCloseTo(face.mid.y + face.out.y * 30, 6);
    const d = dragDuctEnd(h.doc, h.systemId, lay.ret.key, { x: m(10), y: m(4) });
    const [away] = systemDuctwork(d, pack, sysOf(d, h.systemId));
    expect(away.returns).toHaveLength(2);
    expect(away.returns.every((r) => r.diaMm === 400 && r.lengthM > 0)).toBe(true);
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
