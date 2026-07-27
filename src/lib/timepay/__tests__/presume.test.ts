import {
  DEFAULT_SETTINGS,
  dayClass,
  derive,
  normalHours,
  presumeDays,
  type DayEntry,
  type Settings,
  type WeekCtx,
  type WeekDay,
} from "@/components/timepay/logic";
import { classifyEmployment, presumesDays } from "@/lib/staff/employment";
import { absenceMap, type LeaveRequest } from "@/lib/timepay/leave";

/* The normal-day presumption — what a week says when nobody has said anything.

   This is the highest-consequence pure function in Time & Pay: it decides what
   an untouched Tuesday is worth, and therefore what gets paid when a person
   submits a week they never opened. The cases below are the ones that cost
   money if they go the wrong way:

     · today is NOT presumed until today is over
     · a weekend is never presumed onto, by anything
     · a stored entry always wins, including a short one
     · a public holiday beats booked leave, so entitlement isn't spent on a
       day the business was closed anyway
     · unpaid leave lands as `off`, never as paid hours */

const WEEK: WeekDay[] = [
  ["MON", 29, "Jun"],
  ["TUE", 30, "Jun"],
  ["WED", 1, "Jul"],
  ["THU", 2, "Jul"],
  ["FRI", 3, "Jul"],
  ["SAT", 4, "Jul"],
  ["SUN", 5, "Jul"],
];
const DATES = [
  "2026-06-29",
  "2026-06-30",
  "2026-07-01",
  "2026-07-02",
  "2026-07-03",
  "2026-07-04",
  "2026-07-05",
];
const CTX: WeekCtx = { week: WEEK, today: 4 };
const EMPTY_WEEK: DayEntry[] = Array.from({ length: 7 }, () => ({ t: "empty" }));
const HOURS = { start: "7:00 AM", end: "3:00 PM" };

const run = (
  stored: DayEntry[] = EMPTY_WEEK,
  over: Partial<Parameters<typeof presumeDays>[3]> = {},
  settings: Settings = DEFAULT_SETTINGS,
) =>
  presumeDays(stored, CTX, settings, {
    dates: DATES,
    holidays: new Map(),
    absences: new Map(),
    hours: HOURS,
    through: 3, // Mon–Thu are over; Friday is today
    presume: true,
    ...over,
  });

const req = (over: Partial<LeaveRequest> = {}): LeaveRequest => ({
  id: "r1",
  staffId: "me",
  kind: "annual",
  startDate: "2026-06-30",
  endDate: "2026-06-30",
  hours: 8,
  status: "approved",
  ...over,
});

describe("an ordinary week", () => {
  it("presumes every weekday that is over, at the person's normal hours", () => {
    const { days, sources } = run();
    expect(days.slice(0, 4)).toEqual([
      { t: "work", in: "7:00 AM", out: "3:00 PM", h: 8 },
      { t: "work", in: "7:00 AM", out: "3:00 PM", h: 8 },
      { t: "work", in: "7:00 AM", out: "3:00 PM", h: 8 },
      { t: "work", in: "7:00 AM", out: "3:00 PM", h: 8 },
    ]);
    expect(sources.slice(0, 4)).toEqual(["presumed", "presumed", "presumed", "presumed"]);
  });

  it("does NOT mark today until today is over", () => {
    const { days, sources } = run();
    expect(days[4]).toEqual({ t: "empty" });
    expect(sources[4]).toBe("expected");
  });

  it("presumes nothing at all onto a weekend", () => {
    const { days, sources } = run();
    expect(days[5]).toEqual({ t: "empty" });
    expect(days[6]).toEqual({ t: "empty" });
    expect(sources.slice(5)).toEqual(["none", "none"]);
  });

  it("presumes nothing before the period has started", () => {
    const { sources } = run(EMPTY_WEEK, { through: -1 });
    expect(sources).toEqual([
      "expected", "expected", "expected", "expected", "expected", "none", "none",
    ]);
  });

  it("takes an unpaid break off the presumed day, like any other day", () => {
    const settings = { ...DEFAULT_SETTINGS, breakMinutes: 30, breakPaid: false };
    const { days } = run(EMPTY_WEEK, {}, settings);
    expect(days[0]).toEqual({ t: "work", in: "7:00 AM", out: "3:00 PM", h: 7.5 });
  });
});

describe("a stored entry always wins", () => {
  it("keeps the day a person actually logged, short or long", () => {
    const short: DayEntry = { t: "work", in: "7:00 AM", out: "11:00 AM", h: 4 };
    const { days, sources } = run([short, ...EMPTY_WEEK.slice(1)]);
    expect(days[0]).toEqual(short);
    expect(sources[0]).toBe("entered");
  });

  it("keeps a deliberate day off, instead of refilling it every load", () => {
    const { days, sources } = run([{ t: "off" }, ...EMPTY_WEEK.slice(1)]);
    expect(days[0]).toEqual({ t: "off" });
    expect(sources[0]).toBe("entered");
  });

  it("keeps a weekend that was worked", () => {
    const sat: DayEntry = { t: "work", in: "8:00 AM", out: "12:00 PM", h: 4 };
    const { days, sources } = run([...EMPTY_WEEK.slice(0, 5), sat, { t: "empty" }]);
    expect(days[5]).toEqual(sat);
    expect(sources[5]).toBe("entered");
  });
});

describe("days the business already knows about", () => {
  it("marks a public holiday as a full day off, without being asked", () => {
    const { days, sources } = run(EMPTY_WEEK, {
      holidays: new Map([["2026-07-01", "Territory Day"]]),
    });
    expect(days[2]).toEqual({ t: "ph", h: 8 });
    expect(sources[2]).toBe("holiday");
  });

  it("marks approved leave from the leave module", () => {
    const { days, sources } = run(EMPTY_WEEK, {
      absences: new Map([["2026-06-30", { t: "leave" as const, h: 8, id: "r1" }]]),
    });
    expect(days[1]).toEqual({ t: "leave", h: 8 });
    expect(sources[1]).toBe("leave");
  });

  it("a holiday on a weekend closes nothing and pays nothing", () => {
    const { days, sources } = run(EMPTY_WEEK, {
      holidays: new Map([["2026-07-04", "A Saturday Holiday"]]),
    });
    expect(days[5]).toEqual({ t: "empty" });
    expect(sources[5]).toBe("none");
  });

  it("a person's own entry still beats both calendars", () => {
    const worked: DayEntry = { t: "work", in: "7:00 AM", out: "3:00 PM", h: 8 };
    const { days, sources } = run([...EMPTY_WEEK.slice(0, 2), worked, ...EMPTY_WEEK.slice(3)], {
      holidays: new Map([["2026-07-01", "Territory Day"]]),
    });
    expect(days[2]).toEqual(worked);
    expect(sources[2]).toBe("entered");
  });
});

describe("turning leave requests into days", () => {
  it("spreads a request's total hours across the working days it covers", () => {
    const map = absenceMap([req({ startDate: "2026-06-29", endDate: "2026-07-03", hours: 40 })], new Map());
    expect(map.get("2026-06-29")).toEqual({ t: "leave", h: 8, id: "r1" });
    expect(map.get("2026-07-03")).toEqual({ t: "leave", h: 8, id: "r1" });
  });

  it("a part day is a part day — a 4-hour single-day request stays 4 hours", () => {
    const map = absenceMap([req({ hours: 4 })], new Map());
    expect(map.get("2026-06-30")).toEqual({ t: "leave", h: 4, id: "r1" });
  });

  it("a public holiday inside the span is not a day of entitlement spent", () => {
    const holidays = new Map([["2026-07-01", "Territory Day"]]);
    const map = absenceMap(
      [req({ startDate: "2026-06-29", endDate: "2026-07-03", hours: 32 })],
      holidays,
    );
    // four working days, not five — and the holiday itself gets no leave row
    expect(map.get("2026-06-29")).toEqual({ t: "leave", h: 8, id: "r1" });
    expect(map.has("2026-07-01")).toBe(false);
  });

  it("personal leave is a sick day", () => {
    const map = absenceMap([req({ kind: "personal" })], new Map());
    expect(map.get("2026-06-30")).toEqual({ t: "sick", h: 8, id: "r1" });
  });

  it("UNPAID leave is a day off, never paid hours", () => {
    const map = absenceMap([req({ kind: "unpaid" })], new Map());
    expect(map.get("2026-06-30")).toEqual({ t: "off", id: "r1" });
  });

  it("ignores a request that isn't approved yet", () => {
    const map = absenceMap([req({ status: "pending" })], new Map());
    expect(map.size).toBe(0);
  });
});

/* Employment type decides whether a week is filled in at all. A casual works
   when they're rostered, so nothing is presumed onto them — not a normal day
   and not a public holiday, which they aren't paid for unless they work it. */
describe("a casual", () => {
  it("gets nothing presumed, on any day, ever", () => {
    const { days, sources } = run(EMPTY_WEEK, { presume: false });
    expect(days.every((d) => d.t === "empty")).toBe(true);
    expect(sources.every((s) => s === "none")).toBe(true);
  });

  it("is not given a public holiday they didn't work", () => {
    const { days, sources } = run(EMPTY_WEEK, {
      presume: false,
      holidays: new Map([["2026-07-01", "Territory Day"]]),
    });
    expect(days[2]).toEqual({ t: "empty" });
    expect(sources[2]).toBe("none");
  });

  it("keeps every day they DID enter", () => {
    const shift: DayEntry = { t: "work", in: "9:00 AM", out: "1:00 PM", h: 4 };
    const { days, sources } = run([...EMPTY_WEEK.slice(0, 5), shift, { t: "empty" }], {
      presume: false,
    });
    expect(days[5]).toEqual(shift);
    expect(sources[5]).toBe("entered");
  });

  it("has no missing days and no short days — they were rostered for what they did", () => {
    const shift: DayEntry = { t: "work", in: "9:00 AM", out: "1:00 PM", h: 4 };
    const casualCtx: WeekCtx = { ...CTX, workDays: [] };
    const days: DayEntry[] = [shift, ...EMPTY_WEEK.slice(1)];
    const d = derive({ id: "c", name: "Cas", role: "", rate: null, days }, DEFAULT_SETTINGS, casualCtx);
    expect(d.missing).toBe(0);
    expect(d.under).toBe(0);
    expect(dayClass(days[1], 1, DEFAULT_SETTINGS, casualCtx)).toBe("empty");
    expect(dayClass(shift, 0, DEFAULT_SETTINGS, casualCtx)).toBe("std");
  });
});

describe("a part-timer", () => {
  const partTime: WeekCtx = { ...CTX, workDays: [0, 1, 3] }; // Mon, Tue, Thu

  it("is presumed onto their own days and nothing else", () => {
    const { sources } = presumeDays(EMPTY_WEEK, partTime, DEFAULT_SETTINGS, {
      dates: DATES,
      holidays: new Map(),
      absences: new Map(),
      hours: HOURS,
      through: 3,
      presume: true,
    });
    expect(sources[0]).toBe("presumed"); // Mon
    expect(sources[1]).toBe("presumed"); // Tue
    expect(sources[2]).toBe("none"); // Wed — not their day
    expect(sources[3]).toBe("presumed"); // Thu
  });

  it("has no missing day on a day they don't work", () => {
    const d = derive(
      { id: "p", name: "Pat", role: "", rate: null, days: EMPTY_WEEK },
      DEFAULT_SETTINGS,
      partTime,
    );
    // Mon, Tue, Thu are over and empty; Wednesday is simply not their day
    expect(d.missing).toBe(3);
    expect(dayClass(EMPTY_WEEK[2], 2, DEFAULT_SETTINGS, partTime)).toBe("empty");
    expect(dayClass(EMPTY_WEEK[0], 0, DEFAULT_SETTINGS, partTime)).toBe("miss");
  });
});

describe("classifying who somebody is", () => {
  it("reads the roster's labels, however they're spelled", () => {
    ["Full-time", "Full Time", "part-time", "Apprentice", ""].forEach((v) =>
      expect(classifyEmployment(v)).toBe("permanent"),
    );
    expect(classifyEmployment("Casual")).toBe("casual");
    expect(classifyEmployment("Subcontractor")).toBe("subbie");
  });

  it("treats an UNSET type as permanent — the safe end", () => {
    // the column is null for most rows, so this is what a real workspace gets:
    // a week filled in and shown to them, not one silently left blank
    expect(classifyEmployment(null)).toBe("permanent");
    expect(presumesDays(classifyEmployment(null))).toBe(true);
  });

  it("fills in a week only for permanents", () => {
    expect(presumesDays("permanent")).toBe(true);
    expect(presumesDays("casual")).toBe(false);
    expect(presumesDays("subbie")).toBe(false);
  });
});

describe("whose hours a day is presumed at", () => {
  it("falls back to the workspace's when a person has set none", () => {
    expect(normalHours(DEFAULT_SETTINGS)).toEqual({ start: "7:00 AM", end: "3:00 PM" });
    expect(normalHours(DEFAULT_SETTINGS, null)).toEqual({ start: "7:00 AM", end: "3:00 PM" });
  });

  it("uses a person's own when they have", () => {
    expect(normalHours(DEFAULT_SETTINGS, { start: "6:30 AM", end: "2:30 PM" })).toEqual({
      start: "6:30 AM",
      end: "2:30 PM",
    });
  });

  it("refuses HALF an override — it would presume against the org's other end", () => {
    expect(normalHours(DEFAULT_SETTINGS, { start: "6:30 AM" })).toEqual(DEFAULT_HOURS);
    expect(normalHours(DEFAULT_SETTINGS, { start: "nonsense", end: "2:30 PM" })).toEqual(DEFAULT_HOURS);
  });
});

const DEFAULT_HOURS = { start: "7:00 AM", end: "3:00 PM" };
