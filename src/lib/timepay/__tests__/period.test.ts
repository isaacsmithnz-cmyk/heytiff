import {
  addDays,
  dateOfDay,
  mondayIndex,
  periodDays,
  periodLabel,
  periodLength,
  periodStartFor,
  recentPeriods,
  todayIndex,
  type PeriodConfig,
} from "../period";

const WEEKLY: PeriodConfig = { cycle: "Weekly", fortnightAnchor: null, monthStartDay: 1 };
const FN = (anchor: string | null = null): PeriodConfig => ({
  cycle: "Fortnightly",
  fortnightAnchor: anchor,
  monthStartDay: 1,
});
const MONTHLY = (startDay = 1): PeriodConfig => ({
  cycle: "Monthly",
  fortnightAnchor: null,
  monthStartDay: startDay,
});

describe("week anchoring", () => {
  it("indexes Monday as 0 and Sunday as 6 — the order splitDay assumes", () => {
    expect(mondayIndex("2026-06-29")).toBe(0); // Monday
    expect(mondayIndex("2026-07-04")).toBe(5); // Saturday
    expect(mondayIndex("2026-07-05")).toBe(6); // Sunday
  });

  it("snaps any day back to its Monday, including the Sunday", () => {
    // the classic off-by-one: Sunday belongs to the week that STARTED on the
    // 29th, not the one starting the next day
    expect(periodStartFor("2026-07-05", WEEKLY)).toBe("2026-06-29");
    expect(periodStartFor("2026-06-29", WEEKLY)).toBe("2026-06-29");
    expect(periodStartFor("2026-07-02", WEEKLY)).toBe("2026-06-29");
  });

  it("builds the seven grid columns, crossing a month boundary", () => {
    expect(periodDays("2026-06-29", WEEKLY)).toEqual([
      ["MON", 29, "Jun"],
      ["TUE", 30, "Jun"],
      ["WED", 1, "Jul"],
      ["THU", 2, "Jul"],
      ["FRI", 3, "Jul"],
      ["SAT", 4, "Jul"],
      ["SUN", 5, "Jul"],
    ]);
    expect(periodLabel("2026-06-29", WEEKLY)).toBe("29 Jun – 5 Jul");
  });

  it("maps a grid column back to the date the entry is stored against", () => {
    expect(dateOfDay("2026-06-29", 0)).toBe("2026-06-29");
    expect(dateOfDay("2026-06-29", 6)).toBe("2026-07-05");
  });
});

describe("todayIndex", () => {
  it("is the position of today inside the current week", () => {
    expect(todayIndex("2026-06-29", "2026-07-01", WEEKLY)).toBe(2);
  });

  it("saturates at 6 for a past week, so every weekday counts as missing", () => {
    expect(todayIndex("2026-06-29", "2026-08-01", WEEKLY)).toBe(6);
  });

  it("is -1 for a future week — nothing is late yet", () => {
    expect(todayIndex("2026-08-03", "2026-07-01", WEEKLY)).toBe(-1);
  });
});

describe("the weekly period switcher", () => {
  it("lists whole weeks back from the current one, newest first", () => {
    expect(recentPeriods("2026-07-01", WEEKLY, 3)).toEqual(["2026-06-29", "2026-06-22", "2026-06-15"]);
  });

  it("steps by exact days across a DST-style boundary", () => {
    expect(addDays("2026-04-04", 1)).toBe("2026-04-05");
    expect(addDays("2026-10-03", 1)).toBe("2026-10-04");
  });
});

describe("fortnights", () => {
  it("are 14 days, with the second Saturday landing at day 12", () => {
    const days = periodDays("2026-06-29", FN());
    expect(days).toHaveLength(14);
    expect(days[7]).toEqual(["MON", 6, "Jul"]); // day 7 is a MONDAY, not a Sunday
    expect(days[13]).toEqual(["SUN", 12, "Jul"]);
  });

  it("marks BOTH weekends", () => {
    const weekend = periodDays("2026-06-29", FN())
      .map((d, i) => [i, d[0]] as const)
      .filter(([, n]) => n === "SAT" || n === "SUN");
    expect(weekend).toEqual([
      [5, "SAT"],
      [6, "SUN"],
      [12, "SAT"],
      [13, "SUN"],
    ]);
  });

  it("align to a configured anchor, snapped to that week's Monday", () => {
    // owner says a fortnight begins Wed 15 Jul 2026; we snap to Mon 13 Jul and
    // count every fortnight from there
    const cfg = FN("2026-07-15");
    const anchorMonday = "2026-07-13";
    expect(periodStartFor("2026-07-15", cfg)).toBe(anchorMonday);
    expect(periodStartFor("2026-07-20", cfg)).toBe(anchorMonday); // still the same fortnight
    expect(periodStartFor("2026-07-27", cfg)).toBe(addDays(anchorMonday, 14)); // the next one
    // a week that is one week OFF the anchor snaps back to the anchor's phase
    expect(periodStartFor("2026-07-08", cfg)).toBe(addDays(anchorMonday, -14));
  });

  it("put a given date in different fortnights under different anchors", () => {
    // the whole point of a configurable anchor: the same Monday can be the
    // start of a period under one anchor and mid-period under another
    const monday = "2026-07-20";
    expect(periodStartFor(monday, FN("2026-07-20"))).toBe(monday); // period start
    expect(periodStartFor(monday, FN("2026-07-13"))).toBe("2026-07-13"); // mid-period
  });

  it("default (unset) anchor is still deterministic and Monday-aligned", () => {
    for (const d of ["2026-06-29", "2026-07-05", "2026-12-31"]) {
      expect(mondayIndex(periodStartFor(d, FN()))).toBe(0);
    }
    const start = periodStartFor("2026-06-30", FN());
    for (let i = 0; i < 14; i++) expect(periodStartFor(addDays(start, i), FN())).toBe(start);
    expect(periodStartFor(addDays(start, 14), FN())).toBe(addDays(start, 14));
  });

  it("steps the switcher by a fortnight, not a week", () => {
    const p = recentPeriods("2026-07-01", FN(), 3);
    expect(p[1]).toBe(addDays(p[0], -14));
    expect(p[2]).toBe(addDays(p[0], -28));
  });
});

describe("monthly periods", () => {
  it("a calendar month is its own length, including February and leap years", () => {
    expect(periodLength("2026-07-01", MONTHLY())).toBe(31);
    expect(periodLength("2026-06-01", MONTHLY())).toBe(30);
    expect(periodLength("2026-02-01", MONTHLY())).toBe(28);
    expect(periodLength("2028-02-01", MONTHLY())).toBe(29);
    expect(periodStartFor("2026-07-17", MONTHLY())).toBe("2026-07-01");
    expect(periodLabel("2026-07-01", MONTHLY())).toBe("Jul");
  });

  it("run monthStartDay -> the day before next month's, at the right length", () => {
    // a 16th–15th pay month: mid-July resolves to the period that began 16 Jun
    const cfg = MONTHLY(16);
    expect(periodStartFor("2026-07-10", cfg)).toBe("2026-06-16");
    expect(periodStartFor("2026-07-16", cfg)).toBe("2026-07-16");
    // 16 Jun -> 15 Jul inclusive is 30 days
    expect(periodLength("2026-06-16", cfg)).toBe(30);
    const days = periodDays("2026-06-16", cfg);
    expect(days[0]).toEqual(["TUE", 16, "Jun"]);
    expect(days[days.length - 1]).toEqual(["WED", 15, "Jul"]);
    // not a plain calendar month, so it keeps the date range in its label
    expect(periodLabel("2026-06-16", cfg)).toBe("16 Jun – 15 Jul");
  });

  it("steps back over uneven month lengths", () => {
    expect(recentPeriods("2026-03-15", MONTHLY(), 3)).toEqual(["2026-03-01", "2026-02-01", "2026-01-01"]);
    // anchored months step by whole months too
    expect(recentPeriods("2026-03-20", MONTHLY(16), 2)).toEqual(["2026-03-16", "2026-02-16"]);
  });

  it("todayIndex saturates at the real end of the period", () => {
    expect(todayIndex("2026-06-29", "2026-07-09", FN())).toBe(10);
    expect(todayIndex("2026-06-29", "2026-09-01", FN())).toBe(13);
    expect(todayIndex("2026-07-01", "2026-09-01", MONTHLY())).toBe(30);
    expect(todayIndex("2026-02-01", "2026-01-15", MONTHLY())).toBe(-1);
  });
});
