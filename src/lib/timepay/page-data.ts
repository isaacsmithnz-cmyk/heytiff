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
import { periodDays, periodLabel, periodStartFor, periodYear, recentPeriods, todayIndex } from "./period";

/* Shared page loading for both Time & Pay routes, so the *my* screen and the
   *all* screen can't disagree about which period it is or what the rules are.

   Settings load FIRST and everything else follows, because the pay cycle
   decides how long a period is and therefore which entries belong to it. */

export type Ctx = { orgId: string; staffId: string | null; today: string };

export async function timepayContext(): Promise<Ctx | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;
  return { orgId, staffId: await staffProfileIdFor(orgId, userId), today: todayInAu() };
}

/** Resolve ?period=YYYY-MM-DD against this org's cycle, defaulting to the
    current period and refusing anything that isn't one we offer. */
export function resolvePeriod(
  today: string,
  cycle: Settings["cycle"],
  requested?: string,
): { start: string; index: number; periods: PayPeriod[] } {
  const starts = recentPeriods(today, cycle);
  const current = periodStartFor(today, cycle);
  const periods: PayPeriod[] = starts.map((start) => ({
    start,
    range: periodLabel(start, cycle),
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
  const { start, periods, index } = resolvePeriod(ctx.today, settings.cycle, requested);
  const [me, sheets] = await Promise.all([
    getMyWeek(ctx.orgId, ctx.staffId, start, settings.cycle),
    sheetStates(ctx.orgId, start),
  ]);
  if (!me) return null;

  return {
    me,
    settings,
    week: periodDays(start, settings.cycle),
    today: todayIndex(start, ctx.today, settings.cycle),
    periodStart: start,
    periodLabel: `${periods[index].range} ${periods[index].year}`,
    sheet: sheets.get(ctx.staffId) ?? EMPTY_SHEET,
  };
}

export async function loadTimepay(opts: { pay: boolean }, requested?: string) {
  const ctx = await timepayContext();
  if (!ctx) return null;

  const { settings, configured } = await getPaySettings(ctx.orgId);
  const { start, periods, index } = resolvePeriod(ctx.today, settings.cycle, requested);
  const [staff, sheets] = await Promise.all([
    listStaffWeeks(ctx.orgId, start, { pay: opts.pay, cycle: settings.cycle }),
    sheetStates(ctx.orgId, start),
  ]);

  return {
    staff,
    settings,
    configured,
    week: periodDays(start, settings.cycle),
    today: todayIndex(start, ctx.today, settings.cycle),
    periods,
    periodIndex: index,
    sheets: Object.fromEntries(sheets) as Record<string, SheetState>,
  };
}
