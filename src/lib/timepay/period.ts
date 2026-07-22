/* Which week are we looking at, and which day is "today" in it.

   The demo shipped a hardcoded `week` tuple array and `today: 4`. Both are
   derived here instead — pure, so they're testable and so the server and the
   client can't disagree about what week it is.

   The grid is SEVEN DAYS and stays that way: derive()/splitDay identify
   Saturday and Sunday positionally (i === 5, i === 6), and days[] is indexed
   by weekday. `cycle` (Weekly/Fortnightly/Monthly) therefore groups periods
   for submission but does not yet reshape the grid — the same known-limitation
   posture logic.ts already takes with the ph/night penalty rules. */

import type { WeekDay } from "@/components/timepay/logic";

const DAY_NAMES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Weekday index with MONDAY as 0, matching days[] and splitDay's Sat/Sun. */
export function mondayIndex(iso: string): number {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return (dow + 6) % 7;
}

export function addDays(iso: string, n: number): string {
  const t = new Date(`${iso}T00:00:00Z`).getTime();
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10);
}

/** The Monday-anchored week start containing `iso`. */
export function periodStartFor(iso: string): string {
  return addDays(iso, -mondayIndex(iso));
}

/** The seven ['MON', 29, 'Jun'] tuples the grid renders. */
export function weekDays(periodStart: string): WeekDay[] {
  return DAY_NAMES.map((name, i) => {
    const d = new Date(`${addDays(periodStart, i)}T00:00:00Z`);
    return [name, d.getUTCDate(), MONTHS[d.getUTCMonth()]] as WeekDay;
  });
}

/** Index of `today` within the week, or 6 once the week is behind us — a past
    week is complete, so every weekday counts as "should have been logged". */
export function todayIndex(periodStart: string, today: string): number {
  const diff = Math.round(
    (new Date(`${today}T00:00:00Z`).getTime() - new Date(`${periodStart}T00:00:00Z`).getTime()) /
      86_400_000,
  );
  if (diff < 0) return -1; // a future week: nothing is missing yet
  return Math.min(6, diff);
}

/** ISO date for one column of the grid. */
export function dateOfDay(periodStart: string, dayIndex: number): string {
  return addDays(periodStart, dayIndex);
}

/** "29 Jun – 5 Jul" — the period label the switcher shows. */
export function periodLabel(periodStart: string): string {
  const w = weekDays(periodStart);
  const a = w[0];
  const b = w[6];
  return `${a[1]} ${a[2]} – ${b[1]} ${b[2]}`;
}

export function periodYear(periodStart: string): string {
  return periodStart.slice(0, 4);
}

/** Recent periods, newest first, for the period switcher. */
export function recentPeriods(today: string, count = 6): string[] {
  const current = periodStartFor(today);
  return Array.from({ length: count }, (_, i) => addDays(current, -7 * i));
}
