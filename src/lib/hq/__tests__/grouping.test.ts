import {
  emptyPack,
  type DataPack,
  type IndoorUnit,
  type OutdoorUnit,
  type PairTable,
  type PackMeta,
} from "@/lib/studio/packs/schema";
import { buildCatalogView } from "../catalog";
import { groupBrandCatalog } from "../grouping";

const META: PackMeta = { brand: "test", version: "1.0", packSchemaVersion: 1, name: "T" };

function idu(patch: Partial<IndoorUnit>): IndoorUnit {
  return {
    model: "M",
    brand: "test",
    series: "S",
    form_factor: "wall",
    capacity_cool_kw: 3,
    capacity_heat_kw: 3.5,
    conn_liquid_mm: 6.35,
    conn_gas_mm: 12.7,
    default_plane: "room",
    allowed_planes: ["room"],
    system_roles: ["split-pair"],
    refrigerant: "R32",
    width_mm: 800,
    depth_mm: 300,
    height_mm: 300,
    provenance: { kind: "extracted", source: "Book" },
    ...patch,
  };
}

function odu(patch: Partial<OutdoorUnit>): OutdoorUnit {
  return {
    model: "O",
    brand: "test",
    series: "OS",
    system_type: "split",
    capacity_cool_kw: 5,
    capacity_heat_kw: 6,
    phase: "1",
    conn_liquid_mm: 6.35,
    conn_gas_mm: 12.7,
    refrigerant: "R32",
    width_mm: 800,
    depth_mm: 300,
    height_mm: 700,
    provenance: { kind: "extracted", source: "Book" },
    ...patch,
  };
}

function pair(idu_model: string, odu_model: string): PairTable {
  return {
    idu_model,
    odu_model,
    pipe_liquid_mm: 6.35,
    pipe_gas_mm: 12.7,
    max_length_m: 30,
    max_lift_m: 15,
    additional_charge: { method: "none_required" },
    rated_cool_kw: 3,
    rated_heat_kw: 3.5,
    provenance: { kind: "extracted", source: "Book" },
  };
}

function fixture(): DataPack {
  const p = emptyPack(META);
  p.indoor_units = [
    // split wall series, two capacities out of order to test sorting
    idu({ model: "AP-50", series: "MSZ-AP", capacity_cool_kw: 5.0 }),
    idu({ model: "AP-25", series: "MSZ-AP", capacity_cool_kw: 2.5 }),
    // split ducted series (different form factor)
    idu({ model: "PEAD-50", series: "PEAD-M-JAA", form_factor: "ducted", capacity_cool_kw: 5, airflow_ls: 200 }),
    // vrf cassette series
    idu({ model: "PLFY-32", series: "PLFY-P-VEM-A", form_factor: "cassette-4way", system_roles: ["vrf"], capacity_index: 32 }),
    // multi-role unit: split AND vrf (the branch-box case)
    idu({ model: "DUAL-35", series: "MSZ-LN", capacity_cool_kw: 3.5, system_roles: ["split-pair", "vrf"] }),
  ];
  p.outdoor_units = [
    odu({ model: "MUZ-1", series: "MUZ-AP", system_type: "split" }),
    odu({ model: "MXZ-1", series: "MXZ-F", system_type: "multi", ports: 2 }),
    odu({ model: "PUHY-1", series: "PUHY", system_type: "vrf" }),
  ];
  p.pair_tables = [
    pair("AP-25", "MUZ-1"),
    pair("AP-50", "MUZ-1"),
    pair("GONE", "MUZ-1"), // orphan pair → series "Other"
  ];
  return p;
}

function groupsOf() {
  return groupBrandCatalog(buildCatalogView(fixture(), []));
}

describe("groupBrandCatalog", () => {
  it("always returns three system groups in split → multi → vrf order", () => {
    const g = groupsOf();
    expect(g.systems.map((s) => s.key)).toEqual(["split", "multi", "vrf"]);
    expect(g.systems.map((s) => s.label)).toEqual([
      "Split systems",
      "Multi-split",
      "VRF (City Multi)",
    ]);
  });

  it("counts per system: multi is ODU-only in this fixture", () => {
    const g = groupsOf();
    const multi = g.systems[1];
    expect(multi.counts.idu).toBe(0);
    expect(multi.counts.odu).toBe(1);
    expect(multi.counts.pairs).toBe(0);
    expect(multi.iduForms).toEqual([]);
  });

  it("fans a multi-role unit out into BOTH its system groups", () => {
    const g = groupsOf();
    const inSplit = g.systems[0].iduForms.flatMap((f) => f.seriesGroups).flatMap((s) => s.rows);
    const inVrf = g.systems[2].iduForms.flatMap((f) => f.seriesGroups).flatMap((s) => s.rows);
    expect(inSplit.some((r) => r.title === "DUAL-35")).toBe(true);
    expect(inVrf.some((r) => r.title === "DUAL-35")).toBe(true);
  });

  it("puts pairs only under split, bucketed by IDU series with orphans in 'Other' last", () => {
    const g = groupsOf();
    expect(g.systems[0].pairSeries.map((s) => s.series)).toEqual(["MSZ-AP", "Other"]);
    expect(g.systems[1].pairSeries).toEqual([]);
    expect(g.systems[2].pairSeries).toEqual([]);
  });

  it("orders indoor form groups canonically (wall before ducted before cassette)", () => {
    const g = groupsOf();
    expect(g.systems[0].iduForms.map((f) => f.formFactor)).toEqual(["wall", "ducted"]);
    expect(g.systems[0].iduForms[0].label).toBe("Wall-mounted");
    const vrfForms = g.systems[2].iduForms.map((f) => f.formFactor);
    expect(vrfForms).toContain("cassette-4way");
  });

  it("sorts series A→Z and rows by cooling capacity ascending", () => {
    const g = groupsOf();
    const wall = g.systems[0].iduForms[0];
    expect(wall.seriesGroups.map((s) => s.series)).toEqual(["MSZ-AP", "MSZ-LN"]);
    expect(wall.seriesGroups[0].rows.map((r) => r.title)).toEqual(["AP-25", "AP-50"]);
  });

  it("summarises ready/total and the union of blocking fields per series", () => {
    const g = groupsOf();
    // PLFY vrf cassette missing conn sizes? — it has conn sizes; it has capacity_index → vrf-ready
    const vrfCassette = g.systems[2].iduForms.find((f) => f.formFactor === "cassette-4way")!;
    const s = vrfCassette.seriesGroups[0];
    expect(s.total).toBe(1);
    expect(s.ready + s.blockingFields.length).toBeGreaterThanOrEqual(1); // coherent summary
    // the DUAL unit claims vrf but has no capacity_index → blocking field surfaces in its vrf series group
    const lnGroup = g.systems[2].iduForms
      .flatMap((f) => f.seriesGroups)
      .find((sg) => sg.series === "MSZ-LN")!;
    expect(lnGroup.blockingFields).toContain("capacity_index");
  });

  it("stamps ODU system types straight from system_type", () => {
    const g = groupsOf();
    expect(g.systems[0].oduSeries.map((s) => s.series)).toEqual(["MUZ-AP"]);
    expect(g.systems[1].oduSeries.map((s) => s.series)).toEqual(["MXZ-F"]);
    expect(g.systems[2].oduSeries.map((s) => s.series)).toEqual(["PUHY"]);
  });
});
