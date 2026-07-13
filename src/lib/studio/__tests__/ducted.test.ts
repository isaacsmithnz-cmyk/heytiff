/* Ducted Stage-7 Step 1 — lib slice: dev flag, air-capability predicate,
   Attach extension, diversity + required-capacity engine. */

import { createDesign, newId, type DesignDocument, type DesignSystem } from "../document";
import { attachOf } from "../graph";
import { isAirCapable } from "../modules";
import { roomLoadKw, type RoomObj } from "../loads-room";
import {
  DUCTED_OBJECT_TYPES,
  isDuctedObjectType,
  streamOf,
  ftypeOf,
  diversityFactor,
  ductedRequirement,
} from "../ducted";

/* ── fixtures ── */

function docWithRooms(): { doc: DesignDocument; system: DesignSystem; rooms: RoomObj[] } {
  const doc = createDesign({ name: "t", mode: "blank" }); // one floor @ 10 mm/unit
  const floorId = doc.floors[0].id;
  const system: DesignSystem = {
    id: newId("sys"),
    type: "ducted",
    brand: "mitsubishi-electric",
    colour: "#2E68FF",
    name: "System 1",
    settings: {},
  };
  doc.systems.push(system);
  const mkRoom = (w: number, h: number): RoomObj => ({
    id: newId("obj"),
    type: "room",
    systemId: system.id,
    floorId,
    plane: "room",
    geometry: {
      kind: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ],
    },
    props: { name: "Room" },
  });
  const rooms = [mkRoom(800, 500), mkRoom(400, 300)]; // 40 m² + 12 m² at 10 mm/unit
  doc.objects.push(...rooms);
  return { doc, system, rooms };
}

/* ── the dev flag ── */

describe("ducted dev flag", () => {
  const OLD = process.env.NEXT_PUBLIC_STUDIO_DUCTED;
  afterEach(() => {
    process.env.NEXT_PUBLIC_STUDIO_DUCTED = OLD;
  });

  it("keeps ducted unavailable without the flag", () => {
    delete process.env.NEXT_PUBLIC_STUDIO_DUCTED;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mods = require("../modules");
      expect(mods.SYSTEM_MODULES.ducted.available).toBe(false);
      expect(mods.availableModules().map((m: { type: string }) => m.type)).not.toContain(
        "ducted"
      );
    });
  });

  it("enables ducted with NEXT_PUBLIC_STUDIO_DUCTED=1", () => {
    process.env.NEXT_PUBLIC_STUDIO_DUCTED = "1";
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mods = require("../modules");
      expect(mods.SYSTEM_MODULES.ducted.available).toBe(true);
      expect(mods.availableModules().map((m: { type: string }) => m.type)).toContain("ducted");
    });
  });
});

/* ── air capability ── */

describe("isAirCapable", () => {
  it("accepts ducted/bulkhead forms with airflow", () => {
    expect(isAirCapable({ form_factor: "ducted", airflow_ls: 630 })).toBe(true);
    expect(isAirCapable({ form_factor: "bulkhead", airflow_ls: 280 })).toBe(true);
  });
  it("rejects hi-walls and airflow-less rows", () => {
    expect(isAirCapable({ form_factor: "hi-wall", airflow_ls: 500 })).toBe(false);
    expect(isAirCapable({ form_factor: "ducted" })).toBe(false);
  });
});

/* ── Attach extension ── */

describe("attachOf (graph v0 + Stage-7 kinds)", () => {
  it("still accepts unit/riser", () => {
    expect(attachOf({ kind: "unit", id: "u1" })).toEqual({ kind: "unit", id: "u1" });
    expect(attachOf({ kind: "riser", id: "r1" })).toEqual({ kind: "riser", id: "r1" });
  });
  it("accepts fitting / spigot / grille", () => {
    expect(attachOf({ kind: "fitting", id: "f1" })).toEqual({ kind: "fitting", id: "f1" });
    expect(attachOf({ kind: "spigot", id: "s1" })).toEqual({ kind: "spigot", id: "s1" });
    expect(attachOf({ kind: "grille", id: "g1" })).toEqual({ kind: "grille", id: "g1" });
  });
  it("rejects unknown kinds and malformed values", () => {
    expect(attachOf({ kind: "plenum", id: "p1" })).toBeNull();
    expect(attachOf({ kind: "grille" })).toBeNull();
    expect(attachOf("grille")).toBeNull();
  });
});

/* ── object conventions ── */

describe("ducted object conventions", () => {
  it("guards the five palette types", () => {
    for (const t of DUCTED_OBJECT_TYPES) expect(isDuctedObjectType(t)).toBe(true);
    expect(isDuctedObjectType("room")).toBe(false);
    expect(isDuctedObjectType("unit")).toBe(false);
  });
  it("reads streams openly and fitting subtypes strictly", () => {
    expect(streamOf({ stream: "supply" })).toBe("supply");
    expect(streamOf({ stream: "exhaust" })).toBe("exhaust"); // future stream stays readable
    expect(streamOf({})).toBeNull();
    expect(ftypeOf({ ftype: "zone-motor" })).toBe("zone-motor");
    expect(ftypeOf({ ftype: "elbow" })).toBeNull();
  });
});

/* ── diversity + required capacity ── */

describe("diversityFactor", () => {
  const sys = (settings: Record<string, unknown>): DesignSystem => ({
    id: "s",
    type: "ducted",
    brand: "b",
    colour: "#000",
    name: "S",
    settings,
  });

  it("defaults 1.00 unzoned, 0.70 zoned", () => {
    expect(diversityFactor(sys({}))).toBe(1.0);
    expect(diversityFactor(sys({ zones: [] }))).toBe(1.0);
    expect(diversityFactor(sys({ zones: [{ id: "z1" }] }))).toBe(0.7);
  });
  it("a stored override wins; garbage doesn't", () => {
    expect(diversityFactor(sys({ diversityFactor: 0.85 }))).toBe(0.85);
    expect(diversityFactor(sys({ diversityFactor: 9, zones: [{ id: "z" }] }))).toBe(0.7);
  });
});

describe("ductedRequirement", () => {
  it("required = max(D × Σ, largest room), degrading nothing when loads derive", () => {
    const { doc, system, rooms } = docWithRooms();
    const loads = rooms.map((r) => roomLoadKw(doc, r)!);
    const req = ductedRequirement(doc, system);
    expect(req.roomCount).toBe(2);
    expect(req.unknownRooms).toBe(0);
    expect(req.diversity).toBe(1.0); // unzoned
    expect(req.totalKw).toBeCloseTo(loads[0] + loads[1], 6);
    expect(req.largestKw).toBeCloseTo(Math.max(...loads), 6);
    expect(req.requiredKw).toBeCloseTo(
      Math.max(1.0 * (loads[0] + loads[1]), Math.max(...loads)),
      6
    );
  });

  it("zoning drops D to 0.70 but the largest-room floor still holds", () => {
    const { doc, system, rooms } = docWithRooms();
    system.settings.zones = [{ id: "z1", name: "Day", roomIds: [rooms[0].id] }];
    const loads = rooms.map((r) => roomLoadKw(doc, r)!);
    const req = ductedRequirement(doc, system);
    expect(req.diversity).toBe(0.7);
    expect(req.requiredKw).toBeCloseTo(
      Math.max(0.7 * (loads[0] + loads[1]), Math.max(...loads)),
      6
    );
  });

  it("uncalibrated floor → nulls + unknown count, never a guess", () => {
    const { doc, system } = docWithRooms();
    doc.floors[0].scaleMmPerUnit = null;
    const req = ductedRequirement(doc, system);
    expect(req.requiredKw).toBeNull();
    expect(req.totalKw).toBeNull();
    expect(req.unknownRooms).toBe(2);
  });

  it("no served rooms → nulls with zero counts", () => {
    const doc = createDesign({ name: "t", mode: "blank" });
    const system: DesignSystem = {
      id: "sys_x",
      type: "ducted",
      brand: "b",
      colour: "#000",
      name: "S",
      settings: {},
    };
    doc.systems.push(system);
    const req = ductedRequirement(doc, system);
    expect(req.requiredKw).toBeNull();
    expect(req.roomCount).toBe(0);
  });
});
