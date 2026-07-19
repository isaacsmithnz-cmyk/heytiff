/* Summary derivations — the design-basis line the summary chips and the
   printed pack header both render, the snapshot stat strip, and the rooms &
   loads tables. Serving attribution runs against the REAL shipped pack. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createDesign, type DesignDocument, type DesignObject } from "../document";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { DEFAULT_CLIMATE_ZONE } from "../loads";
import {
  buildDesignSnapshot,
  designBasis,
  effectiveBuildingType,
  effectiveClimateZone,
  roomsByFloor,
} from "../summary";
import { buildMaterials, rollupUnits } from "../materials";

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

const rect = (x: number, y: number, w: number, h: number) => ({
  kind: "polygon" as const,
  points: [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ],
});

const room = (
  id: string,
  floorId: string,
  systemId: string | null,
  name: string
): DesignObject => ({
  id,
  type: "room",
  systemId,
  floorId,
  geometry: rect(0, 0, 500, 400),
  plane: "room",
  props: { name },
});

const unit = (
  id: string,
  systemId: string,
  role: "idu" | "odu",
  model: string,
  roomId?: string
): DesignObject => ({
  id,
  type: "unit",
  systemId,
  floorId: "f1",
  geometry: { kind: "point", at: { x: 100, y: 100 } },
  plane: role === "idu" ? "room" : "external-ground",
  props: { role, model, ...(roomId ? { roomId } : {}) },
});

/** two floors — f1 calibrated (10 mm/unit → the 500×400 room is 20 m²),
    f2 uncalibrated; one split system with a placed pair in room1 */
function fixtureDoc(): DesignDocument {
  const d = createDesign({ name: "Sum", mode: "blank", now: "2026-07-19T00:00:00.000Z" });
  d.floors = [
    { id: "f1", name: "Ground", level: 0, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [] },
    { id: "f2", name: "Level 1", level: 1, scaleMmPerUnit: null, northDeg: null, northPos: null, plans: [] },
  ];
  d.systems = [
    { id: "sys1", type: "split", brand: "mitsubishi-electric", colour: "#2E68FF", name: "System 1", settings: { pairIdu: "MSZ-AP25VGD", pairOdu: "MUZ-AP25VGD" } },
  ];
  d.settings.climateZone = "5";
  d.objects = [
    room("room1", "f1", "sys1", "Lounge"),
    room("room2", "f2", null, "Bed 1"),
    unit("i1", "sys1", "idu", "MSZ-AP25VGD", "room1"),
    unit("o1", "sys1", "odu", "MUZ-AP25VGD"),
  ];
  return d;
}

describe("effective settings", () => {
  it("falls back to the default zone when unset or unparsable", () => {
    const d = createDesign({ name: "T", mode: "blank" });
    expect(effectiveClimateZone(d.settings)).toBe(DEFAULT_CLIMATE_ZONE);
    d.settings.climateZone = "nope";
    expect(effectiveClimateZone(d.settings)).toBe(DEFAULT_CLIMATE_ZONE);
    d.settings.climateZone = "99"; // not a table zone
    expect(effectiveClimateZone(d.settings)).toBe(DEFAULT_CLIMATE_ZONE);
  });

  it("parses a stored zone string", () => {
    const d = createDesign({ name: "T", mode: "blank" });
    d.settings.climateZone = "7";
    expect(effectiveClimateZone(d.settings)).toBe(7);
  });

  it("building type falls back to residential", () => {
    const d = createDesign({ name: "T", mode: "blank" });
    expect(effectiveBuildingType(d.settings)).toBe("residential");
    d.settings.buildingType = "commercial";
    expect(effectiveBuildingType(d.settings)).toBe("commercial");
    d.settings.buildingType = "mystery";
    expect(effectiveBuildingType(d.settings)).toBe("residential");
  });
});

describe("designBasis", () => {
  it("labels the settings for chips and print", () => {
    const d = createDesign({ name: "T", mode: "blank" });
    d.settings.climateZone = "6";
    d.settings.buildingType = "light_commercial";
    d.settings.sizingBasis = "heating";
    const b = designBasis(d);
    expect(b.zone).toBe(6);
    expect(b.zoneLabel).toMatch(/Zone 6/);
    expect(b.zoneCity).toBe("Melbourne");
    expect(b.buildingLabel).toBe("Light commercial");
    expect(b.basisLabel).toBe("Sized on heating");
  });

  it("defaults produce the standard basis line", () => {
    const d = createDesign({ name: "T", mode: "blank" });
    const b = designBasis(d);
    expect(b.zone).toBe(DEFAULT_CLIMATE_ZONE);
    expect(b.zoneCity).toBe("Sydney");
    expect(b.buildingLabel).toBe("Residential");
    expect(b.basisLabel).toBe("Sized on worst of both");
  });
});

describe("buildDesignSnapshot", () => {
  it("counts floors, rooms, units and sums only the measurable rooms", () => {
    const s = buildDesignSnapshot(fixtureDoc());
    expect(s.floorCount).toBe(2);
    expect(s.roomCount).toBe(2);
    expect(s.systemCount).toBe(1);
    expect(s.iduCount).toBe(1);
    expect(s.oduCount).toBe(1);
    // 500×400 units @10 mm/unit = 5×4 m = 20 m²; zone 5 residential → 2.9 kW
    expect(s.areaM2).toBe(20);
    expect(s.totalLoadKw).toBe(2.9);
    // room2 sits on the uncalibrated floor — excluded, and counted as such
    expect(s.unmeasuredRoomCount).toBe(1);
    expect(s.uncalibratedFloorCount).toBe(1);
  });

  it("an empty design snapshots to zeros and nulls", () => {
    const s = buildDesignSnapshot(createDesign({ name: "E", mode: "blank" }));
    expect(s.roomCount).toBe(0);
    expect(s.areaM2).toBeNull();
    expect(s.totalLoadKw).toBeNull();
    expect(s.iduCount).toBe(0);
  });
});

describe("roomsByFloor", () => {
  it("groups rooms per floor with loads and serving units", () => {
    const floors = roomsByFloor(fixtureDoc(), pack);
    expect(floors).toHaveLength(2);
    const [f1, f2] = floors;
    expect(f1.calibrated).toBe(true);
    expect(f1.rooms).toHaveLength(1);
    expect(f1.rooms[0].name).toBe("Lounge");
    expect(f1.rooms[0].areaM2).toBeCloseTo(20, 5);
    expect(f1.rooms[0].loadKw).toBeCloseTo(2.9, 5);
    expect(f1.rooms[0].serving).toHaveLength(1);
    expect(f1.rooms[0].serving[0].model).toBe("MSZ-AP25VGD");
    expect(f1.rooms[0].serving[0].systemName).toBe("System 1");
    // uncalibrated floor: the room rows exist, measures are null
    expect(f2.calibrated).toBe(false);
    expect(f2.rooms[0].areaM2).toBeNull();
    expect(f2.rooms[0].loadKw).toBeNull();
  });
});

describe("rollupUnits", () => {
  it("sums the same model across systems, sorted by model", () => {
    const d = fixtureDoc();
    d.systems.push({
      id: "sys2",
      type: "split",
      brand: "mitsubishi-electric",
      colour: "#E4572E",
      name: "System 2",
      settings: { pairIdu: "MSZ-AP25VGD", pairOdu: "MUZ-AP25VGD" },
    });
    d.objects.push(
      room("room3", "f1", "sys2", "Study"),
      unit("i2", "sys2", "idu", "MSZ-AP25VGD", "room3"),
      unit("o2", "sys2", "odu", "MUZ-AP25VGD")
    );
    const rows = rollupUnits(buildMaterials(d, pack));
    const idus = rows.find((r) => r.model === "MSZ-AP25VGD");
    const odus = rows.find((r) => r.model === "MUZ-AP25VGD");
    expect(idus?.qty).toBe(2);
    expect(odus?.qty).toBe(2);
    expect(rows.map((r) => r.model)).toEqual([...rows.map((r) => r.model)].sort());
  });
});
