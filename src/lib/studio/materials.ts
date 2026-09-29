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
      const term = rule.terms.find((t) => t.liquid_mm === ctx.liquidSizeMm);
      if (!term) return null;
      const g =
        ctx.liquidLengthM * term.coeff_g_per_m - (rule.deduction_g ?? 0);
      return Math.max(rule.min_charge_g ?? 0, g);
    }
    case "fixed_per_idu":
      return null; // needs an idu-size key — no consumer yet
    case "per_meter_by_liquid_size_by_farthest":
      return null; // a whole network's lengths — evaluateVrfCharge
  }
}

type VrfChargeRule = Extract<AdditionalChargeRule, { method: "per_meter_by_liquid_size_by_farthest" }>;

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
  }
): number | null {
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
