/* Editable-field registry for the HQ universal-table editor.

   The single source of truth for WHICH scalar fields staff may hand-enter on an
   existing catalog row, and how each is validated (type / enum / sanity band).
   v1 edits existing rows of indoor_units, outdoor_units and pair_tables only —
   identity (model/series), structural arrays/objects and provenance are not
   editable, and creating brand-new rows is deferred (a missing pair/multi/vrf
   row is surfaced as a read-only engine-blocking chip instead).

   Pure and IO-free (importable on client and server): the popover editor
   parses+validates before sending, the server action re-validates before it
   writes. The final structural gate is validatePack, not this registry — dangling
   refs etc. are caught there. */

import { REFRIGERANTS, SYSTEM_ROLES, type OpeningSpec } from "./schema";

export type EditableSection = "indoor_units" | "outdoor_units" | "pair_tables";

/** the structured variant of OpeningSpec — a W×H airway box in mm */
export type OpeningBox = Extract<OpeningSpec, object>;

export function isOpeningBox(v: unknown): v is OpeningBox {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.w_mm === "number" && Number.isFinite(o.w_mm) &&
    typeof o.h_mm === "number" && Number.isFinite(o.h_mm)
  );
}

export interface EditableFieldSpec {
  section: EditableSection;
  field: string;
  label: string;
  unit?: string;
  /** "tags" = multi-enum array (e.g. system_roles) — edited via checkboxes,
      never rendered as a value pill. "opening" = an airway OpeningSpec:
      a {w_mm,h_mm} box (min/max band applies to each dimension) or one of
      `enumValues` ("built-in" | "spigots") — edited via the airway control. */
  type: "number" | "string" | "enum" | "tags" | "opening";
  enumValues?: readonly string[];
  /** number only — inclusive sanity band (broad; the real gate is validatePack) */
  min?: number;
  max?: number;
  integer?: boolean;
}

const PHASES = ["1", "3"] as const;

// broad reusable bands
const KW = { min: 0.1, max: 200 } as const;
const MM = { min: 1, max: 5000 } as const;
const CONN = { min: 1, max: 100 } as const;
const DBA = { min: 10, max: 90 } as const;
const KG = { min: 0.1, max: 2000 } as const;
const INDEX = { min: 1, max: 2000, integer: true } as const;
const AMPS = { min: 0.1, max: 200 } as const;

/** non-box OpeningSpec answers (see schema.ts: integral return / factory spigots) */
const OPENING_ALTS = ["built-in", "spigots"] as const;

/** IndoorUnit.filter — integral washable vs supplied by others */
const FILTER_TYPES = ["built-in", "field-supplied"] as const;

/** IndoorUnit condensate drainage (see schema.ts) */
const DRAIN_PRESSURES = ["positive", "negative"] as const;
const DRAIN_PUMPS = ["built-in", "none"] as const;

export const EDITABLE_FIELDS: readonly EditableFieldSpec[] = [
  // ── indoor units ──
  { section: "indoor_units", field: "capacity_cool_kw", label: "Cooling capacity", unit: "kW", type: "number", ...KW },
  { section: "indoor_units", field: "capacity_heat_kw", label: "Heating capacity", unit: "kW", type: "number", ...KW },
  { section: "indoor_units", field: "capacity_index", label: "Capacity index", type: "number", ...INDEX },
  { section: "indoor_units", field: "airflow_ls", label: "Airflow (Hi)", unit: "L/s", type: "number", min: 1, max: 2000 },
  { section: "indoor_units", field: "static_pressure_pa", label: "External static", unit: "Pa", type: "number", min: 0, max: 500 },
  { section: "indoor_units", field: "filter", label: "Filter", type: "enum", enumValues: FILTER_TYPES },
  // airway openings (ducted forms) — {w_mm,h_mm} box or built-in/spigots;
  // Tier-1 for the ducted role (they size the plenum base, ducted spec §1b)
  { section: "indoor_units", field: "supply_opening", label: "Supply airway", unit: "mm", type: "opening", enumValues: OPENING_ALTS, ...MM },
  { section: "indoor_units", field: "return_opening", label: "Return airway", unit: "mm", type: "opening", enumValues: OPENING_ALTS, ...MM },
  { section: "indoor_units", field: "drain_pressure", label: "Drain pressure", type: "enum", enumValues: DRAIN_PRESSURES },
  { section: "indoor_units", field: "drain_pump", label: "Drain pump", type: "enum", enumValues: DRAIN_PUMPS },
  { section: "indoor_units", field: "conn_liquid_mm", label: "Liquid connection", unit: "mm", type: "number", ...CONN },
  { section: "indoor_units", field: "conn_gas_mm", label: "Gas connection", unit: "mm", type: "number", ...CONN },
  { section: "indoor_units", field: "width_mm", label: "Width", unit: "mm", type: "number", ...MM },
  { section: "indoor_units", field: "depth_mm", label: "Depth", unit: "mm", type: "number", ...MM },
  { section: "indoor_units", field: "height_mm", label: "Height", unit: "mm", type: "number", ...MM },
  { section: "indoor_units", field: "sound_low_dba", label: "Sound (Lo)", unit: "dBA", type: "number", ...DBA },
  { section: "indoor_units", field: "sound_high_dba", label: "Sound (Hi)", unit: "dBA", type: "number", ...DBA },
  { section: "indoor_units", field: "weight_kg", label: "Weight", unit: "kg", type: "number", ...KG },
  { section: "indoor_units", field: "power_supply", label: "Power supply", type: "string" },
  { section: "indoor_units", field: "phase", label: "Phase", type: "enum", enumValues: PHASES },
  { section: "indoor_units", field: "max_amps_a", label: "Max running amps", unit: "A", type: "number", ...AMPS },
  { section: "indoor_units", field: "refrigerant", label: "Refrigerant", type: "enum", enumValues: REFRIGERANTS },
  // system membership tags (the branch-box story: a split wall unit can also
  // serve multi/VRF once the rules allow it). ODU system_type stays fixed —
  // an outdoor unit IS one system.
  { section: "indoor_units", field: "system_roles", label: "System tags", type: "tags", enumValues: SYSTEM_ROLES },

  // ── outdoor units ──
  { section: "outdoor_units", field: "capacity_cool_kw", label: "Cooling capacity", unit: "kW", type: "number", ...KW },
  { section: "outdoor_units", field: "capacity_heat_kw", label: "Heating capacity", unit: "kW", type: "number", ...KW },
  { section: "outdoor_units", field: "hp", label: "Horsepower", unit: "HP", type: "number", min: 0.1, max: 100 },
  { section: "outdoor_units", field: "capacity_index", label: "Capacity index", type: "number", ...INDEX },
  { section: "outdoor_units", field: "phase", label: "Phase", type: "enum", enumValues: PHASES },
  { section: "outdoor_units", field: "power_supply", label: "Power supply", type: "string" },
  { section: "outdoor_units", field: "max_amps_a", label: "Max running amps", unit: "A", type: "number", ...AMPS },
  { section: "outdoor_units", field: "mca_a", label: "MCA (circuit sizing)", unit: "A", type: "number", ...AMPS },
  { section: "outdoor_units", field: "conn_liquid_mm", label: "Liquid connection", unit: "mm", type: "number", ...CONN },
  { section: "outdoor_units", field: "conn_gas_mm", label: "Gas connection", unit: "mm", type: "number", ...CONN },
  { section: "outdoor_units", field: "precharged_kg", label: "Pre-charged", unit: "kg", type: "number", min: 0, max: 100 },
  { section: "outdoor_units", field: "max_charge_kg", label: "Max charge", unit: "kg", type: "number", min: 0, max: 100 },
  { section: "outdoor_units", field: "ports", label: "Ports", type: "number", min: 1, max: 64, integer: true },
  { section: "outdoor_units", field: "ratio_min_pct", label: "Ratio min", unit: "%", type: "number", min: 1, max: 500 },
  { section: "outdoor_units", field: "ratio_max_pct", label: "Ratio max", unit: "%", type: "number", min: 1, max: 500 },
  { section: "outdoor_units", field: "max_idus", label: "Max IDUs", type: "number", min: 1, max: 200, integer: true },
  { section: "outdoor_units", field: "idu_index_min", label: "IDU index min", type: "number", ...INDEX },
  { section: "outdoor_units", field: "idu_index_max", label: "IDU index max", type: "number", ...INDEX },
  { section: "outdoor_units", field: "pipe_table_ref", label: "Pipe table ref", type: "string" },
  { section: "outdoor_units", field: "width_mm", label: "Width", unit: "mm", type: "number", ...MM },
  { section: "outdoor_units", field: "depth_mm", label: "Depth", unit: "mm", type: "number", ...MM },
  { section: "outdoor_units", field: "height_mm", label: "Height", unit: "mm", type: "number", ...MM },
  { section: "outdoor_units", field: "sound_low_dba", label: "Sound (Lo)", unit: "dBA", type: "number", ...DBA },
  { section: "outdoor_units", field: "sound_high_dba", label: "Sound (Hi)", unit: "dBA", type: "number", ...DBA },
  { section: "outdoor_units", field: "weight_kg", label: "Weight", unit: "kg", type: "number", ...KG },
  { section: "outdoor_units", field: "refrigerant", label: "Refrigerant", type: "enum", enumValues: REFRIGERANTS },

  // ── pair tables ──
  { section: "pair_tables", field: "pipe_liquid_mm", label: "Pipe liquid", unit: "mm", type: "number", ...CONN },
  { section: "pair_tables", field: "pipe_gas_mm", label: "Pipe gas", unit: "mm", type: "number", ...CONN },
  { section: "pair_tables", field: "max_length_m", label: "Max length", unit: "m", type: "number", min: 1, max: 1000 },
  { section: "pair_tables", field: "max_lift_m", label: "Max lift", unit: "m", type: "number", min: 1, max: 1000 },
  { section: "pair_tables", field: "rated_cool_kw", label: "Rated cooling", unit: "kW", type: "number", ...KW },
  { section: "pair_tables", field: "rated_heat_kw", label: "Rated heating", unit: "kW", type: "number", ...KW },
];

const BY_KEY = new Map<string, EditableFieldSpec>(
  EDITABLE_FIELDS.map((f) => [`${f.section}:${f.field}`, f])
);

/** The editable-field spec for a section+field, or undefined if not editable. */
export function fieldSpec(
  section: string,
  field: string
): EditableFieldSpec | undefined {
  return BY_KEY.get(`${section}:${field}`);
}

export type FieldValue = number | string | string[] | OpeningBox;

export type ParseResult =
  | { ok: true; value: FieldValue }
  | { ok: false; error: string };

/** Validate an already-typed value against a spec. Used by the server action,
    which receives JSON values. */
export function validateFieldValue(
  spec: EditableFieldSpec,
  value: unknown
): ParseResult {
  if (spec.type === "tags") {
    if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
      return { ok: false, error: "Must be a list of tags" };
    }
    const cleaned = [...new Set(value.map((v) => (v as string).trim()))].filter(Boolean);
    if (cleaned.length === 0) {
      return { ok: false, error: "At least one tag is required" };
    }
    const bad = cleaned.find((v) => !spec.enumValues?.includes(v));
    if (bad) {
      return { ok: false, error: `Unknown tag "${bad}" — must be one of: ${spec.enumValues?.join(", ")}` };
    }
    return { ok: true, value: cleaned };
  }
  if (spec.type === "opening") {
    if (typeof value === "string") {
      const v = value.trim();
      if (spec.enumValues?.includes(v)) return { ok: true, value: v };
      return { ok: false, error: `Must be W × H in mm, or one of: ${spec.enumValues?.join(", ")}` };
    }
    if (isOpeningBox(value)) {
      const bad = (n: number) =>
        (spec.min !== undefined && n < spec.min) || (spec.max !== undefined && n > spec.max);
      if (bad(value.w_mm) || bad(value.h_mm)) {
        return { ok: false, error: `Width and height must be ${spec.min}–${spec.max} mm` };
      }
      // fresh two-key object — strips any stray keys from the caller
      return { ok: true, value: { w_mm: value.w_mm, h_mm: value.h_mm } };
    }
    return { ok: false, error: "Must be W × H in mm, built-in, or spigots" };
  }
  if (spec.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, error: "Must be a number" };
    }
    if (spec.integer && !Number.isInteger(value)) {
      return { ok: false, error: "Must be a whole number" };
    }
    if (spec.min !== undefined && value < spec.min) {
      return { ok: false, error: `Must be ≥ ${spec.min}` };
    }
    if (spec.max !== undefined && value > spec.max) {
      return { ok: false, error: `Must be ≤ ${spec.max}` };
    }
    return { ok: true, value };
  }
  if (typeof value !== "string") return { ok: false, error: "Must be text" };
  const v = value.trim();
  if (!v) return { ok: false, error: "Required" };
  if (spec.type === "enum" && !spec.enumValues?.includes(v)) {
    return { ok: false, error: `Must be one of: ${spec.enumValues?.join(", ")}` };
  }
  return { ok: true, value: v };
}

/** Parse a raw UI string into a validated value for a spec. Used client-side in
    the popover editor before the value is sent to the server. (Tags are edited
    via checkboxes, not text — validate those with validateFieldValue directly.) */
export function parseFieldInput(spec: EditableFieldSpec, raw: string): ParseResult {
  if (spec.type === "tags") {
    return { ok: false, error: "Tags are edited via the tag control" };
  }
  if (spec.type === "opening") {
    return { ok: false, error: "Airways are edited via the airway control" };
  }
  if (spec.type === "number") {
    const t = raw.trim();
    if (!t) return { ok: false, error: "Required" };
    const n = Number(t);
    if (!Number.isFinite(n)) return { ok: false, error: "Must be a number" };
    return validateFieldValue(spec, n);
  }
  return validateFieldValue(spec, raw);
}
