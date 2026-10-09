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

  it("sound sanity is a WARNING, never an error (Tier-3 field)", () => {
    const p = base();
    p.indoor_units.push({
      model: "SND-1",
      brand: "acme",
      series: "X",
      form_factor: "wall",
      capacity_cool_kw: 2.5,
      capacity_heat_kw: 3.2,
      conn_liquid_mm: 6.35,
      conn_gas_mm: 12.7,
      default_plane: "room",
      allowed_planes: ["room"],
      system_roles: ["split-pair"],
      refrigerant: "R32",
      width_mm: 800,
      depth_mm: 600,
      height_mm: 300,
      sound_low_dba: 45,
      sound_high_dba: 30, // inverted range
      provenance: prov,
    });
    p.outdoor_units.push({
      model: "SND-ODU",
      brand: "acme",
      series: "S",
      system_type: "split",
      capacity_cool_kw: 5,
      capacity_heat_kw: 6,
      phase: "1",
      conn_liquid_mm: 6.35,
      conn_gas_mm: 12.7,
      refrigerant: "R32",
      sound_high_dba: 200, // implausible
      provenance: prov,
    });
    const res = validatePack(p);
    expect(res.ok).toBe(true); // warnings don't block a pack
    expect(
      res.warnings.some((w) => w.section === "indoor_units" && w.message.includes("sound_low_dba 45 > sound_high_dba 30"))
    ).toBe(true);
    expect(
      res.warnings.some((w) => w.section === "outdoor_units" && w.message.includes("implausible: 200"))
    ).toBe(true);
  });

  it("warns on a low figure without a high (single figures go in high)", () => {
    const p = base();
    p.outdoor_units.push({
      model: "SND-LOW",
      brand: "acme",
      series: "S",
      system_type: "split",
      capacity_cool_kw: 5,
      capacity_heat_kw: 6,
      phase: "1",
      conn_liquid_mm: 6.35,
      conn_gas_mm: 12.7,
      refrigerant: "R32",
      sound_low_dba: 44,
      provenance: prov,
    });
    const res = validatePack(p);
    expect(res.ok).toBe(true);
    expect(res.warnings.some((w) => w.message.includes("without sound_high_dba"))).toBe(true);
  });

  it("flags an invalid indoor phase enum (mirrors the outdoor check)", () => {
    const p = base();
    p.indoor_units.push({
      model: "PH-1",
      brand: "acme",
      series: "X",
      form_factor: "wall",
      capacity_cool_kw: 2.5,
      capacity_heat_kw: 3.2,
      conn_liquid_mm: 6.35,
      conn_gas_mm: 12.7,
      default_plane: "room",
      allowed_planes: ["room"],
      system_roles: ["split-pair"],
      refrigerant: "R32",
      // @ts-expect-error deliberately invalid
      phase: "2",
      width_mm: 800,
      depth_mm: 600,
      height_mm: 300,
      provenance: prov,
    });
    const res = validatePack(p);
    expect(res.ok).toBe(false);
    expect(
      res.errors.some((e) => e.section === "indoor_units" && e.message.includes("phase must be '1' or '3'"))
    ).toBe(true);
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

  /* the stepped and whole-length charge methods (Daikin SkyAir, MHI
     FDCA160–250): a sound table passes, a broken one is an error, and a table
     that stops short of the pair's own maximum is a warning to look at */
  function pairWith(charge: DataPack["pair_tables"][number]["additional_charge"], maxM = 75): DataPack {
    const p = base();
    const unit = {
      brand: "acme",
      series: "S",
      capacity_cool_kw: 7.1,
      capacity_heat_kw: 8,
      conn_liquid_mm: 9.52,
      conn_gas_mm: 15.88,
      refrigerant: "R32" as const,
      provenance: prov,
    };
    p.indoor_units.push({
      ...unit,
      model: "I1",
      form_factor: "ducted",
      default_plane: "ceiling-cavity",
      allowed_planes: ["ceiling-cavity"],
      system_roles: ["split-pair"],
      width_mm: 1000,
      depth_mm: 700,
      height_mm: 245,
    });
    p.outdoor_units.push({ ...unit, model: "O1", system_type: "split", phase: "1" });
    p.pair_tables.push({
      idu_model: "I1",
      odu_model: "O1",
      pipe_liquid_mm: 9.52,
      pipe_gas_mm: 15.88,
      max_length_m: maxM,
      max_lift_m: 30,
      additional_charge: charge,
      provenance: prov,
    });
    return p;
  }
  const stepped = {
    method: "stepped_by_length" as const,
    precharged_up_to_m: 30,
    bands: [
      { up_to_m: 40, add_g: 350 },
      { up_to_m: 50, add_g: 700 },
      { up_to_m: 60, add_g: 1050 },
      { up_to_m: 75, add_g: 1400 },
    ],
    liquid_mm: 9.52,
  };

  it("accepts a stepped table that reaches the pair's maximum", () => {
    const res = validatePack(pairWith(stepped));
    expect(res.errors).toEqual([]);
    expect(res.warnings).toEqual([]);
  });

  it("flags bands that don't ascend from the pre-charged length, and a falling amount", () => {
    const res = validatePack(
      pairWith({
        ...stepped,
        bands: [
          { up_to_m: 25, add_g: 350 },
          { up_to_m: 50, add_g: 700 },
          { up_to_m: 45, add_g: 600 },
        ],
      })
    );
    const msgs = res.errors.map((e) => e.message);
    expect(msgs).toContain("additional_charge.bands[0].up_to_m 25 not above 30 (bands ascend from precharged_up_to_m)");
    expect(msgs).toContain("additional_charge.bands[2].up_to_m 45 not above 50 (bands ascend from precharged_up_to_m)");
    expect(msgs).toContain("additional_charge.bands[2].add_g 600 less than the band before");
  });

  it("flags an empty stepped table and a bad length weight", () => {
    const res = validatePack(
      pairWith({ method: "stepped_by_length", precharged_up_to_m: 30, bands: [], length_weights: { "9.52": 0 } })
    );
    expect(res.errors.map((e) => e.message)).toContain("additional_charge.bands empty");
    const res2 = validatePack(pairWith({ ...stepped, liquid_mm: undefined, length_weights: { "9.52": 0 } }));
    expect(res2.errors.map((e) => e.message)).toContain("additional_charge.length_weights[9.52] not a positive number");
  });

  it("warns when the table stops short of the pair's maximum (RZA: 'Impossible' past 50 m)", () => {
    const res = validatePack(pairWith({ ...stepped, bands: stepped.bands.slice(0, 2) }, 75));
    expect(res.errors).toEqual([]);
    expect(res.warnings.map((w) => w.message)).toEqual([
      "stepped charge table ends at 50 m, short of the pair's 75 m maximum",
    ]);
    // the same table on a pair whose own maximum is 50 m is consistent
    expect(validatePack(pairWith({ ...stepped, bands: stepped.bands.slice(0, 2) }, 50)).warnings).toEqual([]);
  });

  it("warns when the table is printed for another liquid size than the pair's", () => {
    const res = validatePack(pairWith({ ...stepped, liquid_mm: 6.35 }));
    expect(res.warnings.map((w) => w.message)).toEqual([
      "stepped charge is printed for 6.35 mm liquid, and the pair's is 9.52 mm",
    ]);
  });

  it("accepts the whole-length method and flags its broken parts", () => {
    const ok = validatePack(
      pairWith({
        method: "whole_length_by_liquid_size",
        rates: { "9.52": 57, "12.7": 110 },
        plus_past: { over_m: 30, add_g: 700 },
        round_g: 100,
      })
    );
    expect(ok.errors).toEqual([]);
    const bad = validatePack(
      pairWith({ method: "whole_length_by_liquid_size", rates: {}, chargeless_up_to_m: -1, round_g: 0 })
    );
    expect(bad.errors.map((e) => e.message)).toEqual(
      expect.arrayContaining([
        "additional_charge.rates empty",
        "additional_charge.chargeless_up_to_m not a number ≥ 0",
        "additional_charge.round_g not a positive number",
      ])
    );
  });
});
