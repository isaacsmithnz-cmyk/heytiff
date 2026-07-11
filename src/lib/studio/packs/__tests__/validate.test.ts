/* Stage-2 lock gate: the schema validation suite + the shipped pack loads clean.
   (design-studio-plan.md, Part 3 stage 2 — "Schema validation suite; pack loads".)
   The real Mitsubishi seed on disk is the primary fixture; negative cases prove
   the referential-integrity and enum guards actually bite. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  PACK_SECTIONS,
  emptyPack,
  type DataPack,
  type PackMeta,
} from "../schema";
import { assemblePack, type PackSource } from "../loader";
import { validatePack } from "../validate";

const SEED_DIR = join(
  __dirname,
  "../../../../../data/packs/mitsubishi-electric@2026.1"
);

function loadSeed(): DataPack {
  const meta = JSON.parse(readFileSync(join(SEED_DIR, "meta.json"), "utf8")) as PackMeta;
  const sections: PackSource["sections"] = {};
  for (const section of PACK_SECTIONS) {
    const file = join(SEED_DIR, `${section}.json`);
    if (existsSync(file)) {
      sections[section] = JSON.parse(readFileSync(file, "utf8"));
    }
  }
  return assemblePack({ meta, sections });
}

describe("shipped Mitsubishi pack validates", () => {
  const pack = loadSeed();

  it("loads and passes validation with no errors", () => {
    const res = validatePack(pack);
    if (!res.ok) console.error(res.errors);
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it("carries the VRF outdoor unit + its complete pipe table", () => {
    expect(pack.outdoor_units.map((o) => o.model)).toContain("PUHY-P200YNW-A1");
    const table = pack.vrf_pipe_tables.find((t) => t.series === "PUHY-P200-500YNW-A1");
    expect(table).toBeDefined();
    expect(table!.joint_selection.steps.length).toBeGreaterThan(0);
  });

  it("every joint/header part_ref resolves to a real part", () => {
    const parts = new Set(pack.parts.map((p) => p.model));
    for (const t of pack.vrf_pipe_tables) {
      for (const s of t.joint_selection.steps) expect(parts.has(s.part_ref)).toBe(true);
      for (const s of t.header_selection?.steps ?? []) expect(parts.has(s.part_ref)).toBe(true);
    }
  });
});

describe("validator catches broken packs", () => {
  function base(): DataPack {
    const p = emptyPack({
      brand: "acme",
      version: "1",
      packSchemaVersion: 1,
      name: "test",
    });
    p.brands.push({ id: "acme", name: "Acme" });
    return p;
  }
  const prov = { kind: "extracted" as const, source: "book" };

  it("flags a pair_table referencing a non-existent unit", () => {
    const p = base();
    p.pair_tables.push({
      idu_model: "GHOST-IDU",
      odu_model: "GHOST-ODU",
      pipe_liquid_mm: 6.35,
      pipe_gas_mm: 12.7,
      max_length_m: 30,
      max_lift_m: 15,
      additional_charge: { method: "none_required" },
      provenance: prov,
    });
    const res = validatePack(p);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.message.includes("idu_model not found"))).toBe(true);
    expect(res.errors.some((e) => e.message.includes("odu_model not found"))).toBe(true);
  });

  it("flags an invalid form_factor enum", () => {
    const p = base();
    p.indoor_units.push({
      model: "X1",
      brand: "acme",
      series: "X",
      // @ts-expect-error deliberately invalid
      form_factor: "space-station",
      capacity_cool_kw: 2.5,
      capacity_heat_kw: 3.2,
      conn_liquid_mm: 6.35,
      conn_gas_mm: 12.7,
      default_plane: "room",
      allowed_planes: ["room"],
      system_roles: ["vrf"],
      refrigerant: "R32",
      width_mm: 800,
      depth_mm: 600,
      height_mm: 300,
      provenance: prov,
    });
    const res = validatePack(p);
    expect(res.errors.some((e) => e.message.includes("form_factor invalid"))).toBe(true);
  });

  it("flags a duplicate outdoor model and an unknown brand", () => {
    const p = base();
    const odu = {
      model: "DUP",
      brand: "not-a-brand",
      series: "S",
      system_type: "vrf" as const,
      capacity_cool_kw: 22.4,
      capacity_heat_kw: 25,
      phase: "3" as const,
      conn_liquid_mm: 9.52,
      conn_gas_mm: 22.2,
      refrigerant: "R410A" as const,
      provenance: prov,
    };
    p.outdoor_units.push({ ...odu }, { ...odu });
    const res = validatePack(p);
    expect(res.errors.some((e) => e.message.includes("duplicate model"))).toBe(true);
    expect(res.errors.some((e) => e.message.includes("brand not in brands"))).toBe(true);
  });

  it("accepts a combined multi-module ODU whose modules + kit resolve", () => {
    const p = base();
    const mod = {
      model: "MOD-A",
      brand: "acme",
      series: "S",
      system_type: "vrf" as const,
      capacity_cool_kw: 22.4,
      capacity_heat_kw: 25,
      phase: "3" as const,
      conn_liquid_mm: 9.52,
      conn_gas_mm: 22.2,
      refrigerant: "R410A" as const,
      provenance: prov,
    };
    p.outdoor_units.push(
      { ...mod },
      { ...mod, model: "MOD-B" },
      {
        ...mod,
        model: "BANK-1",
        capacity_cool_kw: 44.8,
        capacity_heat_kw: 50,
        combined: true,
        modules: ["MOD-A", "MOD-B"],
        twinning_kit_ref: "TW-1",
      }
    );
    p.parts.push({ part_type: "twinning-kit", model: "TW-1", brand: "acme", provenance: prov });
    const res = validatePack(p);
    if (!res.ok) console.error(res.errors);
    expect(res.ok).toBe(true);
  });

  it("flags a combined ODU whose module ref doesn't resolve", () => {
    const p = base();
    p.outdoor_units.push({
      model: "BANK-2",
      brand: "acme",
      series: "S",
      system_type: "vrf",
      capacity_cool_kw: 44.8,
      capacity_heat_kw: 50,
      phase: "3",
      conn_liquid_mm: 9.52,
      conn_gas_mm: 22.2,
      refrigerant: "R410A",
      combined: true,
      modules: ["GHOST-MOD", "ALSO-GHOST"],
      provenance: prov,
    });
    const res = validatePack(p);
    expect(res.errors.some((e) => e.message.includes("module not an outdoor unit"))).toBe(true);
  });

  it("flags a vrf table whose joint part_ref is missing from parts[]", () => {
    const p = base();
    p.vrf_pipe_tables.push({
      series: "S1",
      pipe_sizing: {
        method: "size_by_downstream_index",
        steps: [{ index_max: 200, liquid_mm: 9.52, gas_mm: 19.05 }],
      },
      joint_selection: { steps: [{ index_max: 200, part_ref: "NO-SUCH-JOINT" }] },
      limits: {
        max_total_m: 1000,
        max_farthest_actual_m: 165,
        max_farthest_equiv_m: 190,
        max_after_first_joint_m: 40,
        max_lift_odu_above_m: 50,
        max_lift_odu_below_m: 40,
        max_lift_idu_idu_m: 15,
      },
      additional_charge: { method: "none_required" },
      provenance: prov,
    });
    const res = validatePack(p);
    expect(res.errors.some((e) => e.message.includes("part_ref not in parts"))).toBe(true);
  });
});
