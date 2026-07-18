import {
  emptyPack,
  type DataPack,
  type IndoorUnit,
  type PackMeta,
} from "@/lib/studio/packs/schema";
import { buildCatalogView, catalogKpis, type HqRow } from "../catalog";

const META: PackMeta = { brand: "test", version: "1.0", packSchemaVersion: 1, name: "Test" };

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
    system_roles: [],
    refrigerant: "R32",
    width_mm: 800,
    depth_mm: 300,
    height_mm: 300,
    provenance: { kind: "extracted", source: "Book" },
    ...patch,
  };
}

function packOf(idus: IndoorUnit[]): DataPack {
  const p = emptyPack(META);
  p.indoor_units = idus;
  return p;
}

const gap = (row: HqRow, field: string) => row.gaps.find((g) => g.field === field);

describe("buildCatalogView — gap classification", () => {
  it("flags a missing airflow on a ducted unit as engine-blocking (ducted)", () => {
    const view = buildCatalogView(packOf([idu({ model: "D", form_factor: "ducted" })]), []);
    const g = gap(view.indoor[0], "airflow_ls")!;
    expect(g.blocks).toBe(true);
    expect(g.roles).toContain("ducted");
    expect(g.fillable).toBe(true);
    expect(view.indoor[0].engineReady).toBe(false);
  });

  it("flags a missing capacity_index on a VRF unit as blocking (vrf-idu)", () => {
    const view = buildCatalogView(
      packOf([idu({ model: "V", system_roles: ["vrf"] })]), // capacity_index absent
      []
    );
    const g = gap(view.indoor[0], "capacity_index")!;
    expect(g.blocks).toBe(true);
    expect(g.roles).toContain("vrf-idu");
  });

  it("treats missing sound/weight as nice-to-know (Tier-3, never blocks)", () => {
    const view = buildCatalogView(packOf([idu({ model: "W" })]), []);
    const sound = gap(view.indoor[0], "sound_high_dba")!;
    expect(sound.blocks).toBe(false);
    expect(sound.roles).toEqual([]);
    const weight = gap(view.indoor[0], "weight_kg")!;
    expect(weight.blocks).toBe(false);
  });

  it("surfaces a missing pair row as a structural (non-fillable) blocking gap", () => {
    const view = buildCatalogView(
      packOf([idu({ model: "P", system_roles: ["split-pair"] })]), // no pair_tables row
      []
    );
    const g = gap(view.indoor[0], "pair_tables row")!;
    expect(g.blocks).toBe(true);
    expect(g.fillable).toBe(false);
  });

  it("flags missing airway openings as blocking on ducted units only", () => {
    const view = buildCatalogView(
      packOf([idu({ model: "D", form_factor: "ducted" }), idu({ model: "W" })]),
      []
    );
    const ducted = view.indoor[0];
    for (const f of ["supply_opening", "return_opening"]) {
      const g = gap(ducted, f)!;
      expect(g.blocks).toBe(true);
      expect(g.roles).toContain("ducted");
      expect(g.fillable).toBe(true);
    }
    // wall unit: airways are not a gap at all, and the values slot stays null
    const wall = view.indoor[1];
    expect(gap(wall, "supply_opening")).toBeUndefined();
    expect(wall.values.supply_opening).toBeNull();
  });

  it("passes airway values through: box as {w_mm,h_mm}, keyword as string", () => {
    const view = buildCatalogView(
      packOf([
        idu({
          model: "D",
          form_factor: "ducted",
          airflow_ls: 200,
          supply_opening: { w_mm: 595, h_mm: 195 },
          return_opening: "built-in",
        }),
      ]),
      []
    );
    const row = view.indoor[0];
    expect(row.values.supply_opening).toEqual({ w_mm: 595, h_mm: 195 });
    expect(row.values.return_opening).toBe("built-in");
    expect(row.engineReady).toBe(true);
  });

  it("treats missing max running amps as nice-to-know on both unit sections", () => {
    const view = buildCatalogView(
      packOf([idu({ model: "W" })], ),
      []
    );
    const amps = gap(view.indoor[0], "max_amps_a")!;
    expect(amps.blocks).toBe(false);
    expect(amps.fillable).toBe(true);
  });
});

describe("buildCatalogView — overrides", () => {
  it("clears the blocking gap and records an override marker once a value is filled", () => {
    const view = buildCatalogView(
      packOf([
        idu({
          model: "D",
          form_factor: "ducted",
          supply_opening: { w_mm: 600, h_mm: 200 },
          return_opening: "built-in",
        }),
      ]),
      [
        {
          section: "indoor_units",
          rowKey: "D",
          field: "airflow_ls",
          value: 210,
          by: "isaac@heytiff.com",
          at: "2026-07-16T02:30:00Z",
        },
      ]
    );
    const row = view.indoor[0];
    expect(row.values.airflow_ls).toBe(210);
    expect(gap(row, "airflow_ls")).toBeUndefined(); // no longer missing
    expect(row.engineReady).toBe(true);
    expect(row.overridden.airflow_ls).toEqual({
      by: "isaac@heytiff.com",
      at: "2026-07-16T02:30:00Z",
      packValue: null, // pack had no airflow
    });
  });

  it("an airway-box override clears the opening gap and marks the cell", () => {
    const view = buildCatalogView(
      packOf([idu({ model: "D", form_factor: "ducted", airflow_ls: 200, return_opening: "spigots" })]),
      [
        {
          section: "indoor_units",
          rowKey: "D",
          field: "supply_opening",
          value: { w_mm: 595, h_mm: 195 },
          by: "isaac@heytiff.com",
          at: "2026-07-18T00:00:00Z",
        },
      ]
    );
    const row = view.indoor[0];
    expect(row.values.supply_opening).toEqual({ w_mm: 595, h_mm: 195 });
    expect(gap(row, "supply_opening")).toBeUndefined();
    expect(row.engineReady).toBe(true);
    expect(row.overridden.supply_opening?.packValue).toBeNull();
  });
});

describe("buildCatalogView — system-type membership (fan-out)", () => {
  it("maps roles to system types: split-pair→split, vrf→vrf", () => {
    const view = buildCatalogView(
      packOf([
        idu({ model: "S", system_roles: ["split-pair"] }),
        idu({ model: "V", system_roles: ["vrf"] }),
      ]),
      []
    );
    expect(view.indoor[0].systemTypes).toEqual(["split"]);
    expect(view.indoor[1].systemTypes).toEqual(["vrf"]);
  });

  it("fans out multi-role units into EVERY claimed system type", () => {
    // the branch-box case: a wall split also VRF-connectable
    const view = buildCatalogView(
      packOf([idu({ model: "AP", system_roles: ["split-pair", "vrf"] })]),
      []
    );
    expect(view.indoor[0].systemTypes).toEqual(["split", "vrf"]);
  });

  it("defaults roleless units to split so they never vanish", () => {
    const view = buildCatalogView(packOf([idu({ model: "X", system_roles: [] })]), []);
    expect(view.indoor[0].systemTypes).toEqual(["split"]);
  });

  it("stamps series and formFactor on indoor rows", () => {
    const view = buildCatalogView(
      packOf([idu({ model: "D", series: "PEAD-M-JAA", form_factor: "ducted" })]),
      []
    );
    expect(view.indoor[0].series).toBe("PEAD-M-JAA");
    expect(view.indoor[0].formFactor).toBe("ducted");
  });
});

describe("buildCatalogView — rule-derived multi membership (engine-exact)", () => {
  const mxzRule = {
    odu_model_ref: "MXZ-2F52VF",
    port_pipe_sizes: [{ liquid_mm: 6.35, gas_mm: 9.52 }],
    compatibility: [
      {
        method: "family_whitelist_with_limits" as const,
        families: ["MSZ-AP"],
        max_count: 2,
        per_port_max_kw: 5,
      },
    ],
    max_total_pipe_m: 30,
    max_per_branch_m: 20,
    max_lift_m: 10,
    additional_charge: { method: "none_required" as const },
    provenance: { kind: "extracted" as const, source: "Book", page: "C-2" },
  };

  it("adds derived multi membership when an outdoor rule's whitelist accepts the unit", () => {
    const p = packOf([idu({ model: "MSZ-AP25VGK", series: "MSZ-AP", system_roles: ["split-pair"] })]);
    p.multi_rules = [mxzRule];
    const view = buildCatalogView(p, []);
    const row = view.indoor[0];
    expect(row.systemTypes).toEqual(["split", "multi"]);
    expect(row.derived).toEqual(["multi"]);
    expect(row.roles).toEqual(["split-pair"]); // tags untouched — membership is derived
  });

  it("derives nothing when no rule matches (family is a model prefix)", () => {
    const p = packOf([idu({ model: "MFZ-KW25VG", series: "MFZ-KW", system_roles: ["split-pair"] })]);
    p.multi_rules = [mxzRule]; // whitelist only covers MSZ-AP
    const view = buildCatalogView(p, []);
    expect(view.indoor[0].systemTypes).toEqual(["split"]);
    expect(view.indoor[0].derived).toEqual([]);
  });

  it("does not double-count when the unit is already tagged multi", () => {
    const p = packOf([idu({ model: "MSZ-AP25VGK", series: "MSZ-AP", system_roles: ["split-pair", "multi"] })]);
    p.multi_rules = [mxzRule];
    const view = buildCatalogView(p, []);
    expect(view.indoor[0].systemTypes).toEqual(["split", "multi"]);
    expect(view.indoor[0].derived).toEqual([]);
  });
});

describe("buildCatalogView — pair series inheritance", () => {
  const pair = {
    idu_model: "M",
    odu_model: "O",
    pipe_liquid_mm: 6.35,
    pipe_gas_mm: 12.7,
    max_length_m: 30,
    max_lift_m: 15,
    additional_charge: { method: "none_required" } as const,
    provenance: { kind: "extracted" as const, source: "Book" },
  };

  it("inherits the IDU's series and lives in the split world", () => {
    const p = packOf([idu({ model: "M", series: "MSZ-AP" })]);
    p.pair_tables = [pair];
    const view = buildCatalogView(p, []);
    expect(view.pairs[0].series).toBe("MSZ-AP");
    expect(view.pairs[0].systemTypes).toEqual(["split"]);
  });

  it("buckets pairs with an unknown idu_model into 'Other'", () => {
    const p = packOf([idu({ model: "M" })]);
    p.pair_tables = [{ ...pair, idu_model: "GONE" }];
    const view = buildCatalogView(p, []);
    expect(view.pairs[0].series).toBe("Other");
  });
});

describe("buildCatalogView — orphans", () => {
  it("reports overrides that match no catalog row", () => {
    const view = buildCatalogView(packOf([idu({ model: "M" })]), [
      { section: "indoor_units", rowKey: "GONE", field: "airflow_ls", value: 100 },
      { section: "indoor_units", rowKey: "M", field: "airflow_ls", value: 200 },
    ]);
    expect(view.orphans).toHaveLength(1);
    expect(view.orphans[0].rowKey).toBe("GONE");
  });
});

describe("catalogKpis", () => {
  it("counts engine-ready units (missing-map empty) only", () => {
    const view = buildCatalogView(
      packOf([
        idu({ model: "ready" }), // wall, no roles → placeable only → ready
        idu({ model: "gappy", form_factor: "ducted" }), // ducted, airflow missing → not ready
      ]),
      []
    );
    const k = catalogKpis(view);
    expect(k.units).toBe(2);
    expect(k.engineReady).toBe(1);
    expect(k.readyPct).toBe(50);
    expect(k.blockingGaps).toBeGreaterThanOrEqual(1);
  });
});
