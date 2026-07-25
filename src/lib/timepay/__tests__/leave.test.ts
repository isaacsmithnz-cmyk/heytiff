import {
  balanceView,
  bookedAgainst,
  businessDays,
  calendarDays,
  leaveDates,
  rangeBreakdown,
  shortfall,
  suggestedHours,
  upcomingHolidays,
  type LeaveBalance,
  type LeaveRequest,
} from "../leave";

const req = (over: Partial<LeaveRequest> = {}): LeaveRequest => ({
  id: "r1",
  staffId: "s1",
  kind: "annual",
  startDate: "2026-08-03",
  endDate: "2026-08-07",
  hours: 38,
  status: "approved",
  ...over,
});

const balance = (over: Partial<LeaveBalance> = {}): LeaveBalance => ({
  kind: "annual",
  balanceHours: 152,
  asAt: "2026-07-01",
  source: "manual",
  ...over,
});

describe("date maths", () => {
  it("counts working days in a range, skipping weekends", () => {
    // Mon 3 Aug – Fri 7 Aug 2026 = 5 working days
    expect(businessDays("2026-08-03", "2026-08-07")).toBe(5);
    // a range spanning a weekend counts only the weekdays
    expect(businessDays("2026-08-07", "2026-08-10")).toBe(2); // Fri + Mon
  });

  it("skips public holidays too", () => {
    const holidays = new Set(["2026-08-04"]); // a Tuesday off
    expect(businessDays("2026-08-03", "2026-08-07", holidays)).toBe(4);
  });

  it("suggests working-days × the standard day", () => {
    expect(suggestedHours("2026-08-03", "2026-08-07", 8)).toBe(40);
    expect(suggestedHours("2026-08-03", "2026-08-07", 7.6)).toBe(38);
    expect(suggestedHours("2026-08-03", "2026-08-07", 8, new Set(["2026-08-05"]))).toBe(32);
  });

  it("expands a request to every calendar day it covers", () => {
    expect(leaveDates({ startDate: "2026-08-03", endDate: "2026-08-05" })).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
    ]);
  });
});

/* The breakdown is what the calendar SAYS about a chosen span, so every case
   here is a sentence someone reads while deciding: how many days this costs,
   and which ones are free. */
describe("range breakdown", () => {
  const AUS_DAY = new Map([["2027-01-26", "Australia Day"]]); // a Tuesday

  it("splits a fortnight into working days and the weekends between", () => {
    // Mon 3 Aug – Fri 14 Aug 2026: 10 weekdays, one weekend in the middle
    const b = rangeBreakdown("2026-08-03", "2026-08-14");
    expect(b).toEqual({ working: 10, weekends: 2, holidays: [] });
  });

  it("names the public holiday it skips, and doesn't charge for it", () => {
    // Mon 25 Jan – Fri 29 Jan 2027, with Australia Day on the Tuesday
    const b = rangeBreakdown("2027-01-25", "2027-01-29", AUS_DAY);
    expect(b.working).toBe(4);
    expect(b.holidays).toEqual([{ date: "2027-01-26", name: "Australia Day" }]);
    // and it agrees with the number the hours suggestion is built on
    expect(b.working).toBe(businessDays("2027-01-25", "2027-01-29", new Set(AUS_DAY.keys())));
  });

  it("counts a single day as itself", () => {
    expect(rangeBreakdown("2026-08-03", "2026-08-03")).toEqual({
      working: 1,
      weekends: 0,
      holidays: [],
    });
    expect(rangeBreakdown("2026-08-08", "2026-08-08")).toEqual({
      working: 0,
      weekends: 1,
      holidays: [],
    });
  });

  /* A holiday that lands on a Saturday is not a day back — counting it in both
     buckets would tell someone a weekend trip skipped a day of leave. */
  it("counts a holiday that falls on a weekend once, as a weekend", () => {
    const boxing = new Map([["2026-12-26", "Boxing Day"]]); // a Saturday
    const b = rangeBreakdown("2026-12-25", "2026-12-27", boxing);
    expect(b).toEqual({ working: 1, weekends: 2, holidays: [] });
  });

  it("says nothing at all for a backwards or empty range", () => {
    const none = { working: 0, weekends: 0, holidays: [] };
    expect(rangeBreakdown("2026-08-07", "2026-08-03")).toEqual(none);
    expect(rangeBreakdown("", "")).toEqual(none);
  });
});

describe("balance arithmetic", () => {
  it("nets live bookings on/after as_at off the balance", () => {
    const requests = [
      req({ id: "a", hours: 38, status: "approved", startDate: "2026-08-03" }),
      req({ id: "b", hours: 8, status: "pending", startDate: "2026-09-01" }),
    ];
    const v = balanceView(balance(), requests);
    expect(v.booked).toBe(46);
    expect(v.available).toBe(106);
  });

  it("ignores leave taken BEFORE as_at — it's already in the figure", () => {
    // this is the double-count trap: a June leave shouldn't reduce a balance
    // that is stated as-at 1 July
    const requests = [req({ id: "old", hours: 38, status: "approved", startDate: "2026-06-15" })];
    expect(bookedAgainst(requests, "annual", "2026-07-01")).toBe(0);
    expect(balanceView(balance(), requests).available).toBe(152);
  });

  it("ignores declined and cancelled requests", () => {
    const requests = [
      req({ id: "d", hours: 20, status: "declined", startDate: "2026-08-03" }),
      req({ id: "c", hours: 20, status: "cancelled", startDate: "2026-08-03" }),
    ];
    expect(balanceView(balance(), requests).available).toBe(152);
  });

  it("keeps each kind's bookings separate", () => {
    const requests = [
      req({ id: "p", kind: "personal", hours: 8, status: "approved", startDate: "2026-08-03" }),
    ];
    expect(bookedAgainst(requests, "annual", "2026-07-01")).toBe(0);
    expect(bookedAgainst(requests, "personal", "2026-07-01")).toBe(8);
  });
});

describe("shortfall — the request guard", () => {
  const balances = [balance({ balanceHours: 40 })];

  it("is zero when the request fits", () => {
    expect(shortfall("annual", 40, balances, [])).toBe(0);
  });

  it("is the overage when it doesn't, netting existing bookings", () => {
    const requests = [req({ id: "x", hours: 24, status: "approved", startDate: "2026-08-03" })];
    // 40 balance − 24 booked = 16 available; asking for 20 is 4 short
    expect(shortfall("annual", 20, balances, requests)).toBe(4);
  });

  it("treats an unrecorded balance as nothing available", () => {
    expect(shortfall("personal", 8, balances, [])).toBe(8); // no personal balance row
  });

  it("never restricts unpaid leave", () => {
    expect(shortfall("unpaid", 999, [], [])).toBe(0);
  });
});

describe("upcoming holidays", () => {
  const hols = [
    { date: "2026-01-01", name: "New Year's Day" },
    { date: "2026-01-26", name: "Australia Day" },
    { date: "2026-12-25", name: "Christmas Day" },
  ];

  it("drops past dates and keeps today onward, soonest first", () => {
    const up = upcomingHolidays(hols, "2026-01-26");
    expect(up.map((h) => h.date)).toEqual(["2026-01-26", "2026-12-25"]); // today included, NYD gone
  });

  it("returns everything when today is before them all", () => {
    expect(upcomingHolidays(hols, "2025-12-31")).toHaveLength(3);
  });

  it("sorts out-of-order input", () => {
    const shuffled = [hols[2], hols[0], hols[1]];
    expect(upcomingHolidays(shuffled, "2026-01-01").map((h) => h.date)).toEqual([
      "2026-01-01",
      "2026-01-26",
      "2026-12-25",
    ]);
  });
});

describe("team calendar", () => {
  it("groups only approved leave by date within the span", () => {
    const requests = [
      req({ id: "a", staffId: "s1", staffName: "Ana", startDate: "2026-08-03", endDate: "2026-08-04", status: "approved" }),
      req({ id: "b", staffId: "s2", staffName: "Ben", startDate: "2026-08-04", endDate: "2026-08-04", status: "approved" }),
      req({ id: "p", staffId: "s3", staffName: "Cass", startDate: "2026-08-04", endDate: "2026-08-04", status: "pending" }),
    ];
    const days = calendarDays(requests, "2026-08-01", "2026-08-31");
    expect(days.map((d) => d.date)).toEqual(["2026-08-03", "2026-08-04"]);
    expect(days[1].entries.map((e) => e.staffName).sort()).toEqual(["Ana", "Ben"]); // Cass pending, excluded
  });

  it("clips a request to the visible span", () => {
    const requests = [req({ startDate: "2026-07-28", endDate: "2026-08-03", status: "approved" })];
    const days = calendarDays(requests, "2026-08-01", "2026-08-31");
    expect(days.map((d) => d.date)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
  });
});
