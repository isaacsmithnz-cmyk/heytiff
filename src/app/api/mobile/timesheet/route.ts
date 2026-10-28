import { getPaySettings } from "@/lib/timepay/query";
import { loadTimesheetFor } from "@/lib/timepay/page-data";
import { dateOfDay, isIsoDate, periodConfig, periodDays, periodStartFor } from "@/lib/timepay/period";
import { staffIdFor } from "@/lib/workboard/projects-query";
import { todayInAu } from "@/lib/au-dates";
import {
  dayClass,
  derive,
  derivedDayHours,
  dowOf,
  expectedDay,
  expectsWork,
  fmtHval,
  isOver,
  seedBreakMinutes,
  splitDay,
  type DayEntry,
  type WeekCtx,
} from "@/components/timepay/logic";
import { SOURCE_NOTE, clampBreak, dayWord, sheetLine } from "@/components/timepay/sheet-line";
import { saveDay, submitWeek } from "@/app/actions/timepay";
import { actAsPhoneUser, ok, requireMobile } from "@/lib/mobile/auth";

/* YOUR TIMESHEET for the phone: one pay period, read by the same loader My
   timesheet reads with (timepay/page-data's loadTimesheetFor), so the week
   is filled in, and sent at the workspace's moment, exactly as the page does
   it. Then worked out on the server with the page's own rules (derive,
   dayClass, sheet-line), so the phone only draws: each day's hours, its one
   word and where it came from, the totals that go to payroll, and the line
   beside Send.

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
  const live = period?.live ?? false;
  const line = sheetLine({
    status: t.sheet.status,
    live,
    pastSend: t.pastSend,
    settings,
    ctx: week,
    casual: t.employment === "casual",
    salaried: t.salaried,
    entries: d.entries,
  });
  const holidayOn = new Map(t.holidays.map((h) => [h.date, h.name]));
  /* the days can't be changed here: a sent week, a closed period, a week
     locked at its send moment, or a salaried week, which pays itself */
  const locked = line.frozenSent || (!live && !line.reopened) || line.closedAtSend || t.salaried;
  return ok({
    period: { start: t.periodStart, end: t.periodEnd, range: period?.range ?? null, live },
    periods: t.periods.map((p) => ({ start: p.start, range: p.range, live: p.live })),
    status: t.sheet.status,
    pastSend: t.pastSend,
    todayISO: t.todayISO,
    sheet: { label: line.status.label, sub: line.sub, canSend: line.canSend, sendWord: line.sendWord, locked },
    normal: t.normal,
    /* what a day's preview needs to say what the day is (POST do:preview) */
    week: { workDays: t.workDays, dayHours: t.me.dayHours ?? null, holidays: t.me.holidayDays ?? [] },
    breakMinutes: settings.breakPaid ? 0 : settings.breakMinutes,
    days: t.me.days.map((entry, i) => {
      const cls = dayClass(entry, i, settings, week);
      const date = dateOfDay(t.periodStart, i);
      const dow = dowOf(t.week[i]);
      const source = t.sources[i] ?? null;
      return {
        date,
        entry,
        cls,
        word: dayWord(entry, cls, dow, settings),
        source,
        note: source ? SOURCE_NOTE[source] : null,
        holiday: holidayOn.get(date) ?? null,
        expected: expectsWork(week, dow),
        over: isOver(week, i),
        breakMin: seedBreakMinutes(entry, settings),
      };
    }),
    totals: { worked: d.worked, normal: d.normal, ot: d.ot, ot2: d.ot2, paidAbsence: d.leave + d.sick + d.ph },
  });
}

const bad = (error: string) => Response.json({ error }, { status: 400, headers: { "cache-control": "no-store" } });

/* A DAY AS THE PHONE SAYS IT: worked between two clock times (with the
   day's unpaid break, where the workspace has one), off, or back to normal.
   The hours are worked out here from the clocks, never taken from the
   phone, and saveDay proves them again. */
function dayOf(raw: unknown, settings: Parameters<typeof derivedDayHours>[2]): DayEntry | string {
  const e = raw as { t?: unknown; in?: unknown; out?: unknown; breakMin?: unknown } | null;
  if (e?.t === "off") return { t: "off" };
  if (e?.t === "empty") return { t: "empty" };
  if (e?.t !== "work" || typeof e.in !== "string" || typeof e.out !== "string") return "That isn't a day the timesheet can keep.";
  const breakMin = typeof e.breakMin === "number" && Number.isFinite(e.breakMin) ? clampBreak(e.breakMin) : undefined;
  const h = derivedDayHours(e.in, e.out, settings, breakMin);
  if (h === null) return "Those times couldn't be read as clock times.";
  return { t: "work", in: e.in, out: e.out, h };
}

/* CHANGING YOUR TIMESHEET from the phone is the page's own two actions,
   saveDay and submitWeek, run as the phone's own verified person
   (actAsPhoneUser), so every rule the page keeps (your own rows only, a
   sent or locked week closed, leave and holidays never typed in, hours
   proved against the clocks) is kept the same way.

   A PREVIEW says what a day would come to before it is saved: its hours,
   its word and its payroll split, by the page's own rules. It saves
   nothing, so the facts about the person it needs (their work days, their
   own normal day, the period's holidays) are the ones the phone was handed
   with the week; Save goes through saveDay, which reads them for itself. */
export async function POST(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;

  const body = (await request.json().catch(() => null)) as {
    do?: unknown;
    period?: unknown;
    index?: unknown;
    entry?: unknown;
    week?: { workDays?: unknown; dayHours?: unknown; holidays?: unknown };
  } | null;
  const periodStart = typeof body?.period === "string" ? body.period : "";
  if (!isIsoDate(periodStart)) return bad("That pay period isn't a real date.");

  if (body?.do === "send") {
    const r = await actAsPhoneUser(ctx, () => submitWeek(periodStart));
    return r.ok ? ok({ ok: true }) : bad(r.error);
  }

  if (body?.do !== "day" && body?.do !== "preview") return bad("That isn't something the timesheet does.");
  const index = typeof body.index === "number" ? body.index : -1;
  const { settings } = await getPaySettings(ctx.orgId);
  const entry = dayOf(body.entry, settings);
  if (typeof entry === "string") return bad(entry);

  if (body.do === "day") {
    const r = await actAsPhoneUser(ctx, () => saveDay(periodStart, index, entry));
    return r.ok ? ok({ ok: true }) : bad(r.error);
  }

  const cfg = periodConfig(settings);
  if (periodStartFor(periodStart, cfg) !== periodStart) return bad("That date doesn't start a pay period for this organisation.");
  const days = periodDays(periodStart, cfg);
  if (!Number.isInteger(index) || index < 0 || index >= days.length) return bad("That day isn't in this pay period.");
  const ints = (v: unknown) => (Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n)) : []);
  const week: WeekCtx = {
    week: days,
    today: 0,
    workDays: Array.isArray(body.week?.workDays) ? ints(body.week.workDays) : undefined,
    dayHours: typeof body.week?.dayHours === "number" ? body.week.dayHours : undefined,
    holidays: ints(body.week?.holidays),
  };
  const dow = dowOf(days[index]);
  const cls = dayClass(entry, index, settings, week);
  const h = entry.t === "work" ? entry.h : 0;
  const split = splitDay(h, dow, settings, {
    publicHoliday: (week.holidays ?? []).includes(index),
    ...(entry.t === "work" ? { in: entry.in, out: entry.out } : {}),
  });
  const ownDay = expectedDay(week, settings);
  return ok({
    h,
    cls,
    word: dayWord(entry, cls, dow, settings),
    /* the payroll lines, only when the day is worth more than its hours */
    split: split.o15 || split.o2 ? { n: split.n, o15: split.o15, o2: split.o2, forPayroll: split.n + split.o15 * 1.5 + split.o2 * 2 } : null,
    short: entry.t === "work" && expectsWork(week, dow) && h < ownDay ? `Short of your ${fmtHval(ownDay)} day, your manager will see it` : null,
  });
}
