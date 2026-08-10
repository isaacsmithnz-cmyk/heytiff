import { timepayContext } from "./page-data";
import { getPaySettings, shiftDefaultsFor } from "./query";
import {
  approvedInSpan,
  holidaysInSpan,
  listOrgHolidays,
  myBalances,
  myRequests,
  certificatesFor,
  markCertExpected,
  pendingRequests,
  stateFor,
  unavailabilityInSpan,
  type Holiday,
} from "./leave-query";
import { addDays } from "./period";
import { ensureHolidays } from "./holiday-sync";
import { listFleetStaff } from "@/lib/fleet/query";
import { teamBalanceRows, type TeamBalanceRow } from "./balances";
import { orgBalances, orgLiveRequests } from "./balances-query";
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
  /** the requester's own working pattern (Mon=0) — the request form suggests
      hours over THESE days, the same days the timesheet will actually pay */
  workDays: number[];
  /** the workspace's certificate threshold, or null when it never asks */
  certAfterDays: number | null;
};

export async function loadMyLeave(): Promise<MyLeaveData | null> {
  const ctx = await timepayContext();
  if (!ctx?.staffId) return null;

  const horizon = addDays(ctx.today, 365); // a full year — leave is planned that far out
  const [{ settings }, balances, requests, state, defaults] = await Promise.all([
    getPaySettings(ctx.orgId),
    myBalances(ctx.orgId, ctx.staffId),
    myRequests(ctx.orgId, ctx.staffId),
    stateFor(ctx.orgId, ctx.staffId),
    shiftDefaultsFor(ctx.orgId, [ctx.staffId]),
  ]);
  await ensureHolidays(ctx.orgId, state, ctx.today);
  const holidays = await holidaysInSpan(ctx.orgId, state, ctx.today, horizon);
  const ownDays = defaults.workDays.get(ctx.staffId);

  return {
    today: ctx.today,
    standard: settings.standard,
    balances: balances.map((b) => balanceView(b, requests)),
    requests: await markCertExpected(
      ctx.orgId,
      requests,
      new Set(holidays.map((h) => h.date)),
      settings.workDays,
      settings.certAfterDays,
    ),
    holidays,
    // their own pattern, else the org's — never an empty set, because a form
    // that suggests 0h for every span has stopped suggesting anything
    workDays: ownDays?.length ? ownDays : settings.workDays,
    certAfterDays: settings.certAfterDays ?? null,
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
  balances: TeamBalanceRow[];
};

/* `canApprove` decides whether the pending rows carry their certificates.

   It is a PARAMETER rather than a read inside this function because the page
   already resolves `can("approvals")` for the component, and one answer to
   that question is better than two that could drift. A viewer without it gets
   rows with `certificate` absent — indistinguishable from "none attached",
   which is the intended reading: somebody who can't decide the absence has no
   business holding the medical evidence for it. */
async function withCertificatesFor(orgId: string, rows: LeaveRequest[]): Promise<LeaveRequest[]> {
  const ids = rows.filter((r) => r.kind === "personal").map((r) => r.id);
  if (ids.length === 0) return rows;
  const certs = await certificatesFor(orgId, ids);
  return rows.map((r) => (certs.has(r.id) ? { ...r, certificate: certs.get(r.id) } : r));
}

export async function loadTeamLeave(canApprove = false): Promise<TeamLeaveData | null> {
  const ctx = await timepayContext();
  if (!ctx) return null;

  // the calendar shows a rolling window: a week back for context, a quarter on
  const spanStart = addDays(ctx.today, -7);
  const spanEnd = addDays(ctx.today, 90);
  const [{ settings }, pending, approved, unavailable, staff, allBalances, liveRequests] =
    await Promise.all([
      getPaySettings(ctx.orgId),
      pendingRequests(ctx.orgId),
      approvedInSpan(ctx.orgId, spanStart, spanEnd),
      /* Casuals blocking out days they can't work. Same window as the leave
         calendar, because the roster asks one question — who can't I put on —
         and would otherwise have to ask it in two places. */
      unavailabilityInSpan(ctx.orgId, spanStart, spanEnd),
      // the same minimum-identity roster the fleet picker reads — names, nothing HR
      listFleetStaff(ctx.orgId),
      orgBalances(ctx.orgId),
      orgLiveRequests(ctx.orgId),
    ]);
  // the org's own state drives the holiday overlay on the shared calendar
  const orgState = await stateFor(ctx.orgId, "");
  await ensureHolidays(ctx.orgId, orgState, ctx.today);
  const holidays = await holidaysInSpan(ctx.orgId, orgState, spanStart, spanEnd);

  return {
    today: ctx.today,
    pending: await markCertExpected(
      ctx.orgId,
      canApprove ? await withCertificatesFor(ctx.orgId, pending) : pending,
      new Set(holidays.map((h) => h.date)),
      settings.workDays,
      settings.certAfterDays,
    ),
    calendar: calendarDays(approved, spanStart, spanEnd, unavailable),
    spanStart,
    spanEnd,
    holidays,
    balances: teamBalanceRows(
      staff.filter((s) => s.status === "Active"),
      allBalances,
      liveRequests,
    ),
  };
}
