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
import {
  addDays,
  periodConfig,
  periodDays,
  periodEnd,
  periodLabel,
  periodStartFor,
  periodYear,
  recentPeriods,
  todayIndex,
  type PeriodConfig,
} from "./period";
import { holidaysInSpan, myUnavailability, stateFor } from "./leave-query";
import { ensureHolidays } from "./holiday-sync";
import { presumeFor, presumptionCtx } from "./presume";

/* Shared page loading for both Time & Pay routes, so the *my* screen and the
   *all* screen can't disagree about which period it is or what the rules are.

   Settings load FIRST and everything else follows, because the cycle and its
   anchors decide how long a period is and where it begins — and therefore
   which entries belong to it. */

export type Ctx = { orgId: string; staffId: string | null; today: string };

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

  /* A subcontractor invoices for work; they aren't on the payroll, their hours
     never reach a pay run, and a timesheet would imply a claim they aren't
     making. Answered here rather than in the page so the expensive half of
     this function — holidays, leave, the presumption — is never run for
     someone who isn't going to see a week. */
  if (me.employment === "subbie") return { subcontractor: true as const };

  /* Fill the week in before it is handed to the screen. An ordinary Tuesday
     needs no interaction at all: it is presumed worked at this person's normal
     hours once the day is over, and a day the business already knows about —
     a public holiday, approved leave — arrives in that state instead. The
     screen renders the RESULT, so what you see is what submits. */
  const weekDays = periodDays(start, cfg);
  const today = todayIndex(start, ctx.today, cfg);
  const p = await presumptionCtx(ctx.orgId, start, cfg, ctx.today, [{ id: ctx.staffId, state }]);
  const presumed = presumeFor(me, state, settings, { week: weekDays, today }, p);

  /* A casual's own unavailability. Loaded here rather than on demand because
     the rail shows it beside the week it applies to, and a casual opening
     their timesheet is the moment they think of it. */
  const casual = me.employment === "casual";
  const unavailable = casual ? await myUnavailability(ctx.orgId, ctx.staffId) : [];

  return {
    me: { ...me, days: presumed.days },
    /** what each day's content came from — a real entry, or something filled
        in for you. The screen says so rather than pretending you logged it. */
    sources: presumed.sources,
    /** this person's normal hours: their own override, else the org's */
    normal: presumed.hours,
    /** whether the override is theirs, so the settings card can say so */
    ownNormal: p.ownHours.has(ctx.staffId),
    /** the days they're expected — EMPTY for a casual, whose week is all
        theirs to enter. The screen must read the week through this same
        pattern or it will colour days "missing" that it declined to fill. */
    workDays: presumed.workDays,
    ownWorkDays: p.ownWorkDays.has(ctx.staffId),
    /** what kind of employee they are, for the copy that differs */
    employment: me.employment ?? "permanent",
    /** a casual's unavailability blocks; empty for everyone else */
    unavailable,
    settings,
    week: weekDays,
    today,
    todayISO: ctx.today,
    periodStart: start,
    periodEnd: periodEnd(start, cfg),
    // the same switcher the *all* screen gets, so both screens step through
    // the same list of periods rather than two ideas of "last fortnight"
    periods,
    periodIndex: index,
    sheet: sheets.get(ctx.staffId) ?? EMPTY_SHEET,
    holidays,
    // whose calendar these holidays are — the rail names it ("All NSW public
    // holidays") so nobody reads another state's roster as their own
    state,
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

  /* The approver sees the same presumed week the person does. Without this the
     review screen would read every untouched-but-ordinary day as a missing
     entry and chase people for a week they never had to fill in. */
  const weekDays = periodDays(start, cfg);
  const today = todayIndex(start, ctx.today, cfg);
  const p = await presumptionCtx(
    ctx.orgId,
    start,
    cfg,
    ctx.today,
    staff.map((s) => ({ id: s.id, state: s.state ?? null })),
  );

  return {
    /* Each person is presumed AND read through their own roster: the approver
       sees a casual's blank Tuesday as blank, not as a missing day to chase. */
    staff: staff.map((s) => {
      const r = presumeFor(s, s.state ?? null, settings, { week: weekDays, today }, p);
      return { ...s, days: r.days, workDays: r.workDays };
    }),
    settings,
    configured,
    week: weekDays,
    today,
    periods,
    periodIndex: index,
    sheets: Object.fromEntries(sheets) as Record<string, SheetState>,
  };
}
