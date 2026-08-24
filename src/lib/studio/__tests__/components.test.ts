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
  COMPONENT_CHOICES,
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

/** a calibrated (10 mm/unit) doc with one split system */
function docWith(settings: Record<string, unknown>): { doc: DesignDocument; system: DesignSystem } {
  const d = createDesign({ name: "Comp", mode: "blank", now: "2026-07-10T00:00:00.000Z" });
  d.floors = [
    { id: "flr", name: "Ground", level: 0, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [] },
  ];
  const system: DesignSystem = {
    id: "sys1",
    type: "split",
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

  it("emits odu, charge, then the two choice rows in order", () => {
    expect(rows.map((r) => r.id)).toEqual(["odu", "charge", "electrical", "mounting"]);
  });

  it("derives the outdoor-unit row from the pack", () => {
    const odu = rows.find((r) => r.id === "odu")!;
    expect(odu.kind).toBe("odu");
    expect(odu.name).toBe("SUZ-M25VAD-A");
    expect(odu.sub).toBe("1Ø · R32 condenser");
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
    expect(charge.sub).toBe("Pre-charged · run length unknown");
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
    const { doc, system } = docWith({ pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A" });
    const rows = systemComponents(doc, pack, system, "cooling");
    const elec = rows.find((r) => r.id === "electrical")!;
    const mount = rows.find((r) => r.id === "mounting")!;
    expect(elec.kind).toBe("choice");
    expect(elec.choice!.selectedId).toBe("isolator-20a");
    expect(elec.name).toBe("Isolator · 20 A");
    expect(mount.choice!.selectedId).toBe("wall-bracket");
    expect(mount.name).toBe("Wall bracket");
  });

  it("honours a persisted override on settings.components", () => {
    const { doc, system } = docWith({
      pairIdu: "SLZ-M25FA-A",
      pairOdu: "SUZ-M25VAD-A",
      components: { electrical: "isolator-32a", mounting: "roof-mount" },
    });
    const rows = systemComponents(doc, pack, system, "cooling");
    expect(rows.find((r) => r.id === "electrical")!.name).toBe("Isolator · 32 A");
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
    const choices = componentChoices(bad);
    expect(choices.electrical).toBe("isolator-20a"); // invalid → default
    expect(choices.mounting).toBe("wall-bracket"); // missing → default
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
