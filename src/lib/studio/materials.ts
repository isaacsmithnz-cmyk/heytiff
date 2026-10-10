/* Design Studio — the two takeoff primitives.

   This file used to own a whole schedule engine: `buildMaterials` walked the
   document into a per-system MaterialsSchedule, and `rollupUnits` summed its
   units for the printed copy. Both were RETIRED once buildSummaryModel took
   over — the sheet and the printed document now derive from one model, and
   the schedule was the second derivation that made them disagree.

   Worse, it was split-ONLY: `buildMaterials` skipped every other system type,
   so the printed unit schedule silently omitted a multi's units for as long
   as it shipped. The picklist counts placed objects instead, whatever the
   type (see buildSummaryModel).

   What is left is what other modules genuinely share:
     - evaluateAdditionalCharge — the charge-rule evaluator, used by
       components.ts to derive the refrigerant row
     - describeUnit — one wording for a unit, used by the picklist

   The engine's behaviour is still under test; the assertions moved to
   buildSummaryModel in split.test.ts and summary.test.ts, where it lives. */

import type { AdditionalChargeRule, DataPack } from "./packs/schema";
import { formFactorLabel } from "./form-factors";

/* ───────────────── additional-charge rule evaluator ─────────────────
   One evaluator per method (universal-table-schema.md — typed rule blocks).
   Returns grams, or null when the rule needs data we don't have yet. */

export function evaluateAdditionalCharge(
  rule: AdditionalChargeRule,
  ctx: { liquidLengthM: number; liquidSizeMm?: number }
): number | null {
  switch (rule.method) {
    case "none_required":
      return 0;
    case "threshold_then_rate":
      return Math.max(0, ctx.liquidLengthM - rule.free_up_to_m) * rule.g_per_m_beyond;
    case "per_meter_by_liquid_size": {
      if (ctx.liquidSizeMm == null) return null;
      const rate = rule.rates[String(ctx.liquidSizeMm)];
      if (rate == null) return null;
      const chargeable = Math.max(
        0,
        ctx.liquidLengthM - (rule.precharged_allowance_m ?? 0)
      );
      return chargeable * rate;
    }
    case "formula_coefficients": {
      if (ctx.liquidSizeMm == null) return null;
      // the heads term needs a network's connected index — no figure on one run
      if (rule.plus_per_index_over_odu_g != null) return null;
      const term = rule.terms.find((t) => t.liquid_mm === ctx.liquidSizeMm);
      if (!term) return null;
      const g =
        ctx.liquidLengthM * term.coeff_g_per_m - (rule.deduction_g ?? 0);
      return roundNearest(Math.max(rule.min_charge_g ?? 0, g), rule.round_g);
    }
    case "fixed_per_idu":
      return null; // needs an idu-size key — no consumer yet
    case "per_meter_by_liquid_size_by_farthest":
      return null; // a whole network's lengths — evaluateVrfCharge
    case "stepped_by_length": {
      const L = steppedLengthM(rule, ctx);
      if (L == null) return null;
      if (L <= rule.precharged_up_to_m + EPS) return 0;
      // past the last band the book prints no amount ("Impossible"): no figure
      return rule.bands.find((b) => L <= b.up_to_m + EPS)?.add_g ?? null;
    }
    case "whole_length_by_liquid_size": {
      if (ctx.liquidSizeMm == null) return null;
      const rate = rule.rates[String(ctx.liquidSizeMm)];
      if (rate == null) return null;
      const L = ctx.liquidLengthM;
      const chargeless = rule.chargeless_up_to_m != null && L <= rule.chargeless_up_to_m + EPS;
      let g = chargeless ? 0 : L * rate;
      if (rule.plus_past && L > rule.plus_past.over_m + EPS) g += rule.plus_past.add_g;
      // "rounded off in units of 0.1 kg": to the NEAREST step, not up
      return roundNearest(g, rule.round_g);
    }
  }
}

/** to the nearest step ("rounded off in units of 0.1 kg"), not up; the float
    sum is settled to the gram first so 2.95 kg doesn't read as 2.9499… */
function roundNearest(g: number, step: number | undefined): number {
  return step != null && step > 0 ? Math.round(Math.round(g * 1000) / 1000 / step) * step : g;
}

/** a run measured to the millimetre must not fall out of the band it reads
    as ("40 m or less" at 40.0000000001) */
const EPS = 1e-9;

type SteppedRule = Extract<AdditionalChargeRule, { method: "stepped_by_length" }>;

/** the length a stepped table is read on: metres of pipe, or the book's
    weighted length (MHI's Le). Null when the run's liquid size is one the
    table isn't printed for, or isn't known while the table names one. */
function steppedLengthM(rule: SteppedRule, ctx: { liquidLengthM: number; liquidSizeMm?: number }): number | null {
  const size = ctx.liquidSizeMm;
  if (rule.liquid_mm != null && (size == null || size !== rule.liquid_mm)) return null;
  if (!rule.length_weights) return ctx.liquidLengthM;
  if (size == null) return null;
  const w = rule.length_weights[String(size)];
  return w == null ? null : ctx.liquidLengthM * w;
}

/** Is the run longer than the book's charge table goes? Only a stepped table
    has an end: past its last band the book prints no amount (Daikin's
    "Impossible"), so the run can't be charged by the book — never a figure
    carried on from the last band. False when the length can't be read. */
export function pastChargeTable(
  rule: AdditionalChargeRule,
  ctx: { liquidLengthM: number; liquidSizeMm?: number }
): boolean {
  if (rule.method !== "stepped_by_length" || rule.bands.length === 0) return false;
  const L = steppedLengthM(rule, ctx);
  return L != null && L > rule.bands[rule.bands.length - 1].up_to_m + EPS;
}

/** the metres of pipe (in this liquid size) at which a stepped table ends —
    its last band, turned back from a weighted length where the book reads
    one. Null for every other method, or a size the table has no figure for. */
export function chargeTableEndM(rule: AdditionalChargeRule, liquidSizeMm?: number): number | null {
  if (rule.method !== "stepped_by_length" || rule.bands.length === 0) return null;
  const per = steppedLengthM(rule, { liquidLengthM: 1, ...(liquidSizeMm != null ? { liquidSizeMm } : {}) });
  return per == null || per <= 0 ? null : rule.bands[rule.bands.length - 1].up_to_m / per;
}

type VrfChargeRule = Extract<
  AdditionalChargeRule,
  { method: "per_meter_by_liquid_size_by_farthest" | "formula_coefficients" }
>;

/** the charge methods a VRF network is evaluated by */
export const isVrfChargeRule = (rule: AdditionalChargeRule): rule is VrfChargeRule =>
  rule.method === "per_meter_by_liquid_size_by_farthest" || rule.method === "formula_coefficients";

/** A VRF system's additional charge in grams, from the whole network: metres
    of liquid pipe per size, the outdoor → farthest indoor length, the total
    connected index and the units. Null when a size has no rate or no band
    covers the length: a figure the book cannot give is not guessed. */
export function evaluateVrfCharge(
  rule: VrfChargeRule,
  ctx: {
    /** liquid mm → metres of that size across the network */
    liquidM: Record<string, number>;
    farthestM: number;
    connectedIndex: number;
    /** the heads' rated cooling kW added up (PUMY's amount keys on it) */
    connectedKw?: number;
    oduModel: string;
    iduModels: string[];
    /** the outdoor's own capacity index (formula_coefficients' heads term) */
    oduIndex?: number;
  }
): number | null {
  if (rule.method === "formula_coefficients") return formulaNetworkCharge(rule, ctx);
  const band = rule.bands.find((b) => b.farthest_m_max == null || ctx.farthestM <= b.farthest_m_max);
  if (!band) return null;
  let g = 0;
  for (const [size, m] of Object.entries(ctx.liquidM)) {
    if (m <= 0) continue;
    const rate = band.rates[String(Number(size))];
    if (rate == null) return null;
    g += m * rate;
  }
  if (rule.plus_by_connected_index) {
    const step = rule.plus_by_connected_index.find(
      (s) => s.index_max == null || ctx.connectedIndex <= s.index_max
    );
    if (!step) return null;
    g += step.add_g;
  }
  if (rule.plus_by_connected_kw) {
    if (ctx.connectedKw == null) return null;
    const kw = ctx.connectedKw;
    const step = rule.plus_by_connected_kw.find((s) => s.kw_max == null || kw <= s.kw_max + 1e-9);
    if (!step) return null;
    g += step.add_g;
  }
  g += rule.plus_by_odu?.[ctx.oduModel] ?? 0;
  for (const model of ctx.iduModels)
    g += rule.plus_per_idu?.find((a) => a.models.includes(model))?.add_g ?? 0;
  const step = rule.round_up_g ?? 0;
  // the float sum can sit a hair above a whole step (12450.000000002)
  return step > 0 ? Math.ceil(Math.round(g * 1000) / 1000 / step) * step : g;
}

/** formula_coefficients over a network (MHI KX Micro, KX-T-374 p.21):
    P = Σ metres per liquid size × coefficient − deduction, never under the
    floor; then I = grams per index point the heads exceed the outdoor by;
    the total rounded to the nearest step. Null when a size has no
    coefficient, or the heads term needs an index that isn't recorded. */
function formulaNetworkCharge(
  rule: Extract<AdditionalChargeRule, { method: "formula_coefficients" }>,
  ctx: { liquidM: Record<string, number>; connectedIndex: number; oduIndex?: number }
): number | null {
  let g = 0;
  for (const [size, m] of Object.entries(ctx.liquidM)) {
    if (m <= 0) continue;
    const term = rule.terms.find((t) => t.liquid_mm === Number(size));
    if (!term) return null;
    g += m * term.coeff_g_per_m;
  }
  g = Math.max(rule.min_charge_g ?? 0, g - (rule.deduction_g ?? 0));
  if (rule.plus_per_index_over_odu_g != null) {
    if (ctx.oduIndex == null) return null;
    g += Math.max(0, ctx.connectedIndex - ctx.oduIndex) * rule.plus_per_index_over_odu_g;
  }
  return roundNearest(g, rule.round_g);
}

/** "4-way cassette indoor unit, 3.2/3.6 kW" — one wording for a unit, shared
    with the summary sheet's Material picklist, which counts units for every
    system type. */
export const describeUnit = (pack: DataPack, model: string): string => {
  const idu = pack.indoor_units.find((u) => u.model === model);
  if (idu)
    return `${formFactorLabel(idu.form_factor) ?? "Indoor"} indoor unit, ${idu.capacity_cool_kw}/${idu.capacity_heat_kw} kW`;
  const odu = pack.outdoor_units.find((o) => o.model === model);
  if (odu)
    return `Outdoor unit, ${odu.capacity_cool_kw}/${odu.capacity_heat_kw} kW`;
  return "Unit";
};
