/* System Components rows (cockpit panel): derived ODU + refrigerant-charge
   rows from the real shipped pack, plus the electrical/mounting choice rows
   with default + persisted selection. Runs against the REAL ME pack. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  createDesign,
  type DesignDocument,
  type DesignObject,
  type DesignSystem,
} from "../document";
import { PACK_SECTIONS, emptyPack, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import {
  pairPipeSizes,
  systemComponents,
  componentChoices,
  defaultIsolatorId,
  COMPONENT_CHOICES,
  type IsolatorOption,
} from "../components";

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

/** a calibrated (10 mm/unit) doc with one system, a split unless told */
function docWith(
  settings: Record<string, unknown>,
  type: DesignSystem["type"] = "split"
): { doc: DesignDocument; system: DesignSystem } {
  const d = createDesign({ name: "Comp", mode: "blank", now: "2026-07-10T00:00:00.000Z" });
  d.floors = [
    { id: "flr", name: "Ground", level: 0, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [] },
  ];
  const system: DesignSystem = {
    id: "sys1",
    type,
    brand: "mitsubishi-electric",
    colour: "#2E68FF",
    name: "System 1",
    settings,
  };
  d.systems = [system];
  return { doc: d, system };
}

const unit = (id: string, role: "idu" | "odu", model: string): DesignObject => ({
  id,
  type: "unit",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "point", at: role === "idu" ? { x: 0, y: 0 } : { x: 100, y: 0 } },
  plane: role === "idu" ? "room" : "external-ground",
  props: { role, model },
});

describe("systemComponents — gating", () => {
  it("returns [] with no pack", () => {
    const { doc, system } = docWith({ pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A" });
    expect(systemComponents(doc, null, system, "cooling")).toEqual([]);
  });

  it("returns [] before a pair is resolved", () => {
    const { doc, system } = docWith({});
    expect(systemComponents(doc, pack, system, "cooling")).toEqual([]);
  });

  it("does not crash and returns [] against an empty pack", () => {
    const { doc, system } = docWith({ pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A" });
    expect(systemComponents(doc, emptyPack(pack.meta), system, "cooling")).toEqual([]);
  });
});

describe("systemComponents — derived rows (small split, no top-up)", () => {
  // SLZ-M25FA-A + SUZ-M25VAD-A: ODU phase 1 · R32 · precharge 0.65 kg (AU
  // brochure p.24); charge none_required
  const { doc, system } = docWith({ pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A" });
  const rows = systemComponents(doc, pack, system, "cooling");

  it("emits odu, charge, then the three choice rows in order", () => {
    expect(rows.map((r) => r.id)).toEqual(["odu", "charge", "electrical", "mounting", "insulation"]);
  });

  it("derives the outdoor-unit row from the pack", () => {
    const odu = rows.find((r) => r.id === "odu")!;
    expect(odu.kind).toBe("odu");
    expect(odu.name).toBe("SUZ-M25VAD-A");
    expect(odu.sub).toBe("1Ø, R32 condenser");
    expect(odu.value).toBe("2.5 kW"); // pair rated_cool_kw under the cooling basis
  });

  it("shows the factory pre-charge with no top-up when the pair needs none", () => {
    const charge = rows.find((r) => r.id === "charge")!;
    expect(charge.name).toBe("R32");
    expect(charge.sub).toBe("Pre-charged — no top-up");
    expect(charge.value).toBe("0.65 kg"); // factory pre-charge on this small ODU
  });
});

describe("systemComponents — charge with pre-charge + run length", () => {
  // PLA-M100EA2-A + PUZ-M100VKA-A: precharge 3.1 kg; threshold_then_rate (30 m free, 40 g/m)
  const IDU = "PLA-M100EA2-A";
  const ODU = "PUZ-M100VKA-A";

  it("totals pre-charge alone when there is no run drawn", () => {
    const { doc, system } = docWith({ pairIdu: IDU, pairOdu: ODU });
    const charge = systemComponents(doc, pack, system, "cooling").find((r) => r.id === "charge")!;
    expect(charge.value).toBe("3.10 kg");
    expect(charge.sub).toBe("Pre-charged — no top-up");
  });

  it("reports unknown run length when a run is drawn but the floor is uncalibrated", () => {
    const { doc, system } = docWith({ pairIdu: IDU, pairOdu: ODU });
    doc.floors[0].scaleMmPerUnit = null; // uncalibrated
    doc.objects = [
      unit("u_idu", "idu", IDU),
      unit("u_odu", "odu", ODU),
      {
        id: "run1",
        type: "pipe-run",
        systemId: "sys1",
        floorId: "flr",
        geometry: { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
        plane: "room",
        props: { startAttach: { kind: "unit", id: "u_idu" }, endAttach: { kind: "unit", id: "u_odu" } },
      },
    ];
    const charge = systemComponents(doc, pack, system, "cooling").find((r) => r.id === "charge")!;
    expect(charge.sub).toBe("Pre-charged, run length unknown");
    expect(charge.value).toBe("3.10 kg"); // pre-charge still known
  });

  it("adds the computed top-up beyond the free length into the total", () => {
    const { doc, system } = docWith({ pairIdu: IDU, pairOdu: ODU });
    // 10 mm/unit → metres = units/100; a 4000-unit run = 40 m → 10 m beyond 30 m free
    doc.objects = [
      unit("u_idu", "idu", IDU),
      unit("u_odu", "odu", ODU),
      {
        id: "run1",
        type: "pipe-run",
        systemId: "sys1",
        floorId: "flr",
        geometry: { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 4000, y: 0 }] },
        plane: "room",
        props: { startAttach: { kind: "unit", id: "u_idu" }, endAttach: { kind: "unit", id: "u_odu" } },
      },
    ];
    const charge = systemComponents(doc, pack, system, "cooling").find((r) => r.id === "charge")!;
    // 10 m × 40 g/m = 400 g = 0.40 kg top-up; + 3.1 kg pre-charge = 3.50 kg
    expect(charge.sub).toBe("Pre-charged + 0.40 kg top-up");
    expect(charge.value).toBe("3.50 kg");
  });
});

describe("component choice rows", () => {
  it("defaults electrical + mounting when nothing is stored", () => {
    // SUZ-M25VAD-A: 1Ø, 6.8 A max running current
    const { doc, system } = docWith({ pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A" });
    const rows = systemComponents(doc, pack, system, "cooling");
    const elec = rows.find((r) => r.id === "electrical")!;
    const mount = rows.find((r) => r.id === "mounting")!;
    expect(elec.kind).toBe("choice");
    expect(elec.choice!.selectedId).toBe("isolator-20a-1ph");
    expect(elec.name).toBe("Isolator, 1Ø 20 A");
    expect(mount.choice!.selectedId).toBe("wall-bracket");
    expect(mount.name).toBe("Wall bracket");
  });

  it("honours a persisted override on settings.components", () => {
    const { doc, system } = docWith({
      pairIdu: "SLZ-M25FA-A",
      pairOdu: "SUZ-M25VAD-A",
      components: { electrical: "isolator-32a-1ph", mounting: "roof-mount" },
    });
    const rows = systemComponents(doc, pack, system, "cooling");
    expect(rows.find((r) => r.id === "electrical")!.name).toBe("Isolator, 1Ø 32 A");
    expect(rows.find((r) => r.id === "mounting")!.name).toBe("Roof frame");
  });

  it("componentChoices falls back to defaults for missing/invalid keys", () => {
    const withBad = { ...COMPONENT_CHOICES }; // guard the catalogue is well-formed
    expect(withBad).toBeTruthy();
    const bad: DesignSystem = {
      id: "s",
      type: "split",
      brand: "b",
      colour: "#000",
      name: "S",
      settings: { components: { electrical: "does-not-exist" } },
    };
    const odu = pack.outdoor_units.find((o) => o.model === "SUZ-M25VAD-A")!;
    const choices = componentChoices(bad, odu);
    expect(choices.electrical).toBe("isolator-20a-1ph"); // invalid → default
    expect(choices.mounting).toBe("wall-bracket"); // missing → default
  });
});

/* ── the isolator is sized to the outdoor it breaks ──
   The default is the smallest rating at or above the outdoor's max running
   current (`max_amps_a`), on the outdoor's own supply. Every case reads the
   REAL pack, and states the pack's figure first, so a data change that moves
   the premise fails here rather than passing on a stale one. */
describe("the isolator follows the outdoor's draw and supply", () => {
  const odu = (model: string) => {
    const o = pack.outdoor_units.find((u) => u.model === model);
    if (!o) throw new Error(`${model} is not in the pack`);
    return o;
  };
  const isolators = COMPONENT_CHOICES.find((g) => g.key === "electrical")!.options.filter(
    (o): o is IsolatorOption => "isolator" in o
  );
  const isolatorOf = (id: string) => isolators.find((o) => o.id === id)!.isolator;
  const electrical = (settings: Record<string, unknown>, type: DesignSystem["type"] = "split") => {
    const { doc, system } = docWith(settings, type);
    return systemComponents(doc, pack, system, "cooling").find((r) => r.id === "electrical")!;
  };

  it("a 28 A single-phase outdoor gets a 1Ø 32 A isolator, not a 20 A", () => {
    expect(odu("PUZ-ZM125VKA2-A")).toMatchObject({ phase: "1", max_amps_a: 28 });
    const row = electrical({ pairIdu: "PEAD-M125JAA(D)", pairOdu: "PUZ-ZM125VKA2-A" }, "ducted");
    expect(row.choice!.selectedId).toBe("isolator-32a-1ph");
    expect(row.name).toBe("Isolator, 1Ø 32 A");
    expect(row.value).toBe("1");
  });

  it("an 18.4 A multi outdoor gets a 1Ø 20 A", () => {
    expect(odu("MXZ-5F100VGD")).toMatchObject({ phase: "1", max_amps_a: 18.4 });
    const row = electrical({ pairOdu: "MXZ-5F100VGD" }, "multi-split");
    expect(row.choice!.selectedId).toBe("isolator-20a-1ph");
    expect(row.name).toBe("Isolator, 1Ø 20 A");
  });

  it("the other single-phase outdoors past 20 A get the 1Ø 32 A too", () => {
    expect(odu("PUZ-M125VKA-A")).toMatchObject({ phase: "1", max_amps_a: 26.5 });
    expect(
      electrical({ pairIdu: "PEAD-M125JAA(D)", pairOdu: "PUZ-M125VKA-A" }, "ducted").name
    ).toBe("Isolator, 1Ø 32 A");
    expect(odu("MXZ-6F120VGD")).toMatchObject({ phase: "1", max_amps_a: 26.8 });
    expect(electrical({ pairOdu: "MXZ-6F120VGD" }, "multi-split").name).toBe("Isolator, 1Ø 32 A");
  });

  it("a draw exactly on a rating takes that rating", () => {
    expect(odu("PUZ-M100VKA-A")).toMatchObject({ phase: "1", max_amps_a: 20 });
    expect(defaultIsolatorId(odu("PUZ-M100VKA-A"))).toBe("isolator-20a-1ph");
    expect(odu("PUZ-ZM250YKA-A")).toMatchObject({ phase: "3", max_amps_a: 20 });
    expect(defaultIsolatorId(odu("PUZ-ZM250YKA-A"))).toBe("isolator-20a-3ph");
  });

  it("a three-phase outdoor gets a 3Ø isolator", () => {
    expect(odu("PUZ-ZM100YKA3-A")).toMatchObject({ phase: "3", max_amps_a: 11.5 });
    const row = electrical({ pairIdu: "PLA-M100EA2-A", pairOdu: "PUZ-ZM100YKA3-A" });
    expect(row.choice!.selectedId).toBe("isolator-20a-3ph");
    expect(row.name).toBe("Isolator, 3Ø 20 A");
  });

  it("with no max_amps_a in the pack it keeps the 20 A, on the outdoor's supply", () => {
    expect(odu("PUZ-ZM100VKA2-A").max_amps_a).toBeUndefined();
    expect(
      electrical({ pairIdu: "PLA-M100EA2-A", pairOdu: "PUZ-ZM100VKA2-A" }).choice!.selectedId
    ).toBe("isolator-20a-1ph");
    expect(odu("PUMY-SP112YKMD2-A")).toMatchObject({ phase: "3" });
    expect(odu("PUMY-SP112YKMD2-A").max_amps_a).toBeUndefined();
    expect(electrical({ pairOdu: "PUMY-SP112YKMD2-A" }, "multi-split").name).toBe("Isolator, 3Ø 20 A");
  });

  it("never sizes from a circuit figure standing in for the draw", () => {
    // City Multi prints MCA and no max running current: MCA sizes a circuit,
    // it is not the draw, so the default is the unsized 20 A
    expect(odu("PUHY-P500YNW-A1")).toMatchObject({ phase: "3", mca_a: 43.7 });
    expect(odu("PUHY-P500YNW-A1").max_amps_a).toBeUndefined();
    expect(electrical({ pairOdu: "PUHY-P500YNW-A1" }, "vrf").name).toBe("Isolator, 3Ø 20 A");
  });

  it("a draw it cannot read, or past every rating, keeps the 20 A rather than guess", () => {
    const base = odu("PUZ-M140VKA-A");
    for (const draw of [0, -3, Number.NaN, "28" as unknown as number, 45, 200]) {
      expect(defaultIsolatorId({ ...base, max_amps_a: draw })).toBe("isolator-20a-1ph");
    }
  });

  it("a hand-picked isolator stands, whatever the outdoor draws", () => {
    const pair = { pairIdu: "PEAD-M125JAA(D)", pairOdu: "PUZ-ZM125VKA2-A" };
    expect(
      electrical({ ...pair, components: { electrical: "isolator-20a-1ph" } }, "ducted").name
    ).toBe("Isolator, 1Ø 20 A");
    expect(
      electrical({ ...pair, components: { electrical: "isolator-32a-3ph" } }, "ducted").name
    ).toBe("Isolator, 3Ø 32 A");
    const others = electrical({ ...pair, components: { electrical: "none" } }, "ducted");
    expect(others.name).toBe("Supplied by others");
    expect(others.value).toBe("—");
  });

  it("an older catalogue's pick means what it meant, and is never rewritten", () => {
    // the old 32 A was labelled 3Ø — kept as 3Ø, even on a single-phase outdoor
    const { doc, system } = docWith(
      {
        pairIdu: "PEAD-M125JAA(D)",
        pairOdu: "PUZ-ZM125VKA2-A",
        components: { electrical: "isolator-32a" },
      },
      "ducted"
    );
    const row = systemComponents(doc, pack, system, "cooling").find((r) => r.id === "electrical")!;
    expect(row.choice!.selectedId).toBe("isolator-32a-3ph");
    expect(row.name).toBe("Isolator, 3Ø 32 A");
    expect(system.settings.components).toEqual({ electrical: "isolator-32a" });

    // the old 20 A named no supply: the rating was the pick, the supply is the
    // outdoor's, and a bigger draw does not bump it
    const legacy20 = { components: { electrical: "isolator-20a" } };
    expect(
      electrical({ pairIdu: "PEAD-M125JAA(D)", pairOdu: "PUZ-ZM125VKA2-A", ...legacy20 }, "ducted").name
    ).toBe("Isolator, 1Ø 20 A");
    expect(
      electrical({ pairIdu: "PEA-M250LAA", pairOdu: "PUZ-ZM250YKA-A", ...legacy20 }, "ducted").name
    ).toBe("Isolator, 3Ø 20 A");
  });

  it("every outdoor in the shipped pack with a draw gets the smallest isolator that covers it, on its supply", () => {
    const withDraw = pack.outdoor_units.filter((o) => o.max_amps_a != null);
    expect(withDraw.length).toBeGreaterThan(50);
    const wrong = withDraw.flatMap((o) => {
      const got = isolatorOf(defaultIsolatorId(o));
      const smallest = Math.min(
        ...isolators
          .filter((i) => i.isolator.phase === o.phase && i.isolator.amps >= o.max_amps_a!)
          .map((i) => i.isolator.amps)
      );
      return got.phase === o.phase && got.amps === smallest
        ? []
        : [`${o.model} (${o.phase}Ø, ${o.max_amps_a} A) got ${got.phase}Ø ${got.amps} A`];
    });
    expect(wrong).toEqual([]);
  });
});

/* ── pairPipeSizes — what a drawn pipe-run autosizes to ── */
describe("pairPipeSizes", () => {
  it("returns the pair row's line sizes once the pairing resolves", () => {
    const { doc, system } = docWith({ pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A" });
    const row = pack.pair_tables.find(
      (p) => p.idu_model === "SLZ-M25FA-A" && p.odu_model === "SUZ-M25VAD-A"
    )!;
    expect(pairPipeSizes(doc, pack, system)).toEqual({
      liquidMm: row.pipe_liquid_mm,
      gasMm: row.pipe_gas_mm,
    });
  });

  it("placed unit models win over settings", () => {
    const { doc, system } = docWith({ pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A" });
    doc.objects = [unit("i1", "idu", "PLA-M100EA2-A"), unit("o1", "odu", "PUZ-M100VKA-A")];
    const row = pack.pair_tables.find(
      (p) => p.idu_model === "PLA-M100EA2-A" && p.odu_model === "PUZ-M100VKA-A"
    )!;
    expect(pairPipeSizes(doc, pack, system)).toEqual({
      liquidMm: row.pipe_liquid_mm,
      gasMm: row.pipe_gas_mm,
    });
  });

  it("is null before a pairing resolves, without a pack, or off the tables", () => {
    const { doc, system } = docWith({});
    expect(pairPipeSizes(doc, pack, system)).toBeNull();
    const paired = docWith({ pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A" });
    expect(pairPipeSizes(paired.doc, null, paired.system)).toBeNull();
    const unknown = docWith({ pairIdu: "NOPE-1", pairOdu: "NOPE-2" });
    expect(pairPipeSizes(unknown.doc, pack, unknown.system)).toBeNull();
  });
});

/* ── insulation — lagging for hard-drawn copper (soft coil comes insulated) ── */
describe("insulation choice row", () => {
  const IDU = "PLA-M100EA2-A";
  const ODU = "PUZ-M100VKA-A";
  const run = (id: string, pts: { x: number; y: number }[], props: Record<string, unknown> = {}): DesignObject => ({
    id,
    type: "pipe-run",
    systemId: "sys1",
    floorId: "flr",
    geometry: { kind: "polyline", points: pts },
    plane: "room",
    props: {
      startAttach: { kind: "unit", id: "u_idu" },
      endAttach: { kind: "unit", id: "u_odu" },
      ...props,
    },
  });

  it("defaults to 13 mm wall and derives its metres from hard-drawn runs", () => {
    const { doc, system } = docWith({ pairIdu: IDU, pairOdu: ODU });
    // 10 mm/unit → a 500-unit run = 5 m of raw copper
    doc.objects = [
      unit("u_idu", "idu", IDU),
      unit("u_odu", "odu", ODU),
      run("r1", [{ x: 0, y: 0 }, { x: 500, y: 0 }]),
    ];
    const row = systemComponents(doc, pack, system, "cooling").find((r) => r.id === "insulation")!;
    expect(row.name).toBe("Lagging, 13 mm wall");
    expect(row.value).toBe("5 m");
  });

  it("skips soft-drawn runs — the coil arrives pre-insulated", () => {
    const { doc, system } = docWith({ pairIdu: IDU, pairOdu: ODU });
    doc.objects = [
      unit("u_idu", "idu", IDU),
      unit("u_odu", "odu", ODU),
      run("r1", [{ x: 0, y: 0 }, { x: 500, y: 0 }], { form: "soft" }),
    ];
    const row = systemComponents(doc, pack, system, "cooling").find((r) => r.id === "insulation")!;
    expect(row.value).toBe("—");
  });

  it("'supplied by others' zeroes the takeoff line", () => {
    const { doc, system } = docWith({
      pairIdu: IDU,
      pairOdu: ODU,
      components: { insulation: "none" },
    });
    doc.objects = [
      unit("u_idu", "idu", IDU),
      unit("u_odu", "odu", ODU),
      run("r1", [{ x: 0, y: 0 }, { x: 500, y: 0 }]),
    ];
    const row = systemComponents(doc, pack, system, "cooling").find((r) => r.id === "insulation")!;
    expect(row.name).toBe("Supplied by others");
    expect(row.value).toBe("—");
  });
});

/* ── the takeoff graph measures a soft run along its curve, not its chords ── */
describe("graph length for soft-drawn runs", () => {
  it("smoothed length exceeds the chord length through a bend", async () => {
    const { buildSystemGraph, totalPipeLengthM } = await import("../graph");
    const { doc } = docWith({});
    const mkRun = (form?: string): DesignObject => ({
      id: "r1",
      type: "pipe-run",
      systemId: "sys1",
      floorId: "flr",
      geometry: {
        kind: "polyline",
        points: [
          { x: 0, y: 0 },
          { x: 250, y: 200 },
          { x: 500, y: 0 },
        ],
      },
      plane: "room",
      props: {
        startAttach: { kind: "unit", id: "u_idu" },
        endAttach: { kind: "unit", id: "u_odu" },
        ...(form ? { form } : {}),
      },
    });
    const units = [unit("u_idu", "idu", "A"), unit("u_odu", "odu", "B")];
    doc.objects = [...units, mkRun()];
    const hard = totalPipeLengthM(buildSystemGraph(doc.objects, doc.floors, "sys1"))!;
    doc.objects = [...units, mkRun("soft")];
    const soft = totalPipeLengthM(buildSystemGraph(doc.objects, doc.floors, "sys1"))!;
    expect(soft).toBeGreaterThan(hard);
    expect(soft).toBeLessThan(hard * 1.5);
  });
});
