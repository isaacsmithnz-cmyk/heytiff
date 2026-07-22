import {
  addDays,
  dateOfDay,
  mondayIndex,
  periodLabel,
  periodStartFor,
  recentPeriods,
  todayIndex,
  weekDays,
} from "../period";

describe("week anchoring", () => {
  it("indexes Monday as 0 and Sunday as 6 — the order splitDay assumes", () => {
    expect(mondayIndex("2026-06-29")).toBe(0); // Monday
    expect(mondayIndex("2026-07-04")).toBe(5); // Saturday
    expect(mondayIndex("2026-07-05")).toBe(6); // Sunday
  });

  it("snaps any day back to its Monday, including the Sunday", () => {
    // the classic off-by-one: Sunday belongs to the week that STARTED on the
    // 29th, not the one starting the next day
    expect(periodStartFor("2026-07-05")).toBe("2026-06-29");
    expect(periodStartFor("2026-06-29")).toBe("2026-06-29");
    expect(periodStartFor("2026-07-02")).toBe("2026-06-29");
  });

  it("builds the seven grid columns, crossing a month boundary", () => {
    expect(weekDays("2026-06-29")).toEqual([
      ["MON", 29, "Jun"],
      ["TUE", 30, "Jun"],
      ["WED", 1, "Jul"],
      ["THU", 2, "Jul"],
      ["FRI", 3, "Jul"],
      ["SAT", 4, "Jul"],
      ["SUN", 5, "Jul"],
    ]);
    expect(periodLabel("2026-06-29")).toBe("29 Jun – 5 Jul");
  });

  it("maps a grid column back to the date the entry is stored against", () => {
    expect(dateOfDay("2026-06-29", 0)).toBe("2026-06-29");
    expect(dateOfDay("2026-06-29", 6)).toBe("2026-07-05");
  });
});

describe("todayIndex", () => {
  it("is the position of today inside the current week", () => {
    expect(todayIndex("2026-06-29", "2026-07-01")).toBe(2);
  });

  it("saturates at 6 for a past week, so every weekday counts as missing", () => {
    // otherwise last week's unfilled Thursday never gets flagged
    expect(todayIndex("2026-06-29", "2026-08-01")).toBe(6);
  });

  it("is -1 for a future week — nothing is late yet", () => {
    expect(todayIndex("2026-08-03", "2026-07-01")).toBe(-1);
  });
});

describe("the period switcher", () => {
  it("lists whole weeks back from the current one, newest first", () => {
    const p = recentPeriods("2026-07-01", 3);
    expect(p).toEqual(["2026-06-29", "2026-06-22", "2026-06-15"]);
  });

  it("steps by exact days across a DST-style boundary", () => {
    // dates are handled in UTC precisely so a clock change can't drop an hour
    // and shift the week start
    expect(addDays("2026-04-04", 1)).toBe("2026-04-05");
    expect(addDays("2026-10-03", 1)).toBe("2026-10-04");
  });
});
