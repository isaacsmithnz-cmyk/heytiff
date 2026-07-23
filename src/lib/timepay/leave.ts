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

const isWeekendISO = (iso: string): boolean => {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
  return dow === 0 || dow === 6;
};

/** Working days in an inclusive range: weekdays that aren't public holidays. */
export function businessDays(startISO: string, endISO: string, holidays: Set<string> = new Set()): number {
  if (endISO < startISO) return 0;
  let n = 0;
  for (let i = 0; i <= daysBetween(startISO, endISO); i++) {
    const d = addDays(startISO, i);
    if (!isWeekendISO(d) && !holidays.has(d)) n++;
  }
  return n;
}

/** Suggested hours for a leave span — working days × the standard day. The
    requester can override for a part-day; this is only the sensible default. */
export function suggestedHours(
  startISO: string,
  endISO: string,
  standard: number,
  holidays: Set<string> = new Set(),
): number {
  return Math.round(businessDays(startISO, endISO, holidays) * standard * 100) / 100;
}

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

export type CalendarDay = { date: string; entries: { staffId: string; staffName: string; kind: LeaveKind }[] };

/** Approved leave grouped by date across the given span (inclusive). Requests
    that only partly overlap the span contribute just their in-span days. */
export function calendarDays(
  requests: LeaveRequest[],
  spanStart: string,
  spanEnd: string,
): CalendarDay[] {
  const byDate = new Map<string, CalendarDay["entries"]>();
  for (const r of requests) {
    if (r.status !== "approved") continue;
    for (const d of leaveDates(r)) {
      if (d < spanStart || d > spanEnd) continue;
      const list = byDate.get(d) ?? [];
      list.push({ staffId: r.staffId, staffName: r.staffName ?? "", kind: r.kind });
      byDate.set(d, list);
    }
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, entries]) => ({ date, entries }));
}
