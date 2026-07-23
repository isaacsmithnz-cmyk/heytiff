import {
  balanceView,
  bookedAgainst,
  businessDays,
  calendarDays,
  leaveDates,
  shortfall,
  suggestedHours,
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
