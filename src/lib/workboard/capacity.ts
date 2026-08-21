/* How full a day is — the Schedule's other question, and the only one the day
   rail cannot answer. Pure, so jest can hold it still: the rail's
   schedule.ts / schedule-query.ts split, applied to the month.

   CAPACITY IS ALLOCATED, NEVER INFERRED. The obvious implementation counts the
   people who happen to have bookings and calls that the crew — which makes a
   quiet Tuesday look FULL, because the two people booked that day are the only
   two the arithmetic knows about. Worse, ServiceM8's staff list is not a crew:
   this account's holds `Pending Jobs`, a placeholder that work is parked
   against, alongside eleven real people and eight deactivated ones. Counting
   rows would put a fictional person in the denominator.

   So the denominator is a LIST SOMEBODY CHOSE: who counts toward a day, and
   how many hours each of them typically does. That list is the feature. The
   numerator is every booked minute on the day, including minutes belonging to
   people outside the list — an apprentice nobody allocated still consumes the
   day, and hiding that would be the same mistake in the other direction. It is
   why `booked` can exceed `capacity`, and why over-capacity is a state this
   module reports rather than a number it clamps.

   WEEKENDS HAVE NO CAPACITY, WHICH IS NOT THE SAME AS BEING EMPTY. Nobody is
   rostered Saturday, so the denominator is zero and a percentage would be a
   division by zero dressed up as insight. A Saturday with four hours on it
   reports those four hours and NO score. The one thing this module will not do
   is invent a denominator so that every cell has a number in it.

   MINUTES, NOT HOURS. Every figure here is minutes, for the same reason the
   rail is: an hour is a rendering decision and 7.5 is a rounding error waiting
   to be summed. `fmtHoursShort` turns them into words at the edge. */

import { minutesOfNaive, type ScheduleActivity } from "./schedule";

/** One person's standing place in the day's denominator. Presence in this list
    is not enough — `included` survives a toggle so their hours are still there
    when they come back, which is the difference between a checkbox and a
    delete. */
export type CapacityAllocation = {
  /** ServiceM8's staff uuid. THE ONLY IDENTITY THE DIARY HAS: the lanes are
      keyed on it, and `integration_links` — the app's law for one-truth-per-
      staff-member — holds no staff rows at all in the live account, so keying
      this on a HeyTiff staff card would produce an allocation list nobody
      appears in. When those links exist, this becomes a join, not a rewrite. */
  staffUuid: string;
  name: string;
  included: boolean;
  /** What this person typically does in a working day. */
  dailyMinutes: number;
};

/** What one day of the month says. */
export type CapacityDay = {
  dayISO: string;
  /** Every booked minute on the day, whoever it belongs to. */
  bookedMinutes: number;
  /** The allocated crew's minutes for this day — zero at a weekend. */
  capacityMinutes: number;
  bookings: number;
  jobs: number;
  /** The people with something on, whether or not they are in the index. */
  people: string[];
  /** booked ÷ capacity as a percentage, or NULL when there is no denominator
      to divide by — a weekend, or an empty allocation. Never Infinity, never
      a quiet zero standing in for "unknown". */
  fillPct: number | null;
  /** Past its denominator. False whenever `fillPct` is null: a day with no
      capacity cannot be over it, only booked. */
  over: boolean;
};

/** A working day is Mon–Fri. Saturday and Sunday carry no capacity — see the
    header. The rail's `isWeekendISO` is the same judgement on the same
    strings, and is deliberately NOT imported: this module owns no Dates and
    that one builds one. */
export function isWorkingDayISO(dayISO: string): boolean {
  return dowOfISO(dayISO) < 5;
}

/** Mon=0 … Sun=6, by counting days from a known Monday rather than by parsing.
    2026-08-17 IS a Monday; the arithmetic is whole days, so no timezone can
    reach it. */
export function dowOfISO(dayISO: string): number {
  const days = daysBetweenISO("2026-08-17", dayISO);
  return ((days % 7) + 7) % 7;
}

/** Whole days from `a` to `b`, either sign. Date.UTC only — both ends are
    midnight UTC so the fake zone cancels out of the difference, exactly as
    sm8MinutesBetween argues. */
export function daysBetweenISO(a: string, b: string): number {
  const at = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const bt = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((bt - at) / 86_400_000);
}

/** Every day of the month `anyDayISO` falls in, in order. */
export function daysOfMonth(anyDayISO: string): string[] {
  const y = +anyDayISO.slice(0, 4);
  const m = +anyDayISO.slice(5, 7);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: string[] = [];
  for (let d = 1; d <= last; d += 1) {
    out.push(`${anyDayISO.slice(0, 7)}-${String(d).padStart(2, "0")}`);
  }
  return out;
}

/** The crew's minutes for one working day: everyone in the index, at their own
    typical hours. Zero at a weekend, and zero when nobody is allocated — both
    of which `capacityDay` reads as "no denominator" rather than as "empty". */
export function capacityForDay(dayISO: string, allocation: CapacityAllocation[]): number {
  if (!isWorkingDayISO(dayISO)) return 0;
  return allocation.reduce((s, a) => (a.included ? s + Math.max(0, a.dailyMinutes) : s), 0);
}

/** How long one booking runs, in minutes on its own day.

    THE SAME CLAMPS THE RAIL USES, for the same reasons: a zero or reversed
    span still happened and is worth 30 minutes rather than nothing, and one
    that crosses midnight stops at midnight rather than wrapping into a
    negative number. A month total is a sum of these, so a single wrapped
    booking would quietly subtract a day's work from the score. */
export function bookedMinutesOf(a: Pick<ScheduleActivity, "start" | "end">): number {
  const startMin = minutesOfNaive(a.start);
  if (startMin === null) return 0;
  const sameDay = a.end !== null && a.end.slice(0, 10) === a.start.slice(0, 10);
  const rawEnd = sameDay ? minutesOfNaive(a.end) : a.end !== null ? 1440 : null;
  const endMin =
    rawEnd !== null && rawEnd > startMin ? Math.min(rawEnd, 1440) : Math.min(startMin + 30, 1440);
  return endMin - startMin;
}

/** One month, scored. `activities` is every dispatched booking in the month —
    the caller has already applied `activity_was_scheduled = 1`, and this
    re-applies it for the same reason schedule.ts does: it is the single most
    important line in the feature and a pure function is where a test pins it. */
export function capacityMonth(input: {
  anyDayISO: string;
  activities: ScheduleActivity[];
  allocation: CapacityAllocation[];
  /** staff uuid → name, for the people list on a day. */
  staffNames?: Map<string, string>;
}): CapacityDay[] {
  const names = input.staffNames ?? new Map<string, string>();
  const byDay = new Map<
    string,
    { minutes: number; bookings: number; jobs: Set<string>; people: Set<string> }
  >();

  for (const a of input.activities) {
    if (a.wasScheduled !== 1) continue;
    const dayISO = a.start.slice(0, 10);
    if (dayISO.length !== 10) continue;
    const cell =
      byDay.get(dayISO) ??
      byDay.set(dayISO, { minutes: 0, bookings: 0, jobs: new Set(), people: new Set() }).get(dayISO)!;
    cell.minutes += bookedMinutesOf(a);
    cell.bookings += 1;
    if (a.jobUuid) cell.jobs.add(a.jobUuid);
    /* An unnamed booking is still somebody's — it counts as a head so the
       day's people list and the rail's "Nobody named" lane agree. */
    cell.people.add(a.staffUuid ? names.get(a.staffUuid) ?? "Nobody named" : "Nobody named");
  }

  return daysOfMonth(input.anyDayISO).map((dayISO) => {
    const cell = byDay.get(dayISO);
    const bookedMinutes = cell?.minutes ?? 0;
    const capacityMinutes = capacityForDay(dayISO, input.allocation);
    const scored = capacityMinutes > 0;
    return {
      dayISO,
      bookedMinutes,
      capacityMinutes,
      bookings: cell?.bookings ?? 0,
      jobs: cell?.jobs.size ?? 0,
      people: [...(cell?.people ?? [])].sort((a, b) => a.localeCompare(b)),
      fillPct: scored ? Math.round((bookedMinutes / capacityMinutes) * 100) : null,
      over: scored && bookedMinutes > capacityMinutes,
    };
  });
}

/** The month's own line: what was booked against what was available, counting
    only the days that HAVE a denominator. Including weekends would make every
    month look emptier the more weekends it had, which says nothing about the
    crew. */
export function capacityMonthTotal(days: CapacityDay[]): {
  bookedMinutes: number;
  capacityMinutes: number;
  fillPct: number | null;
  workingDays: number;
} {
  let bookedMinutes = 0;
  let capacityMinutes = 0;
  let workingDays = 0;
  for (const d of days) {
    if (d.capacityMinutes <= 0) continue;
    bookedMinutes += d.bookedMinutes;
    capacityMinutes += d.capacityMinutes;
    workingDays += 1;
  }
  return {
    bookedMinutes,
    capacityMinutes,
    workingDays,
    fillPct: capacityMinutes > 0 ? Math.round((bookedMinutes / capacityMinutes) * 100) : null,
  };
}
