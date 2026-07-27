import { timepayContext } from "./page-data";
import { getPaySettings } from "./query";
import {
  approvedInSpan,
  holidaysInSpan,
  listOrgHolidays,
  myBalances,
  myRequests,
  pendingRequests,
  stateFor,
  unavailabilityInSpan,
  type Holiday,
} from "./leave-query";
import { addDays } from "./period";
import { ensureHolidays } from "./holiday-sync";
import {
  balanceView,
  calendarDays,
  type BalanceView,
  type CalendarDay,
  type LeaveRequest,
} from "./leave";

/* Page loaders for the two leave surfaces, so My leave and the team Leave tab
   agree on today, the standard day and the holiday calendar. */

export type MyLeaveData = {
  today: string;
  standard: number;
  balances: BalanceView[];
  requests: LeaveRequest[];
  holidays: { date: string; name: string }[]; // upcoming, for the request helper + list
};

export async function loadMyLeave(): Promise<MyLeaveData | null> {
  const ctx = await timepayContext();
  if (!ctx?.staffId) return null;

  const horizon = addDays(ctx.today, 365); // a full year — leave is planned that far out
  const [{ settings }, balances, requests, state] = await Promise.all([
    getPaySettings(ctx.orgId),
    myBalances(ctx.orgId, ctx.staffId),
    myRequests(ctx.orgId, ctx.staffId),
    stateFor(ctx.orgId, ctx.staffId),
  ]);
  await ensureHolidays(ctx.orgId, state, ctx.today);
  const holidays = await holidaysInSpan(ctx.orgId, state, ctx.today, horizon);

  return {
    today: ctx.today,
    standard: settings.standard,
    balances: balances.map((b) => balanceView(b, requests)),
    requests,
    holidays,
  };
}

export type HolidayManagerData = {
  holidays: Holiday[];
  orgState: string | null;
  today: string;
};

/** Everything the holiday manager (settings-modal section or the old admin
    page) needs: the org's calendar from Jan 1 this year, incl. suppressed
    rows so they can be restored. Caller is responsible for the admin+ gate. */
export async function loadHolidayManager(): Promise<HolidayManagerData | null> {
  const ctx = await timepayContext();
  if (!ctx) return null;
  const [holidays, orgState] = await Promise.all([
    listOrgHolidays(ctx.orgId, `${ctx.today.slice(0, 4)}-01-01`),
    stateFor(ctx.orgId, ""),
  ]);
  return { holidays, orgState, today: ctx.today };
}

export type TeamLeaveData = {
  today: string;
  pending: LeaveRequest[];
  calendar: CalendarDay[];
  spanStart: string;
  spanEnd: string;
  holidays: { date: string; name: string }[];
};

export async function loadTeamLeave(): Promise<TeamLeaveData | null> {
  const ctx = await timepayContext();
  if (!ctx) return null;

  // the calendar shows a rolling window: a week back for context, a quarter on
  const spanStart = addDays(ctx.today, -7);
  const spanEnd = addDays(ctx.today, 90);
  const [pending, approved, unavailable] = await Promise.all([
    pendingRequests(ctx.orgId),
    approvedInSpan(ctx.orgId, spanStart, spanEnd),
    /* Casuals blocking out days they can't work. Same window as the leave
       calendar, because the roster asks one question — who can't I put on —
       and would otherwise have to ask it in two places. */
    unavailabilityInSpan(ctx.orgId, spanStart, spanEnd),
  ]);
  // the org's own state drives the holiday overlay on the shared calendar
  const orgState = await stateFor(ctx.orgId, "");
  await ensureHolidays(ctx.orgId, orgState, ctx.today);
  const holidays = await holidaysInSpan(ctx.orgId, orgState, spanStart, spanEnd);

  return {
    today: ctx.today,
    pending,
    calendar: calendarDays(approved, spanStart, spanEnd, unavailable),
    spanStart,
    spanEnd,
    holidays,
  };
}
