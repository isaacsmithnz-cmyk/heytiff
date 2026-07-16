import {
  EDITABLE_FIELDS,
  fieldSpec,
  parseFieldInput,
  validateFieldValue,
} from "../fields";

describe("EDITABLE_FIELDS registry", () => {
  it("has no duplicate section+field entries", () => {
    const keys = EDITABLE_FIELDS.map((f) => `${f.section}:${f.field}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers every readiness-gated scalar field", () => {
    // fields ready.ts checks (the ones whose absence blocks an engine role)
    const gated: [string, string][] = [
      ["indoor_units", "capacity_cool_kw"],
      ["indoor_units", "capacity_heat_kw"],
      ["indoor_units", "capacity_index"],
      ["indoor_units", "airflow_ls"],
      ["indoor_units", "conn_liquid_mm"],
      ["indoor_units", "conn_gas_mm"],
      ["indoor_units", "width_mm"],
      ["indoor_units", "depth_mm"],
      ["outdoor_units", "capacity_cool_kw"],
      ["outdoor_units", "capacity_heat_kw"],
      ["outdoor_units", "capacity_index"],
      ["outdoor_units", "ports"],
      ["outdoor_units", "ratio_min_pct"],
      ["outdoor_units", "ratio_max_pct"],
      ["outdoor_units", "max_idus"],
      ["pair_tables", "rated_cool_kw"],
      ["pair_tables", "rated_heat_kw"],
      ["pair_tables", "max_length_m"],
      ["pair_tables", "max_lift_m"],
    ];
    for (const [section, field] of gated) {
      expect(fieldSpec(section, field)).toBeDefined();
    }
  });

  it("returns undefined for non-editable / identity fields", () => {
    expect(fieldSpec("indoor_units", "model")).toBeUndefined();
    expect(fieldSpec("indoor_units", "allowed_planes")).toBeUndefined();
    expect(fieldSpec("nope", "airflow_ls")).toBeUndefined();
  });
});

describe("parseFieldInput / validateFieldValue", () => {
  const airflow = fieldSpec("indoor_units", "airflow_ls")!;
  const ports = fieldSpec("outdoor_units", "ports")!;
  const phase = fieldSpec("indoor_units", "phase")!;
  const refrigerant = fieldSpec("indoor_units", "refrigerant")!;
  const power = fieldSpec("indoor_units", "power_supply")!;

  it("parses a valid number in range", () => {
    expect(parseFieldInput(airflow, "210")).toEqual({ ok: true, value: 210 });
  });

  it("rejects blank, non-numeric and out-of-range numbers", () => {
    expect(parseFieldInput(airflow, "")).toMatchObject({ ok: false });
    expect(parseFieldInput(airflow, "abc")).toMatchObject({ ok: false });
    expect(parseFieldInput(airflow, "999999")).toMatchObject({ ok: false });
  });

  it("enforces integer fields", () => {
    expect(parseFieldInput(ports, "3")).toEqual({ ok: true, value: 3 });
    expect(parseFieldInput(ports, "3.5")).toMatchObject({ ok: false });
  });

  it("validates enum membership", () => {
    expect(parseFieldInput(phase, "3")).toEqual({ ok: true, value: "3" });
    expect(parseFieldInput(phase, "2")).toMatchObject({ ok: false });
    expect(parseFieldInput(refrigerant, "R32")).toEqual({ ok: true, value: "R32" });
    expect(parseFieldInput(refrigerant, "R99")).toMatchObject({ ok: false });
  });

  it("trims strings and rejects empty", () => {
    expect(parseFieldInput(power, "  230V 1N~ 50Hz ")).toEqual({
      ok: true,
      value: "230V 1N~ 50Hz",
    });
    expect(parseFieldInput(power, "   ")).toMatchObject({ ok: false });
  });

  it("validateFieldValue rejects wrong JS types (server-side guard)", () => {
    expect(validateFieldValue(airflow, "210")).toMatchObject({ ok: false });
    expect(validateFieldValue(phase, 3)).toMatchObject({ ok: false });
  });
});

describe("tags type (system_roles)", () => {
  const tags = fieldSpec("indoor_units", "system_roles")!;

  it("is registered as a tags spec with the role enum", () => {
    expect(tags.type).toBe("tags");
    expect(tags.enumValues).toEqual(["split-pair", "multi", "vrf"]);
  });

  it("accepts a valid role list and dedupes it", () => {
    expect(
      validateFieldValue(tags, ["split-pair", "vrf", "split-pair"])
    ).toEqual({ ok: true, value: ["split-pair", "vrf"] });
  });

  it("rejects an empty list (at least one tag required)", () => {
    expect(validateFieldValue(tags, [])).toMatchObject({ ok: false });
  });

  it("rejects unknown roles and non-arrays", () => {
    expect(validateFieldValue(tags, ["split-pair", "ducted"])).toMatchObject({
      ok: false,
    });
    expect(validateFieldValue(tags, "vrf")).toMatchObject({ ok: false });
  });

  it("is not editable through the text-input parser", () => {
    expect(parseFieldInput(tags, "vrf")).toMatchObject({ ok: false });
  });
});
