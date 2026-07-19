/* Design Studio — universal data-pack schema (Stage 2).
   The single structure every data book is transcribed into, and the only thing
   the engine ever reads (universal-table-schema.md). Pure types + pure helpers:
   no React, no canvas, no network. A pack is a set of linked sections; the
   engine resolves cross-references on design events and never reads a book.

   Canonical units, one each (never store imperial — it's a display map):
     capacity kW · airflow L/s · pressure Pa · length m · pipe/duct mm ·
     charge g/m · dimensions mm.

   Design pins the pack version it was built against (document.ts `packPins`),
   so an old job never silently changes when a pack is revised. */

import type { Plane } from "../document";

/** Bump when the *pack* shape changes (independent of the design SCHEMA_VERSION). */
export const PACK_SCHEMA_VERSION = 1;

/* ────────────────────────── shared value types ────────────────────────── */

export type FormFactor =
  | "wall"
  | "ducted"
  | "cassette-4way"
  | "cassette-2way"
  | "cassette-1way"
  | "cassette-compact"
  | "under-ceiling"
  | "floor-console"
  | "floor-concealed"
  | "bulkhead";

export const FORM_FACTORS: readonly FormFactor[] = [
  "wall",
  "ducted",
  "cassette-4way",
  "cassette-2way", // e.g. PLFY-P VLMD-E — added additively (no force-fit); data is a follow-on
  "cassette-1way",
  "cassette-compact",
  "under-ceiling",
  "floor-console",
  "floor-concealed",
  "bulkhead",
];

/** Contexts a model may serve in. A model can be engine-ready for one and not
    another (a ducted IDU usable in a 1:1 pair but not VRF until its index is
    entered). See ready.ts for the computed flags. */
export type SystemRole = "split-pair" | "multi" | "vrf";
export const SYSTEM_ROLES: readonly SystemRole[] = ["split-pair", "multi", "vrf"];

export type SystemType = "split" | "multi" | "vrf";

/** Electrical supply phase — single (230V 1N~) or three (400V 3N~). */
export type Phase = "1" | "3";

export type Refrigerant = "R32" | "R410A" | "R454B" | "R290" | "R32/R410A";
export const REFRIGERANTS: readonly Refrigerant[] = [
  "R32",
  "R410A",
  "R454B",
  "R290",
  "R32/R410A",
];

/** Every value carries provenance. Legacy VRF-builder imports are `legacy-ductr`
    until verified against a book. `extracted` shows book/edition/page for
    verification; `user-entered` records who/when (trust + liability). */
export interface Provenance {
  kind: "extracted" | "user-entered" | "legacy-ductr";
  /** book / brochure title, or "legacy-ductr" */
  source: string;
  edition?: string;
  /** printed page(s), e.g. "2" or "139-141" */
  page?: string;
  /** user-entered only */
  by?: string;
  at?: string; // ISO
}

/* ───────────────── typed rule blocks (method + parameters) ─────────────────
   Books agree on *what* to answer but not *how* they specify it. Each concept
   is a discriminated object; the engine ships one evaluator per method. A book
   using an unsupported method is a schema-extension task (add an evaluator,
   additively), never a force-fit. (universal-table-schema.md — rule blocks.) */

/** Extra refrigerant for pipe runs. */
export type AdditionalChargeRule =
  | {
      method: "per_meter_by_liquid_size";
      /** liquid-pipe mm (as string key) → g per metre */
      rates: Record<string, number>;
      /** metres of liquid pipe covered by the factory pre-charge */
      precharged_allowance_m?: number;
    }
  | {
      method: "formula_coefficients";
      terms: { liquid_mm: number; coeff_g_per_m: number }[];
      deduction_g?: number;
      min_charge_g?: number;
    }
  | { method: "threshold_then_rate"; free_up_to_m: number; g_per_m_beyond: number }
  | { method: "fixed_per_idu"; /** idu-size key → grams */ table: Record<string, number> }
  | { method: "none_required" };

export const ADDITIONAL_CHARGE_METHODS = [
  "per_meter_by_liquid_size",
  "formula_coefficients",
  "threshold_then_rate",
  "fixed_per_idu",
  "none_required",
] as const;

/** Which IDUs an ODU accepts. Methods compose — all present blocks must pass. */
export type CompatibilityRule =
  | { method: "explicit_combination_table"; combos: string[][] }
  | {
      method: "family_whitelist_with_limits";
      families: string[];
      max_count?: number;
      capacity_min_kw?: number;
      capacity_max_kw?: number;
      index_min?: number;
      index_max?: number;
      per_port_max_kw?: number;
    }
  | {
      method: "index_ratio_band";
      ratio_min_pct: number;
      ratio_max_pct: number;
      max_idus: number;
      index_min?: number;
      index_max?: number;
    };

export const COMPATIBILITY_METHODS = [
  "explicit_combination_table",
  "family_whitelist_with_limits",
  "index_ratio_band",
] as const;

/** Refrigerant pipe size for a segment, by what the book keys off. */
export type PipeSizingRule =
  | {
      method: "size_by_downstream_index";
      /** ordered ascending by index_max; first row whose index_max ≥ downstream index wins */
      steps: { index_max: number; liquid_mm: number; gas_mm: number }[];
    }
  | {
      method: "size_by_downstream_kw";
      steps: { kw_max: number; liquid_mm: number; gas_mm: number }[];
    };

export const PIPE_SIZING_METHODS = [
  "size_by_downstream_index",
  "size_by_downstream_kw",
] as const;

/* ───────────────────────────── sections ───────────────────────────── */

/** §1 brands */
export interface Brand {
  id: string; // kebab, unique
  name: string;
  regions?: string[];
  notes?: string;
}

/** the unit's air opening from the data book (ducted spec §1b): `{w,h}` mm
    sizes the plenum base (NOT the unit width); `"built-in"` = integral
    return; `"spigots"` = factory spigots on the opening; `"open"` = a bare or
    filtered face that takes a duct but has no published opening size, so the
    installer sizes the plenum on site (it renders as the grey derived
    default, exactly like an absent opening — the difference is that "open" is
    a positive answer and satisfies the ducted role). Brand-agnostic. */
export type OpeningSpec =
  | { w_mm: number; h_mm: number }
  | "built-in"
  | "spigots"
  | "open";

/** §2 indoor units — the largest section, one row per model. */
export interface IndoorUnit {
  model: string; // exact code, unique per brand
  brand: string; // → Brand.id
  series: string;
  form_factor: FormFactor;
  capacity_cool_kw: number;
  capacity_heat_kw: number;
  /** brand index (Mitsubishi P-number). Required for VRF/multi roles. */
  capacity_index?: number;
  /** nominal (high) airflow. Required for ducted/vent roles. */
  airflow_ls?: number;
  /** external static, numeric Pa. Required for ducted forms (v1: optional — no ESP check yet). */
  static_pressure_pa?: number;
  /** data-book air openings for ducted forms — size the plenum base per
      ducted spec §1b; absent → grey derived default (never the unit width). */
  supply_opening?: OpeningSpec;
  return_opening?: OpeningSpec;
  /** return-air filter: "built-in" (integral washable) vs "field-supplied"
      (by others — typical for ducted forms). Tier-3 — never gates readiness. */
  filter?: "built-in" | "field-supplied";
  /** condensate drainage: which pressure side the drain connection sits on
      ("negative" needs the deeper trap) and whether a lift pump is integral.
      Both Tier-3 — installer info, never gate readiness.

      `drain_pressure` is STAFF-ENTERED, not extracted: no Mitsubishi document
      states it, so it is left out of the HQ "nice-to-know" gap list (see
      lib/hq/catalog.ts) and simply stays editable per row. `drain_pump` IS
      published and is extracted normally. */
  drain_pressure?: "positive" | "negative";
  drain_pump?: "built-in" | "none";
  conn_liquid_mm: number;
  conn_gas_mm: number;
  conn_condensate?: string;
  default_plane: Plane;
  allowed_planes: Plane[];
  system_roles: SystemRole[];
  refrigerant: Refrigerant;
  phase?: Phase;
  power_supply?: string;
  /** max running current, amps (Tier-3 — electrical planning nicety, never gates readiness) */
  max_amps_a?: number;
  width_mm: number;
  depth_mm: number;
  height_mm: number;
  /** sound pressure (SPL dBA) across fan speeds: low = the published Lo-fan
      figure, high = the Hi-fan figure. A sheet that publishes ONE figure fills
      `sound_high_dba` only — `sound_low_dba` is never derived. */
  sound_low_dba?: number;
  sound_high_dba?: number;
  weight_kg?: number;
  provenance: Provenance;
}

/** §3 outdoor units. Split ODUs exist via `pair_tables` but still get a row. */
export interface OutdoorUnit {
  model: string;
  brand: string;
  series: string;
  system_type: SystemType;
  capacity_cool_kw: number;
  capacity_heat_kw: number;
  hp?: number;
  capacity_index?: number; // required for VRF
  phase: Phase;
  /** exact supply wording from the sheet, e.g. "230V 1N~ 50Hz" / "400V 3N~ 50Hz" */
  power_supply?: string;
  /** max running current, amps (Tier-3 — electrical planning nicety, never gates readiness) */
  max_amps_a?: number;
  /** max circuit amps — the circuit-SIZING figure (≈125% of the largest motor
      plus the rest), NOT a running current. Kept separate from `max_amps_a`
      because some sheets publish only one of the two: the City Multi book
      (MEES21K067) prints MCA and rated running current but never a max
      operating current, while the Mr Slim book prints the reverse. Tier-3. */
  mca_a?: number;
  conn_liquid_mm: number;
  conn_gas_mm: number;
  refrigerant: Refrigerant;
  precharged_kg?: number;
  max_charge_kg?: number;
  /* multi only */
  ports?: number;
  branch_box_required?: boolean;
  /* vrf/multi connectable envelope */
  ratio_min_pct?: number;
  ratio_max_pct?: number;
  max_idus?: number;
  idu_index_min?: number;
  idu_index_max?: number;
  /** → vrf_pipe_tables.series | multi_rules.odu_model — the sizing engine follows this */
  pipe_table_ref?: string;
  /* ── combined multi-module banks (SEAM, not yet built) ──
     Twin/triple ODUs (Mitsubishi PUHY YSNW, future Daikin multi-module VRV) are
     N single-module units + a twinning kit. Absent/false = an atomic unit.
     Leaving the slot here means those banks arrive as DATA + a small resolver
     later, never a reshape of the single-module rows. See design notes. */
  combined?: boolean;
  /** constituent single-module OutdoorUnit.model refs (≥2 when combined) */
  modules?: string[];
  /** → parts.model with part_type "twinning-kit" */
  twinning_kit_ref?: string;
  width_mm?: number;
  depth_mm?: number;
  height_mm?: number;
  /** SPL dBA — same convention as IndoorUnit: single published figure → high only */
  sound_low_dba?: number;
  sound_high_dba?: number;
  weight_kg?: number;
  provenance: Provenance;
}

/** §4 pair tables (split 1:1) — the split engine reads only this for matching. */
export interface PairTable {
  idu_model: string; // → IndoorUnit.model
  odu_model: string; // → OutdoorUnit.model
  pipe_liquid_mm: number;
  pipe_gas_mm: number;
  max_length_m: number;
  max_lift_m: number;
  additional_charge: AdditionalChargeRule;
  rated_cool_kw?: number;
  rated_heat_kw?: number;
  provenance: Provenance;
}

/** §5 multi rules (per multi ODU / series). */
export interface MultiRule {
  odu_model_ref: string; // → OutdoorUnit.model
  /** per-port pipe sizes, or sizing by connected IDU size */
  port_pipe_sizes: { liquid_mm: number; gas_mm: number }[];
  compatibility: CompatibilityRule[];
  max_total_pipe_m: number;
  max_per_branch_m: number;
  max_lift_m: number;
  additional_charge: AdditionalChargeRule;
  /** branch-box part models (→ parts.model) */
  branch_box_refs?: string[];
  provenance: Provenance;
}

/** §6 vrf pipe tables (per series) — the topology engine's lookup target. */
export interface VrfLimits {
  max_total_m: number;
  max_farthest_actual_m: number;
  max_farthest_equiv_m: number;
  max_after_first_joint_m: number;
  max_lift_odu_above_m: number;
  max_lift_odu_below_m: number;
  max_lift_idu_idu_m: number;
}

export interface VrfPipeTable {
  series: string; // → OutdoorUnit.pipe_table_ref
  /** the MAIN / between-joints run, by total downstream index (Mitsubishi
      Table 2 "B,C,D,E"). First step whose index_max ≥ downstream index wins. */
  pipe_sizing: PipeSizingRule;
  /** the TERMINAL branch (last joint → indoor unit), sized by that ONE IDU's
      index — distinct from `pipe_sizing` (Mitsubishi Table 3 "a…g": a P10–P50
      branch is smaller than the same index summed downstream in Table 2).
      Optional: brands that use a single table omit it and the engine reuses
      `pipe_sizing`. */
  branch_sizing?: PipeSizingRule;
  /** ODU → 1st joint ("A"). Optional: Mitsubishi's Table 1 equals the ODU's
      own connection sizes, so the engine defaults to those when absent; only
      brands that publish a separate main-selection rule fill this. */
  odu_to_first_joint?: PipeSizingRule;
  /** joint part by downstream index; optional first-joint-by-ODU override table */
  joint_selection: {
    steps: { index_max: number; part_ref: string }[];
    first_joint_by_odu?: Record<string, string>;
  };
  /** header part by branch count + downstream index (where the brand offers headers) */
  header_selection?: {
    steps: { branches_max: number; index_max: number; part_ref: string }[];
  };
  limits: VrfLimits;
  additional_charge: AdditionalChargeRule;
  provenance: Provenance;
}

/** §7 parts — fittings & control boxes, one section, typed rows. */
export type PartType =
  | "joint"
  | "header"
  | "bc-box"
  | "branch-box"
  | "reducer"
  | "flare-adaptor"
  | "twinning-kit";

export interface Part {
  part_type: PartType;
  model: string; // unique per brand
  brand: string;
  /** joints: [index_min?, index_max]; headers: branches + index; boxes: ports + max index/kw */
  index_max?: number;
  branches?: number;
  ports?: number;
  max_kw?: number;
  width_mm?: number;
  depth_mm?: number;
  height_mm?: number;
  provenance: Provenance;
}

/** §8 grilles — vendor-agnostic (brand optional). Not filled by this pack. */
export interface Grille {
  model: string;
  brand?: string;
  style: string;
  size: string;
  airflow_min_ls: number;
  airflow_max_ls: number;
  mount: "ceiling" | "wall" | "floor";
  type: "supply" | "return" | "transfer";
  finish?: string;
  provenance: Provenance;
}

/** §9 duct components. Not filled by this pack. */
export interface DuctComponent {
  kind: "flex" | "rigid" | "fitting";
  diameter_mm?: number;
  width_mm?: number;
  height_mm?: number;
  max_airflow_ls?: number;
  insulation?: string;
  provenance: Provenance;
}

/** §10 zoning controllers. Not filled by this pack. */
export interface ZoningController {
  vendor: string;
  model: string;
  max_zones: number;
  damper_part_refs: Record<string, string>;
  sensor_options: string[];
  expansion_rules?: string;
  compatible_brands?: string[];
  provenance: Provenance;
}

/** §11 ventilation units. Not filled by this pack. */
export interface VentilationUnit {
  model: string;
  brand: string;
  vent_type: "exhaust" | "supply" | "lossnay-erv" | "hrv" | "inline" | "underfloor";
  airflow_ls: number;
  airflow_extract_ls?: number;
  duct_conn_mm: number;
  static_pa?: number;
  provenance: Provenance;
}

/** §12 accessories. */
export interface Accessory {
  model: string;
  brand: string;
  category:
    | "wifi"
    | "wired-controller"
    | "condensate-pump"
    | "filter"
    | "drain-kit"
    | "mounting";
  /** unit model list or family patterns (validated) */
  compatible_with: string[];
  description?: string;
  provenance: Provenance;
}

/** §13 consumables — materials backbone, mostly brand-independent. */
export interface Consumable {
  kind: "pipe" | "cable" | "drain" | "fixings" | "tape";
  size?: string;
  description?: string;
  provenance: Provenance;
}

/* ─────────────────────────── the pack ─────────────────────────── */

export interface PackMeta {
  brand: string; // → Brand.id
  version: string; // e.g. "2026.1"
  packSchemaVersion: number;
  name: string;
  /** how each source book was obtained — copyright posture (public vs dealer portal) */
  sources?: { title: string; edition?: string; access?: "public" | "dealer-portal" }[];
}

/** All sections. Brand packs fill unit/table sections; shared packs fill
    grilles/ducts/zoning/consumables. The loader merges (overlay over base). */
export interface DataPack {
  meta: PackMeta;
  brands: Brand[];
  indoor_units: IndoorUnit[];
  outdoor_units: OutdoorUnit[];
  pair_tables: PairTable[];
  multi_rules: MultiRule[];
  vrf_pipe_tables: VrfPipeTable[];
  parts: Part[];
  grilles: Grille[];
  duct_components: DuctComponent[];
  zoning_controllers: ZoningController[];
  ventilation_units: VentilationUnit[];
  accessories: Accessory[];
  consumables: Consumable[];
}

/** The section keys that carry rows (everything but `meta`). */
export const PACK_SECTIONS = [
  "brands",
  "indoor_units",
  "outdoor_units",
  "pair_tables",
  "multi_rules",
  "vrf_pipe_tables",
  "parts",
  "grilles",
  "duct_components",
  "zoning_controllers",
  "ventilation_units",
  "accessories",
  "consumables",
] as const;

export type PackSection = (typeof PACK_SECTIONS)[number];

/** An empty pack at the current schema version — the base for merges and a
    convenient seed in tests. */
export function emptyPack(meta: PackMeta): DataPack {
  return {
    meta,
    brands: [],
    indoor_units: [],
    outdoor_units: [],
    pair_tables: [],
    multi_rules: [],
    vrf_pipe_tables: [],
    parts: [],
    grilles: [],
    duct_components: [],
    zoning_controllers: [],
    ventilation_units: [],
    accessories: [],
    consumables: [],
  };
}
