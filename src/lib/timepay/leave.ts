/* Leave — pure logic and types. Side-effect free and jest-covered, like
   period.ts; the DB lives in leave-query.ts and the mutations in
   app/actions/leave.ts.

   The balance model is the load-bearing decision. `balanceHours` is the
   entitlement remaining AS AT `asAt`, and it is owned by whoever set it — an
   admin today, a Xero/MYOB/QuickBooks sync later. The app never writes it from
   an approval; it counts BOOKINGS against it. So "available" is the balance
   minus leave booked on or after `asAt` (leave before that date is assumed
   already reflected in the figure, whether hand-entered or synced), and that
   arithmetic is the same whatever the source. */

import { addDays, daysBetween } from "./period";

export type LeaveKind = "annual" | "personal" | "unpaid";
export type LeaveStatus = "pending" | "approved" | "declined" | "cancelled";
export type BalanceKind = "annual" | "personal";
export type BalanceSource = "manual" | "xero" | "myob" | "quickbooks";

export type LeaveRequest = {
  id: string;
  staffId: string;
  staffName?: string;
  kind: LeaveKind;
  startDate: string; // ISO
  endDate: string; // ISO (inclusive)
  hours: number;
  note?: string;
  status: LeaveStatus;
  reviewNote?: string;
  reviewedBy?: string | null;
};

export type LeaveBalance = {
  kind: BalanceKind;
  balanceHours: number;
  asAt: string; // ISO
  source: BalanceSource;
  syncedAt?: string | null;
};

/** A balance with the app's bookings netted off — what the request form shows. */
export type BalanceView = LeaveBalance & { booked: number; available: number };

export const LEAVE_LABEL: Record<LeaveKind, string> = {
  annual: "Annual leave",
  personal: "Personal / carer's",
  unpaid: "Unpaid leave",
};

export const SOURCE_LABEL: Record<BalanceSource, string> = {
  manual: "Set by your team",
  xero: "Synced from Xero",
  myob: "Synced from MYOB",
  quickbooks: "Synced from QuickBooks",
};

/** Kinds that draw down a balance. Unpaid never does. */
export const BALANCE_KINDS: BalanceKind[] = ["annual", "personal"];

export function isBalanceKind(k: LeaveKind): k is BalanceKind {
  return k === "annual" || k === "personal";
}

/* ---- date maths ---- */

/** Mon=0 … Sun=6, the same convention as the timesheet's work-day pattern. */
const dowISO = (iso: string): number => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;

/** The default roster when nobody has said otherwise. */
export const MON_FRI = [0, 1, 2, 3, 4];

/** Is this date on the person's roster? The audit's part-timer finding lived
    here: every spread assumed Mon–Fri while the timesheet applied the real
    pattern, so a Mon/Tue/Thu part-timer spent five days of balance and was
    paid three. Divisor and applier now share one question. */
const onRoster = (iso: string, workDays: number[]): boolean => workDays.includes(dowISO(iso));

/** Working days in an inclusive range: rostered days that aren't holidays. */
export function businessDays(
  startISO: string,
  endISO: string,
  holidays: Set<string> = new Set(),
  workDays: number[] = MON_FRI,
): number {
  if (endISO < startISO) return 0;
  let n = 0;
  for (let i = 0; i <= daysBetween(startISO, endISO); i++) {
    const d = addDays(startISO, i);
    if (onRoster(d, workDays) && !holidays.has(d)) n++;
  }
  return n;
}

/** What a chosen span is actually made of. */
export type RangeBreakdown = {
  /** days that come off the balance — the same count businessDays returns */
  working: number;
  /** Saturdays and Sundays in the span */
  weekends: number;
  /** the public holidays the span passes over, in date order, named */
  holidays: { date: string; name: string }[];
};

/* Why the calendar can say "8 working days, and Australia Day is free".

   businessDays answers with a number, which is all the hours suggestion needs.
   A person choosing dates needs the WORKING, though: a fortnight off is ten
   days or nine depending on whether a public holiday falls in it, and the
   difference is a day of leave they either keep or spend without noticing.

   The three buckets are exclusive and add up to the span, so a holiday that
   lands on a weekend is counted ONCE — as a weekend. Nobody is "given" a
   Saturday back, and listing it as a skipped holiday would imply they were. */
export function rangeBreakdown(
  startISO: string,
  endISO: string,
  holidays: Map<string, string> = new Map(),
  workDays: number[] = MON_FRI,
): RangeBreakdown {
  const out: RangeBreakdown = { working: 0, weekends: 0, holidays: [] };
  if (!startISO || !endISO || endISO < startISO) return out;
  for (let i = 0; i <= daysBetween(startISO, endISO); i++) {
    const d = addDays(startISO, i);
    // an off-roster day counts in the "weekends" bucket whatever its name —
    // for the default Mon–Fri pattern that is literally the weekend
    if (!onRoster(d, workDays)) out.weekends++;
    else {
      const name = holidays.get(d);
      if (name === undefined) out.working++;
      else out.holidays.push({ date: d, name });
    }
  }
  return out;
}

/** Suggested hours for a leave span — rostered days × the standard day. The
    requester can override for a part-day; this is only the sensible default. */
export function suggestedHours(
  startISO: string,
  endISO: string,
  standard: number,
  holidays: Set<string> = new Set(),
  workDays: number[] = MON_FRI,
): number {
  return Math.round(businessDays(startISO, endISO, holidays, workDays) * standard * 100) / 100;
}

/** How approved leave lands on the timesheet, day by day.

    A request carries TOTAL hours across a span, so a day's worth is the total
    divided by the working days it covers — which makes a one-day 4-hour
    request a 4-hour day and a two-week block a run of standard days, with no
    special case for either. Public holidays inside the span are excluded from
    the divisor and get no row of their own, for the same reason the request
    form excludes them: they aren't days of entitlement being spent.

    UNPAID leave comes back as `off`. It is a day not worked, and it must never
    reach the timesheet as paid hours — but it still has to reach the approver
    as something that wasn't a normal workday.

    Lives here rather than beside the queries that feed it because it is pure,
    it is the arithmetic that decides what an absence pays, and both of those
    make it something to test directly. */
export function absenceMap(
  requests: LeaveRequest[],
  holidays: Map<string, string>,
  workDays: number[] = MON_FRI,
): Map<string, AbsenceDay> {
  const out = new Map<string, AbsenceDay>();
  const holidaySet = new Set(holidays.keys());

  for (const r of requests) {
    if (r.status !== "approved") continue;
    /* Divisor and applier use the SAME roster: the hours divide over the days
       that will actually be stamped, so what the balance paid for and what
       the timesheet pays out are the same number of days. */
    const spread = businessDays(r.startDate, r.endDate, holidaySet, workDays);
    const perDay = spread > 0 ? Math.round((r.hours / spread) * 100) / 100 : 0;
    for (const date of leaveDates(r)) {
      if (holidaySet.has(date) || !workDays.includes(dowISO(date))) continue;
      out.set(
        date,
        r.kind === "unpaid"
          ? { t: "off", id: r.id }
          : { t: r.kind === "personal" ? "sick" : "leave", h: perDay, id: r.id },
      );
    }
  }
  return out;
}

/** One day of an approved absence. `id` names the request it came from, so a
    materialised row can carry provenance — the audit's finding was that a
    leave day in `time_entries` and the request that paid for it had no link
    at all, which made every later disagreement unfindable. */
export type AbsenceDay =
  | { t: "leave" | "sick"; h: number; id: string }
  | { t: "off"; id: string };

/** Every calendar day a request covers (inclusive) — for the team calendar. */
export function leaveDates(r: { startDate: string; endDate: string }): string[] {
  const out: string[] = [];
  for (let i = 0; i <= daysBetween(r.startDate, r.endDate); i++) out.push(addDays(r.startDate, i));
  return out;
}

/* ---- balance arithmetic ---- */

/** A booking reduces available if it's live (pending or approved) and starts on
    or after the balance's as-at date. Declined/cancelled never count; leave
    already taken before as_at is assumed baked into the balance. */
export function bookedAgainst(requests: LeaveRequest[], kind: BalanceKind, asAt: string): number {
  return requests
    .filter(
      (r) =>
        r.kind === kind &&
        (r.status === "pending" || r.status === "approved") &&
        r.startDate >= asAt,
    )
    .reduce((sum, r) => sum + r.hours, 0);
}

export function balanceView(balance: LeaveBalance, requests: LeaveRequest[]): BalanceView {
  const booked = bookedAgainst(requests, balance.kind, balance.asAt);
  return { ...balance, booked, available: Math.round((balance.balanceHours - booked) * 100) / 100 };
}

/** Would this new request fit? Unpaid always fits; a kind with no balance row
    is treated as zero available. Returns the shortfall (0 = fits). */
export function shortfall(
  kind: LeaveKind,
  hours: number,
  balances: LeaveBalance[],
  requests: LeaveRequest[],
): number {
  if (!isBalanceKind(kind)) return 0; // unpaid is unrestricted
  const bal = balances.find((b) => b.kind === kind);
  if (!bal) return hours; // no entitlement recorded → nothing available
  const { available } = balanceView(bal, requests);
  return Math.max(0, Math.round((hours - available) * 100) / 100);
}

/* ---- public holidays (display helpers) ---- */

/** Holidays still to come, soonest first — the timesheet panel's list. The
    first is "the next day off"; past holidays drop away. */
export function upcomingHolidays<T extends { date: string }>(list: T[], todayISO: string): T[] {
  return list.filter((h) => h.date >= todayISO).sort((a, b) => a.date.localeCompare(b.date));
}

/* ---- calendar ---- */

/* WHO CAN'T WORK ON A GIVEN DAY — and the two reasons are not the same thing.

   `leave` is an entitlement somebody spent and a manager agreed to. It has a
   status, a balance behind it and an approver.

   `unavailable` is a casual saying they can't be rostered. Nobody approved it
   and nothing was spent — see lib/timepay/availability.ts for why it isn't a
   request. Treating it as leave on this screen would tell whoever rosters that
   somebody is "off", implying an arrangement that doesn't exist.

   They share one calendar because the ROSTER'S question is the same for both:
   who can I not put on. They stay distinguishable in the entry because the
   MANAGER'S question isn't — one of these is a conversation, the other is
   just a fact. */
export type CalendarSource = "leave" | "unavailable";

export type CalendarEntry = {
  staffId: string;
  staffName: string;
  source: CalendarSource;
  /** present on leave only — an unavailability has no kind to speak of */
  kind?: LeaveKind;
  /** present on unavailability only, when the person gave a reason */
  note?: string;
};

export type CalendarDay = { date: string; entries: CalendarEntry[] };

/** Approved leave and casual unavailability, grouped by date across the given
    span (inclusive). Anything that only partly overlaps the span contributes
    just its in-span days.

    Entries sort leave first within a day: a booked absence is the one the
    roster has to plan around, an unavailability is the one it has to avoid. */
export function calendarDays(
  requests: LeaveRequest[],
  spanStart: string,
  spanEnd: string,
  unavailable: { staffId: string; staffName?: string; from: string; to: string; note?: string }[] = [],
): CalendarDay[] {
  const byDate = new Map<string, CalendarEntry[]>();
  const add = (d: string, e: CalendarEntry) => {
    if (d < spanStart || d > spanEnd) return;
    byDate.set(d, [...(byDate.get(d) ?? []), e]);
  };

  for (const r of requests) {
    if (r.status !== "approved") continue;
    for (const d of leaveDates(r))
      add(d, { staffId: r.staffId, staffName: r.staffName ?? "", source: "leave", kind: r.kind });
  }

  for (const b of unavailable) {
    for (const d of leaveDates({ startDate: b.from, endDate: b.to }))
      add(d, {
        staffId: b.staffId,
        staffName: b.staffName ?? "",
        source: "unavailable",
        note: b.note,
      });
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, entries]) => ({
      date,
      entries: [...entries].sort((a, b) => (a.source === b.source ? 0 : a.source === "leave" ? -1 : 1)),
    }));
}
