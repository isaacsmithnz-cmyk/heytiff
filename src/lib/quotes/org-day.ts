/* THE BUSINESS'S DAY — what one person's day on site costs: its charge-out
   rate times its working hours (Isaac, 2026-10-04: "Day rate only the charge
   out rate by set work hours… there are to be no made up figures.
   Everything has to come from the orgs own settings").

   Each is set on the Quoting page, so a business can quote without
   finishing its Rate Calculator ("make sure that you can set the rate
   without completing the rate calc"). Left blank there, each comes from the
   Rate Calculator: the install rate it charges, else the one it recommends
   once it has enough to say; its working hours. Set nowhere, it is nothing —
   never a figure of ours. Pure: the Quoting page, the quote's labour and
   the build-up read the same answer. */

/** What the business's Rate Calculator says, when it has one. */
export type CalcDay = {
  chargedCents: number | null;
  recommendedCents: number | null;
  workingHours: number | null;
};

export type RateFrom = "quoting" | "charged" | "recommended";

export type OrgDay = {
  /** the install charge-out rate, cents an hour */
  rate: { perHourCents: number; from: RateFrom } | null;
  /** the working day, hours */
  hours: { hours: number; from: "quoting" | "rate_calc" } | null;
  /** one person's day on site: the rate times the hours, when both are set */
  dayCents: number | null;
};

const positive = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export function orgDayOf(set: { chargeOutCents: number | null; dayHours: number | null }, calc: CalcDay | null): OrgDay {
  const rate: OrgDay["rate"] = positive(set.chargeOutCents)
    ? { perHourCents: Math.round(set.chargeOutCents), from: "quoting" }
    : positive(calc?.chargedCents)
      ? { perHourCents: Math.round(calc.chargedCents), from: "charged" }
      : positive(calc?.recommendedCents)
        ? { perHourCents: Math.round(calc.recommendedCents), from: "recommended" }
        : null;
  const hours: OrgDay["hours"] = positive(set.dayHours)
    ? { hours: set.dayHours, from: "quoting" }
    : positive(calc?.workingHours)
      ? { hours: calc.workingHours, from: "rate_calc" }
      : null;
  return { rate, hours, dayCents: rate && hours ? Math.round(rate.perHourCents * hours.hours) : null };
}

/** Where a figure came from, in a few words. */
export function rateFromWords(from: RateFrom): string {
  return from === "quoting" ? "set here" : from === "charged" ? "what your Rate Calculator says you charge" : "your Rate Calculator's recommendation";
}
