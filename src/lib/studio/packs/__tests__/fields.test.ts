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
      ["indoor_units", "supply_opening"],
      ["indoor_units", "return_opening"],
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

describe("opening type (supply/return airways)", () => {
  const supply = fieldSpec("indoor_units", "supply_opening")!;

  it("is registered as an opening spec with the keyword alternatives", () => {
    expect(supply.type).toBe("opening");
    expect(supply.enumValues).toEqual(["built-in", "spigots", "open"]);
    expect(fieldSpec("indoor_units", "return_opening")?.type).toBe("opening");
  });

  it("accepts a W×H box in band and returns a clean two-key copy", () => {
    const messy = { w_mm: 600, h_mm: 200, stray: "x" };
    expect(validateFieldValue(supply, messy)).toEqual({
      ok: true,
      value: { w_mm: 600, h_mm: 200 },
    });
  });

  it("accepts the keyword answers", () => {
    expect(validateFieldValue(supply, "built-in")).toEqual({ ok: true, value: "built-in" });
    expect(validateFieldValue(supply, " spigots ")).toEqual({ ok: true, value: "spigots" });
    // "open" = ductable face, size decided on site (books often publish none)
    expect(validateFieldValue(supply, "open")).toEqual({ ok: true, value: "open" });
  });

  it("rejects free text, malformed boxes and out-of-band dimensions", () => {
    expect(validateFieldValue(supply, "600x200")).toMatchObject({ ok: false });
    expect(validateFieldValue(supply, { w_mm: -1, h_mm: 200 })).toMatchObject({ ok: false });
    expect(validateFieldValue(supply, { w_mm: 6000, h_mm: 200 })).toMatchObject({ ok: false });
    expect(validateFieldValue(supply, { w_mm: 600 })).toMatchObject({ ok: false });
    expect(validateFieldValue(supply, null)).toMatchObject({ ok: false });
    expect(validateFieldValue(supply, [600, 200])).toMatchObject({ ok: false });
    expect(validateFieldValue(supply, 600)).toMatchObject({ ok: false });
  });

  it("is not editable through the text-input parser", () => {
    expect(parseFieldInput(supply, "600 × 200")).toMatchObject({ ok: false });
  });
});

describe("max running amps", () => {
  it("is a bounded number on both unit sections", () => {
    const idu = fieldSpec("indoor_units", "max_amps_a")!;
    const odu = fieldSpec("outdoor_units", "max_amps_a")!;
    expect(idu.type).toBe("number");
    expect(odu.unit).toBe("A");
    expect(parseFieldInput(odu, "12.5")).toEqual({ ok: true, value: 12.5 });
    expect(parseFieldInput(idu, "0")).toMatchObject({ ok: false });
    expect(parseFieldInput(idu, "999")).toMatchObject({ ok: false });
  });
});

describe("filter (built-in vs field-supplied)", () => {
  it("is an indoor-only enum with the two provenance answers", () => {
    const filter = fieldSpec("indoor_units", "filter")!;
    expect(filter.type).toBe("enum");
    expect(filter.enumValues).toEqual(["built-in", "field-supplied"]);
    expect(fieldSpec("outdoor_units", "filter")).toBeUndefined();
    expect(parseFieldInput(filter, "built-in")).toEqual({ ok: true, value: "built-in" });
    expect(parseFieldInput(filter, "washable")).toMatchObject({ ok: false });
  });
});

describe("drain pressure + pump", () => {
  it("are indoor-only enums with the trade answers", () => {
    const pressure = fieldSpec("indoor_units", "drain_pressure")!;
    const pump = fieldSpec("indoor_units", "drain_pump")!;
    expect(pressure.enumValues).toEqual(["positive", "negative"]);
    expect(pump.enumValues).toEqual(["built-in", "none"]);
    expect(fieldSpec("outdoor_units", "drain_pressure")).toBeUndefined();
    expect(parseFieldInput(pressure, "negative")).toEqual({ ok: true, value: "negative" });
    expect(parseFieldInput(pump, "gravity")).toMatchObject({ ok: false });
  });
});
