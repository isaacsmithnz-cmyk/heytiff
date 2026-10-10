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
      /** a computed charge: metres of liquid pipe per size × its coefficient,
          less a deduction, never under `min_charge_g`. On a pair the run's one
          size; on a VRF network every size's metres added up (vrf-tree.ts).
          MHI KX Micro (KX-T-374 p.21): P = standard 3.2 kg + L(φ9.52) × 0.050
          + L(φ6.35) × 0.020 − factory 4.2 kg, nothing when negative →
          terms 9.52: 50, 6.35: 20, deduction_g 1000, min_charge_g 0. */
      method: "formula_coefficients";
      terms: { liquid_mm: number; coeff_g_per_m: number }[];
      deduction_g?: number;
      min_charge_g?: number;
      /** a VRF network's heads term, added after the floor: grams per point
          by which the connected heads' capacity indexes added up exceed the
          outdoor's own index, nothing when they don't. KX-T-374 p.21: "I = D ×
          0.005", D = total indoor capacity − outdoor capacity → 5. A one-run
          (pair) charge has no connected index, so a rule carrying this gives
          no figure there. */
      plus_per_index_over_odu_g?: number;
      /** the total rounded to the NEAREST step ("rounding to the nearest
          0.1kg" → 100) */
      round_g?: number;
    }
  | { method: "threshold_then_rate"; free_up_to_m: number; g_per_m_beyond: number }
  | { method: "fixed_per_idu"; /** idu-size key → grams */ table: Record<string, number> }
  | {
      /** a VRF system's charge (Mitsubishi City Multi, e.g. MEES21K029 p.143):
          metres of liquid pipe per size × a rate that depends on how far the
          farthest indoor unit is, plus a fixed amount by the total connected
          index, plus a fixed amount per outdoor, plus named indoor units' own
          adders. The sum rounds UP to `round_up_g`. */
      method: "per_meter_by_liquid_size_by_farthest";
      /** ascending by farthest_m_max; the first band whose farthest_m_max ≥
          the outdoor → farthest indoor length wins (inclusive: the book's
          "30.5 m or shorter"); null = no upper bound. Rates: liquid mm (string
          key) → g per metre. */
      bands: { farthest_m_max: number | null; rates: Record<string, number> }[];
      /** ascending by index_max (inclusive); null = no upper bound */
      plus_by_connected_index?: { index_max: number | null; add_g: number }[];
      /** the same by the heads' rated cooling kW added up (PUMY p.86-87) */
      plus_by_connected_kw?: { kw_max: number | null; add_g: number }[];
      /** outdoor model → grams (the book prints the column even where it is 0) */
      plus_by_odu?: Record<string, number>;
      /** each connected indoor unit named here adds its grams */
      plus_per_idu?: { models: string[]; add_g: number }[];
      round_up_g?: number;
    }
  | {
      /** a FIXED amount per length band, not a rate — the book prints a table
          of kilograms by how long the pipe is. Daikin SkyAir R32 (EDAU282388
          p.112, RZA/RZAS/RZAV/RZAC): "Length for which additional charging is
          not required 30 m", then 40 m or less +0.35 kg, 50 m or less +0.70,
          60 m or less +1.05, 75 m or less +1.40, and "Impossible" past the
          last column. MHI FDCA160–250VSA-W ('24 PAC-DB-450 2.8): the same
          table read on its equivalent length Le, 30 < Le ≤ 40 m +0.44 kg …
          60 < Le ≤ 70 m +2.85 kg. */
      method: "stepped_by_length";
      /** at or under this many metres nothing is added (the factory charge
          covers it) */
      precharged_up_to_m: number;
      /** ascending by up_to_m, each INCLUSIVE ("40 m or less", "Le ≤ 40 m");
          a band runs from the one before it (or precharged_up_to_m) to its
          own up_to_m. Past the last band the book prints no amount — the run
          is outside the table, never extrapolated. */
      bands: { up_to_m: number; add_g: number }[];
      /** the liquid size the table is printed for (Daikin prints one per
          row). A run in another size has no figure. Absent = any size. */
      liquid_mm?: number;
      /** the bands are read on a WEIGHTED length, not metres of pipe: liquid
          mm (string key) → the weight each metre of that size counts for.
          MHI's Le ("equivalent length", PAC-DB-450): Le = L(12.7) + 0.52 ×
          L(9.52) → { "12.7": 1, "9.52": 0.52 }. It is a liquid-volume
          weighting, NOT a bends-and-fittings allowance. A size not listed has
          no figure. Absent = plain metres. */
      length_weights?: Record<string, number>;
    }
  | {
      /** a rate per metre of liquid pipe applied to the WHOLE length — never
          the length past an allowance — optionally only once the run is past
          a chargeless length, plus a fixed adder past a length. Daikin
          SkyAir R410A: RZQ (EDAU282226 p.128) "in case of the liquid piping
          lengths over chargeless piping length [30 m]", R = L(12.7) × 0.12 +
          L(9.5) × 0.059 kg; RZYQ (EDAU282301 p.88) R = Σ L × rate per size +
          A, where A = 0.7 kg (7–8 HP) or 1.0 kg (10 HP) once the piping is
          over 30 m. Both "rounded off in units of 0.1 kg". */
      method: "whole_length_by_liquid_size";
      /** liquid mm (string key) → g per metre, on every metre of that size */
      rates: Record<string, number>;
      /** at or under this length nothing is added; past it the rates apply to
          the whole length (RZQ 30). Absent = the rates always apply (RZYQ). */
      chargeless_up_to_m?: number;
      /** a fixed amount added once the run is past `over_m` (RZYQ's "A") */
      plus_past?: { over_m: number; add_g: number };
      /** the book rounds the result to the NEAREST step ("rounded off in units
          of 0.1 kg" → 100) */
      round_g?: number;
    }
  | { method: "none_required" };

export const ADDITIONAL_CHARGE_METHODS = [
  "per_meter_by_liquid_size",
  "formula_coefficients",
  "threshold_then_rate",
  "fixed_per_idu",
  "per_meter_by_liquid_size_by_farthest",
  "stepped_by_length",
  "whole_length_by_liquid_size",
  "none_required",
] as const;

/** Which IDUs an ODU accepts. Methods compose — all present blocks must pass. */
export type CompatibilityRule =
  | { method: "explicit_combination_table"; combos: string[][] }
  | {
      /** the book lists approved sets by SIZE CLASS, not by model — the ME
          multi-split form. Each combo is a sorted list of capacity codes
          (→ IndoorUnit.capacity_code); a set is approved when it is a
          sub-multiset of one listed combo. Carries its own provenance: the
          table often comes from a different book than the rest of the row. */
      method: "capacity_combination_table";
      combos: number[][];
      provenance?: Provenance;
    }
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
    }
  /* ── multi limits a book prints beside (or instead of) its table ──
     Each is optional and each composes with the rest: a brand that doesn't
     publish one leaves it out, and an absent block passes and refuses
     nothing. Where the rule also carries a combination table, the table is
     the capacity authority: a set it accepts is never refused by a head
     count's or a connected total's MAXIMUM, and a set it lists outright is
     never refused by their MINIMUM. The per-model limits (max_matching,
     excluded_combinations) are the book's own exceptions to its table and
     apply on top of it. Minimums are amber on a set still being built (it
     can grow into them); the verdict holds them against the system. */
  | {
      /** how many heads the outdoor takes. Daikin Super Multi NX: "A single
          indoor unit cannot be connected for the reverse cycle type"
          (PCRAU1729B p.58 note 4) → { min: 2 }. MHI SCM100ZS-W: "normally
          requires a minimum of 3", up to 5 → { min: 3, max: 5 } with the
          two-head sets its chart allows in `fewer_allowed`. */
      method: "head_count";
      min?: number;
      max?: number;
      /** sets the book allows BELOW `min`, each one head per slot: a set
          passes when its heads pair off one-to-one with an entry's slots. A
          slot is a HeadMatch; `{}` is any head. MHI SCM100 (compatibility
          chart, Jan 2026): 2 × SRK-ZSXA, or 1 × SRK-ZSXA + 1 × SRF35ZS, or
          1 × SRK71/80ZRA (DXK24/28ZRA) + any. */
      fewer_allowed?: HeadMatch[][];
      provenance?: Provenance;
    }
  | {
      /** the heads' capacities added up, within the book's bounds. Daikin
          4MXM80: "Total capacity of connected indoor units is … up to 14.5
          kW" (PCRAU1729B p.58 note 3) → { basis: "class_kw", max: 14.5 }.
          MHI SCM100: 9.0–16.0 kW → { basis: "class_kw", min: 9, max: 16 }.
          `class_kw` adds the size classes read as kW (capacity_code ÷ 10:
          a 25 is 2.5 kW, a 46 is 4.6), the form Daikin and MHI print ("2.5 kW
          Class", "Indoor Unit Standard Capacity"); `rated_cool_kw` adds the
          heads' rated cooling capacity, for a book that sums those. Never a
          ratio — a book that prints a ratio uses index_ratio_band. */
      method: "connected_capacity";
      basis: "class_kw" | "rated_cool_kw";
      min?: number;
      max?: number;
      provenance?: Provenance;
    }
  | {
      /** at most `max` heads of a kind on the outdoor. Fujitsu AOTH36/45KBTA5:
          "Up to 2 units of Medium static pressure duct are connectable to the
          combination. However, in the combination marked with *, only 1"
          (DR_MU034ES_01 f.10, f.16) → { match: { models: ["ARTH18KMTAP",
          "ARTH24KMTAP"] }, max: 2, in_combos: [{ combo: […], max: 1 }] }.
          MHI SCM100: in a 5-head set "SRK-ZSXA-W/WF, SRF35ZS-W, SRF50ZSX-W
          must be 4 or less" → { …, max: 4, from_heads: 5 }. */
      method: "max_matching";
      match: HeadMatch;
      /** the most such heads, wherever no `in_combos` entry applies; absent
          = no general limit */
      max?: number;
      /** the limit holds only on a set of this many heads or more */
      from_heads?: number;
      /** a combination's own limit: when the set's size classes are exactly
          this combo, its `max` applies instead (Fujitsu's "*" rows; on
          AOTH24KBCA3 combos 19, 23 and 30 take none, `max: 0`) */
      in_combos?: { combo: number[]; max: number }[];
      /** how a finding names these heads ("medium-static ducted") */
      label?: string;
      provenance?: Provenance;
    }
  | {
      /** sets the book rules out by size class, matched exactly — a set still
          being built can grow past them. MHI SCM100 "Combination of indoor
          units that are Not Possible": 20+20+20+20+71, 20+20+20+20+80,
          20+20+20+25+71, 20+20+20+50+50. */
      method: "excluded_combinations";
      combos: number[][];
      provenance?: Provenance;
    };

/** which heads a multi limit counts: model patterns (an exact model, or a
    prefix ending in `*`, model-glob.ts) and/or form factors. Every criterion
    given must hold; `{}` matches any head. */
export interface HeadMatch {
  models?: string[];
  form_factors?: FormFactor[];
}

export const COMPATIBILITY_METHODS = [
  "explicit_combination_table",
  "capacity_combination_table",
  "family_whitelist_with_limits",
  "index_ratio_band",
  "head_count",
  "connected_capacity",
  "max_matching",
  "excluded_combinations",
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

/** one published spigot group on a factory-spigot face — `2 × Ø400`. Books
    state the takeoffs rather than an opening size, so this IS the face's
    published dimension. Several groups only where a face mixes sizes. */
export interface SpigotGroup {
  count: number;
  dia_mm: number;
}

/** the unit's air opening from the data book (ducted spec §1b): `{w,h}` mm
    sizes the plenum base (NOT the unit width); `"built-in"` = integral
    return; `"open"` = a bare or filtered face that takes a duct but has no
    published opening size, so the installer sizes the plenum on site (it
    renders as the grey derived default, exactly like an absent opening — the
    difference is that "open" is a positive answer and satisfies the ducted
    role). Brand-agnostic.

    Factory spigots come in two grades, both meaning "no plenum — duct
    connects straight to the unit":
    - `{ spigots: [{count, dia_mm}] }` — the book published the takeoff sizes
      ("2 × Ø400"), so the canvas can draw them at true size and label them.
    - `"spigots"` — factory spigots confirmed, sizes NOT published (or not yet
      extracted). Positive answer, satisfies the ducted role; the canvas falls
      back to an airflow-derived fan of takeoffs, drawn as derived. Prefer the
      sized form whenever the book states the diameters. */
export type OpeningSpec =
  | { w_mm: number; h_mm: number }
  | { spigots: SpigotGroup[] }
  | "built-in"
  | "spigots"
  | "open";

/** the sized factory-spigot variant of OpeningSpec. Takes `unknown` — it
    narrows loosely-typed catalog/override values at their boundaries too. */
export function isSpigotOpening(o: unknown): o is { spigots: SpigotGroup[] } {
  return (
    typeof o === "object" &&
    o !== null &&
    Array.isArray((o as { spigots?: unknown }).spigots)
  );
}

/** does this face carry factory spigots (sized or not)? Both grades mean the
    duct connects to the unit itself — no plenum is fabricated. */
export function hasFactorySpigots(o: unknown): boolean {
  return o === "spigots" || isSpigotOpening(o);
}

/** flatten a sized spigot opening to one entry per physical takeoff; `[]` for
    every other opening kind (including the unsized `"spigots"`). */
export function spigotDiametersMm(o: unknown): number[] {
  if (!isSpigotOpening(o)) return [];
  const out: number[] = [];
  for (const g of o.spigots) {
    if (!Number.isFinite(g.count) || !Number.isFinite(g.dia_mm)) continue;
    for (let i = 0; i < Math.max(0, Math.round(g.count)); i++) out.push(g.dia_mm);
  }
  return out;
}

/** `2 × Ø400` / `2 × Ø400 · 1 × Ø300` — the face's published size, as the
    canvas and the HQ catalog both show it. Empty string when unsized. */
export function spigotLabel(o: unknown): string {
  if (!isSpigotOpening(o)) return "";
  return o.spigots
    .filter((g) => Number.isFinite(g.count) && Number.isFinite(g.dia_mm))
    .map((g) => `${Math.round(g.count)} × Ø${Math.round(g.dia_mm)}`)
    .join(", ");
}

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
  /** the size class printed in the model name — MSZ-AP35VGD2 → 35. NOT a
      restatement of capacity_cool_kw: three ME models differ (AP80 is 7.8 kW,
      LN60 is 6.1, SLZ-M60FA is 5.6), so a code derived at runtime would
      mis-key them silently. Combination tables key on this, never on kW. */
  capacity_code?: number;
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
  /** a lower top to the ratio once the system has this many heads or more —
      the lowest tier that applies wins over `ratio_max_pct`. MHI KX Micro (R32
      VRF brochure, Mar 2026, folio 25): 100–150%, but "When connecting 9
      units or more … 5HP : 110% or less, 6HP : 100% or less" → FDC140:
      [{ min_heads: 9, max_pct: 110 }], FDCA155: [{ min_heads: 9, max_pct:
      100 }]. Absent = the one top for every head count. */
  ratio_max_pct_by_heads?: { min_heads: number; max_pct: number }[];
  max_idus?: number;
  idu_index_min?: number;
  idu_index_max?: number;
  /** → vrf_pipe_tables.series | multi_rules.odu_model — the sizing engine follows this */
  pipe_table_ref?: string;
  /** what the ratio band counts: capacity index (City Multi PUHY, the
      default) or rated cooling kW (PUMY, M-P0860 p.2-7 "50 to 130% of outdoor
      unit capacity", the install manual's SP112 "6.3 – 16.2 kW") */
  ratio_basis?: "index" | "kw";
  /** a VRF that also takes heads on branch boxes (PUMY): the tables for a
      system on branch boxes only, and for a mixed one (vrf_pipe_tables.series) */
  branch_box_table_ref?: string;
  mixed_table_ref?: string;
  /** heads on branch boxes: how many boxes, the size range and count of box
      heads alone, and a mixed system's City Multi / box-head pairs per number
      of boxes (each pair a pair of maxima; any one pair may hold) */
  branch_boxes?: {
    max_boxes: number;
    code_min: number;
    code_max: number;
    max_heads: number;
    mixed: { boxes: number; city_multi: number; box_heads: number }[];
    /** the indoor families a box port takes, as model globs ("MSZ-AP*"):
        the book's list for this outdoor */
    families: string[];
    /** families staff have confirmed beyond the book's list */
    staff_families?: { patterns: string[]; by: string; at: string };
  };
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
  /** the most height between any two of this outdoor's heads, as printed:
      Daikin Super Multi NX "7.5 (between Indoor Units)" (EDTAU122219A),
      Fujitsu AOTH24–45KB 10 m (DR_MU034ES_01). Judged on where
      the heads are placed on the plan (floor + height on it); heads not
      placed aren't judged. Absent = not recorded, nothing checked. */
  max_lift_idu_idu_m?: number;
  additional_charge: AdditionalChargeRule;
  /** branch-box part models (→ parts.model) */
  branch_box_refs?: string[];
  provenance: Provenance;
}

/** §6 vrf pipe tables (per series) — the topology engine's lookup target. */
export interface VrfLimits {
  max_total_m: number;
  max_farthest_actual_m: number;
  /** judged on the EQUIVALENT length: actual + bend_equiv_m_by_odu × bends;
      absent where the book limits bends by count instead (PUMY) */
  max_farthest_equiv_m?: number;
  /** absent where the book sets none (a branch-box system) */
  max_after_first_joint_m?: number;
  max_lift_odu_above_m: number;
  max_lift_odu_below_m: number;
  max_lift_idu_idu_m: number;
  /** outdoor model → metres each bend adds to a run's equivalent length */
  bend_equiv_m_by_odu?: Record<string, number>;
  /** after-first-joint may reach this when the LIQUID pipe goes one size up
      from the section where max_after_first_joint_m is exceeded, and all of
      the piping after it */
  extended_after_first_joint_m?: number;
  /** indoor-to-indoor height may reach this when the liquid pipes to the
      units past max_lift_idu_idu_m go one size up */
  extended_lift_idu_idu_m?: number;
  /* branch boxes (PUMY M-P0860 p.75-85) */
  /** the outdoor to its farthest branch box, along the mains */
  max_odu_to_box_m?: number;
  /** the first joint to the farthest branch box */
  max_first_joint_to_box_m?: number;
  /** the outdoor to the farthest head reached through a branch box */
  max_farthest_via_box_m?: number;
  /** a branch box to its farthest head */
  max_after_box_m?: number;
  /** every branch box → head pipe added up */
  max_box_to_heads_total_m?: number;
  /** corners on any one path from the outdoor to a head */
  max_bends_per_path?: number;
  /** height between branch boxes (h2) */
  max_box_box_lift_m?: number;
  /** height between the heads on one branch box (h3) */
  max_box_heads_lift_m?: number;
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
  /** which connection this table is for: joints and headers only (the
      default), branch boxes only, or both at once (PUMY M-P0860 §11-2) */
  method?: "joint" | "branch-box" | "mixed";
  /** a section is never larger than the one before it (PUHY p.140 Note 5);
      false where the book does not say so (PUMY) */
  downstream_not_larger?: boolean;
  /** the book's conditional liquid sizes (PUMY p.77-84): when the farthest
      head from the outdoor is past `farthest_over_m`, or the farthest branch
      box along the mains is past `to_box_over_m`, or a head of one of
      `heads_index` is on the system, the named sections take `liquid_mm`
      (any one condition is enough) */
  liquid_step_ups?: {
    farthest_over_m?: number;
    to_box_over_m?: number;
    heads_index?: number[];
    liquid_mm: number;
    roles: ("main" | "between")[];
  }[];
  /** a City Multi head's own pipe goes to `liquid_mm` when it is under
      `below_index` and the farthest head is past `after_first_joint_over_m`
      from the first joint (PUMY p.76 *) */
  branch_step_ups?: { below_index: number; after_first_joint_over_m: number; liquid_mm: number }[];
  /** a head on a branch box: its pipe by its series (the first letter of its
      model, M, S or P: Isaac, 2026-09-28) and model number (kW type). A row
      the book doesn't print carries its own provenance. */
  box_head_sizing?: {
    series: "M" | "S" | "P";
    code_min: number;
    code_max: number;
    liquid_mm: number;
    gas_mm: number;
    provenance?: Provenance;
  }[];
  /** ODU → 1st joint ("A"). Optional: Mitsubishi's Table 1 equals the ODU's
      own connection sizes, so the engine defaults to those when absent; only
      brands that publish a separate main-selection rule fill this. */
  odu_to_first_joint?: PipeSizingRule;
  /** where the ODU → 1st joint LIQUID size steps up with the length to the
      farthest indoor unit (Mitsubishi Table 1 notes): outdoor model → from
      this many metres (inclusive), use liquid_mm instead of the connection */
  odu_liquid_upsize?: Record<string, { farthest_m_min: number; liquid_mm: number }>;
  /** joint part by downstream index; optional first-joint-by-ODU override table */
  joint_selection: {
    steps: { index_max: number; part_ref: string }[];
    first_joint_by_odu?: Record<string, string>;
  };
  /** header part by branch count + downstream index (where the brand offers headers) */
  header_selection?: {
    steps: {
      branches_max: number;
      index_max: number;
      part_ref: string;
      /** the outdoor models this header may connect to DIRECTLY (no joint
          before it); absent = the book sets no limit */
      direct_odus?: string[];
      /** indoor indexes this header cannot take on a branch */
      excludes_idu_index?: number[];
    }[];
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
  /** a branch box's indoor-side flare ports, A first: liquid and gas mm
      (M-P0860 p.44). A head whose pipe differs takes the book's
      different-diameter joint at the box. */
  port_liquid_mm?: number[];
  port_gas_mm?: number[];
  /** a reducer (different-diameter joint): the tube it takes, and the tube it
      gives, mm (PAC-MK34/54BC manual WG79B748H02: branch box side → head) */
  from_mm?: number;
  to_mm?: number;
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
  /* the maker's own rules, as its book prints them (optional: a vendor's
     row can carry only the fields above) */
  /** the interface by zones and control: on/off, or temperature (linear) */
  interfaces?: { model: string; max_zones: number; control: "on_off" | "temperature" }[];
  /** the main controller: `per_system` required, up to `max` with subs */
  main_controller?: { model: string; per_system: number; max: number };
  /** needed with any wireless sensor or zone remote; `max_devices` a receiver */
  wireless_receiver?: { model: string; max_devices: number };
  /** temperature sensors: wireless or wired, the batteries they don't come
      with, and how many of a kind a system takes */
  sensors?: { model: string; kind: "wireless" | "wired"; batteries?: { type: string; per: number }; max?: number }[];
  /** wireless zone remotes, one at most a zone */
  zone_remotes?: { model: string; batteries?: { type: string; per: number } }[];
  wifi?: string;
  /** temperature control needs a sensor or zone remote in every zone */
  temperature_sensor_per_zone?: boolean;
  /** field-supplied dampers and their cable, as the maker specifies them */
  damper?: { volts: string; drive: string; max_ma: number };
  damper_cable?: { kind: string; max_m: number };
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
  /** the day the pack last changed, "YYYY-MM-DD" — set by whoever changes
      it (data/packs/AGENTS.md §10). The studio's start screen shows it as
      "Library, updated 18 Aug 2026"; the installed-packs gate requires it. */
  updated?: string;
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
