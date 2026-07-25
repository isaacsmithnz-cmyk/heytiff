import { auth0 } from "@/lib/auth0";
import { todayInAu } from "@/lib/au-dates";
import { staffProfileIdFor } from "@/lib/fleet/query";
import type { PayPeriod } from "@/components/timepay/timepay";
import type { Settings } from "@/components/timepay/logic";
import {
  EMPTY_SHEET,
  getMyWeek,
  getPaySettings,
  listStaffWeeks,
  sheetStates,
  type SheetState,
} from "./query";
import {
  addDays,
  periodDays,
  periodEnd,
  periodLabel,
  periodStartFor,
  periodYear,
  recentPeriods,
  todayIndex,
  type PeriodConfig,
} from "./period";
import { holidaysInSpan, stateFor } from "./leave-query";
import { ensureHolidays } from "./holiday-sync";

/* Shared page loading for both Time & Pay routes, so the *my* screen and the
   *all* screen can't disagree about which period it is or what the rules are.

   Settings load FIRST and everything else follows, because the cycle and its
   anchors decide how long a period is and where it begins — and therefore
   which entries belong to it. */

export type Ctx = { orgId: string; staffId: string | null; today: string };

const periodConfig = (s: Settings): PeriodConfig => ({
  cycle: s.cycle,
  weekStart: s.weekStart,
  fortnightAnchor: s.fortnightAnchor,
  monthStartDay: s.monthStartDay,
});

export async function timepayContext(): Promise<Ctx | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;
  return { orgId, staffId: await staffProfileIdFor(orgId, userId), today: todayInAu() };
}

/** Resolve ?period=YYYY-MM-DD against this org's configuration, defaulting to
    the current period and refusing anything that isn't one we offer. */
export function resolvePeriod(
  today: string,
  cfg: PeriodConfig,
  requested?: string,
): { start: string; index: number; periods: PayPeriod[] } {
  const starts = recentPeriods(today, cfg);
  const current = periodStartFor(today, cfg);
  const periods: PayPeriod[] = starts.map((start) => ({
    start,
    range: periodLabel(start, cfg),
    year: periodYear(start),
    live: start === current,
    note: "Closed period · historical",
  }));
  const index = requested ? Math.max(0, starts.indexOf(requested)) : 0;
  return { start: starts[index], index, periods };
}

export async function loadMyTimesheet(requested?: string) {
  const ctx = await timepayContext();
  if (!ctx?.staffId) return null;

  const { settings } = await getPaySettings(ctx.orgId);
  const cfg = periodConfig(settings);
  const { start, periods, index } = resolvePeriod(ctx.today, cfg, requested);
  const state = await stateFor(ctx.orgId, ctx.staffId);
  // top the calendar up from the statutory rules before reading it
  await ensureHolidays(ctx.orgId, state, ctx.today);
  // one query covers both jobs: mark holidays that fall in the shown period,
  // and list the upcoming ones (a full year, so nothing sneaks up unseen)
  const spanStart = start < ctx.today ? start : ctx.today;
  const [me, sheets, holidays] = await Promise.all([
    getMyWeek(ctx.orgId, ctx.staffId, start, cfg),
    sheetStates(ctx.orgId, start),
    holidaysInSpan(ctx.orgId, state, spanStart, addDays(ctx.today, 365)),
  ]);
  if (!me) return null;

  return {
    me,
    settings,
    week: periodDays(start, cfg),
    today: todayIndex(start, ctx.today, cfg),
    todayISO: ctx.today,
    periodStart: start,
    periodEnd: periodEnd(start, cfg),
    // the same switcher the *all* screen gets, so both screens step through
    // the same list of periods rather than two ideas of "last fortnight"
    periods,
    periodIndex: index,
    sheet: sheets.get(ctx.staffId) ?? EMPTY_SHEET,
    holidays,
  };
}

export async function loadTimepay(opts: { pay: boolean }, requested?: string) {
  const ctx = await timepayContext();
  if (!ctx) return null;

  const { settings, configured } = await getPaySettings(ctx.orgId);
  const cfg = periodConfig(settings);
  const { start, periods, index } = resolvePeriod(ctx.today, cfg, requested);
  const [staff, sheets] = await Promise.all([
    listStaffWeeks(ctx.orgId, start, { pay: opts.pay, cfg }),
    sheetStates(ctx.orgId, start),
  ]);

  return {
    staff,
    settings,
    configured,
    week: periodDays(start, cfg),
    today: todayIndex(start, ctx.today, cfg),
    periods,
    periodIndex: index,
    sheets: Object.fromEntries(sheets) as Record<string, SheetState>,
  };
}
