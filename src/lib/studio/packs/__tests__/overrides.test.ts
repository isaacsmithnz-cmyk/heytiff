import {
  emptyPack,
  type DataPack,
  type IndoorUnit,
  type PairTable,
  type PackMeta,
} from "../schema";
import { applyOverrides, newValidationErrors } from "../overrides";
import { indoorReadiness } from "../ready";
import type { ValidationIssue } from "../validate";

const META: PackMeta = {
  brand: "test",
  version: "1.0",
  packSchemaVersion: 1,
  name: "Test",
};

function ductedIdu(patch: Partial<IndoorUnit> = {}): IndoorUnit {
  return {
    model: "DUCT-1",
    brand: "test",
    series: "D",
    form_factor: "ducted",
    capacity_cool_kw: 5,
    capacity_heat_kw: 6,
    conn_liquid_mm: 6.35,
    conn_gas_mm: 12.7,
    default_plane: "ceiling-cavity",
    allowed_planes: ["ceiling-cavity"],
    system_roles: [],
    refrigerant: "R32",
    width_mm: 700,
    depth_mm: 600,
    height_mm: 250,
    provenance: { kind: "extracted", source: "Book", page: "12" },
    ...patch,
  };
}

function packWith(idus: IndoorUnit[], pairs: PairTable[] = []): DataPack {
  const p = emptyPack(META);
  p.indoor_units = idus;
  p.pair_tables = pairs;
  return p;
}

describe("applyOverrides", () => {
  it("patches a scalar field by model key", () => {
    const pack = packWith([ductedIdu()]);
    const out = applyOverrides(pack, [
      { section: "indoor_units", rowKey: "DUCT-1", field: "capacity_cool_kw", value: 7.1 },
    ]);
    expect(out.indoor_units[0].capacity_cool_kw).toBe(7.1);
  });

  it("does not mutate the input pack or row (structural sharing)", () => {
    const idu = ductedIdu();
    const pack = packWith([idu]);
    applyOverrides(pack, [
      { section: "indoor_units", rowKey: "DUCT-1", field: "capacity_cool_kw", value: 9 },
    ]);
    expect(idu.capacity_cool_kw).toBe(5); // original untouched
  });

  it("leaves row provenance untouched (the overrides table is the per-field provenance)", () => {
    const pack = packWith([ductedIdu()]);
    const out = applyOverrides(pack, [
      { section: "indoor_units", rowKey: "DUCT-1", field: "airflow_ls", value: 210, by: "isaac@x.com", at: "2026-07-16T00:00:00Z" },
    ]);
    expect(out.indoor_units[0].provenance).toEqual({
      kind: "extracted",
      source: "Book",
      page: "12",
    });
  });

  it("makes a ducted unit engine-ready once its missing airflow is filled", () => {
    const pack = packWith([ductedIdu()]); // airflow_ls absent
    expect(indoorReadiness(pack, pack.indoor_units[0]).roles.ducted).toBe(false);

    const out = applyOverrides(pack, [
      { section: "indoor_units", rowKey: "DUCT-1", field: "airflow_ls", value: 210 },
    ]);
    const eff = out.indoor_units[0];
    const readiness = indoorReadiness(out, eff);
    expect(readiness.roles.ducted).toBe(true);
    expect(Object.keys(readiness.missing)).toHaveLength(0);
  });

  it("patches pair rows by composite idu+odu key", () => {
    const pair: PairTable = {
      idu_model: "DUCT-1",
      odu_model: "ODU-9",
      pipe_liquid_mm: 6.35,
      pipe_gas_mm: 12.7,
      max_length_m: 30,
      max_lift_m: 15,
      additional_charge: { method: "none_required" },
      provenance: { kind: "extracted", source: "Book" },
    };
    const pack = packWith([ductedIdu()], [pair]);
    const out = applyOverrides(pack, [
      { section: "pair_tables", rowKey: "DUCT-1+ODU-9", field: "rated_cool_kw", value: 4.8 },
    ]);
    expect(out.pair_tables[0].rated_cool_kw).toBe(4.8);
  });

  it("patches array values (system_roles tags) and upgrades readiness domains", () => {
    const pack = packWith([ductedIdu({ airflow_ls: 210, capacity_index: 50 })]);
    // untagged for vrf → no vrf-idu readiness claim at all
    expect(indoorReadiness(pack, pack.indoor_units[0]).roles["vrf-idu"]).toBe(false);

    const out = applyOverrides(pack, [
      { section: "indoor_units", rowKey: "DUCT-1", field: "system_roles", value: ["split-pair", "vrf"] },
    ]);
    expect(out.indoor_units[0].system_roles).toEqual(["split-pair", "vrf"]);
    // now the unit claims vrf and has index + conn sizes → vrf-idu ready
    expect(indoorReadiness(out, out.indoor_units[0]).roles["vrf-idu"]).toBe(true);
  });

  it("ignores orphan overrides that match no row", () => {
    const pack = packWith([ductedIdu()]);
    const out = applyOverrides(pack, [
      { section: "indoor_units", rowKey: "NOPE", field: "airflow_ls", value: 99 },
    ]);
    expect(out.indoor_units[0].airflow_ls).toBeUndefined();
  });

  it("returns the same pack reference for an empty override list", () => {
    const pack = packWith([ductedIdu()]);
    expect(applyOverrides(pack, [])).toBe(pack);
  });
});

describe("newValidationErrors", () => {
  const mk = (row: string, message: string): ValidationIssue => ({
    severity: "error",
    section: "indoor_units",
    row,
    message,
  });

  it("returns only errors not present in the baseline", () => {
    const baseline = [mk("A", "bad x")];
    const candidate = [mk("A", "bad x"), mk("B", "bad y")];
    expect(newValidationErrors(baseline, candidate)).toEqual([mk("B", "bad y")]);
  });

  it("is empty when the candidate introduces nothing new", () => {
    const baseline = [mk("A", "bad x")];
    expect(newValidationErrors(baseline, [mk("A", "bad x")])).toEqual([]);
  });
});
