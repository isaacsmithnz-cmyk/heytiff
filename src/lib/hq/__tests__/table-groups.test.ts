import {
  emptyPack,
  type DataPack,
  type IndoorUnit,
  type PackMeta,
  type PairTable,
} from "@/lib/studio/packs/schema";
import { EDITABLE_FIELDS, type EditableSection } from "@/lib/studio/packs/fields";
import { buildCatalogView } from "../catalog";
import { seriesColumns, sectionFields, TABLE_GROUPS } from "../table-groups";

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

const pairOf = (patch: Partial<PairTable> = {}): PairTable => ({
  idu_model: "M",
  odu_model: "O",
  pipe_liquid_mm: 6.35,
  pipe_gas_mm: 12.7,
  max_length_m: 30,
  max_lift_m: 15,
  additional_charge: { method: "none_required" },
  provenance: { kind: "extracted", source: "Book" },
  ...patch,
});

function packOf(idus: IndoorUnit[], mutate?: (p: DataPack) => void): DataPack {
  const p = emptyPack(META);
  p.indoor_units = idus;
  mutate?.(p);
  return p;
}

const SECTIONS: EditableSection[] = ["indoor_units", "outdoor_units", "pair_tables"];

describe("TABLE_GROUPS — registry drift guard", () => {
  it.each(SECTIONS)("%s groups cover the editable value fields exactly, no dupes", (section) => {
    const grouped = TABLE_GROUPS[section].flatMap((g) => g.columns.map((c) => c.field));
    expect(new Set(grouped).size).toBe(grouped.length); // no duplicates
    expect([...grouped].sort()).toEqual([...sectionFields(section)].sort());
  });

  it("matches the known section totals (indoor 16 / outdoor 24 / pairs 6)", () => {
    expect(sectionFields("indoor_units")).toHaveLength(16);
    expect(sectionFields("outdoor_units")).toHaveLength(24);
    expect(sectionFields("pair_tables")).toHaveLength(6);
    // sanity: derived from the same registry the editor validates against
    expect(EDITABLE_FIELDS.some((f) => f.type === "tags")).toBe(true);
  });
});

describe("seriesColumns — to-add partition", () => {
  it("moves a field to toAdd only when NO row in the series has it", () => {
    const view = buildCatalogView(
      packOf([idu({ model: "A" }), idu({ model: "B", sound_high_dba: 42 })]),
      []
    );
    const cols = seriesColumns("indoor_units", view.indoor);

    // sound_high_dba: one row has it → stays in the sound group
    const sound = cols.groups.find((g) => g.key === "sound");
    expect(sound?.columns.map((c) => c.field)).toEqual(["sound_high_dba"]);
    // sound_low_dba: no row has it → toAdd
    expect(cols.toAdd.map((c) => c.field)).toContain("sound_low_dba");
    expect(cols.toAdd.map((c) => c.field)).not.toContain("sound_high_dba");
  });

  it("drops a group entirely when all its fields are empty across the series", () => {
    const view = buildCatalogView(packOf([idu({ model: "A" })]), []);
    const cols = seriesColumns("indoor_units", view.indoor);
    expect(cols.groups.find((g) => g.key === "sound")).toBeUndefined();
    expect(cols.toAdd.map((c) => c.field)).toEqual(
      expect.arrayContaining(["sound_low_dba", "sound_high_dba"])
    );
  });

  it("keeps mapped + toAdd = total, and toAdd in registry order", () => {
    const view = buildCatalogView(packOf([idu({ model: "A" })]), []);
    const cols = seriesColumns("indoor_units", view.indoor);
    expect(cols.totalFields).toBe(16);
    expect(cols.mappedFields + cols.toAdd.length).toBe(cols.totalFields);
    const order = sectionFields("indoor_units");
    const idx = cols.toAdd.map((c) => order.indexOf(c.field));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });

  it("uses the full field label as the toAdd sub-header", () => {
    const view = buildCatalogView(packOf([idu({ model: "A", form_factor: "ducted" })]), []);
    const cols = seriesColumns("indoor_units", view.indoor);
    expect(cols.toAdd.find((c) => c.field === "airflow_ls")?.sub).toBe("Airflow (Hi)");
  });
});

describe("seriesColumns — blocking markers", () => {
  it("marks a toAdd field blocking with the roles that need it (ducted airflow)", () => {
    const view = buildCatalogView(packOf([idu({ model: "D", form_factor: "ducted" })]), []);
    const cols = seriesColumns("indoor_units", view.indoor);
    const airflow = cols.toAdd.find((c) => c.field === "airflow_ls")!;
    expect(airflow.blocks).toBe(true);
    expect(airflow.roles).toContain("ducted");
    const weight = cols.toAdd.find((c) => c.field === "weight_kg")!;
    expect(weight.blocks).toBe(false);
    expect(weight.roles).toEqual([]);
  });

  it("marks pair rated capacities blocking when a pair misses both", () => {
    const view = buildCatalogView(
      packOf([idu({ model: "M" })], (p) => {
        p.pair_tables = [pairOf()];
      }),
      []
    );
    const cols = seriesColumns("pair_tables", view.pairs);
    for (const f of ["rated_cool_kw", "rated_heat_kw"]) {
      const c = cols.toAdd.find((x) => x.field === f)!;
      expect(c.blocks).toBe(true);
      expect(c.roles).toEqual(["simulation"]);
    }
  });
});

describe("seriesColumns — overrides", () => {
  it("an override filling an otherwise-empty column maps it (not toAdd)", () => {
    const view = buildCatalogView(packOf([idu({ model: "D", form_factor: "ducted" })]), [
      { section: "indoor_units", rowKey: "D", field: "airflow_ls", value: 210 },
    ]);
    const cols = seriesColumns("indoor_units", view.indoor);
    expect(cols.toAdd.map((c) => c.field)).not.toContain("airflow_ls");
    expect(cols.groups.find((g) => g.key === "air")?.columns.map((c) => c.field)).toEqual([
      "airflow_ls",
    ]);
  });
});
