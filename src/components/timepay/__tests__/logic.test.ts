import {
  DEFAULT_SETTINGS,
  type DayEntry,
  type Settings,
  type WeekCtx,
  dayClass,
  derive,
  fmt,
  initials,
  ruleSummary,
  splitDay,
  submitNote,
} from "../logic";
import { demoTimepayStaff, demoTimepayToday, demoTimepayWeek } from "@/mock/demo";

/* Expectations verified against the design prototype's derive pipeline
   (design_handoff_time_and_pay/app/timepay-review.js) run in Node. */

const ctx: WeekCtx = { week: demoTimepayWeek, today: demoTimepayToday };
const S = (over: Partial<Settings> = {}): Settings =>
  JSON.parse(JSON.stringify({ ...DEFAULT_SETTINGS, ...over }));

const W = (i: string, o: string, h: number): DayEntry => ({ t: "work", in: i, out: o, h });
const w8 = W("07:00", "15:00", 8);
const EM: DayEntry = { t: "empty" };
const staff = (days: DayEntry[]) => ({ name: "Test Person", role: "Installer", rate: 40, days });

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
    expect(d.issueTitle).toBe("Overtime & double time to confirm");
  });

  it("Marcus and Dylan: clean 40h weeks are ready with no bullets", () => {
    for (const name of ["Marcus Webb", "Dylan Reyes"]) {
      expect(byName[name].status).toBe("ready");
      expect(byName[name].bullets).toHaveLength(0);
    }
  });

  it("Hannah: sick day flags review, paid in weighted hours", () => {
    const d = byName["Hannah Cole"];
    expect([d.status, d.sick, d.weighted]).toEqual(["review", 8, 40]);
    expect(d.issueTitle).toBe("Sick leave to confirm");
  });

  it("Sophie: annual leave flags review", () => {
    const d = byName["Sophie Tran"];
    expect([d.status, d.leave]).toEqual(["review", 8]);
    expect(d.issueTitle).toBe("Annual leave to confirm");
  });
});

describe("derive — rules and edge cases", () => {
  it("counts missing entries only on weekdays up to today", () => {
    const d = derive(staff([w8, EM, EM, w8, EM, EM, EM]), S(), ctx);
    expect(d.missing).toBe(3); // Tue, Wed, Fri (today = Fri); weekend empties don't count
    expect(d.status).toBe("review");
    expect(d.issueTitle).toBe("Missing entries to chase");
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

  it("marks empty weekdays up to today as missing, later ones as empty", () => {
    expect(dayClass(EM, 4, S(), ctx)).toBe("miss");
    expect(dayClass(EM, 5, S(), ctx)).toBe("empty");
    expect(dayClass(EM, 6, S(), ctx)).toBe("empty");
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
    expect(ruleSummary({ on: true, rate: 1.5, up: 2 })).toBe("1.5× first 2h · then 2×");
  });
  it("builds the live-period note from settings", () => {
    expect(submitNote(DEFAULT_SETTINGS)).toBe("Open · auto-submits Sun 3:00 PM · then locks");
    expect(submitNote({ ...DEFAULT_SETTINGS, lock: false })).toBe("Open · auto-submits Sun 3:00 PM");
  });
});
