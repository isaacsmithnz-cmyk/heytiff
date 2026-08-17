/* Design Studio — the two takeoff primitives.

   This file used to own a whole schedule engine: `buildMaterials` walked the
   document into a per-system MaterialsSchedule, and `rollupUnits` summed its
   units for the printed pack. Both were RETIRED once buildSummaryModel took
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
  }
}

/** "cassette-4way indoor unit · 3.2/3.6 kW" — one wording for a unit, shared
    with the summary sheet's Material picklist, which counts units for every
    system type. */
export const describeUnit = (pack: DataPack, model: string): string => {
  const idu = pack.indoor_units.find((u) => u.model === model);
  if (idu)
    return `${idu.form_factor} indoor unit · ${idu.capacity_cool_kw}/${idu.capacity_heat_kw} kW`;
  const odu = pack.outdoor_units.find((o) => o.model === model);
  if (odu)
    return `outdoor unit · ${odu.capacity_cool_kw}/${odu.capacity_heat_kw} kW`;
  return "unit";
};
