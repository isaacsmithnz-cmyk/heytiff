import { parseClock, type DayEntry, type Settings } from "@/components/timepay/logic";
import { dateOfDay, periodDays, type PeriodConfig } from "./period";

/* WHEN A SHEET SENDS ITSELF.

   The workspace names a day and a time — "Sun 3:00 PM" — and the screen has
   promised since the first version that a sheet nobody sent goes then, and
   locks. Nothing ever sent one. A walk of the live screen found last week
   closed and still a draft, with 40 hours on it that no approver could see.

   There is still no scheduler, and there needs to be none. The moment is a
   pure function of the period and the settings, so every reader can ask
   whether it has passed; the first one to find a draft on the far side of it
   writes the submission down (lib/timepay/submit `sendThemselves`), and the
   actions refuse to edit it. The same derive-at-read law the reminders run
   on — and it cannot die quietly the way a cron without its secret does.

   Pure, and importable by the client: the rail's sentence and the server's
   lock have to agree about WHICH day, so they both read `submitDayIndex`. */

/** The index of the period's LAST day that falls on the submit day, or -1.
    A fortnight has two Sundays and sends on the second. */
export function submitDayIndex(week: ReadonlyArray<ReadonlyArray<unknown>>, submitDay: string): number {
  const want = submitDay.slice(0, 3).toLowerCase();
  for (let i = week.length - 1; i >= 0; i--)
    if (String(week[i][0]).slice(0, 3).toLowerCase() === want) return i;
  return -1;
}

/** A moment on the AU wall clock: a calendar date and minutes past midnight. */
export type SubmitMoment = { date: string; minutes: number };

/** When this period sends itself — or null when the settings name a day the
    period doesn't contain, or a time nobody can read, in which case it never
    does. */
export function submitMomentOf(
  periodStart: string,
  cfg: PeriodConfig,
  settings: Pick<Settings, "submitDay" | "submitTime">,
): SubmitMoment | null {
  const i = submitDayIndex(periodDays(periodStart, cfg), settings.submitDay);
  const minutes = parseClock(settings.submitTime);
  if (i < 0 || minutes == null) return null;
  return { date: dateOfDay(periodStart, i), minutes };
}

/** Has the moment come? Both sides are read off the same AU clock — a date
    and minutes past midnight — so there is no instant arithmetic in the
    comparison to get wrong across daylight saving. The minute itself counts:
    at 3:00 PM a "Sun 3:00 PM" sheet has gone. */
export function hasPassed(moment: SubmitMoment | null, todayISO: string, nowMinutes: number): boolean {
  if (!moment) return false;
  return todayISO > moment.date || (todayISO === moment.date && nowMinutes >= moment.minutes);
}

/** A week with nothing on it has nothing to send — the rule the Submit button
    already keeps, since `derive` counts an entry for every day that isn't
    empty. */
export const hasSomethingToSend = (days: ReadonlyArray<DayEntry>): boolean =>
  days.some((d) => d.t !== "empty");
