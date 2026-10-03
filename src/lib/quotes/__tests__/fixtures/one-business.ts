import type { BuildSettings } from "../../buildup";

/* ONE BUSINESS'S SETTINGS, for the benchmarks only: the markups, day rate
   and duct contingency the past and blind jobs were quoted at (Diamond Air,
   2026-09-30). HeyTiff has no default of its own — every business sets its
   own on the Quoting page and the Rate Calculator. */
export const ONE_BUSINESS: BuildSettings = {
  unitMarkupPct: 25,
  materialMarkupPct: 40,
  dayRateCents: 132000,
  labourRateCents: 14000,
  contingencyPct: 15,
  contingencyHours: 2,
  contingencyOn: true,
};
