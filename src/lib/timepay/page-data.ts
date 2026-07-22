import { auth0 } from "@/lib/auth0";
import { todayInAu } from "@/lib/au-dates";
import { staffProfileIdFor } from "@/lib/fleet/query";
import type { PayPeriod } from "@/components/timepay/timepay";
import {
  EMPTY_SHEET,
  getMyWeek,
  getPaySettings,
  listStaffWeeks,
  sheetStates,
  type SheetState,
} from "./query";
import { periodLabel, periodStartFor, periodYear, recentPeriods, todayIndex, weekDays } from "./period";

/* Shared page loading for both Time & Pay routes, so the *my* screen and the
   *all* screen can't disagree about which week it is or what the rules are. */

export type Ctx = { orgId: string; staffId: string | null; today: string };

export async function timepayContext(): Promise<Ctx | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;
  return { orgId, staffId: await staffProfileIdFor(orgId, userId), today: todayInAu() };
}

/** Resolve ?period=YYYY-MM-DD to a real period start, defaulting to this week
    and refusing anything that isn't one of the periods we offer. */
export function resolvePeriod(today: string, requested?: string): { start: string; index: number; periods: PayPeriod[] } {
  const starts = recentPeriods(today);
  const current = periodStartFor(today);
  const periods: PayPeriod[] = starts.map((start) => ({
    start,
    range: periodLabel(start),
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
  const { start, periods, index } = resolvePeriod(ctx.today, requested);
  const [{ settings }, me, sheets] = await Promise.all([
    getPaySettings(ctx.orgId),
    getMyWeek(ctx.orgId, ctx.staffId, start),
    sheetStates(ctx.orgId, start),
  ]);
  if (!me) return null;
  return {
    me,
    settings,
    week: weekDays(start),
    today: todayIndex(start, ctx.today),
    periodStart: start,
    periodLabel: `${periods[index].range} ${periods[index].year}`,
    sheet: sheets.get(ctx.staffId) ?? EMPTY_SHEET,
  };
}

export async function loadTimepay(opts: { pay: boolean }, requested?: string) {
  const ctx = await timepayContext();
  if (!ctx) return null;
  const { start, periods, index } = resolvePeriod(ctx.today, requested);
  const [{ settings, configured }, staff, sheets] = await Promise.all([
    getPaySettings(ctx.orgId),
    listStaffWeeks(ctx.orgId, start, { pay: opts.pay }),
    sheetStates(ctx.orgId, start),
  ]);
  return {
    staff,
    settings,
    configured,
    week: weekDays(start),
    today: todayIndex(start, ctx.today),
    periods,
    periodIndex: index,
    sheets: Object.fromEntries(sheets) as Record<string, SheetState>,
  };
}
