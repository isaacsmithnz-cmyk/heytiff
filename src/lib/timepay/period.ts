/* Which PERIOD are we looking at, how long is it, and where is today in it.

   A period is 7, 14 or a calendar month of days depending on the pay cycle.
   Everything downstream reads the day tuples this file produces, and
   logic.ts keys its weekend rules off each tuple's weekday name — so a
   fortnight's day 5 is correctly the first Saturday and day 12 the second,
   rather than whatever a fixed 7-column layout would have implied.

   Monthly periods are variable length (28–31); nothing assumes otherwise. */

import type { Settings, WeekDay } from "@/components/timepay/logic";

type Cycle = Settings["cycle"];

const DAY_NAMES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* Fortnights need an anchor, or "which fortnight is this" has no answer. We
   count from a fixed Monday so every org lands on the same boundaries and a
   period start is stable forever — no drift when settings change, and no
   dependence on when the org signed up. A configurable anchor (some employers
   run their fortnight from a specific date) is a later concern; until then
   this is at least deterministic rather than arbitrary-per-request. */
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

function daysInMonth(iso: string): number {
  const d = new Date(utc(iso));
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

/** How many days this period covers. Monthly depends on which month it is. */
export function periodLength(cycle: Cycle, periodStart: string): number {
  if (cycle === "Fortnightly") return 14;
  if (cycle === "Monthly") return daysInMonth(periodStart);
  return 7;
}

/** The start of the period containing `iso`, for this cycle. */
export function periodStartFor(iso: string, cycle: Cycle = "Weekly"): string {
  if (cycle === "Monthly") return `${iso.slice(0, 7)}-01`;
  const monday = addDays(iso, -mondayIndex(iso));
  if (cycle !== "Fortnightly") return monday;
  // snap to every second Monday counted from the epoch
  const weeks = Math.floor(daysBetween(FORTNIGHT_EPOCH, monday) / 7);
  return addDays(monday, weeks % 2 === 0 ? 0 : -7);
}

/** The ['MON', 29, 'Jun'] tuples the grid renders — one per day of the period. */
export function periodDays(periodStart: string, cycle: Cycle = "Weekly"): WeekDay[] {
  const len = periodLength(cycle, periodStart);
  return Array.from({ length: len }, (_, i) => {
    const d = new Date(utc(addDays(periodStart, i)));
    return [DAY_NAMES[mondayIndex(addDays(periodStart, i))], d.getUTCDate(), MONTHS[d.getUTCMonth()]] as WeekDay;
  });
}

/** Index of today within the period, or the last day once it's behind us — a
    closed period is complete, so every weekday counts as "should have been
    logged". -1 for a period that hasn't started. */
export function todayIndex(periodStart: string, today: string, cycle: Cycle = "Weekly"): number {
  const diff = daysBetween(periodStart, today);
  if (diff < 0) return -1;
  return Math.min(periodLength(cycle, periodStart) - 1, diff);
}

/** ISO date for one column of the grid. */
export function dateOfDay(periodStart: string, dayIndex: number): string {
  return addDays(periodStart, dayIndex);
}

/** The last day of the period — the range end for a query. */
export function periodEnd(periodStart: string, cycle: Cycle = "Weekly"): string {
  return addDays(periodStart, periodLength(cycle, periodStart) - 1);
}

/** "29 Jun – 5 Jul", or "July" for a calendar month. */
export function periodLabel(periodStart: string, cycle: Cycle = "Weekly"): string {
  const days = periodDays(periodStart, cycle);
  const a = days[0];
  const b = days[days.length - 1];
  if (cycle === "Monthly") return `${a[2]}`;
  return `${a[1]} ${a[2]} – ${b[1]} ${b[2]}`;
}

export function periodYear(periodStart: string): string {
  return periodStart.slice(0, 4);
}

/** The previous period start, whatever the cycle. */
export function previousPeriod(periodStart: string, cycle: Cycle = "Weekly"): string {
  if (cycle === "Monthly") return periodStartFor(addDays(periodStart, -1), cycle);
  return addDays(periodStart, -periodLength(cycle, periodStart));
}

/** Recent periods, newest first, for the period switcher. */
export function recentPeriods(today: string, cycle: Cycle = "Weekly", count = 6): string[] {
  const out = [periodStartFor(today, cycle)];
  while (out.length < count) out.push(previousPeriod(out[out.length - 1], cycle));
  return out;
}
