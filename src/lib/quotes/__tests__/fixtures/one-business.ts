import type { BuildSettings } from "../../buildup";

/* ONE BUSINESS'S SETTINGS, for the benchmarks only: the markups, day and
   duct contingency the past and blind jobs were quoted at (Diamond Air's
   ServiceM8 "Labour HVAC", $1,320 a day: 8 hours at $165). HeyTiff has no
   default of its own — every business sets its own on the Quoting page, or
   its Rate Calculator. */
export const ONE_BUSINESS: BuildSettings = {
  unitMarkupPct: 25,
  materialMarkupPct: 40,
  chargeOutCents: 16500,
  dayHours: 8,
  contingency: { pct: 15, hours: 2 },
};
