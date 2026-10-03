import type { BuildSettings } from "./buildup";
import type { OrgDay } from "./org-day";
import type { QuoteSettings } from "./settings";

/* WHAT A PRICED QUOTE IS BUILT ON — the business's own settings, gathered
   for the build-up, or what it still hasn't set (Isaac, 2026-10-04: "there
   are to be no made up figures… if your hours or rates aren't set yet the
   quote builder can warn you").

   A quote is priced only when every figure is the business's: both
   markups, a charge-out rate and a working day (org-day.ts). The duct
   contingency is the business's choice to use; left blank, a quote carries
   none. Pure. */

export type BuildUnset = "rate" | "hours" | "unit_markup" | "material_markup";

export const BUILD_UNSET_WORDS: Record<BuildUnset, string> = {
  rate: "a charge-out rate",
  hours: "a working day",
  unit_markup: "a markup on units",
  material_markup: "a markup on materials",
};

/** The contingency a quote carries: a share, hours, both or neither. */
export function contingencyOf(s: Pick<QuoteSettings, "contingencyPct" | "contingencyHours">): BuildSettings["contingency"] {
  const pct = s.contingencyPct ?? 0;
  const hours = s.contingencyHours ?? 0;
  return pct > 0 || hours > 0 ? { pct, hours } : null;
}

export function buildSettingsOf(
  s: QuoteSettings,
  day: OrgDay
): { ok: true; settings: BuildSettings } | { ok: false; unset: BuildUnset[] } {
  const unset: BuildUnset[] = [];
  if (!day.rate) unset.push("rate");
  if (!day.hours) unset.push("hours");
  if (s.unitMarkupPct == null) unset.push("unit_markup");
  if (s.materialMarkupPct == null) unset.push("material_markup");
  if (!day.rate || !day.hours || s.unitMarkupPct == null || s.materialMarkupPct == null) return { ok: false, unset };
  return {
    ok: true,
    settings: {
      unitMarkupPct: s.unitMarkupPct,
      materialMarkupPct: s.materialMarkupPct,
      chargeOutCents: day.rate.perHourCents,
      dayHours: day.hours.hours,
      contingency: contingencyOf(s),
    },
  };
}

/** What's missing, in one sentence: "No charge-out rate or markup on units set." */
export function unsetWords(unset: readonly BuildUnset[]): string {
  const w = unset.map((u) => BUILD_UNSET_WORDS[u]);
  const list = w.length <= 1 ? (w[0] ?? "") : `${w.slice(0, -1).join(", ")} and ${w.at(-1)}`;
  return `Set ${list} in Quoting to price this quote.`;
}
