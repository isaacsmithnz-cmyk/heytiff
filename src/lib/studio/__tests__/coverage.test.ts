/* Coverage engine (units → spaces): attribution via unit.props.roomId stamps,
   rooms-served = drawn ∪ adopted, covered = placed IDUs only, pending = chosen
   pairs sized against the room. Runs against the REAL shipped pack. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createDesign, type DesignDocument, type DesignObject } from "../document";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { roomsServedBy, roomCoverage, systemPairKw } from "../coverage";
import type { RoomObj } from "../loads-room";

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

/** calibrated floor (10 mm/unit), sys1 owns a 5×4 m room (20 m² → 2.9 kW at
    zone-5 defaults: orientation N, external walls assumed) */
function baseDoc(): DesignDocument {
  const d = createDesign({ name: "Cov", mode: "blank", now: "2026-07-10T00:00:00.000Z" });
  d.floors = [
    { id: "flr", name: "Ground", level: 0, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [] },
  ];
  d.systems = [
    { id: "sys1", type: "split", brand: "mitsubishi-electric", colour: "#2E68FF", name: "System 1", settings: {} },
    { id: "sys2", type: "split", brand: "mitsubishi-electric", colour: "#E4572E", name: "System 2", settings: {} },
  ];
  d.settings.climateZone = "5";
  d.objects = [
    {
      id: "room1",
      type: "room",
      systemId: "sys1",
      floorId: "flr",
      geometry: rect(0, 0, 500, 400),
      plane: "room",
      props: { name: "Lounge" },
    },
  ];
  return d;
}

const room1 = (d: DesignDocument) =>
  d.objects.find((o) => o.id === "room1") as RoomObj;

const idu = (id: string, systemId: string, model: string, roomId?: string): DesignObject => ({
  id,
  type: "unit",
  systemId,
  floorId: "flr",
  geometry: { kind: "point", at: { x: 100, y: 100 } },
  plane: "room",
  props: { role: "idu", model, ...(roomId ? { roomId } : {}) },
});
const odu = (id: string, systemId: string, model: string): DesignObject => ({
  id,
  type: "unit",
  systemId,
  floorId: "flr",
  geometry: { kind: "point", at: { x: 900, y: 100 } },
  plane: "external-ground",
  props: { role: "odu", model },
});

describe("roomsServedBy — drawn ∪ adopted", () => {
  it("a system serves its own rooms", () => {
    const d = baseDoc();
    expect(roomsServedBy(d, "sys1").map((r) => r.id)).toEqual(["room1"]);
    expect(roomsServedBy(d, "sys2")).toEqual([]);
  });

  it("adopting via settings.roomIds brings a foreign room into the served list", () => {
    const d = baseDoc();
    d.systems[1].settings.roomIds = ["room1"];
    expect(roomsServedBy(d, "sys2").map((r) => r.id)).toEqual(["room1"]);
    // ownership is untouched
    expect(room1(d).systemId).toBe("sys1");
  });
});

describe("systemPairKw", () => {
  it("reads the pair from placed units, honouring the sizing basis", () => {
    const d = baseDoc();
    d.objects.push(idu("i1", "sys1", "SLZ-M25FA-A"), odu("o1", "sys1", "SUZ-M25VAD-A"));
    expect(systemPairKw(d, pack, "sys1", "cooling")).toBe(2.5);
    expect(systemPairKw(d, pack, "sys1", "heating")).toBe(3);
    expect(systemPairKw(d, pack, "sys1", "worst-of-both")).toBe(2.5);
  });

  it("falls back to the chosen pair when nothing is placed", () => {
    const d = baseDoc();
    d.systems[0].settings.pairIdu = "PLA-M100EA2-A";
    d.systems[0].settings.pairOdu = "PUZ-M100VKA-A";
    expect(systemPairKw(d, pack, "sys1", "cooling")).toBe(10);
  });

  it("null when no pairing is known", () => {
    expect(systemPairKw(baseDoc(), pack, "sys1", "cooling")).toBeNull();
  });
});

describe("roomCoverage", () => {
  it("empty room: 2.9 kW load, nothing covered → under", () => {
    const d = baseDoc();
    const c = roomCoverage(d, pack, room1(d), "cooling");
    expect(c.loadKw).toBe(2.9);
    expect(c.coveredKw).toBe(0);
    expect(c.status).toBe("under");
    expect(c.pct).toBe(0);
  });

  it("a placed, attributed 2.5 kW IDU covers 86% → still under", () => {
    const d = baseDoc();
    d.objects.push(idu("i1", "sys1", "SLZ-M25FA-A", "room1"), odu("o1", "sys1", "SUZ-M25VAD-A"));
    const c = roomCoverage(d, pack, room1(d), "cooling");
    expect(c.coveredKw).toBe(2.5);
    expect(c.pct).toBe(86);
    expect(c.status).toBe("under");
    expect(c.contributors).toHaveLength(1);
    expect(c.contributors[0]).toMatchObject({ systemId: "sys1", model: "SLZ-M25FA-A", kw: 2.5 });
  });

  it("an UNattributed IDU contributes nothing", () => {
    const d = baseDoc();
    d.objects.push(idu("i1", "sys1", "SLZ-M25FA-A"), odu("o1", "sys1", "SUZ-M25VAD-A"));
    expect(roomCoverage(d, pack, room1(d), "cooling").coveredKw).toBe(0);
  });

  it("two systems on one room SUM their capacity (the System-2 story)", () => {
    const d = baseDoc();
    d.systems[1].settings.roomIds = ["room1"]; // sys2 adopted the room
    d.objects.push(
      idu("i1", "sys1", "SLZ-M25FA-A", "room1"),
      odu("o1", "sys1", "SUZ-M25VAD-A"),
      idu("i2", "sys2", "SLZ-M25FA-A", "room1"),
      odu("o2", "sys2", "SUZ-M25VAD-A")
    );
    const c = roomCoverage(d, pack, room1(d), "cooling");
    expect(c.coveredKw).toBe(5);
    expect(c.pct).toBe(172);
    expect(c.status).toBe("covered");
    expect(c.oversized).toBe(true); // >150%
    expect(c.contributors.map((x) => x.systemId)).toEqual(["sys1", "sys2"]);
  });

  it("exactly covering flips to covered without the oversize flag", () => {
    const d = baseDoc();
    d.objects.push(idu("i1", "sys1", "PEAD-M50JAA(D)", "room1"), odu("o1", "sys1", "SUZ-M50VAD-A"));
    const c = roomCoverage(d, pack, room1(d), "cooling"); // 5.0 kW on 2.9 → 172%
    expect(c.status).toBe("covered");
    // and a 3.5 kW pair on the same load is covered, NOT oversized (121%)
    const d2 = baseDoc();
    d2.objects.push(idu("i1", "sys1", "SLZ-M35FA-A", "room1"), odu("o1", "sys1", "SUZ-M35VAD-A"));
    const c2 = roomCoverage(d2, pack, room1(d2), "cooling");
    expect(c2.pct).toBe(121);
    expect(c2.status).toBe("covered");
    expect(c2.oversized).toBe(false);
  });

  it("a chosen-but-unplaced pair shows as pending, not covered", () => {
    const d = baseDoc();
    d.systems[1].settings.pairIdu = "SLZ-M25FA-A";
    d.systems[1].settings.pairOdu = "SUZ-M25VAD-A";
    d.systems[1].settings.roomId = "room1"; // sized against this room
    const c = roomCoverage(d, pack, room1(d), "cooling");
    expect(c.coveredKw).toBe(0);
    expect(c.pendingKw).toBe(2.5);
    expect(c.status).toBe("under");
  });

  it("uncalibrated floor → unknown status", () => {
    const d = baseDoc();
    d.floors[0].scaleMmPerUnit = null;
    const c = roomCoverage(d, pack, room1(d), "cooling");
    expect(c.loadKw).toBeNull();
    expect(c.status).toBe("unknown");
  });
});
