/* Statutory public-holiday rules, per state/territory.

   ⚠️ SKELETON — the per-state tables land with the verified research pass.
   `certainHolidays` returning [] means the sync simply adds nothing, so an
   incomplete build can never invent a date. DO NOT ship rules here without
   the anchor regression in __tests__/holiday-rules.test.ts proving the NSW
   output matches the 25 gazetted rows seeded in prod, verbatim.

   Two tiers, and the boundary is load-bearing:
   - `certain`  — computable forever: fixed dates, weekday-of-month formulas,
     Easter offsets, and each state's statutory weekend-substitution rules.
     Only these are ever written automatically.
   - `provisional` — proclamation-dependent (WA King's Birthday, VIC Grand
     Final Friday, one-off gazettals). Never auto-written; surfaced in the
     manager as confirm-first suggestions an admin accepts into `manual`. */

export type RuleHoliday = { date: string; name: string };
export type ProvisionalHoliday = { name: string; usual: string };

export const RULE_STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"] as const;

/** Easter Sunday for a year (Anonymous Gregorian computus), ISO date. */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Every auto-writable holiday for a state and year. Empty until the
    verified tables land — see the header. */
export function certainHolidays(_state: string, _year: number): RuleHoliday[] {
  return [];
}

/** Proclamation-dependent days an admin should confirm from the gazette. */
export function provisionalHolidays(_state: string, _year: number): ProvisionalHoliday[] {
  return [];
}
