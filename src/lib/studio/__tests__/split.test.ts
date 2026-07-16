/* Stage-4 lock gate — golden scenario set A (design-studio-plan.md, Stage 4):
   single-floor split, two-floor split via riser, over-length warning, plus
   pair proposals, graph connectivity and full document→materials outputs.
   Scenarios run against the REAL shipped Mitsubishi pack, so these tests also
   lock the engine to the data: any later change that alters a scenario's
   output fails this suite. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  createDesign,
  type DesignDocument,
  type DesignObject,
} from "../document";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { proposePairs, validateSplitSystem, systemBadge } from "../split";
import { buildSystemGraph, findPath } from "../graph";
import { buildMaterials, evaluateAdditionalCharge } from "../materials";

/* ── the shipped pack, straight off disk ── */
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

/* ── golden document builders (fixed ids — snapshots must be stable) ── */

const rect = (x: number, y: number, w: number, h: number) => ({
  kind: "polygon" as const,
  points: [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ],
});

const unit = (
  id: string,
  floorId: string,
  role: "idu" | "odu",
  model: string,
  x: number,
  y: number
): DesignObject => ({
  id,
  type: "unit",
  systemId: "sys_split",
  floorId,
  geometry: { kind: "point", at: { x, y } },
  plane: role === "idu" ? "room" : "external-ground",
  props: { role, model },
});

const run = (
  id: string,
  floorId: string,
  points: { x: number; y: number }[],
  startAttach: { kind: "unit" | "riser"; id: string } | null,
  endAttach: { kind: "unit" | "riser"; id: string } | null
): DesignObject => ({
  id,
  type: "pipe-run",
  systemId: "sys_split",
  floorId,
  geometry: { kind: "polyline", points },
  plane: "room",
  props: {
    ...(startAttach ? { startAttach } : {}),
    ...(endAttach ? { endAttach } : {}),
  },
});

const riser = (
  id: string,
  floorId: string,
  group: string,
  heightM: number,
  x: number,
  y: number
): DesignObject => ({
  id,
  type: "riser",
  systemId: "sys_split",
  floorId,
  geometry: { kind: "point", at: { x, y } },
  plane: "room",
  props: { group, heightM },
});

/** Base doc: one calibrated floor (10 mm/unit → 100 units = 1 m), a split
    system, a 5×4 m room. */
function baseDoc(): DesignDocument {
  const d = createDesign({ name: "Golden A", mode: "blank", now: "2026-07-07T00:00:00.000Z" });
  d.id = "dsn_golden_a";
  d.floors = [
    { id: "flr_g", name: "Ground floor", level: 0, scaleMmPerUnit: 10, northDeg: null, northPos: null, simplePlan: null, plans: [] },
  ];
  d.systems = [
    { id: "sys_split", type: "split", brand: "mitsubishi-electric", colour: "#2E68FF", name: "Lounge split", settings: {} },
  ];
  d.packPins = { "mitsubishi-electric": "2026.1" };
  d.objects = [
    { id: "obj_room", type: "room", systemId: null, floorId: "flr_g", geometry: rect(0, 0, 500, 400), plane: "room", props: { name: "Lounge" } },
  ];
  return d;
}

/* ═══════════════ A1 — single-floor split, all green ═══════════════ */

function scenarioA1(): DesignDocument {
  const d = baseDoc();
  d.objects.push(
    unit("obj_idu", "flr_g", "idu", "PLA-M100EA2-A", 100, 100),
    unit("obj_odu", "flr_g", "odu", "PUZ-M100VKA-A", 3100, 100),
    run(
      "obj_run",
      "flr_g",
      [{ x: 100, y: 100 }, { x: 3100, y: 100 }],
      { kind: "unit", id: "obj_idu" },
      { kind: "unit", id: "obj_odu" }
    )
  );
  return d;
}

describe("A1 — single-floor split", () => {
  const doc = scenarioA1();

  it("graph connects IDU→ODU at 30 m, no lift", () => {
    const g = buildSystemGraph(doc.objects, doc.floors, "sys_split");
    const path = findPath(g, "obj_idu", "obj_odu");
    expect(path).not.toBeNull();
    expect(path!.lengthM).toBeCloseTo(30, 5);
    expect(path!.liftM).toBe(0);
    expect(g.orphanRuns).toEqual([]);
  });

  it("validates green (approved pair, within 55 m / 30 m limits)", () => {
    const v = validateSplitSystem(doc, pack, "sys_split");
    expect(v.findings).toEqual([]);
    expect(v.status).toBe("green");
    expect(v.pair!.odu_model).toBe("PUZ-M100VKA-A");
    expect(v.lengthM).toBeCloseTo(30, 5);
  });

  it("materials: full document→schedule golden output", () => {
    expect(buildMaterials(doc, pack)).toEqual({
      systems: [
        {
          systemId: "sys_split",
          name: "Lounge split",
          type: "split",
          brand: "mitsubishi-electric",
          colour: "#2E68FF",
          units: [
            { model: "PLA-M100EA2-A", qty: 1, description: "cassette-4way indoor unit · 10/11.2 kW" },
            { model: "PUZ-M100VKA-A", qty: 1, description: "outdoor unit · 10/11.2 kW" },
          ],
          pipe: [{ liquid_mm: 9.52, gas_mm: 15.88, lengthM: 30 }],
          charge: { grams: 0, note: "No additional refrigerant required at this run length" },
          notes: [],
        },
      ],
    });
  });
});

/* ═══════════ A2 — two-floor split via riser (vertical counted) ═══════════ */

function scenarioA2(): DesignDocument {
  const d = baseDoc();
  d.floors.push({ id: "flr_1", name: "Level 1", level: 1, scaleMmPerUnit: 10, northDeg: null, northPos: null, simplePlan: null, plans: [] });
  d.objects.push(
    unit("obj_odu", "flr_g", "odu", "PUZ-M100VKA-A", 100, 100),
    riser("obj_riser_g", "flr_g", "A", 3, 1100, 100),
    run("obj_run_g", "flr_g", [{ x: 100, y: 100 }, { x: 1100, y: 100 }], { kind: "unit", id: "obj_odu" }, { kind: "riser", id: "obj_riser_g" }),
    riser("obj_riser_1", "flr_1", "A", 3, 1100, 100),
    unit("obj_idu", "flr_1", "idu", "PLA-M100EA2-A", 2100, 100),
    run("obj_run_1", "flr_1", [{ x: 1100, y: 100 }, { x: 2100, y: 100 }], { kind: "riser", id: "obj_riser_1" }, { kind: "unit", id: "obj_idu" })
  );
  return d;
}

describe("A2 — two-floor split via riser", () => {
  const doc = scenarioA2();

  it("path crosses the riser: 10 + 3 + 10 = 23 m, lift 3 m", () => {
    const g = buildSystemGraph(doc.objects, doc.floors, "sys_split");
    const path = findPath(g, "obj_idu", "obj_odu");
    expect(path!.lengthM).toBeCloseTo(23, 5);
    expect(path!.liftM).toBeCloseTo(3, 5);
  });

  it("validates green and materials count the vertical", () => {
    const v = validateSplitSystem(doc, pack, "sys_split");
    expect(v.status).toBe("green");
    const m = buildMaterials(doc, pack);
    expect(m.systems[0].pipe).toEqual([{ liquid_mm: 9.52, gas_mm: 15.88, lengthM: 23 }]);
    expect(m.systems[0].charge).toEqual({ grams: 0, note: "No additional refrigerant required at this run length" });
  });
});

/* ═══════════════ A3 — over-length red + charged run ═══════════════ */

describe("A3 — over-length warning", () => {
  const doc = baseDoc();
  doc.objects.push(
    unit("obj_idu", "flr_g", "idu", "PLA-M100EA2-A", 100, 100),
    unit("obj_odu", "flr_g", "odu", "PUZ-M100VKA-A", 5700, 100),
    run("obj_run", "flr_g", [{ x: 100, y: 100 }, { x: 5700, y: 100 }], { kind: "unit", id: "obj_idu" }, { kind: "unit", id: "obj_odu" })
  );

  it("56 m run on a 55 m pair → red over-length", () => {
    const v = validateSplitSystem(doc, pack, "sys_split");
    expect(v.status).toBe("red");
    expect(v.findings.map((f) => f.code)).toEqual(["over-length"]);
    expect(v.lengthM).toBeCloseTo(56, 5);
  });

  it("charge kicks in beyond the 30 m free length: (56−30)×40 g", () => {
    const m = buildMaterials(doc, pack);
    expect(m.systems[0].charge).toEqual({
      grams: 1040,
      note: "Additional refrigerant beyond the pre-charge",
    });
  });
});

/* ═══════════════ A4 — not connected / orphan runs ═══════════════ */

describe("A4 — connectivity is graph-checked, not assumed", () => {
  it("units with no run at all → red not-connected", () => {
    const doc = baseDoc();
    doc.objects.push(
      unit("obj_idu", "flr_g", "idu", "PLA-M100EA2-A", 100, 100),
      unit("obj_odu", "flr_g", "odu", "PUZ-M100VKA-A", 3100, 100)
    );
    const v = validateSplitSystem(doc, pack, "sys_split");
    expect(v.status).toBe("red");
    expect(v.findings.map((f) => f.code)).toEqual(["not-connected"]);
  });

  it("a drawn run that never attached → red not-connected + amber orphan", () => {
    const doc = baseDoc();
    doc.objects.push(
      unit("obj_idu", "flr_g", "idu", "PLA-M100EA2-A", 100, 100),
      unit("obj_odu", "flr_g", "odu", "PUZ-M100VKA-A", 3100, 100),
      run("obj_run", "flr_g", [{ x: 200, y: 300 }, { x: 900, y: 300 }], null, null)
    );
    const v = validateSplitSystem(doc, pack, "sys_split");
    expect(v.status).toBe("red");
    expect(v.findings.map((f) => f.code).sort()).toEqual(["not-connected", "orphan-run"]);
  });

  it("unapproved pairing → red pair-not-approved", () => {
    const doc = baseDoc();
    doc.objects.push(
      unit("obj_idu", "flr_g", "idu", "PLA-M100EA2-A", 100, 100),
      // real ODU, but never paired with a PLA-M100 in the book
      unit("obj_odu", "flr_g", "odu", "SUZ-M50VAD-A", 3100, 100),
      run("obj_run", "flr_g", [{ x: 100, y: 100 }, { x: 3100, y: 100 }], { kind: "unit", id: "obj_idu" }, { kind: "unit", id: "obj_odu" })
    );
    const v = validateSplitSystem(doc, pack, "sys_split");
    expect(v.findings.map((f) => f.code)).toContain("pair-not-approved");
    expect(v.status).toBe("red");
  });
});

/* ═══════════════ A5 — empties stay empty ═══════════════ */

describe("A5 — empty design = empty schedule", () => {
  it("no systems → empty schedule; system with no objects → empty badge", () => {
    const d = createDesign({ name: "Empty", mode: "blank", now: "2026-07-07T00:00:00.000Z" });
    expect(buildMaterials(d, pack)).toEqual({ systems: [] });

    const withSys = baseDoc(); // system exists, only a room drawn
    expect(systemBadge(withSys, pack, withSys.systems[0]).status).toBe("empty");
  });

  it("uncalibrated floor → amber, lengths unknown, materials carry a note", () => {
    const doc = baseDoc();
    doc.floors[0].scaleMmPerUnit = null;
    doc.objects.push(
      unit("obj_idu", "flr_g", "idu", "PLA-M100EA2-A", 100, 100),
      unit("obj_odu", "flr_g", "odu", "PUZ-M100VKA-A", 3100, 100),
      run("obj_run", "flr_g", [{ x: 100, y: 100 }, { x: 3100, y: 100 }], { kind: "unit", id: "obj_idu" }, { kind: "unit", id: "obj_odu" })
    );
    const v = validateSplitSystem(doc, pack, "sys_split");
    expect(v.status).toBe("amber");
    expect(v.findings.map((f) => f.code)).toEqual(["uncalibrated"]);
    const m = buildMaterials(doc, pack);
    expect(m.systems[0].pipe).toEqual([]);
    expect(m.systems[0].notes).toEqual([
      "Pipe lengths unknown — calibrate the floor to quantify the run",
    ]);
  });
});

/* ═══════════════ pair proposals ═══════════════ */

describe("proposePairs — the engine offers matched pairs sized ≥ load", () => {
  it("9.5 kW cassette load → PLA-M100 pairs cover, smallest first, recommended", () => {
    const props = proposePairs(pack, 9.5, "cooling", { formFactor: "cassette-4way" });
    expect(props.length).toBeGreaterThan(0);
    expect(props[0].idu.model).toBe("PLA-M100EA2-A");
    expect(props[0].capacityKw).toBe(10);
    expect(props[0].recommended).toBe(true);
    expect(props.filter((p) => p.recommended)).toHaveLength(1);
    // ascending capacity, and every proposal covers the load
    for (let i = 1; i < props.length; i++)
      expect(props[i].capacityKw).toBeGreaterThanOrEqual(props[i - 1].capacityKw);
    expect(props.every((p) => p.capacityKw >= 9.5)).toBe(true);
  });

  it("worst-of-both sizes on the smaller rating", () => {
    // wall 4.0 kW load: MSZ-AP42 pair (4.2 cool / 5.4 heat) covers on worst-of-both
    const props = proposePairs(pack, 4.0, "worst-of-both", { formFactor: "wall" });
    expect(props[0].capacityKw).toBeGreaterThanOrEqual(4.0);
    expect(props[0].capacityKw).toBe(
      Math.min(props[0].coolKw, props[0].heatKw)
    );
  });

  it("no load → full catalogue, nothing recommended", () => {
    const props = proposePairs(pack, null, "cooling");
    expect(props.length).toBe(pack.pair_tables.length);
    expect(props.some((p) => p.recommended)).toBe(false);
  });
});

/* ═══════════════ charge evaluator unit tests ═══════════════ */

describe("evaluateAdditionalCharge", () => {
  it("threshold_then_rate: free length then g/m", () => {
    const rule = { method: "threshold_then_rate" as const, free_up_to_m: 30, g_per_m_beyond: 40 };
    expect(evaluateAdditionalCharge(rule, { liquidLengthM: 25 })).toBe(0);
    expect(evaluateAdditionalCharge(rule, { liquidLengthM: 56 })).toBe(1040);
  });
  it("per_meter_by_liquid_size uses the size's rate", () => {
    const rule = {
      method: "per_meter_by_liquid_size" as const,
      rates: { "9.52": 60 },
      precharged_allowance_m: 0,
    };
    expect(evaluateAdditionalCharge(rule, { liquidLengthM: 10, liquidSizeMm: 9.52 })).toBe(600);
    expect(evaluateAdditionalCharge(rule, { liquidLengthM: 10, liquidSizeMm: 6.35 })).toBeNull();
  });
  it("none_required is 0", () => {
    expect(evaluateAdditionalCharge({ method: "none_required" }, { liquidLengthM: 99 })).toBe(0);
  });
});
