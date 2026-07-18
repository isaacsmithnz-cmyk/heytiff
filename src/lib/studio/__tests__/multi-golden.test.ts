/* Stage-5 lock gate — golden scenario set B (design-studio-plan.md, Stage 5):
   multi-split geometry validation against the REAL shipped Mitsubishi pack.
   One shared MXZ outdoor, a branch per indoor: per-branch / total / lift
   limits from multi_rules, per-port pipe sizes, charge rule.
   Set A (split.test.ts) must stay green alongside this suite.

   The schedule half of this gate was dropped when the branch was rebased on
   2026-08-21: it asserted on buildMaterials(), and #421 retired that engine
   in favour of buildSummaryModel() — which already knows multi-split (it was
   written because "the materials schedule under-counted a multi"). Nothing
   here re-asserts the schedule; see summary.ts's own suites for that. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  createDesign,
  type DesignDocument,
  type DesignObject,
} from "../document";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { validateMultiSystem } from "../multi";
import { systemBadge } from "../split";

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

const room = (id: string, name: string, x: number): DesignObject => ({
  id,
  type: "room",
  systemId: "sys_multi", // multi rooms belong to the system (design-flow spec)
  floorId: "flr_g",
  geometry: rect(x, 0, 400, 300),
  plane: "room",
  props: { name },
});

const unit = (
  id: string,
  floorId: string,
  role: "idu" | "odu",
  model: string,
  x: number,
  y: number,
  roomId?: string
): DesignObject => ({
  id,
  type: "unit",
  systemId: "sys_multi",
  floorId,
  geometry: { kind: "point", at: { x, y } },
  plane: role === "idu" ? "room" : "external-ground",
  props: { role, model, ...(roomId ? { roomId } : {}) },
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
  systemId: "sys_multi",
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
  systemId: "sys_multi",
  floorId,
  geometry: { kind: "point", at: { x, y } },
  plane: "room",
  props: { group, heightM },
});

/** a straight branch run of `lengthUnits` at row `y`, attached IDU→ODU */
const branchRun = (n: number, iduId: string, lengthUnits: number): DesignObject =>
  run(
    `obj_run${n}`,
    "flr_g",
    [{ x: 0, y: n * 100 }, { x: lengthUnits, y: n * 100 }],
    { kind: "unit", id: iduId },
    { kind: "unit", id: "obj_odu" }
  );

/** Base doc: one calibrated floor (10 mm/unit → 100 units = 1 m), a
    multi-split system, three named rooms owned by it. */
function baseDoc(): DesignDocument {
  const d = createDesign({ name: "Golden B", mode: "blank", now: "2026-07-18T00:00:00.000Z" });
  d.id = "dsn_golden_b";
  d.floors = [
    { id: "flr_g", name: "Ground floor", level: 0, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [] },
  ];
  d.systems = [
    { id: "sys_multi", type: "multi-split", brand: "mitsubishi-electric", colour: "#2E68FF", name: "Beds multi", settings: {} },
  ];
  d.packPins = { "mitsubishi-electric": "2026.1" };
  d.objects = [room("room1", "Bed 1", 0), room("room2", "Bed 2", 500), room("room3", "Bed 3", 1000)];
  return d;
}

/* ═══════ B1 — three rooms on an MXZ-3F54VGD, all green, full takeoff ═══════ */

function scenarioB1(): DesignDocument {
  const d = baseDoc();
  d.objects.push(
    unit("obj_idu1", "flr_g", "idu", "MSZ-AP20VGD", 100, 100, "room1"),
    unit("obj_idu2", "flr_g", "idu", "MSZ-AP20VGD", 600, 100, "room2"),
    unit("obj_idu3", "flr_g", "idu", "MSZ-AP20VGD", 1100, 100, "room3"),
    unit("obj_odu", "flr_g", "odu", "MXZ-3F54VGD", 2000, 500),
    branchRun(1, "obj_idu1", 1000), // 10 m
    branchRun(2, "obj_idu2", 1200), // 12 m
    branchRun(3, "obj_idu3", 1400) //  14 m
  );
  return d;
}

describe("B1 — three-room MXZ-3F54VGD, green", () => {
  const doc = scenarioB1();

  it("validates green: every branch connected within 25 m, total 36 of 50 m", () => {
    const v = validateMultiSystem(doc, pack, "sys_multi");
    expect(v.findings).toEqual([]);
    expect(v.status).toBe("green");
    expect(v.oduModel).toBe("MXZ-3F54VGD");
    expect(v.rule!.max_total_pipe_m).toBe(50);
    expect(v.totalLengthM).toBeCloseTo(36, 5);
    // equal capacities → ports follow model then object id (deterministic)
    expect(v.branches.map((b) => [b.iduId, b.port, b.liquidMm, b.gasMm])).toEqual([
      ["obj_idu1", 0, 6.35, 9.52],
      ["obj_idu2", 1, 6.35, 9.52],
      ["obj_idu3", 2, 6.35, 9.52],
    ]);
    expect(v.branches.map((b) => b.roomName)).toEqual(["Bed 1", "Bed 2", "Bed 3"]);
  });

  it("systemBadge dispatches multi-split (the JobView seam)", () => {
    expect(systemBadge(doc, pack, doc.systems[0]).status).toBe("green");
  });

});

/* ═══════ B2 — port allocation: the big unit takes port 1's 12.7 gas ═══════ */

function scenarioB2(): DesignDocument {
  const d = baseDoc();
  d.objects.push(
    unit("obj_idu1", "flr_g", "idu", "MSZ-AP20VGD", 100, 100, "room1"),
    unit("obj_idu2", "flr_g", "idu", "MSZ-AP25VGD2", 600, 100, "room2"),
    unit("obj_idu3", "flr_g", "idu", "MSZ-AP50VGD2", 1100, 100, "room3"),
    unit("obj_odu", "flr_g", "odu", "MXZ-4F71VGD", 2000, 500),
    branchRun(1, "obj_idu1", 600), //  6 m
    branchRun(2, "obj_idu2", 800), //  8 m
    branchRun(3, "obj_idu3", 1200) // 12 m — the 5.0 kW unit
  );
  return d;
}

describe("B2 — port allocation by capacity on an MXZ-4F71VGD", () => {
  const doc = scenarioB2();

  it("largest indoor gets port 1 (ø12.7 gas), descending after", () => {
    const v = validateMultiSystem(doc, pack, "sys_multi");
    expect(v.status).toBe("green");
    expect(v.branches.map((b) => [b.model, b.port, b.gasMm])).toEqual([
      ["MSZ-AP50VGD2", 0, 12.7],
      ["MSZ-AP25VGD2", 1, 9.52],
      ["MSZ-AP20VGD", 2, 9.52],
    ]);
  });

});

/* ═══════════════ B3 — a branch beyond the per-branch limit ═══════════════ */

describe("B3 — over-length branch", () => {
  const doc = baseDoc();
  doc.objects.push(
    unit("obj_idu1", "flr_g", "idu", "MSZ-AP20VGD", 100, 100, "room1"),
    unit("obj_idu2", "flr_g", "idu", "MSZ-AP20VGD", 600, 100, "room2"),
    unit("obj_odu", "flr_g", "odu", "MXZ-3F54VGD", 2000, 500),
    branchRun(1, "obj_idu1", 2600), // 26 m — over the 25 m per-branch cap
    branchRun(2, "obj_idu2", 500) //   5 m
  );

  it("26 m on a 25 m-per-branch rule → red over-length, names the room", () => {
    const v = validateMultiSystem(doc, pack, "sys_multi");
    expect(v.status).toBe("red");
    expect(v.findings.map((f) => f.code)).toEqual(["over-length"]);
    expect(v.findings[0].message).toContain("Bed 1");
    expect(v.findings[0].message).toContain("26.0");
  });
});

/* ═══════════ B4 — total over the rule while every branch fits ═══════════ */

describe("B4 — over-total-length", () => {
  const doc = baseDoc();
  doc.objects.push(
    unit("obj_idu1", "flr_g", "idu", "MSZ-AP20VGD", 100, 100, "room1"),
    unit("obj_idu2", "flr_g", "idu", "MSZ-AP20VGD", 600, 100, "room2"),
    unit("obj_idu3", "flr_g", "idu", "MSZ-AP20VGD", 1100, 100, "room3"),
    unit("obj_odu", "flr_g", "odu", "MXZ-3F54VGD", 2000, 500),
    branchRun(1, "obj_idu1", 1700), // 17 m each — fine per branch,
    branchRun(2, "obj_idu2", 1700), // 51 m total on a 50 m rule
    branchRun(3, "obj_idu3", 1700)
  );

  it("3 × 17 m = 51 m > 50 m → exactly over-total-length", () => {
    const v = validateMultiSystem(doc, pack, "sys_multi");
    expect(v.status).toBe("red");
    expect(v.findings.map((f) => f.code)).toEqual(["over-total-length"]);
    expect(v.totalLengthM).toBeCloseTo(51, 5);
  });
});

/* ═══════════ B5 — lift beyond the rule via a cross-floor riser ═══════════ */

function scenarioB5(): DesignDocument {
  const d = baseDoc();
  d.floors.push({ id: "flr_1", name: "Level 1", level: 1, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [] });
  d.objects.push(
    unit("obj_odu", "flr_g", "odu", "MXZ-3F54VGD", 2000, 500),
    unit("obj_idu1", "flr_g", "idu", "MSZ-AP20VGD", 100, 100, "room1"),
    branchRun(1, "obj_idu1", 1000), // 10 m, flat
    riser("obj_riser_g", "flr_g", "A", 11, 1100, 100),
    run("obj_run_g", "flr_g", [{ x: 600, y: 100 }, { x: 1100, y: 100 }], { kind: "unit", id: "obj_odu" }, { kind: "riser", id: "obj_riser_g" }),
    riser("obj_riser_1", "flr_1", "A", 11, 1100, 100),
    unit("obj_idu2", "flr_1", "idu", "MSZ-AP20VGD", 1600, 100),
    run("obj_run_1", "flr_1", [{ x: 1100, y: 100 }, { x: 1600, y: 100 }], { kind: "riser", id: "obj_riser_1" }, { kind: "unit", id: "obj_idu2" })
  );
  return d;
}

describe("B5 — over-lift via riser", () => {
  const doc = scenarioB5();

  it("11 m rise on a 10 m-lift rule → red over-lift; vertical counts as length", () => {
    const v = validateMultiSystem(doc, pack, "sys_multi");
    expect(v.status).toBe("red");
    expect(v.findings.map((f) => f.code)).toEqual(["over-lift"]);
    const upstairs = v.branches.find((b) => b.iduId === "obj_idu2")!;
    expect(upstairs.liftM).toBeCloseTo(11, 5);
    expect(upstairs.lengthM).toBeCloseTo(5 + 11 + 5, 5); // 21 m — within 25
  });
});

/* ═══════════════ B6 — connectivity is graph-checked per branch ═══════════════ */

describe("B6 — connectivity", () => {
  it("units with no runs at all → a red not-connected per indoor", () => {
    const doc = baseDoc();
    doc.objects.push(
      unit("obj_idu1", "flr_g", "idu", "MSZ-AP20VGD", 100, 100, "room1"),
      unit("obj_idu2", "flr_g", "idu", "MSZ-AP20VGD", 600, 100, "room2"),
      unit("obj_odu", "flr_g", "odu", "MXZ-3F54VGD", 2000, 500)
    );
    const v = validateMultiSystem(doc, pack, "sys_multi");
    expect(v.status).toBe("red");
    expect(v.findings.map((f) => f.code)).toEqual(["not-connected", "not-connected"]);
    expect(v.findings[0].message).toBe(
      "Draw the refrigerant runs between each indoor and the outdoor unit"
    );
    expect(v.totalLengthM).toBeNull();
  });

  it("a drawn run that never attached → not-connected + amber orphan", () => {
    const doc = baseDoc();
    doc.objects.push(
      unit("obj_idu1", "flr_g", "idu", "MSZ-AP20VGD", 100, 100, "room1"),
      unit("obj_odu", "flr_g", "odu", "MXZ-3F54VGD", 2000, 500),
      run("obj_run", "flr_g", [{ x: 200, y: 300 }, { x: 900, y: 300 }], null, null)
    );
    const v = validateMultiSystem(doc, pack, "sys_multi");
    expect(v.status).toBe("red");
    expect(v.findings.map((f) => f.code).sort()).toEqual(["not-connected", "orphan-run"]);
  });

  it("two of three connected → the finding names the missing room", () => {
    const doc = scenarioB1();
    doc.objects = doc.objects.filter((o) => o.id !== "obj_run3"); // Bed 3 unplumbed
    const v = validateMultiSystem(doc, pack, "sys_multi");
    expect(v.status).toBe("red");
    const nc = v.findings.filter((f) => f.code === "not-connected");
    expect(nc).toHaveLength(1);
    expect(nc[0].message).toContain("Bed 3");
    expect(v.totalLengthM).toBeNull(); // an unconnected branch spoils the sum
  });
});

/* ═══════════════ B7 — degradations stay honest ═══════════════ */

describe("B7 — degradations", () => {
  it("rooms only, nothing placed → empty badge (rooms carry the system id)", () => {
    const doc = baseDoc();
    expect(systemBadge(doc, pack, doc.systems[0]).status).toBe("empty");
  });

  it("uncalibrated floor → one amber, and no total length to report", () => {
    const doc = scenarioB1();
    doc.floors[0].scaleMmPerUnit = null;
    const v = validateMultiSystem(doc, pack, "sys_multi");
    expect(v.status).toBe("amber");
    expect(v.findings.map((f) => f.code)).toEqual(["uncalibrated"]);
    expect(v.totalLengthM).toBeNull();
  });

  it("three indoors on a two-port outdoor → compat reds fold into the badge", () => {
    const doc = baseDoc();
    doc.objects.push(
      unit("obj_idu1", "flr_g", "idu", "MSZ-AP20VGD", 100, 100, "room1"),
      unit("obj_idu2", "flr_g", "idu", "MSZ-AP20VGD", 600, 100, "room2"),
      unit("obj_idu3", "flr_g", "idu", "MSZ-AP20VGD", 1100, 100, "room3"),
      unit("obj_odu", "flr_g", "odu", "MXZ-2F52VGD", 2000, 500),
      branchRun(1, "obj_idu1", 500),
      branchRun(2, "obj_idu2", 500),
      branchRun(3, "obj_idu3", 500)
    );
    const v = validateMultiSystem(doc, pack, "sys_multi");
    expect(v.status).toBe("red");
    const codes = v.findings.map((f) => f.code);
    expect(codes).toContain("over-max-count");
    expect(codes).toContain("over-ports");
  });

  it("a split outdoor placed as the multi outdoor → red no-rule, sizes unknown", () => {
    const doc = baseDoc();
    doc.objects.push(
      unit("obj_idu1", "flr_g", "idu", "MSZ-AP20VGD", 100, 100, "room1"),
      unit("obj_odu", "flr_g", "odu", "PUZ-M100VKA-A", 2000, 500),
      branchRun(1, "obj_idu1", 1000)
    );
    const v = validateMultiSystem(doc, pack, "sys_multi");
    expect(v.status).toBe("red");
    expect(v.findings.map((f) => f.code)).toContain("no-rule");
    expect(v.branches[0].port).toBeNull();
  });
});
