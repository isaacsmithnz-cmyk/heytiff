import { initialsFrom } from "@/lib/staff/derive";
import { LEAVE_LABEL, type LeaveRequest } from "@/lib/timepay/leave";
import { plusDays } from "@/lib/workboard/dates";
import { mondayOf } from "@/lib/workboard/board-status";

/* THE CALENDAR — your leave, who else is off, and the days the office closes.

   This replaces `rosterToday`, which answered the same question for exactly one
   day and did it in a strip under the card: "Who's about today — Everyone's in
   today." That sentence cost half the page's width to say nothing, and the one
   genuinely load-bearing thing it carried — "Public holiday, the office is
   closed" — was announced on this screen and nowhere else in the app.

   A WINDOW COSTS NOTHING MORE THAN A DAY DID. `approvedInSpan` and
   `holidaysInSpan` already take a span; the loader was passing `today, today`.
   So four weeks of answer is the same two queries.

   WHAT THE GRID MAY NOT DO IS BORROW A STATE COLOUR. The maintenance board's
   calendar tints a day by how READY it is — green/amber/red mean something is
   or isn't on track. Leave is not a readiness problem, so none of that comes
   across. Three facts share these cells and each gets its own material:

     yours       an ink band. Ink is the app's own material and the only
                 question the band answers is "is this mine".
     a colleague a neutral pill. Quieter on purpose: context, not your day.
     closed      the info blue the old public-holiday line already used.

   THE BAND RUNS THROUGH THE WEEKEND (Isaac, 2026-08-10). A Wednesday-to-Tuesday
   request covers the Saturday, and you are away on it — breaking the band at
   the weekend would draw two runs where the person took one. Payroll's view of
   which days are payable is a different question, asked on a different screen. */

export type CalendarDay = {
  iso: string;
  /** The holiday name if the org closes this day, else null. */
  holiday: string | null;
  /** The viewer's own approved leave covering this day. */
  mine: {
    /** "Annual leave" — the human label for the kind. */
    label: string;
    /** This day is the request's first. False also means "it started before
        the window", which is what leaves the band squared at the edge. */
    runStart: boolean;
    /** This day is the request's last. */
    runEnd: boolean;
  } | null;
  /** Everyone else on approved leave. Empty unless the viewer holds `team`.
      `firstName` is what the pill shows and `name` is what its title says — a
      cell is a seventh of the card, and a surname does not fit one. */
  others: {
    staffId: string;
    name: string;
    firstName: string;
    initials: string;
    label: string;
  }[];
};

export type LeaveCalendar = {
  /** First day the arrows may reach — a Monday. */
  spanStart: string;
  /** Last day the arrows may reach. */
  spanEnd: string;
  /** Every day in the span, ascending. */
  days: CalendarDay[];
};

/** A week behind so "last week" is one press away, eight ahead because that is
    as far as anyone plans leave from a home screen. Both ends land on whole
    weeks, so the grid never opens on a part-row. */
export const WEEKS_BACK = 1;
export const WEEKS_AHEAD = 8;
/** The grid itself — four weeks, same as the maintenance board's. */
export const WINDOW_DAYS = 28;

/** The span to fetch and to step inside, derived from today alone. */
export function calendarSpan(today: string): { spanStart: string; spanEnd: string } {
  const spanStart = plusDays(mondayOf(today), -WEEKS_BACK * 7);
  return {
    spanStart,
    spanEnd: plusDays(spanStart, (WEEKS_BACK + WEEKS_AHEAD) * 7 + WINDOW_DAYS - 1),
  };
}

/* Pure over already-fetched rows, the way `rosterToday` was: the queries hand
   us approved leave overlapping the span and the holidays inside it, and this
   shapes them per day. The `team` gate lives at the loader — here, a viewer
   without it simply arrives with nobody else's leave in `approved`. */
export function buildCalendar(
  approvedLeave: readonly LeaveRequest[],
  holidays: readonly { date: string; name: string }[],
  today: string,
  /** Null for an account with no staff record: nothing can be yours. */
  viewerStaffId: string | null,
): LeaveCalendar {
  const { spanStart, spanEnd } = calendarSpan(today);
  const holidayBy = new Map(holidays.map((h) => [h.date, h.name]));

  const days: CalendarDay[] = [];
  for (let iso = spanStart; iso <= spanEnd; iso = plusDays(iso, 1)) {
    /* Re-check the span per row rather than trusting the query's overlap
       filter, so the derivation stands on its own — end date is inclusive. */
    const covering = approvedLeave.filter((r) => r.startDate <= iso && iso <= r.endDate);
    const own = viewerStaffId ? covering.find((r) => r.staffId === viewerStaffId) : undefined;

    days.push({
      iso,
      holiday: holidayBy.get(iso) ?? null,
      mine: own
        ? {
            label: LEAVE_LABEL[own.kind],
            runStart: own.startDate === iso,
            runEnd: own.endDate === iso,
          }
        : null,
      others: covering
        .filter((r) => r.staffId !== viewerStaffId)
        .map((r) => {
          const name = r.staffName?.trim() || "Unnamed";
          return {
            staffId: r.staffId,
            name,
            firstName: name.split(/\s+/)[0],
            initials: initialsFrom(name),
            label: LEAVE_LABEL[r.kind],
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  }

  return { spanStart, spanEnd, days };
}

/** The 28 days on show, starting `weekShift` weeks from this Monday. Clamped to
    the loaded span, because the arrows may not walk off the data. */
export function windowFrom(
  cal: LeaveCalendar,
  today: string,
  weekShift: number,
): CalendarDay[] {
  const wanted = plusDays(mondayOf(today), weekShift * 7);
  const first = wanted < cal.spanStart ? cal.spanStart : wanted;
  const byIso = new Map(cal.days.map((d) => [d.iso, d]));
  const out: CalendarDay[] = [];
  for (let i = 0; i < WINDOW_DAYS; i += 1) {
    const iso = plusDays(first, i);
    const day = byIso.get(iso);
    if (day) out.push(day);
  }
  return out;
}

/** How far the arrows may go, in weeks either side of this Monday. */
export function shiftBounds(cal: LeaveCalendar, today: string): { min: number; max: number } {
  const monday = mondayOf(today);
  return {
    min: -WEEKS_BACK,
    max: Math.max(0, weeksBetween(monday, cal.spanEnd) - (WINDOW_DAYS / 7 - 1)),
  };
}

function weeksBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(`${fromISO}T12:00:00Z`);
  const to = Date.parse(`${toISO}T12:00:00Z`);
  return Math.floor((to - from) / (7 * 24 * 60 * 60 * 1000));
}

/** What the header counts: the window's own facts, never the whole span. */
export function windowSummary(days: readonly CalendarDay[]): {
  holidays: number;
  othersOff: number;
  yoursOff: number;
} {
  const people = new Set<string>();
  let holidays = 0;
  let yoursOff = 0;
  for (const d of days) {
    if (d.holiday) holidays += 1;
    if (d.mine) yoursOff += 1;
    for (const o of d.others) people.add(o.staffId);
  }
  return { holidays, othersOff: people.size, yoursOff };
}
