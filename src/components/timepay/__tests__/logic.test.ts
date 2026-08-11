import {
  DEFAULT_SETTINGS,
  type DayEntry,
  type Settings,
  type StaffWeek,
  type WeekDay,
  type WeekCtx,
  breakLine,
  dayClass,
  derive,
  derivedDayHours,
  fmt,
  fmtH,
  initials,
  nightHours,
  parseClock,
  rosteredWeekHours,
  ruleSummary,
  seedBreakMinutes,
  spanHours,
  splitDay,
  submitNote,
  weekGroups,
  daysToCome,
  issueHeading,
} from "../logic";
/* The prototype-parity roster. It used to live in mock/demo.ts; Stage 5 moved
   Time & Pay onto real tables and deleted that file's timepay fixtures, but
   these expectations were verified against the design prototype's own derive
   pipeline run in Node, so the roster stays here as the parity fixture. */

const LV: DayEntry = { t: "leave", h: 8 };
const SK: DayEntry = { t: "sick", h: 8 };
const w = (i: string, o: string, h: number): DayEntry => ({ t: "work", in: i, out: o, h });
const NO = { t: "empty" } as DayEntry;

const demoTimepayWeek: WeekDay[] = [
  ["MON", 29, "Jun"],
  ["TUE", 30, "Jun"],
  ["WED", 1, "Jul"],
  ["THU", 2, "Jul"],
  ["FRI", 3, "Jul"],
  ["SAT", 4, "Jul"],
  ["SUN", 5, "Jul"],
];
const demoTimepayToday = 4;

const demoTimepayStaff: StaffWeek[] = [
  { id: "s1", name: "Boston Hayes", role: "Installer", rate: 44,
    days: [w("07:00", "16:00", 9), w("07:00", "15:00", 8), w("07:00", "16:00", 9), w("07:00", "15:00", 8), w("07:00", "15:00", 8), NO, NO] },
  { id: "s2", name: "Priya Nair", role: "Service Technician", rate: 46,
    days: [w("08:00", "16:00", 8), w("06:30", "19:30", 11.5), w("08:00", "16:00", 8), w("08:00", "16:00", 8), w("08:00", "16:00", 8), NO, NO] },
  { id: "s3", name: "Marcus Webb", role: "Installer", rate: 44,
    days: [w("07:00", "15:00", 8), w("07:00", "15:00", 8), w("07:00", "15:00", 8), w("07:00", "15:00", 8), w("07:00", "15:00", 8), NO, NO] },
  { id: "s4", name: "Jordan Mills", role: "Lead Installer", rate: 52,
    days: [w("06:30", "14:30", 8), w("06:30", "16:00", 9.5), w("06:30", "14:30", 8), w("06:30", "14:30", 8), w("06:30", "14:30", 8), w("07:00", "11:00", 4), NO] },
  { id: "s5", name: "Hannah Cole", role: "Estimator", rate: 48,
    days: [w("09:00", "17:00", 8), w("09:00", "17:00", 8), w("09:00", "17:00", 8), SK, w("09:00", "17:00", 8), NO, NO] },
  { id: "s6", name: "Sophie Tran", role: "Office Manager", rate: 45,
    days: [w("08:30", "16:30", 8), w("08:30", "16:30", 8), w("08:30", "16:30", 8), w("08:30", "16:30", 8), LV, NO, NO] },
  { id: "s7", name: "Dylan Reyes", role: "Installer", rate: 44,
    days: [w("07:00", "15:00", 8), w("07:00", "15:00", 8), w("07:00", "15:00", 8), w("07:00", "15:00", 8), w("07:00", "15:00", 8), NO, NO] },
];

/* Expectations verified against the design prototype's derive pipeline
   (design_handoff_time_and_pay/app/timepay-review.js) run in Node. */

const ctx: WeekCtx = { week: demoTimepayWeek, today: demoTimepayToday };
const S = (over: Partial<Settings> = {}): Settings =>
  JSON.parse(JSON.stringify({ ...DEFAULT_SETTINGS, ...over }));

const W = (i: string, o: string, h: number): DayEntry => ({ t: "work", in: i, out: o, h });
const w8 = W("07:00", "15:00", 8);
const EM: DayEntry = { t: "empty" };
const staff = (days: DayEntry[], rate: number | null = 40) => ({
  id: "staff-1",
  name: "Test Person",
  role: "Installer",
  rate,
  days,
});

describe("splitDay", () => {
  it("splits a weekday beyond dblAfter into 1x/1.5x/2x", () => {
    expect(splitDay(13, 0, S())).toEqual({ n: 8, o15: 4, o2: 1 });
  });
  it("applies Saturday step-up rates", () => {
    expect(splitDay(4, 5, S())).toEqual({ n: 0, o15: 2, o2: 2 });
    expect(splitDay(1.5, 5, S())).toEqual({ n: 0, o15: 1.5, o2: 0 });
  });
  it("pays all Sunday hours at 2x", () => {
    expect(splitDay(6, 6, S())).toEqual({ n: 0, o15: 0, o2: 6 });
  });
  it("treats a weekend day as a weekday when its rule is off", () => {
    const s = S();
    s.rules.sat.on = false;
    expect(splitDay(4, 5, s)).toEqual({ n: 4, o15: 0, o2: 0 });
    expect(splitDay(10, 5, s)).toEqual({ n: 8, o15: 2, o2: 0 });
  });
});

describe("derive — demo staff on default settings", () => {
  const byName = Object.fromEntries(
    demoTimepayStaff.map((s) => [s.name, derive(s, DEFAULT_SETTINGS, ctx)])
  );

  it("Boston: two 9h days -> 2h at 1.5x, review", () => {
    const d = byName["Boston Hayes"];
    expect([d.normal, d.ot, d.ot2]).toEqual([40, 2, 0]);
    expect(d.worked).toBe(42);
    expect(d.weighted).toBe(43);
    expect(d.status).toBe("review");
    expect(d.issueTitle).toBe("Overtime to confirm");
  });

  it("Priya: 11.5h day -> 3.5h at 1.5x", () => {
    const d = byName["Priya Nair"];
    expect([d.normal, d.ot, d.ot2]).toEqual([40, 3.5, 0]);
  });

  it("Jordan: weekday OT plus Saturday step-up rates", () => {
    const d = byName["Jordan Mills"];
    expect([d.normal, d.ot, d.ot2]).toEqual([40, 3.5, 2]);
    expect(d.weighted).toBe(40 + 3.5 * 1.5 + 2 * 2);
    expect(d.bullets).toContain("Sat 4 Jul — 4h at Saturday rates (2h @1.5×, then 2h @2×)");
    /* Two kinds of issue, so the heading names both and drops the verb — see
       `issueHeading`. Double time leads: it is the more expensive one. */
    expect(d.issueTitle).toBe("Double time · Overtime");
  });

  it("Marcus and Dylan: clean 40h weeks are ready with no bullets", () => {
    for (const name of ["Marcus Webb", "Dylan Reyes"]) {
      expect(byName[name].status).toBe("ready");
      expect(byName[name].bullets).toHaveLength(0);
    }
  });

  /* AN ABSENT WEEK REACHES A PERSON — Isaac's call, taken back after a round
     where it didn't. A period somebody was away for is one an approver should
     look at before it is paid, whoever approved the absence.

     What DID change is the wording. A timesheet cannot declare leave, so every
     sick and leave day came from a request the leave module already approved,
     and asking this screen to "check it was requested" was that approval a
     second time. The line says where the day came from instead. */
  it("Hannah: a sick day still reaches the approver", () => {
    const d = byName["Hannah Cole"];
    expect([d.status, d.sick, d.weighted]).toEqual(["review", 8, 40]);
    expect(d.bullets.join(" ")).toContain("approved in My leave");
    expect(d.bullets.join(" ")).not.toMatch(/check it was requested/);
  });

  /* THE CERTIFICATE LINE IS ANSWERABLE NOW. It used to read "chase a
     certificate if your workspace needs one" on every sick day — a prompt with
     nothing behind it, because there was no field and nothing to upload. A
     leave request carries one, so the bullet says which of the three states
     the day is in rather than making the approver guess. Silence is one of
     them: a workspace with no threshold set never sees the word. */
  it("says nothing about certificates when none is outstanding", () => {
    expect(byName["Hannah Cole"].bullets.join(" ")).not.toMatch(/certificate/);
  });

  it("names the day when one IS outstanding", () => {
    const days: DayEntry[] = [SK, w8, w8, w8, w8, NO, NO];
    const d = derive(staff(days), DEFAULT_SETTINGS, { ...ctx, through: 6, certMissing: [0] });
    expect(d.bullets.join(" ")).toMatch(/Mon 29 Jun.*still waiting on a medical certificate/);
  });

  it("Sophie: annual leave does too, without asking for a second approval", () => {
    const d = byName["Sophie Tran"];
    expect([d.status, d.leave]).toEqual(["review", 8]);
    expect(d.bullets).toContain("Fri 3 Jul — annual leave (8h), already approved in My leave");
    expect(d.bullets.join(" ")).not.toMatch(/check it was requested/);
  });

  it("a public holiday still does NOT — nobody chose it and it closed the business", () => {
    const days: DayEntry[] = [w8, w8, w8, w8, { t: "ph", h: 8 }, NO, NO];
    expect(derive(staff(days), DEFAULT_SETTINGS, ctx).status).toBe("ready");
  });
});

describe("derive — rules and edge cases", () => {
  it("counts missing entries only on weekdays that are OVER", () => {
    const d = derive(staff([w8, EM, EM, w8, EM, EM, EM]), S(), ctx);
    // Tue and Wed. NOT Friday — Friday is today, and today is not over: at
    // 6am there is nothing to have put in yet. Weekend empties never count.
    expect(d.missing).toBe(2);
    expect(d.status).toBe("review");
    expect(d.issueTitle).toBe("Missing entries to chase");
  });

  /* THE BUG THIS REPLACES: `missing` used `i <= today` while the presumption
     filled days in only once they were over. The two disagreed by exactly one
     day, so at 6:45am on Tuesday the screen said "Tue — no entry logged" and
     put the day up to be chased, for a day the person hadn't worked yet. */
  it("does not chase TODAY, and does chase it once the day is over", () => {
    const days = [w8, EM, EM, w8, EM, EM, EM];
    const live = derive(staff(days), S(), { ...ctx, through: 3 }); // Fri is today
    const done = derive(staff(days), S(), { ...ctx, through: 4 }); // Fri has ended
    expect(live.missing).toBe(2);
    expect(done.missing).toBe(3);
    expect(live.bullets.some((b) => b.includes("Fri"))).toBe(false);
    expect(done.bullets.some((b) => b.includes("Fri"))).toBe(true);
  });

  it("a closed period has every day over, so nothing escapes the count", () => {
    // a historical period passes through = last index; today's clamp doesn't
    // get to excuse the final day
    const d = derive(staff([w8, EM, EM, w8, EM, EM, EM]), S(), { ...ctx, through: 6 });
    expect(d.missing).toBe(3); // Tue, Wed, Fri
  });

  it("weekly overtime mode moves the week's excess to 1.5x", () => {
    const w9 = W("07:00", "16:00", 9);
    const d = derive(staff([w9, w9, w9, w9, w9, EM, EM]), S({ otUnit: "week", otAfter: 38 }), ctx);
    expect([d.normal, d.ot, d.ot2]).toEqual([38, 7, 0]);
    expect(d.status).toBe("review");
  });

  it("weekly mode keeps weekend penalty hours out of the weekly pool", () => {
    const d = derive(
      staff([w8, w8, w8, w8, w8, W("07:00", "11:00", 4), EM]),
      S({ otUnit: "week", otAfter: 38 }),
      ctx
    );
    // 40h weekday normal -> 2h moved to 1.5x; Sat 4h stays at its own 2h/2h split
    expect([d.normal, d.ot, d.ot2]).toEqual([38, 4, 2]);
  });

  it("under days flag review with a bullet", () => {
    const d = derive(staff([W("09:00", "15:00", 6), w8, w8, w8, w8, EM, EM]), S(), ctx);
    expect([d.under, d.status]).toEqual([1, "review"]);
    expect(d.bullets).toContain("Mon 29 Jun — under day: 6h of 8h");
  });

  it("a public-holiday day pays at 1x and does not trigger review", () => {
    const d = derive(staff([w8, { t: "ph", h: 8 }, w8, w8, w8, EM, EM]), S(), ctx);
    expect([d.ph, d.weighted, d.status]).toEqual([8, 40, "ready"]);
  });

  it("a short Saturday with its rule off does not trigger review", () => {
    const s = S();
    s.rules.sat.on = false;
    const d = derive(staff([w8, w8, w8, w8, w8, W("07:00", "11:00", 4), EM]), s, ctx);
    expect([d.normal, d.ot, d.ot2, d.status]).toEqual([44, 0, 0, "ready"]);
  });

  it("returns no gross at all when the rate is absent", () => {
    // the hours-only payload: without `financials` the query never selects the
    // wage column, so there is nothing to state a wage from — and derive()
    // must say so rather than quietly computing zero dollars
    const d = derive(staff([w8, w8, w8, w8, w8, EM, EM], null), S(), ctx);
    expect(d.gross).toBeNull();
    expect(d.worked).toBe(40); // hours are unaffected
    expect(d.weighted).toBe(40); // weighted HOURS, not money
  });

  it("gross multiplies buckets by the staff rate", () => {
    const d = derive(staff([W("06:00", "20:00", 13), w8, w8, w8, w8, EM, EM]), S(), ctx);
    // 13h day: 8 @1x + 4 @1.5x + 1 @2x, plus 4 clean 8h days
    expect(d.gross).toBe((8 + 32) * 40 + 4 * 40 * 1.5 + 1 * 40 * 2);
  });
});

describe("dayClass", () => {
  it("classifies each day type", () => {
    expect(dayClass(w8, 0, S(), ctx)).toBe("std");
    expect(dayClass(W("07:00", "16:00", 9), 0, S(), ctx)).toBe("over");
    expect(dayClass(W("09:00", "15:00", 6), 0, S(), ctx)).toBe("under");
    expect(dayClass({ t: "leave", h: 8 }, 0, S(), ctx)).toBe("leave");
    expect(dayClass({ t: "sick", h: 8 }, 0, S(), ctx)).toBe("sick");
    expect(dayClass({ t: "ph", h: 8 }, 0, S(), ctx)).toBe("ph");
  });

  it("marks an empty weekday missing only once it is OVER", () => {
    // index 4 is Friday, and Friday is today — not over, so not missing
    expect(dayClass(EM, 4, S(), ctx)).toBe("empty");
    expect(dayClass(EM, 4, S(), { ...ctx, through: 4 })).toBe("miss");
    // earlier weekdays are over and do count
    expect(dayClass(EM, 1, S(), ctx)).toBe("miss");
    // the weekend is never missing whatever the date
    expect(dayClass(EM, 5, S(), { ...ctx, through: 6 })).toBe("empty");
    expect(dayClass(EM, 6, S(), { ...ctx, through: 6 })).toBe("empty");
  });

  it("keeps a short Saturday neutral when its rule is off (matches derive)", () => {
    const s = S();
    s.rules.sat.on = false;
    expect(dayClass(W("07:00", "11:00", 4), 5, s, ctx)).toBe("std");
  });
});

describe("formatting helpers", () => {
  it("fmt renders integers bare and halves to one decimal", () => {
    expect(fmt(8)).toBe("8");
    expect(fmt(3.5)).toBe("3.5");
    expect(fmt(null)).toBe("—");
  });
  it("initials and rule summaries", () => {
    expect(initials("Boston Hayes")).toBe("BH");
    expect(ruleSummary({ on: true, rate: 2, up: null })).toBe("2× all day");
    expect(ruleSummary({ on: true, rate: 1.5, up: 2 })).toBe("1.5× first 2h, then 2×");
  });
  it("builds the live-period note from settings", () => {
    expect(submitNote(DEFAULT_SETTINGS)).toBe("Open · auto-submits Sun 3:00 PM, then locks");
    expect(submitNote({ ...DEFAULT_SETTINGS, lock: false })).toBe("Open · auto-submits Sun 3:00 PM");
  });
});

describe("a period is not a week", () => {
  /* Fourteen day tuples: two full weeks starting Monday 29 Jun. */
  const fortnight: WeekDay[] = [
    ["MON", 29, "Jun"], ["TUE", 30, "Jun"], ["WED", 1, "Jul"], ["THU", 2, "Jul"],
    ["FRI", 3, "Jul"], ["SAT", 4, "Jul"], ["SUN", 5, "Jul"],
    ["MON", 6, "Jul"], ["TUE", 7, "Jul"], ["WED", 8, "Jul"], ["THU", 9, "Jul"],
    ["FRI", 10, "Jul"], ["SAT", 11, "Jul"], ["SUN", 12, "Jul"],
  ];
  const fnCtx: WeekCtx = { week: fortnight, today: 13 };
  const none = { t: "empty" } as DayEntry;

  it("pays the SECOND Saturday at weekend rates, not weekday rates", () => {
    // day 12 is a Saturday. Positionally it is neither 5 nor 6, so the old
    // index-based rule silently paid it as an ordinary weekday.
    const days = [w8, w8, w8, w8, w8, none, none, w8, w8, w8, w8, w8, W("07:00", "11:00", 4), none];
    const d = derive(staff(days), S(), fnCtx);
    expect(d.bullets).toContain("Sat 11 Jul — 4h at Saturday rates (2h @1.5×, then 2h @2×)");
    expect([d.ot, d.ot2]).toEqual([2, 2]);
  });

  it("does not treat the second Monday as a weekend", () => {
    // day 7 is a Monday; the old rule had already run out of week by then
    const days = [...Array(7).fill(none), W("07:00", "18:00", 11), ...Array(6).fill(none)];
    const d = derive(staff(days as DayEntry[]), S(), fnCtx);
    expect([d.normal, d.ot, d.ot2]).toEqual([8, 3, 0]); // weekday overtime, not 2x all day
  });

  it("flags a missing SECOND-week weekday, and never a weekend", () => {
    const days = Array(14).fill(none) as DayEntry[];
    const d = derive(staff(days), S(), fnCtx);
    // 10 weekdays across the fortnight, no weekend days
    expect(d.missing).toBe(10);
    expect(d.bullets).toContain("Thu 9 Jul — no entry logged");
    expect(d.bullets.some((b) => b.includes("Sat") || b.includes("Sun"))).toBe(false);
  });

  it("dayClass reads the weekday from the period, not the column", () => {
    expect(dayClass(W("07:00", "11:00", 4), 12, S(), fnCtx)).toBe("over"); // 2nd Saturday
    expect(dayClass(W("07:00", "11:00", 4), 8, S(), fnCtx)).toBe("under"); // 2nd Tuesday
    expect(dayClass({ t: "empty" }, 13, S(), fnCtx)).toBe("empty"); // Sunday is never missing
  });

  it("applies WEEKLY overtime per week, not once across the fortnight", () => {
    // 38h in each week is a full standard fortnight — ZERO overtime. The old
    // rule summed 76h against the 38h threshold and invented 38h of overtime.
    const wk = W("07:36", "16:00", 7.6); // 5 × 7.6 = 38
    const days = [wk, wk, wk, wk, wk, none, none, wk, wk, wk, wk, wk, none, none];
    const weekly = S({ otUnit: "week", otAfter: 38 });
    const d = derive(staff(days), weekly, fnCtx);
    expect([d.normal, d.ot]).toEqual([76, 0]);

    // push ONE week to 42h: only that week's 4h excess is overtime
    const busy = [...days];
    busy[0] = W("07:00", "17:24", 10.4); // week 1 = 40.8; +2.8 over
    const d2 = derive(staff(busy), weekly, fnCtx);
    expect(d2.ot).toBeCloseTo(2.8, 5);
  });

  it("weekGroups splits a fortnight into two week-rows with subtotals", () => {
    const days = [w8, w8, w8, w8, w8, none, none, w8, w8, w8, none, none, none, none];
    const groups = weekGroups(days);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ label: "Week 1", start: 0, workedHours: 40 });
    expect(groups[1]).toMatchObject({ label: "Week 2", start: 7, workedHours: 24 });
    // indices stay absolute so dayClass/splitDay still get the right day
    expect(groups[1].days[0].index).toBe(7);
    // a plain week is a single group
    expect(weekGroups(days.slice(0, 7))).toHaveLength(1);
  });
});

/* ---------------- clock → hours ----------------

   The bug this replaced: a worked day carried a start, a finish AND a typed
   `h`, so a day could be saved with both times set and 0.00 hours. These are
   the pure functions that make the hours a consequence of the times, so the
   two can no longer disagree. */

const withBreak = (minutes: number, paid: boolean): Settings => ({
  ...DEFAULT_SETTINGS,
  breakMinutes: minutes,
  breakPaid: paid,
});

describe("parseClock", () => {
  it.each([
    ["7:00 AM", 7 * 60],
    ["7:00 am", 7 * 60],
    ["07:00", 7 * 60],
    ["7", 7 * 60],
    ["7am", 7 * 60],
    ["7 a.m.", 7 * 60],
    ["0700", 7 * 60],
    ["3:30 PM", 15 * 60 + 30],
    ["3.30 pm", 15 * 60 + 30],
    ["15:30", 15 * 60 + 30],
    ["1530", 15 * 60 + 30],
    ["  3:30PM  ", 15 * 60 + 30],
    ["12:00 AM", 0],
    ["12:30 AM", 30],
    ["12:00 PM", 12 * 60],
    ["12:45 PM", 12 * 60 + 45],
    ["00:00", 0],
    ["23:59", 23 * 60 + 59],
  ])("reads %s", (input, minutes) => {
    expect(parseClock(input)).toBe(minutes);
  });

  it.each([
    "",
    "   ",
    "half seven",
    "24:00",
    "7:60",
    "13:00 PM",
    "0:30 AM",
    "am",
    "700",
    "7:00:30",
    "-3",
  ])("refuses %s rather than guessing", (input) => {
    expect(parseClock(input)).toBeNull();
  });

  it("reads one minute digit literally — 3.3 pm is 3:03, not half past", () => {
    // padding it the other way would silently invent 27 minutes
    expect(parseClock("3.3 pm")).toBe(15 * 60 + 3);
  });
});

describe("spanHours", () => {
  it("measures a normal day", () => {
    expect(spanHours("7:00 AM", "3:00 PM")).toBe(8);
    expect(spanHours("7:00 AM", "3:30 PM")).toBe(8.5);
  });

  it("crosses midnight rather than going negative", () => {
    expect(spanHours("10:00 PM", "6:00 AM")).toBe(8);
    expect(spanHours("23:30", "00:30")).toBe(1);
  });

  it("is null when either end can't be read", () => {
    expect(spanHours("banana", "3:00 PM")).toBeNull();
    expect(spanHours("7:00 AM", "")).toBeNull();
  });
});

describe("derivedDayHours", () => {
  it("is the whole span when no break is configured", () => {
    expect(derivedDayHours("7:00 AM", "3:00 PM", DEFAULT_SETTINGS)).toBe(8);
  });

  it("deducts an unpaid break", () => {
    expect(derivedDayHours("7:00 AM", "3:00 PM", withBreak(30, false))).toBe(7.5);
    expect(derivedDayHours("7:00 AM", "3:00 PM", withBreak(45, false))).toBe(7.25);
  });

  it("deducts nothing for a paid break — it's on the clock", () => {
    expect(derivedDayHours("7:00 AM", "3:00 PM", withBreak(30, true))).toBe(8);
  });

  it("takes a per-day override, but only when the break is unpaid", () => {
    expect(derivedDayHours("7:00 AM", "3:00 PM", withBreak(30, false), 20)).toBe(7.67);
    expect(derivedDayHours("7:00 AM", "3:00 PM", withBreak(30, false), 0)).toBe(8);
    // paid: an override is meaningless, so it changes nothing
    expect(derivedDayHours("7:00 AM", "3:00 PM", withBreak(30, true), 60)).toBe(8);
  });

  it("clamps the deduction at the span — a short call-out is 0h, never below", () => {
    expect(derivedDayHours("7:00 AM", "7:20 AM", withBreak(30, false))).toBe(0);
    expect(derivedDayHours("7:00 AM", "7:20 AM", withBreak(120, false))).toBe(0);
  });

  it("carries the cross-midnight span through the break", () => {
    expect(derivedDayHours("10:00 PM", "6:00 AM", withBreak(30, false))).toBe(7.5);
  });

  it("is null when the times can't be read — the caller must refuse to save", () => {
    expect(derivedDayHours("half seven", "3:00 PM", DEFAULT_SETTINGS)).toBeNull();
    expect(derivedDayHours("7:00 AM", "", withBreak(30, false))).toBeNull();
  });

  it("rounds to two places, so 20 minutes off eight hours is 7.67", () => {
    expect(derivedDayHours("7:00 AM", "3:00 PM", withBreak(20, false))).toBe(7.67);
  });
});

describe("seedBreakMinutes", () => {
  const day = (i: string, o: string, h: number): DayEntry => ({ t: "work", in: i, out: o, h });

  it("recovers the break that was actually taken — span minus stored hours", () => {
    // no column stores a per-day break, so it is read back out of the entry
    expect(seedBreakMinutes(day("7:00 AM", "3:00 PM", 7.5), withBreak(30, false))).toBe(30);
    expect(seedBreakMinutes(day("7:00 AM", "3:00 PM", 7.25), withBreak(30, false))).toBe(45);
  });

  it("falls back to the org standard when there's nothing to read it from", () => {
    expect(seedBreakMinutes({ t: "empty" }, withBreak(30, false))).toBe(30);
    expect(seedBreakMinutes(day("nope", "3:00 PM", 8), withBreak(30, false))).toBe(30);
    // out of the stepper's range (a legacy row with hours nobody derived)
    expect(seedBreakMinutes(day("7:00 AM", "3:00 PM", 2), withBreak(30, false))).toBe(30);
  });

  it("is just the org number when the break is paid or absent", () => {
    expect(seedBreakMinutes(day("7:00 AM", "3:00 PM", 7.5), withBreak(30, true))).toBe(30);
    expect(seedBreakMinutes(day("7:00 AM", "3:00 PM", 7.5), DEFAULT_SETTINGS)).toBe(0);
  });
});

describe("breakLine", () => {
  it("is empty when no break is configured", () => {
    expect(breakLine(DEFAULT_SETTINGS)).toBe("");
  });

  it("says the minutes and whether they're paid", () => {
    expect(breakLine(withBreak(30, false))).toBe("30 min unpaid break");
    expect(breakLine(withBreak(30, true))).toBe("30 min paid break");
    expect(breakLine(withBreak(30, false), 20)).toBe("20 min unpaid break");
  });

  /* NO INTERIOR "·". The rules footnote joins its items with " · ", and this
     string used to carry one of its own ("Break: 30 min · unpaid"), so the
     footnote ran "30 min break · unpaid · Sat 1.5× first 2h · then 2×" with no
     way to tell a divider from a continuation. Same reason `ruleSummary` uses
     a comma. */
  it("keeps the list separator out of the item", () => {
    expect(breakLine(withBreak(30, false))).not.toContain("·");
    expect(ruleSummary({ on: true, rate: 1.5, up: 2 })).not.toContain("·");
    expect(submitNote({ ...DEFAULT_SETTINGS, lock: true }).replace(/^Open · /, "")).not.toContain(
      "·",
    );
  });

  /* A day whose break is recovered as zero — `seedBreakMinutes` reads it back
     out of what was saved — used to render "Break: 0 min · unpaid": a payment
     status for a break that isn't there. */
  it("does not price a break of no minutes", () => {
    expect(breakLine(withBreak(30, false), 0)).toBe("No break on this day");
  });
});

describe("fmtH", () => {
  it("states hours at the precision they are stored, unlike fmt", () => {
    expect(fmtH(8)).toBe("8");
    expect(fmtH(7.5)).toBe("7.5");
    // fmt rounds to one place for a review column; a field that is about to
    // save 7.67 must not print 7.7
    expect(fmtH(7.67)).toBe("7.67");
    expect(fmt(7.67)).toBe("7.7");
    expect(fmtH(null)).toBe("—");
  });
});

/* The rostered week: what Time & Pay actually presumes onto somebody, stated
   in the same unit as the `contracted_hours` figure typed on the Payroll card.
   The two are separate on purpose — one costs jobs, one fills timesheets — so
   this only has to be RIGHT, never reconciling. */
describe("rosteredWeekHours", () => {
  const at = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });

  it("prices the org's own default week: 7-3, Mon-Fri, is 40h", () => {
    expect(rosteredWeekHours(at(), {})).toBe(40);
  });

  it("honours a person's own hours over the org's", () => {
    expect(rosteredWeekHours(at(), { hours: { start: "8:00 AM", end: "4:30 PM" } })).toBe(42.5);
  });

  it("counts the days THEY work, not the days the org does", () => {
    // a part-timer on Mon/Tue/Thu — 3 x 8h, not 5
    expect(rosteredWeekHours(at(), { workDays: [0, 1, 3] })).toBe(24);
  });

  it("an empty roster is a real answer, not a missing one", () => {
    expect(rosteredWeekHours(at(), { workDays: [] })).toBe(0);
  });

  /* The break is a pay setting and it comes off worked hours when unpaid, so
     a week that ignored it would overstate every roster in the workspace by
     the length of five lunches. */
  it("deducts an unpaid break from every rostered day", () => {
    expect(rosteredWeekHours(at({ breakMinutes: 30, breakPaid: false }), {})).toBe(37.5);
    expect(rosteredWeekHours(at({ breakMinutes: 30, breakPaid: true }), {})).toBe(40);
  });

  it("refuses to state a week for people who have none", () => {
    // nothing is ever presumed for a casual, and a subbie has no timesheet;
    // a figure here would be a claim about hours nobody agreed to
    expect(rosteredWeekHours(at(), {}, "casual")).toBeNull();
    expect(rosteredWeekHours(at(), {}, "subbie")).toBeNull();
    expect(rosteredWeekHours(at(), {}, null)).toBe(40); // unset classifies permanent
  });

  it("returns null rather than a zero when the times can't be read", () => {
    expect(rosteredWeekHours(at({ defaultStart: "sometime", defaultEnd: "later" }), {})).toBeNull();
  });

  /* Half an override would silently price a day at the org's finish time --
     the same rule normalHours enforces, checked here because this is the
     number an owner reads off the card. */
  it("ignores a half-written override and falls back to the org", () => {
    expect(rosteredWeekHours(at(), { hours: { start: "6:00 AM" } })).toBe(40);
  });
});

/* The two penalty rules that were configurable for months and never paid a
   cent (audit #203). Both are money, so every case here is a dollar. */

describe("nightHours — the 10 PM – 6 AM window", () => {
  it("finds the night slice of a shift that crosses midnight", () => {
    // 6 PM – 2 AM: four ordinary hours, then four inside the window
    expect(nightHours("6:00 PM", "2:00 AM", 8)).toBe(4);
  });

  it("counts an early start against this morning's tail", () => {
    // 4 AM – 12 PM: two hours before 6 AM
    expect(nightHours("4:00 AM", "12:00 PM", 8)).toBe(2);
  });

  it("is zero for an ordinary day, and whole for a full night", () => {
    expect(nightHours("7:00 AM", "3:00 PM", 8)).toBe(0);
    expect(nightHours("10:00 PM", "6:00 AM", 8)).toBe(8);
  });

  it("never exceeds the day's PAID hours — an unpaid break isn't night work", () => {
    // 10 PM – 6 AM is 8h of window, but only 7.5h were paid
    expect(nightHours("10:00 PM", "6:00 AM", 7.5)).toBe(7.5);
  });

  it("answers zero rather than throwing on unreadable clocks", () => {
    expect(nightHours("x", "y", 8)).toBe(0);
  });
});

describe("splitDay — public holidays and night work", () => {
  const on = (over: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...over });
  /* Night ships OFF — an early start is the ordinary day in a trade, and a
     rule that pays 2× before 6 AM has to be chosen. These cases choose it. */
  const NIGHT_ON: Settings = on({
    rules: { ...DEFAULT_SETTINGS.rules, night: { on: true, rate: 2, up: null } },
  });

  it("pays a worked public holiday at holiday rates, outranking the weekend", () => {
    // default ph rule is 2× all day; the day is a SATURDAY, which pays 1.5/2
    const s = DEFAULT_SETTINGS;
    const sat = splitDay(8, 5, s, { publicHoliday: true, in: "7:00 AM", out: "3:00 PM" });
    expect(sat).toEqual({ n: 0, o15: 0, o2: 8 });
    // and a Tuesday holiday is the same — the date decides, not the weekday
    expect(splitDay(8, 1, s, { publicHoliday: true })).toEqual({ n: 0, o15: 0, o2: 8 });
  });

  it("leaves a holiday at ordinary rates when the rule is off", () => {
    const s = on({ rules: { ...DEFAULT_SETTINGS.rules, ph: { on: false, rate: 2, up: null } } });
    expect(splitDay(8, 1, s, { publicHoliday: true })).toEqual({ n: 8, o15: 0, o2: 0 });
  });

  it("pays the night SLICE at night rates and the rest through the ladder", () => {
    // 6 PM – 2 AM, 8h paid: 4h ordinary + 4h night at 2×
    const sp = splitDay(8, 1, NIGHT_ON, { in: "6:00 PM", out: "2:00 AM" });
    expect(sp).toEqual({ n: 4, o15: 0, o2: 4 });
    // every hour is accounted for exactly once
    expect(sp.n + sp.o15 + sp.o2).toBe(8);
  });

  it("does not stack night onto a whole-day rule", () => {
    // a Sunday night shift is all Sunday, not Sunday-plus-night for part
    const sp = splitDay(8, 6, NIGHT_ON, { in: "6:00 PM", out: "2:00 AM" });
    expect(sp).toEqual({ n: 0, o15: 0, o2: 8 });
  });

  it("keeps the overtime ladder on the hours that aren't night", () => {
    /* 4 PM – 4 AM, 12h paid: 6h night (10 PM–4 AM), 6h through the ladder.
       otAfter is 8, so the 6h remainder is all ordinary. */
    const sp = splitDay(12, 1, NIGHT_ON, { in: "4:00 PM", out: "4:00 AM" });
    expect(sp).toEqual({ n: 6, o15: 0, o2: 6 });
    expect(sp.n + sp.o15 + sp.o2).toBe(12);
  });

  it("is unchanged for an ordinary day, with the rule on", () => {
    expect(splitDay(8, 1, NIGHT_ON, { in: "7:00 AM", out: "3:00 PM" }))
      .toEqual(splitDay(8, 1, NIGHT_ON));
  });

  /* The rule ships off, and off means off — a 5:30 start is not night work
     until somebody says it is. This is the case the opt-in migration exists
     to protect. */
  it("pays an early start ordinarily until the rule is chosen", () => {
    expect(splitDay(8, 1, DEFAULT_SETTINGS, { in: "5:30 AM", out: "2:00 PM" }))
      .toEqual({ n: 8, o15: 0, o2: 0 });
    expect(splitDay(8, 1, NIGHT_ON, { in: "5:30 AM", out: "2:00 PM" }))
      .toEqual({ n: 7.5, o15: 0, o2: 0.5 });
  });
});

describe("derive — a worked holiday reaches the approver", () => {
  const week: WeekDay[] = [
    ["MON", 29, "Jun"], ["TUE", 30, "Jun"], ["WED", 1, "Jul"],
    ["THU", 2, "Jul"], ["FRI", 3, "Jul"], ["SAT", 4, "Jul"], ["SUN", 5, "Jul"],
  ];
  const empty = Array.from({ length: 7 }, () => ({ t: "empty" }) as DayEntry);
  const staff = (days: DayEntry[]): StaffWeek => ({
    id: "s1", name: "", role: "", rate: 50, days,
  });

  it("prices the holiday at 2× and says so", () => {
    const days = [{ t: "work" as const, in: "7:00 AM", out: "3:00 PM", h: 8 }, ...empty.slice(1)];
    const d = derive(staff(days), DEFAULT_SETTINGS, { week, today: 6, through: 6, holidays: [0] });
    expect(d.ot2).toBe(8);
    expect(d.normal).toBe(0);
    expect(d.gross).toBe(8 * 50 * 2);
    expect(d.bullets.some((b) => /worked the public holiday/.test(b))).toBe(true);
  });

  it("a holiday NOT worked still pays its standard day at 1×", () => {
    const days = [{ t: "ph" as const, h: 8 }, ...empty.slice(1)];
    const d = derive(staff(days), DEFAULT_SETTINGS, { week, today: 6, through: 6, holidays: [0] });
    expect(d.ph).toBe(8);
    expect(d.gross).toBe(8 * 50);
  });

  it("reports night hours as night, not as overtime", () => {
    const days = [{ t: "work" as const, in: "6:00 PM", out: "2:00 AM", h: 8 }, ...empty.slice(1)];
    const nightOn: Settings = {
      ...DEFAULT_SETTINGS,
      rules: { ...DEFAULT_SETTINGS.rules, night: { on: true, rate: 2, up: null } },
    };
    const d = derive(staff(days), nightOn, { week, today: 6, through: 6 });
    expect(d.bullets.some((b) => /4h of night work/.test(b))).toBe(true);
    // the day is 8h — nothing is "over standard" here
    expect(d.bullets.some((b) => /over standard/.test(b))).toBe(false);
  });
});

/* ---------------- the two guards added with the 2026-08 workflow review ---- */

describe("daysToCome — what a Submit would freeze", () => {
  /* Mon 29 Jun … Sun 5 Jul, the same shape every fixture in this file uses. */
  const week: WeekDay[] = [
    ["MON", 29, "Jun"],
    ["TUE", 30, "Jun"],
    ["WED", 1, "Jul"],
    ["THU", 2, "Jul"],
    ["FRI", 3, "Jul"],
    ["SAT", 4, "Jul"],
    ["SUN", 5, "Jul"],
  ];
  const MON_FRI = [0, 1, 2, 3, 4];

  it("counts the working days still ahead — the reason Submit waits", () => {
    // it is Wednesday: Mon and Tue are over, Thu and Fri are not
    expect(daysToCome({ week, today: 2, through: 1, workDays: MON_FRI })).toBe(3);
  });

  it("ignores a weekend nobody was going to work", () => {
    /* Saturday, with the whole working week behind us. Counting every day
       would hold the button until Monday — by which time the Sunday
       auto-submit has already sent the sheet, and the button never worked at
       all. */
    expect(daysToCome({ week, today: 5, through: 4, workDays: MON_FRI })).toBe(0);
  });

  it("holds a part-timer to THEIR days, not to Friday", () => {
    // Mon/Tue/Thu: on Thursday evening (through = Wed) one is still ahead
    expect(daysToCome({ week, today: 3, through: 2, workDays: [0, 1, 3] })).toBe(1);
    // and once Thursday is over, nothing is
    expect(daysToCome({ week, today: 4, through: 3, workDays: [0, 1, 3] })).toBe(0);
  });

  it("counts EVERY remaining day for a casual, who has no expected ones", () => {
    /* An empty roster is what makes a casual a casual — nothing is presumed
       onto their week. Read as "no expected days" it would mean nothing is
       ever still to come, and their Submit would be as sharp as before. */
    expect(daysToCome({ week, today: 2, through: 1, workDays: [] })).toBe(5);
  });

  it("is zero for a closed period — every day of it is over", () => {
    expect(daysToCome({ week, today: 6, through: 6, workDays: MON_FRI })).toBe(0);
  });
});

describe("issueHeading — the approver's one-line summary", () => {
  const none = { missing: 0, off: 0, ot2: 0, ot: 0, under: 0, sick: 0, leave: 0 };

  it("keeps the verb when there is one kind of issue", () => {
    expect(issueHeading({ ...none, ot: 2 })).toBe("Overtime to confirm");
    expect(issueHeading({ ...none, missing: 1 })).toBe("Missing entries to chase");
  });

  it("names every kind once there is more than one, and drops the verb", () => {
    /* The bug this replaces: a week with one unlogged day and two overtime
       days was headed "Missing entries to chase", which described a third of
       the list underneath it. */
    expect(issueHeading({ ...none, missing: 1, ot: 2 })).toBe("Missing entries · Overtime");
  });

  it("stops at three and counts the rest — a heading is a glance", () => {
    expect(issueHeading({ ...none, missing: 1, off: 1, ot2: 1, ot: 1, sick: 1 })).toBe(
      "Missing entries · Days not worked · Double time · +2",
    );
  });

  it("falls back when a card is flagged for something uncounted", () => {
    expect(issueHeading(none)).toBe("To confirm");
  });
});
