import { daysUntil } from "@/lib/au-dates";
import { expiryState, type ChipState } from "@/components/fleet/logic";

/* ONE ANSWER TO "WHEN IS THIS DUE, AND IS IT LATE" — for every place on the
   new Home that draws a dated thing (the list and the calendar).

   The two of them never show side by side (the calendar takes the list's
   place), but a person walks from one to the other, and a rego the list
   calls late must not be merely "due" on the calendar. Both used to be
   specified with their own sum: the list from the bell chip's day count,
   the calendar from fleet's `expiryState` on its own read. This is the one
   they share, and it is the bell's own rule (`expiryState`, the one every
   chip and the register read), so none of the three can disagree.

   Pure, and deliberately tiny: the list and the calendar land in separate
   pull requests, and whichever lands first brings this. The window is the
   org's number (lib/expiry.ts), passed in, never defaulted. */

export type ExpiryDue = {
  /** The expiry day itself, ISO yyyy-mm-dd: what a row is placed by. */
  due: string;
  /** Whole days from `today`; negative is past it. */
  days: number;
  /** The bell's verdict: `bad` is past it, `warn` is inside the warning
      window (today included), `ok` is further off. */
  state: ChipState;
};

/* A real calendar day, written yyyy-mm-dd. Date rolls 31 Feb over into
   March rather than refusing it, so the day is read back and compared. */
function isDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** When an expiry is due and how late, or null when there is no date to
    chase. Nobody entering a date is silence, never a guess (see
    `expiryState`), and neither is a value that is not a calendar day. A
    timestamp is not a day either: resolve one with `auDayOf` first. */
export function expiryDue(
  iso: string | null | undefined,
  today: string,
  warnDays: number,
): ExpiryDue | null {
  const due = typeof iso === "string" ? iso.trim() : "";
  if (!isDay(due) || !isDay(today)) return null;
  const days = daysUntil(due, today);
  return { due, days, state: expiryState(days, warnDays) };
}
