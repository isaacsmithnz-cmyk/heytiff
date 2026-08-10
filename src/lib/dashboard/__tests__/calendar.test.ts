import {
  WINDOW_DAYS,
  buildCalendar,
  calendarSpan,
  shiftBounds,
  windowFrom,
  windowSummary,
} from "../calendar";
import type { LeaveRequest } from "@/lib/timepay/leave";

/* The calendar replaced `rosterToday`, which answered "who's off" for exactly
   one day. What is worth pinning is the three things that can go quietly wrong:
   the band's run edges (a wrong one draws two runs where a person took one),
   the arrows walking off the end of the loaded span, and the `team` split
   between your own leave and everyone else's. */

const TODAY = "2026-08-10"; // a Monday
const leave = (over: Partial<LeaveRequest> = {}): LeaveRequest => ({
  id: "l1",
  staffId: "me",
  staffName: "Isaac Smith",
  kind: "annual",
  startDate: "2026-08-19",
  endDate: "2026-08-25",
  hours: 38,
  status: "approved",
  ...over,
});

const day = (cal: ReturnType<typeof buildCalendar>, iso: string) =>
  cal.days.find((d) => d.iso === iso)!;

describe("the span", () => {
  it("opens on a Monday a week back and runs eight weeks past the window", () => {
    const { spanStart, spanEnd } = calendarSpan(TODAY);
    expect(spanStart).toBe("2026-08-03"); // the Monday before this one
    expect(new Date(`${spanStart}T12:00:00Z`).getUTCDay()).toBe(1);
    // a week back + eight ahead + the 28-day window itself, inclusive
    expect(spanEnd).toBe("2026-11-01");
  });

  it("builds every day in it, ascending, with no gaps", () => {
    const cal = buildCalendar([], [], TODAY, "me");
    expect(cal.days).toHaveLength(91);
    expect(cal.days[0].iso).toBe(cal.spanStart);
    expect(cal.days[cal.days.length - 1].iso).toBe(cal.spanEnd);
    expect([...cal.days].sort((a, b) => a.iso.localeCompare(b.iso))).toEqual(cal.days);
  });
});

describe("your own leave", () => {
  it("covers every day of the run, weekend included", () => {
    /* Isaac, 2026-08-10: a Wednesday-to-Tuesday request covers the Saturday and
       you are away on it. Breaking the band at the weekend would draw two runs
       where the person took one. */
    const cal = buildCalendar([leave()], [], TODAY, "me");
    for (const iso of [
      "2026-08-19", "2026-08-20", "2026-08-21",
      "2026-08-22", "2026-08-23", // Sat and Sun
      "2026-08-24", "2026-08-25",
    ]) {
      expect(day(cal, iso).mine).not.toBeNull();
    }
    expect(day(cal, "2026-08-18").mine).toBeNull();
    expect(day(cal, "2026-08-26").mine).toBeNull();
  });

  it("marks the run's true ends and nothing in between", () => {
    // the rounded corners hang off these two flags; a wrong one is a band that
    // looks like it stops mid-week
    const cal = buildCalendar([leave()], [], TODAY, "me");
    expect(day(cal, "2026-08-19").mine).toEqual({
      label: "Annual leave",
      runStart: true,
      runEnd: false,
    });
    expect(day(cal, "2026-08-22").mine).toMatchObject({ runStart: false, runEnd: false });
    expect(day(cal, "2026-08-25").mine).toMatchObject({ runStart: false, runEnd: true });
  });

  it("leaves the edge squared for a run that started before the span", () => {
    // it continues off the left of the grid, so it must not draw a cap there
    const cal = buildCalendar(
      [leave({ startDate: "2026-07-20", endDate: "2026-08-05" })],
      [],
      TODAY,
      "me",
    );
    expect(day(cal, "2026-08-03").mine).toMatchObject({ runStart: false, runEnd: false });
    expect(day(cal, "2026-08-05").mine).toMatchObject({ runEnd: true });
  });

  it("is nobody's when the account has no staff record", () => {
    const cal = buildCalendar([leave()], [], TODAY, null);
    expect(day(cal, "2026-08-19").mine).toBeNull();
    // and it does not become "someone else" either — it is the same person
    expect(day(cal, "2026-08-19").others).toHaveLength(1);
  });
});

describe("everyone else", () => {
  it("is separated from yours, named, initialled and sorted", () => {
    const cal = buildCalendar(
      [
        leave({ id: "l2", staffId: "s2", staffName: "Zoe Park", startDate: TODAY, endDate: TODAY }),
        leave({
          id: "l3",
          staffId: "s3",
          staffName: "Dane Whitcombe",
          kind: "personal",
          startDate: TODAY,
          endDate: TODAY,
        }),
        leave({ startDate: TODAY, endDate: TODAY }),
      ],
      [],
      TODAY,
      "me",
    );
    const d = day(cal, TODAY);
    expect(d.mine).not.toBeNull();
    expect(d.others.map((o) => [o.name, o.initials, o.label])).toEqual([
      ["Dane Whitcombe", "DW", "Personal / carer's"],
      ["Zoe Park", "ZP", "Annual leave"],
    ]);
  });
});

describe("the office closing", () => {
  it("lands on the day it names, and coexists with your leave", () => {
    const cal = buildCalendar(
      [leave({ startDate: "2026-08-24", endDate: "2026-08-28" })],
      [{ date: "2026-08-26", name: "Bank Holiday" }],
      TODAY,
      "me",
    );
    expect(day(cal, "2026-08-26").holiday).toBe("Bank Holiday");
    // two different facts about one day: the cell keeps both
    expect(day(cal, "2026-08-26").mine).not.toBeNull();
    expect(day(cal, "2026-08-25").holiday).toBeNull();
  });
});

describe("the window and its arrows", () => {
  it("shows four weeks from this Monday at rest", () => {
    const cal = buildCalendar([], [], TODAY, "me");
    const days = windowFrom(cal, TODAY, 0);
    expect(days).toHaveLength(WINDOW_DAYS);
    expect(days[0].iso).toBe(TODAY);
    expect(days[WINDOW_DAYS - 1].iso).toBe("2026-09-06");
  });

  it("steps a week at a time and never walks off the loaded span", () => {
    const cal = buildCalendar([], [], TODAY, "me");
    const { min, max } = shiftBounds(cal, TODAY);
    expect(min).toBe(-1);
    expect(max).toBe(8);
    // the furthest step still returns a full grid — the point of the bound
    expect(windowFrom(cal, TODAY, max)).toHaveLength(WINDOW_DAYS);
    expect(windowFrom(cal, TODAY, min)[0].iso).toBe(cal.spanStart);
  });

  it("counts the window's own facts, not the whole span", () => {
    const cal = buildCalendar(
      [
        leave({ startDate: "2026-08-11", endDate: "2026-08-12" }),
        leave({ id: "l2", staffId: "s2", staffName: "Zoe Park", startDate: "2026-10-05", endDate: "2026-10-09" }),
      ],
      [{ date: "2026-08-26", name: "Bank Holiday" }],
      TODAY,
      "me",
    );
    // Zoe's October leave is loaded, but this window cannot see it
    expect(windowSummary(windowFrom(cal, TODAY, 0))).toEqual({
      holidays: 1,
      othersOff: 0,
      yoursOff: 2,
    });
  });

  it("counts a person once however many days they are off", () => {
    const cal = buildCalendar(
      [leave({ id: "l2", staffId: "s2", staffName: "Zoe Park", startDate: "2026-08-11", endDate: "2026-08-14" })],
      [],
      TODAY,
      "me",
    );
    expect(windowSummary(windowFrom(cal, TODAY, 0)).othersOff).toBe(1);
  });
});
