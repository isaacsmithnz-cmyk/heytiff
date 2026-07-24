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
  distributeSpigots,
  ductedRequirement,
  isPlenumOf,
  isSpillRoom,
  formatDia,
  plenumBody,
  spigotsOf,
  suggestedMainDucts,
  type PlenumSpigot,
} from "../ducted";
import {
  hasFactorySpigots,
  spigotDiametersMm,
  spigotLabel,
} from "../packs/schema";

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

describe("plenumBody — base ON the unit, tapering OUT (spec §1b)", () => {
  const spig = (diaMm: number, face: PlenumSpigot["face"] = "front"): PlenumSpigot => ({
    id: newId("sp"),
    diaMm,
    t: 0.5,
    face,
  });
  const opening = { w_mm: 1200, h_mm: 250 }; // data-book supply opening

  it("base = the opening width; spigot face stays ≤ base while ducts fit", () => {
    const b = plenumBody({ opening, spigots: [spig(350), spig(350)], units: "inch" });
    // 2×350 + 3×50 = 850 ≤ 1200 base → not over
    expect(b.baseWMm).toBe(1200);
    expect(b.spigotFaceWMm).toBe(850);
    expect(b.overSpigot).toBe(false);
    expect(b.depthMm).toBe(400);
    expect(b.derived).toBe(false);
    expect(b.label).toBe('1200 × 400 · 2 × 14"');
  });

  it("one spigot → a near-point arrow (small spigot face), base unchanged", () => {
    const b = plenumBody({ opening, spigots: [spig(350)], units: "inch" });
    expect(b.baseWMm).toBe(1200); // base never shrinks
    expect(b.spigotFaceWMm).toBe(350 + 100); // 1×350 + 2×50 gaps
    expect(b.overSpigot).toBe(false);
    expect(b.label).toBe('1200 × 400 · 1 × 14"');
  });

  it("too many ducts → overSpigot, base never grows past the unit", () => {
    // 4×350 + 5×50 = 1650 > 1200 base
    const b = plenumBody({ opening, spigots: [spig(350), spig(350), spig(350), spig(350)], units: "inch" });
    expect(b.overSpigot).toBe(true);
    expect(b.baseWMm).toBe(1200); // stays the opening width, does NOT grow
    expect(b.spigotFaceWMm).toBe(1200); // clamped to base for rendering
    expect(b.label).toBe('1200 × 400 · 4 × 14"'); // no "(3-face)" — that model is gone
  });

  it("mixed sizes label descending, per units setting", () => {
    const b = plenumBody({ opening, spigots: [spig(250), spig(350), spig(250)], units: "mm" });
    expect(b.label).toBe("1200 × 400 · 1 × Ø350 · 2 × Ø250");
  });

  /* Field feedback 2026-07-23: a RETURN plenum is a box bolted to the back of
     the unit — a return-air/filter box, not a transition to round ducts — so
     it must not taper. Only the supply side has spigots to narrow toward. */
  it("a RETURN plenum is a plain box — far face = base, so it draws square", () => {
    const ret = { w_mm: 660, h_mm: 157.5 }; // SEZ-M25DA(L) return opening
    const b = plenumBody({ opening: ret, spigots: [], units: "mm", stream: "return" });
    expect(b.rectangular).toBe(true);
    expect(b.baseWMm).toBe(660);
    expect(b.spigotFaceWMm).toBe(660); // equal ⇒ rectangle, not a wedge
    expect(b.depthMm).toBe(400);
    expect(b.label).toBe("660 × 400");
  });

  it("a return box stays square even with a spigot on it", () => {
    const ret = { w_mm: 660, h_mm: 157.5 };
    const b = plenumBody({
      opening: ret,
      spigots: [spig(350)],
      units: "mm",
      stream: "return",
    });
    expect(b.spigotFaceWMm).toBe(660); // NOT narrowed to 350 + gaps
    expect(b.rectangular).toBe(true);
  });

  it("SUPPLY still tapers — the same width narrows toward its spigot", () => {
    const sup = { w_mm: 660, h_mm: 150 };
    const b = plenumBody({
      opening: sup,
      spigots: [spig(350)],
      units: "mm",
      stream: "supply",
    });
    expect(b.rectangular).toBe(false);
    expect(b.spigotFaceWMm).toBe(450); // 350 + 2×50 gaps
    expect(b.spigotFaceWMm).toBeLessThan(b.baseWMm);
  });

  it("an omitted stream keeps the tapering shape — no silent square-off", () => {
    const b = plenumBody({ opening, spigots: [spig(350)], units: "mm" });
    expect(b.rectangular).toBe(false);
    expect(b.spigotFaceWMm).toBeLessThan(b.baseWMm);
  });

  it("no opening data → grey derived default (~90% of the discharge END, NOT the unit width)", () => {
    // caller passes the unit's SHORT-end width (the discharge face), e.g. 800
    const b = plenumBody({ opening: null, unitWidthMm: 800, spigots: [], units: "mm" });
    expect(b.derived).toBe(true);
    expect(b.baseWMm).toBe(720); // 800 × 0.9 — a plausible opening, not a long unit width
  });

  it("'open' takes the derived default — a positive answer with no size in it", () => {
    // the face is ductable but the book publishes no opening, so the plenum
    // falls back to the same grey default as absent data (installer sizes it)
    const b = plenumBody({ opening: "open", unitWidthMm: 800, spigots: [], units: "mm" });
    expect(b.derived).toBe(true);
    expect(b.baseWMm).toBe(720);
    expect(b.builtIn).toBe(false);
    expect(b.factorySpigots).toBe(false);
  });

  it("built-in return short-circuits", () => {
    const b = plenumBody({ opening: "built-in", unitWidthMm: 900, spigots: [], units: "mm" });
    expect(b.builtIn).toBe(true);
    expect(b.factorySpigots).toBe(false);
    expect(b.derived).toBe(false);
  });

  it("factory spigots flagged (no drawn plenum body)", () => {
    const b = plenumBody({ opening: "spigots", unitWidthMm: 900, spigots: [], units: "mm" });
    expect(b.factorySpigots).toBe(true);
    expect(b.builtIn).toBe(false);
    expect(b.derived).toBe(false);
  });

  it("SIZED factory spigots flag the same way — 2 × Ø400 still means no plenum", () => {
    const b = plenumBody({
      opening: { spigots: [{ count: 2, dia_mm: 400 }] },
      unitWidthMm: 900,
      spigots: [],
      units: "mm",
    });
    expect(b.factorySpigots).toBe(true);
    expect(b.builtIn).toBe(false);
    // a sized spigot face is a positive, published answer — never "derived"
    expect(b.derived).toBe(false);
  });

  it("a sized-spigot opening is NOT mistaken for a W×H box", () => {
    // it's an object like a box is, but carries no w_mm — the base must fall
    // back to the derived width rather than reading undefined
    const b = plenumBody({
      opening: { spigots: [{ count: 2, dia_mm: 400 }] },
      unitWidthMm: 800,
      spigots: [],
      units: "mm",
    });
    expect(b.baseWMm).toBe(720); // 800 × 0.9, not NaN
  });
});

describe("factory-spigot openings (pack schema helpers)", () => {
  it("both grades read as factory spigots; other openings do not", () => {
    expect(hasFactorySpigots("spigots")).toBe(true);
    expect(hasFactorySpigots({ spigots: [{ count: 2, dia_mm: 400 }] })).toBe(true);
    expect(hasFactorySpigots("built-in")).toBe(false);
    expect(hasFactorySpigots("open")).toBe(false);
    expect(hasFactorySpigots({ w_mm: 900, h_mm: 250 })).toBe(false);
    expect(hasFactorySpigots(undefined)).toBe(false);
  });

  it("flattens groups to one entry per physical takeoff", () => {
    expect(spigotDiametersMm({ spigots: [{ count: 2, dia_mm: 400 }] })).toEqual([400, 400]);
    expect(
      spigotDiametersMm({ spigots: [{ count: 2, dia_mm: 400 }, { count: 1, dia_mm: 300 }] })
    ).toEqual([400, 400, 300]);
    // the unsized answer has no diameters to draw — the canvas derives a fan
    expect(spigotDiametersMm("spigots")).toEqual([]);
  });

  it("labels the face the way the book states it", () => {
    expect(spigotLabel({ spigots: [{ count: 2, dia_mm: 400 }] })).toBe("2 × Ø400");
    expect(
      spigotLabel({ spigots: [{ count: 2, dia_mm: 400 }, { count: 1, dia_mm: 300 }] })
    ).toBe("2 × Ø400 · 1 × Ø300");
    expect(spigotLabel("spigots")).toBe(""); // nothing published to show
  });
});

describe("suggestedMainDucts (spec §6b-iii)", () => {
  it("~1000 l/s ≈ 3 × Ø350 (289 l/s) or 2 × Ø400 (377 l/s)", () => {
    expect(suggestedMainDucts(1000, 289)).toBe(4); // ceil(1000/289)=4 at 14"
    expect(suggestedMainDucts(1000, 377)).toBe(3); // ceil(1000/377)=3 at 16"
    expect(suggestedMainDucts(null, 289)).toBeNull();
  });
});

describe("distributeSpigots", () => {
  const spig = (id: string, t: number, face: PlenumSpigot["face"] = "front"): PlenumSpigot => ({
    id,
    diaMm: 350,
    t,
    face,
  });

  it("packs a face evenly at t = (i+1)/(n+1), preserving left-to-right order", () => {
    const out = distributeSpigots([spig("a", 1 / 3), spig("b", 2 / 3), spig("new", 0.5)]);
    const byId = new Map(out.map((s) => [s.id, s.t]));
    // order by current t: a (.33) · new (.5) · b (.67) → 0.25 / 0.5 / 0.75
    expect(byId.get("a")).toBeCloseTo(0.25, 6);
    expect(byId.get("new")).toBeCloseTo(0.5, 6);
    expect(byId.get("b")).toBeCloseTo(0.75, 6);
  });

  it("each face packs independently (side spigots never shift the front)", () => {
    const out = distributeSpigots([
      spig("f1", 0.4),
      spig("f2", 0.9),
      spig("l1", 0.7, "left"),
    ]);
    const byId = new Map(out.map((s) => [s.id, s.t]));
    expect(byId.get("f1")).toBeCloseTo(1 / 3, 6);
    expect(byId.get("f2")).toBeCloseTo(2 / 3, 6);
    expect(byId.get("l1")).toBeCloseTo(0.5, 6); // alone on its face → centred
  });

  it("a delete re-packs the survivors", () => {
    const three = distributeSpigots([spig("a", 0.25), spig("b", 0.5), spig("c", 0.75)]);
    const two = distributeSpigots(three.filter((s) => s.id !== "b"));
    const byId = new Map(two.map((s) => [s.id, s.t]));
    expect(byId.get("a")).toBeCloseTo(1 / 3, 6);
    expect(byId.get("c")).toBeCloseTo(2 / 3, 6);
  });
});

describe("isPlenumOf", () => {
  it("matches only plenums anchored to the given unit", () => {
    const pl = { type: "plenum", props: { unitId: "u1" } };
    expect(isPlenumOf(pl, "u1")).toBe(true);
    expect(isPlenumOf(pl, "u2")).toBe(false);
    expect(isPlenumOf({ type: "grille", props: { unitId: "u1" } }, "u1")).toBe(false);
    expect(isPlenumOf({ type: "plenum", props: {} }, "u1")).toBe(false);
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
