/* Zoning a ducted unit (zoning.ts; Isaac, 2026-10-28: "build in some zone
   dampers. And controllers and sensors"): every room its own zone until
   joined, the kit from the brand's pack by control and zone count, plain
   lines for a brand with none, and on the plan a damper on each zone's own
   run, a sensor a zone and the controller. The mock's house at 10 mm a
   unit, a PEAD-M100JAA(D) in the hall. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { createDesign, type DesignDocument, type DesignObject } from "../document";
import { addBandUnit, allocationsOf, placeAllocation } from "../builder";
import { claimZone, newSystem } from "../zones";
import { systemAir } from "../airflow";
import { ductLines } from "../duct-materials";
import { joinZone, setZoning, zoneKit, zoningOf, zonesOf } from "../zoning";

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

function house() {
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
  room("hall", "Hall", 4, 5.5, 8, 1.5);
  room("bed2", "Bed 2", 4, 7, 4, 3);
  room("bed3", "Bed 3", 8, 7, 4, 3);
  const made = newSystem(doc, pack.meta.version);
  let d = made.doc;
  for (const z of ["living", "kitchen", "master", "bed2", "bed3"]) d = claimZone(d, made.systemId, z);
  d = addBandUnit(d, pack, { systemId: made.systemId, iduModel: "PEAD-M100JAA(D)" });
  const unit = allocationsOf(d.systems[0]).find((a) => a.role === "idu")!;
  d = placeAllocation(d, pack, made.systemId, unit.id, d.floors[0].id, { x: m(7.3), y: m(6.25) });
  return { doc: d, systemId: made.systemId, unitId: unit.id };
}
const sysOf = (d: DesignDocument) => d.systems[0];
const airOf = (d: DesignDocument) => systemAir(d, pack, sysOf(d))[0];

describe("zones", () => {
  it("are off until set; then every room is its own zone, Z1 onwards", () => {
    const h = house();
    expect(zonesOf(airOf(h.doc), zoningOf(sysOf(h.doc), h.unitId))).toEqual([]);
    const d = setZoning(h.doc, h.systemId, h.unitId, { control: "temperature" });
    const zones = zonesOf(airOf(d), zoningOf(sysOf(d), h.unitId));
    expect(zones.map((z) => `${z.label} ${z.name}`)).toEqual(["Z1 Living", "Z2 Kitchen", "Z3 Master", "Z4 Bed 2", "Z5 Bed 3"]);
  });

  it("join by moving a room into another's zone, and part when it moves out", () => {
    const h = house();
    let d = setZoning(h.doc, h.systemId, h.unitId, { control: "temperature", spill: "kitchen" });
    d = joinZone(d, h.systemId, h.unitId, airOf(d), "kitchen", "living");
    let zones = zonesOf(airOf(d), zoningOf(sysOf(d), h.unitId));
    expect(zones.map((z) => z.name)).toEqual(["Living and Kitchen", "Master", "Bed 2", "Bed 3"]);
    // the spill zone it was is gone with it
    expect(zoningOf(sysOf(d), h.unitId).spill).toBeNull();
    // the zone's first room leaving keeps the rest together
    d = joinZone(d, h.systemId, h.unitId, airOf(d), "master", "living");
    d = joinZone(d, h.systemId, h.unitId, airOf(d), "living", null);
    zones = zonesOf(airOf(d), zoningOf(sysOf(d), h.unitId));
    expect(zones.map((z) => z.name)).toEqual(["Living", "Kitchen and Master", "Bed 2", "Bed 3"]);
  });
});

describe("the kit, from the brand's pack", () => {
  const zonesFor = (n: number, control: "on_off" | "temperature") => {
    const h = house();
    let d = setZoning(h.doc, h.systemId, h.unitId, { control });
    if (n < 5) for (const id of ["kitchen", "master", "bed2", "bed3"].slice(0, 5 - n)) d = joinZone(d, h.systemId, h.unitId, airOf(d), id, "living");
    const z = zoningOf(sysOf(d), h.unitId);
    return { z, zones: zonesOf(airOf(d), z) };
  };
  const names = (k: ReturnType<typeof zoneKit>) => k.lines.map((l) => `${l.qty} ${l.name}`);

  it("temperature, four zones, wireless: the 4-zone interface, a sensor a zone with batteries, and the receiver", () => {
    const { z, zones } = zonesFor(4, "temperature");
    const kit = zoneKit(pack, z, zones);
    expect(kit.interfaceModel).toBe("PAC-ZC04L240C-A");
    expect(kit.problem).toBeNull();
    expect(names(kit)).toEqual([
      "1 Zone interface PAC-ZC04L240C-A",
      "1 Main controller PAR-ZM01A-A",
      "4 Wireless sensor PAR-ZR01S-A",
      "8 AAA battery",
      "1 Wireless receiver PAR-ZR01R-A",
    ]);
    expect(kit.lines.every((l) => l.shelf === "controls")).toBe(true);
  });

  it("five zones take the 10-zone interface; on/off takes the on/off one and no sensors", () => {
    expect(zoneKit(pack, ...(Object.values(zonesFor(5, "temperature")) as [never, never])).interfaceModel).toBe("PAC-ZC10L240C-A");
    const off = zonesFor(4, "on_off");
    const kit = zoneKit(pack, off.z, off.zones);
    expect(kit.interfaceModel).toBe("PAC-ZC04S240C-A");
    expect(names(kit).some((n) => /sensor/i.test(n))).toBe(false);
  });

  it("wired sensors past the maker's four are a problem the builder says", () => {
    const { z, zones } = zonesFor(5, "temperature");
    expect(zoneKit(pack, { ...z, sensors: "wired" }, zones).problem).toMatch(/wired sensors stop at 4/);
  });

  it("a brand whose pack has no zoning gets plain lines the price book prices", () => {
    const { z, zones } = zonesFor(4, "temperature");
    const bare = { ...pack, zoning_controllers: [] };
    expect(names(zoneKit(bare, z, zones))).toEqual(["1 Zone controller", "4 Zone sensor"]);
  });
});

describe("on the sheet", () => {
  it("a damper a zone, the kit and a cable a damper; nothing is drawn on the plan for it", () => {
    const h = house();
    let d = setZoning(h.doc, h.systemId, h.unitId, { control: "temperature" });
    d = joinZone(d, h.systemId, h.unitId, airOf(d), "kitchen", "living");
    const lines = ductLines(d, pack, sysOf(d));
    expect(lines.find((l) => l.name === "Zone damper")).toMatchObject({ shelf: "ductwork", qty: "4" });
    expect(lines.find((l) => l.name === "Zone damper cable")).toMatchObject({ shelf: "controls", qty: "4" });
    expect(lines.find((l) => l.name === "Zone interface PAC-ZC04L240C-A")).toMatchObject({ shelf: "controls", qty: "1" });
    expect(d.objects.length).toBe(h.doc.objects.length);
  });

  it("zoning off puts nothing on the sheet", () => {
    const h = house();
    expect(ductLines(h.doc, pack, sysOf(h.doc)).some((l) => /zone/i.test(l.name))).toBe(false);
  });
});
