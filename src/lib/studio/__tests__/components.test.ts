/* System Components rows (cockpit panel): ODU + refrigerant-charge rows and the
   electrical/mounting rows, all DERIVED from the real shipped ME pack. The
   electrical/mounting defaults come from pack data (OutdoorUnit.breaker_a /
   mca_a and the outdoor-mount accessories) and stay override-able via
   settings.components. Runs against the REAL ME pack. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  createDesign,
  type DesignDocument,
  type DesignObject,
  type DesignSystem,
} from "../document";
import {
  PACK_SECTIONS,
  emptyPack,
  type DataPack,
  type OutdoorUnit,
  type PackMeta,
} from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import {
  systemComponents,
  componentChoices,
  componentChoiceGroups,
  electricalGroup,
  mountingGroup,
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

const odu = (model: string): OutdoorUnit =>
  pack.outdoor_units.find((o) => o.model === model)!;

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

describe("systemComponents — derived rows (small split, no pre-charge)", () => {
  // SLZ-M25FA-A + SUZ-M25VAD-A: ODU phase 1 · R32 · no precharge; charge none_required
  const { doc, system } = docWith({ pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A" });
  const rows = systemComponents(doc, pack, system, "cooling");

  it("emits odu, charge, then the two choice rows in order", () => {
    expect(rows.map((r) => r.id)).toEqual(["odu", "charge", "electrical", "mounting"]);
  });

  it("derives the outdoor-unit row from the pack", () => {
    const o = rows.find((r) => r.id === "odu")!;
    expect(o.kind).toBe("odu");
    expect(o.name).toBe("SUZ-M25VAD-A");
    expect(o.sub).toBe("1Ø · R32 condenser");
    expect(o.value).toBe("2.5 kW"); // pair rated_cool_kw under the cooling basis
  });

  it("shows no top-up when the pair needs none", () => {
    const charge = rows.find((r) => r.id === "charge")!;
    expect(charge.name).toBe("R32");
    expect(charge.sub).toBe("Pre-charged — no top-up");
    expect(charge.value).toBe("—"); // no factory pre-charge on this small ODU
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

describe("electrical row — derived from the ODU breaker rating", () => {
  it("defaults to the pack-derived isolator for a single-phase split", () => {
    // SUZ-M25VAD-A: 2.5 kW / 1Ø → MCA 6 A, breaker 10 A
    const { doc, system } = docWith({ pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A" });
    const elec = systemComponents(doc, pack, system, "cooling").find((r) => r.id === "electrical")!;
    expect(elec.kind).toBe("choice");
    expect(elec.choice!.selectedId).toBe("pack");
    expect(elec.name).toBe("Isolator · 10 A");
    expect(elec.sub).toBe("1Ø · sized to 10 A breaker (MCA 6 A)");
    expect(elec.value).toBe("1");
  });

  it("carries the three-phase rating and label for a 3Ø split", () => {
    // PUZ-ZM100YKA3-A: 10 kW / 3Ø → MCA 10 A, breaker 16 A
    const { doc, system } = docWith({ pairIdu: "PLA-M100EA2-A", pairOdu: "PUZ-ZM100YKA3-A" });
    const elec = systemComponents(doc, pack, system, "cooling").find((r) => r.id === "electrical")!;
    expect(elec.name).toBe("Isolator · 16 A");
    expect(elec.sub).toBe("3Ø · sized to 16 A breaker (MCA 10 A)");
  });

  it("honours a persisted 'supplied by others' override", () => {
    const { doc, system } = docWith({
      pairIdu: "SLZ-M25FA-A",
      pairOdu: "SUZ-M25VAD-A",
      components: { electrical: "others" },
    });
    const elec = systemComponents(doc, pack, system, "cooling").find((r) => r.id === "electrical")!;
    expect(elec.choice!.selectedId).toBe("others");
    expect(elec.name).toBe("Supplied by others");
    expect(elec.value).toBe("—");
  });

  it("degrades to an '—' rating when the ODU carries no breaker data", () => {
    const bare = { ...odu("SUZ-M25VAD-A"), mca_a: undefined, breaker_a: undefined };
    const g = electricalGroup(bare);
    expect(g.defaultId).toBe("pack");
    const packOpt = g.options.find((o) => o.id === "pack")!;
    expect(packOpt.name).toBe("Isolator");
    expect(packOpt.sub).toBe("1Ø · rating not in pack");
    expect(packOpt.value).toBe("—");
  });
});

describe("mounting row — derived from the ODU form + outdoor-mount accessories", () => {
  it("defaults a light wall-hung ODU to the wall bracket", () => {
    // SUZ-M25VAD-A: 30 kg, 550 mm tall → not floor-standing
    const { doc, system } = docWith({ pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A" });
    const mount = systemComponents(doc, pack, system, "cooling").find((r) => r.id === "mounting")!;
    expect(mount.choice!.selectedId).toBe("OM-WALL-BRACKET");
    expect(mount.name).toBe("Wall bracket");
    // the pack marks all three supports compatible with the SUZ series
    expect(mount.choice!.options.map((o) => o.id).sort()).toEqual([
      "OM-GROUND-KIT",
      "OM-ROOF-FRAME",
      "OM-WALL-BRACKET",
    ]);
  });

  it("defaults a heavy floor-standing ODU to the ground pad and hides the wall bracket", () => {
    // PUZ-M100VKA-A: 76 kg → floor-standing; the wall bracket is not PUZ-compatible
    const { doc, system } = docWith({ pairIdu: "PLA-M100EA2-A", pairOdu: "PUZ-M100VKA-A" });
    const mount = systemComponents(doc, pack, system, "cooling").find((r) => r.id === "mounting")!;
    expect(mount.choice!.selectedId).toBe("OM-GROUND-KIT");
    expect(mount.name).toBe("Ground pad");
    expect(mount.choice!.options.map((o) => o.id)).not.toContain("OM-WALL-BRACKET");
  });

  it("honours a persisted mounting override", () => {
    const { doc, system } = docWith({
      pairIdu: "SLZ-M25FA-A",
      pairOdu: "SUZ-M25VAD-A",
      components: { mounting: "OM-ROOF-FRAME" },
    });
    const mount = systemComponents(doc, pack, system, "cooling").find((r) => r.id === "mounting")!;
    expect(mount.choice!.selectedId).toBe("OM-ROOF-FRAME");
    expect(mount.name).toBe("Roof frame");
  });

  it("degrades to a single '—' option when no outdoor-mount fits the ODU", () => {
    const stranger = { ...odu("SUZ-M25VAD-A"), model: "ZZZ-9000" };
    const g = mountingGroup(pack, stranger);
    expect(g.options).toEqual([{ id: "none", name: "Mounting", sub: "No support in pack", value: "—" }]);
    expect(g.defaultId).toBe("none");
  });
});

describe("componentChoices — overrides ∪ derived defaults", () => {
  it("falls back to the derived default for missing/invalid keys", () => {
    const groups = componentChoiceGroups(pack, odu("SUZ-M25VAD-A"));
    const bad: DesignSystem = {
      id: "s",
      type: "split",
      brand: "mitsubishi-electric",
      colour: "#000",
      name: "S",
      settings: { components: { electrical: "does-not-exist" } },
    };
    const choices = componentChoices(bad, groups);
    expect(choices.electrical).toBe("pack"); // invalid → default
    expect(choices.mounting).toBe("OM-WALL-BRACKET"); // missing → derived default
  });
});
