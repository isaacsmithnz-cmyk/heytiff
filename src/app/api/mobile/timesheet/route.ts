import { getPaySettings } from "@/lib/timepay/query";
import { loadTimesheetFor } from "@/lib/timepay/page-data";
import { dateOfDay } from "@/lib/timepay/period";
import { staffIdFor } from "@/lib/workboard/projects-query";
import { todayInAu } from "@/lib/au-dates";
import { DAY_WORD, dayClass, derive, type WeekCtx } from "@/components/timepay/logic";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* YOUR TIMESHEET for the phone: one pay period, read by the same loader My
   timesheet reads with (timepay/page-data's loadTimesheetFor), so the week
   is filled in, and sent at the workspace's moment, exactly as the page does
   it. Then worked out on the server with the page's own rules (derive,
   dayClass), so the phone only draws: each day's hours and its one word
   (DAY_WORD), and the totals that go to payroll.

   Your own timesheet is yours to see, so it takes no capability, only a
   membership, and it is found by the token's own user. The period is a
   CHOICE the phone hands in; the loader only ever honours one of the periods
   it offers, and falls back to the current one. */
export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;

  const staffId = await staffIdFor(ctx.orgId, ctx.userId);
  if (!staffId) return Response.json({ error: "There's no staff card for you here yet." }, { status: 404, headers: { "cache-control": "no-store" } });

  const requested = new URL(request.url).searchParams.get("period") ?? undefined;
  const { settings } = await getPaySettings(ctx.orgId);
  const t = await loadTimesheetFor({ orgId: ctx.orgId, staffId, today: todayInAu() }, settings, requested);
  if (!t) return Response.json({ error: "There's no timesheet for you here yet." }, { status: 404, headers: { "cache-control": "no-store" } });
  if ("subcontractor" in t) return ok({ subcontractor: true });

  const week: WeekCtx = {
    week: t.week,
    today: t.today,
    through: t.through,
    workDays: t.workDays,
    dayHours: t.me.dayHours,
    holidays: t.me.holidayDays,
    certMissing: t.me.certMissing,
  };
  const d = derive(t.me, settings, week);
  const period = t.periods[t.periodIndex];
  return ok({
    period: { start: t.periodStart, end: t.periodEnd, range: period?.range ?? null, live: period?.live ?? false },
    periods: t.periods.map((p) => ({ start: p.start, range: p.range, live: p.live })),
    status: t.sheet.status,
    pastSend: t.pastSend,
    todayISO: t.todayISO,
    days: t.me.days.map((entry, i) => {
      const cls = dayClass(entry, i, settings, week);
      return { date: dateOfDay(t.periodStart, i), entry, cls, word: DAY_WORD[cls], source: t.sources[i] ?? null };
    }),
    totals: { worked: d.worked, normal: d.normal, ot: d.ot, ot2: d.ot2, paidAbsence: d.leave + d.sick + d.ph },
  });
}
