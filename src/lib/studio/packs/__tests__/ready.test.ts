/* Stage-2: engine-ready flags are COMPUTED and the `missing` lists are the
   extraction to-do list. (universal-table-schema.md — engine-ready.) */

import { emptyPack, type DataPack, type IndoorUnit, type OutdoorUnit } from "../schema";
import { indoorReadiness, outdoorReadiness, completenessByRange } from "../ready";

const prov = { kind: "extracted" as const, source: "book" };

function packWith(idus: IndoorUnit[] = [], odus: OutdoorUnit[] = []): DataPack {
  const p = emptyPack({ brand: "me", version: "1", packSchemaVersion: 1, name: "t" });
  p.brands.push({ id: "me", name: "Mitsubishi Electric" });
  p.indoor_units.push(...idus);
  p.outdoor_units.push(...odus);
  return p;
}

const vrfOdu: OutdoorUnit = {
  model: "PUHY-P200YNW-A1",
  brand: "me",
  series: "PUHY-P-YNW-A1",
  system_type: "vrf",
  capacity_cool_kw: 22.4,
  capacity_heat_kw: 25,
  capacity_index: 200,
  phase: "3",
  conn_liquid_mm: 9.52,
  conn_gas_mm: 22.2,
  refrigerant: "R410A",
  ratio_min_pct: 50,
  ratio_max_pct: 130,
  max_idus: 20,
  pipe_table_ref: "PUHY-P200-500YNW-A1",
  width_mm: 920,
  depth_mm: 740,
  height_mm: 1858,
  provenance: prov,
};

function withPipeTable(p: DataPack): DataPack {
  p.parts.push({ part_type: "joint", model: "J1", brand: "me", index_max: 200, provenance: prov });
  p.vrf_pipe_tables.push({
    series: "PUHY-P200-500YNW-A1",
    pipe_sizing: {
      method: "size_by_downstream_index",
      steps: [{ index_max: 200, liquid_mm: 9.52, gas_mm: 19.05 }],
    },
    joint_selection: { steps: [{ index_max: 200, part_ref: "J1" }] },
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
  return p;
}

describe("outdoor engine-ready", () => {
  it("a VRF ODU with a complete pipe table is vrf-odu ready", () => {
    const p = withPipeTable(packWith([], [vrfOdu]));
    const r = outdoorReadiness(p, vrfOdu);
    expect(r.roles["vrf-odu"]).toBe(true);
    expect(r.missing["vrf-odu"]).toBeUndefined();
  });

  it("a VRF ODU with no pipe table is NOT ready and reports the gap", () => {
    const p = packWith([], [vrfOdu]); // no vrf_pipe_tables
    const r = outdoorReadiness(p, vrfOdu);
    expect(r.roles["vrf-odu"]).toBe(false);
    expect(r.missing["vrf-odu"]).toContain("vrf_pipe_tables row");
  });

  it("a VRF ODU missing its capacity index reports exactly that", () => {
    const p = withPipeTable(packWith([], []));
    const noIndex = { ...vrfOdu, capacity_index: undefined };
    const r = outdoorReadiness(p, noIndex);
    expect(r.roles["vrf-odu"]).toBe(false);
    expect(r.missing["vrf-odu"]).toContain("capacity_index");
  });
});

describe("indoor engine-ready", () => {
  const idu: IndoorUnit = {
    model: "PEFY-P40VMA-E",
    brand: "me",
    series: "PEFY-P-VMA",
    form_factor: "ducted",
    capacity_cool_kw: 4.5,
    capacity_heat_kw: 5.0,
    capacity_index: 40,
    airflow_ls: 200,
    conn_liquid_mm: 6.35,
    conn_gas_mm: 12.7,
    default_plane: "ceiling-cavity",
    allowed_planes: ["ceiling-cavity"],
    system_roles: ["vrf"],
    refrigerant: "R410A",
    width_mm: 700,
    depth_mm: 600,
    height_mm: 250,
    provenance: prov,
  };

  it("a fully-specified VRF ducted IDU is vrf-idu + ducted ready", () => {
    const r = indoorReadiness(packWith([idu]), idu);
    expect(r.roles["vrf-idu"]).toBe(true);
    expect(r.roles.ducted).toBe(true);
    expect(r.roles.placeable).toBe(true);
  });

  it("missing capacity_index blocks vrf-idu but not placeable", () => {
    const noIndex = { ...idu, capacity_index: undefined };
    const r = indoorReadiness(packWith([noIndex]), noIndex);
    expect(r.roles.placeable).toBe(true);
    expect(r.roles["vrf-idu"]).toBe(false);
    expect(r.missing["vrf-idu"]).toContain("capacity_index");
  });

  it("missing airflow blocks ducted-ready (the brochure-gap case)", () => {
    const noAir = { ...idu, airflow_ls: undefined };
    const r = indoorReadiness(packWith([noAir]), noAir);
    expect(r.roles.ducted).toBe(false);
    expect(r.missing.ducted).toContain("airflow_ls");
  });

  it("completenessByRange rolls up ready/total per series+role", () => {
    const ready = idu;
    const notReady = { ...idu, model: "PEFY-P25VMA-E", capacity_index: undefined };
    const rows = completenessByRange(packWith([ready, notReady]));
    const vrf = rows.find((r) => r.series === "PEFY-P-VMA" && r.role === "vrf-idu");
    expect(vrf).toBeDefined();
    expect(vrf!.total).toBe(2);
    expect(vrf!.ready).toBe(1);
    expect(vrf!.gaps).toContain("capacity_index");
  });
});
