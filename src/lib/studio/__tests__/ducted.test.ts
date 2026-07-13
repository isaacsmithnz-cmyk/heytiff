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
  isSpillRoom,
  formatDia,
  plenumBody,
  spigotsOf,
  type PlenumSpigot,
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

  it("spill rooms are excluded from the sums — they just receive air", () => {
    const { doc, system, rooms } = docWithRooms();
    rooms[1].props.spill = true; // the small room becomes the spill target
    const bigLoad = roomLoadKw(doc, rooms[0])!;
    const req = ductedRequirement(doc, system);
    expect(isSpillRoom(rooms[1])).toBe(true);
    expect(req.spillRooms).toBe(1);
    expect(req.roomCount).toBe(1); // sized rooms only
    expect(req.totalKw).toBeCloseTo(bigLoad, 6);
    expect(req.requiredKw).toBeCloseTo(bigLoad, 6); // D=1.0, one room
  });

  it("a system of only spill rooms requires nothing", () => {
    const { doc, system, rooms } = docWithRooms();
    for (const r of rooms) r.props.spill = true;
    const req = ductedRequirement(doc, system);
    expect(req.requiredKw).toBeNull();
    expect(req.roomCount).toBe(0);
    expect(req.spillRooms).toBe(2);
    expect(req.unknownRooms).toBe(0);
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

/* ── size series + plenum body ── */

describe("formatDia", () => {
  it("mm vs inch labels, off-series falls back to Ø-mm", () => {
    expect(formatDia(250, "mm")).toBe("Ø250");
    expect(formatDia(350, "inch")).toBe('14"');
    expect(formatDia(275, "inch")).toBe("Ø275");
  });
});

describe("plenumBody", () => {
  const spig = (diaMm: number, face: PlenumSpigot["face"] = "front"): PlenumSpigot => ({
    id: newId("sp"),
    diaMm,
    t: 0.5,
    face,
  });
  const spec = { w_mm: 1200, h_mm: 250, d_mm: 450 };

  it("stays flat while the front spigots fit (2×14\" on a 1200 face)", () => {
    const b = plenumBody({ spec, spigots: [spig(350), spig(350)], units: "inch" });
    // 2×350 + 3×50 gap = 850 ≤ 1200
    expect(b.faceted).toBe(false);
    expect(b.wMm).toBe(1200);
    expect(b.derived).toBe(false);
    expect(b.label).toBe('1200 × 450 · 2 × 14"');
  });

  it("a third 14\" refacets and grows the face — the user's exact scenario", () => {
    const b = plenumBody({ spec, spigots: [spig(350), spig(350), spig(350)], units: "inch" });
    // 3×350 + 4×50 = 1250 > 1200 → 3-face at the needed width
    expect(b.faceted).toBe(true);
    expect(b.wMm).toBe(1250);
    expect(b.label).toBe('1250 × 450 · 3 × 14" (3-face)');
  });

  it("side-face spigots never refacet the front", () => {
    const b = plenumBody({
      spec,
      spigots: [spig(350), spig(350), spig(350, "left"), spig(350, "right")],
      units: "mm",
    });
    expect(b.faceted).toBe(false);
    expect(b.label).toBe("1200 × 450 · 4 × Ø350");
  });

  it("mixed sizes label descending, per units setting", () => {
    const b = plenumBody({ spec, spigots: [spig(250), spig(350), spig(250)], units: "mm" });
    expect(b.label).toBe("1200 × 450 · 1 × Ø350 · 2 × Ø250");
  });

  it("no pack spec → grey derived default (unit width × 350 deep)", () => {
    const b = plenumBody({ spec: null, unitWidthMm: 1400, spigots: [], units: "mm" });
    expect(b.derived).toBe(true);
    expect(b.wMm).toBe(1400);
    expect(b.dMm).toBe(350);
    expect(b.hMm).toBeNull();
  });

  it("built-in short-circuits", () => {
    const b = plenumBody({ spec: "built-in", unitWidthMm: 900, spigots: [], units: "mm" });
    expect(b.builtIn).toBe(true);
    expect(b.derived).toBe(false);
  });
});

describe("spigotsOf", () => {
  it("reads tolerant, defaults face/t, skips malformed entries", () => {
    const list = spigotsOf({
      spigots: [
        { id: "a", diaMm: 350 },
        { id: "b", diaMm: 250, t: 0.2, face: "left", capped: true },
        { diaMm: 999 }, // no id → skipped
        "junk",
      ],
    });
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: "a", face: "front", t: 0.5 });
    expect(list[1]).toMatchObject({ id: "b", face: "left", capped: true });
  });
  it("returns [] when absent", () => {
    expect(spigotsOf({})).toEqual([]);
  });
});
