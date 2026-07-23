/* Which PERIOD are we looking at, how long is it, and where is today in it.

   A period is 7, 14 or a calendar-month span of days depending on the pay
   cycle, and where it BEGINS is configurable:

     Weekly       Monday-anchored (the roster week).
     Fortnightly  counted in 14-day steps from `fortnightAnchor` — a fortnight
                  has no natural start, so the owner picks one boundary and
                  every period follows from it. Unset falls back to a fixed
                  epoch so the answer is deterministic before anyone sets one.
     Monthly      `monthStartDay`-th of the month → the day before next month's,
                  so a 16th–15th pay month is a real, correctly-lengthed period.

   Everything downstream reads the day tuples this file produces; logic.ts keys
   its weekend rules off each tuple's weekday NAME, so a fortnight's day 12 is
   the second Saturday however the period is anchored. */

import type { Settings } from "@/components/timepay/logic";

/** The slice of settings that decides period shape. */
export type PeriodConfig = Pick<Settings, "cycle" | "fortnightAnchor" | "monthStartDay">;

const DAY_NAMES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* Fortnights need an anchor or "which fortnight is this?" has no answer. When
   the owner hasn't set one we count from a fixed Monday, so a period start is
   stable forever and every org that leaves it unset lands on the same
   boundaries. */
const FORTNIGHT_EPOCH = "1970-01-05"; // a Monday

const DAY_MS = 86_400_000;
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();

/** Weekday index with MONDAY as 0, matching logic.ts's dowOf. */
export function mondayIndex(iso: string): number {
  const dow = new Date(utc(iso)).getUTCDay(); // 0 = Sunday
  return (dow + 6) % 7;
}

export function addDays(iso: string, n: number): string {
  return new Date(utc(iso) + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

/** The Monday of the week containing `iso` — the week basis for the grid. */
function mondayOf(iso: string): string {
  return addDays(iso, -mondayIndex(iso));
}

/* ---- monthly helpers (a monthStartDay-anchored "month") ---- */

function ymd(iso: string): [number, number, number] {
  const d = new Date(utc(iso));
  return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
}

function isoOf(y: number, monthIdx: number, day: number): string {
  // normalises overflow (monthIdx 12 -> next year), day is 1..28 so never rolls
  return new Date(Date.UTC(y, monthIdx, day)).toISOString().slice(0, 10);
}

function monthStart(iso: string, startDay: number): string {
  const [y, m, d] = ymd(iso);
  // before this month's start day → the period began last month
  return d >= startDay ? isoOf(y, m, startDay) : isoOf(y, m - 1, startDay);
}

function nextMonthStart(periodStart: string, startDay: number): string {
  const [y, m] = ymd(periodStart);
  return isoOf(y, m + 1, startDay);
}

/* ---- period identity ---- */

/** The start of the period containing `iso`, for this configuration. */
export function periodStartFor(iso: string, cfg: PeriodConfig): string {
  if (cfg.cycle === "Monthly") return monthStart(iso, cfg.monthStartDay);
  const monday = mondayOf(iso);
  if (cfg.cycle !== "Fortnightly") return monday;
  // align to the anchor's own week, then snap back to an even number of weeks
  const anchor = mondayOf(cfg.fortnightAnchor ?? FORTNIGHT_EPOCH);
  const weeks = Math.floor(daysBetween(anchor, monday) / 7);
  return addDays(monday, weeks % 2 === 0 ? 0 : -7);
}

/** How many days this period covers. Monthly is the true span to the next
    start (28–31); a fortnight is 14; a week is 7. */
export function periodLength(periodStart: string, cfg: PeriodConfig): number {
  if (cfg.cycle === "Fortnightly") return 14;
  if (cfg.cycle === "Monthly")
    return daysBetween(periodStart, nextMonthStart(periodStart, cfg.monthStartDay));
  return 7;
}

/** The ['MON', 29, 'Jun'] tuples the grid renders — one per day of the period,
    each carrying its true calendar weekday. */
export function periodDays(periodStart: string, cfg: PeriodConfig): [string, number, string][] {
  const len = periodLength(periodStart, cfg);
  return Array.from({ length: len }, (_, i) => {
    const iso = addDays(periodStart, i);
    const d = new Date(utc(iso));
    return [DAY_NAMES[mondayIndex(iso)], d.getUTCDate(), MONTHS[d.getUTCMonth()]];
  });
}

/** Index of today within the period, or the last day once it's behind us — a
    closed period is complete, so every weekday counts as "should have been
    logged". -1 for a period that hasn't started. */
export function todayIndex(periodStart: string, today: string, cfg: PeriodConfig): number {
  const diff = daysBetween(periodStart, today);
  if (diff < 0) return -1;
  return Math.min(periodLength(periodStart, cfg) - 1, diff);
}

/** ISO date for one column of the grid. */
export function dateOfDay(periodStart: string, dayIndex: number): string {
  return addDays(periodStart, dayIndex);
}

/** The last day of the period — the range end for a query. */
export function periodEnd(periodStart: string, cfg: PeriodConfig): string {
  return addDays(periodStart, periodLength(periodStart, cfg) - 1);
}

/** "29 Jun – 5 Jul", or "July" for a calendar month. */
export function periodLabel(periodStart: string, cfg: PeriodConfig): string {
  const days = periodDays(periodStart, cfg);
  const a = days[0];
  const b = days[days.length - 1];
  if (cfg.cycle === "Monthly" && cfg.monthStartDay === 1) return `${a[2]}`;
  return `${a[1]} ${a[2]} – ${b[1]} ${b[2]}`;
}

export function periodYear(periodStart: string): string {
  return periodStart.slice(0, 4);
}

/** The previous period start, whatever the cycle. */
export function previousPeriod(periodStart: string, cfg: PeriodConfig): string {
  if (cfg.cycle === "Monthly") return periodStartFor(addDays(periodStart, -1), cfg);
  return addDays(periodStart, -periodLength(periodStart, cfg));
}

/** Recent periods, newest first, for the period switcher. */
export function recentPeriods(today: string, cfg: PeriodConfig, count = 6): string[] {
  const out = [periodStartFor(today, cfg)];
  while (out.length < count) out.push(previousPeriod(out[out.length - 1], cfg));
  return out;
}
