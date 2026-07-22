import {
  addDays,
  dateOfDay,
  mondayIndex,
  periodLabel,
  periodStartFor,
  recentPeriods,
  todayIndex,
  periodDays,
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
    expect(periodDays("2026-06-29")).toEqual([
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
    const p = recentPeriods("2026-07-01", "Weekly", 3);
    expect(p).toEqual(["2026-06-29", "2026-06-22", "2026-06-15"]);
  });

  it("steps by exact days across a DST-style boundary", () => {
    // dates are handled in UTC precisely so a clock change can't drop an hour
    // and shift the week start
    expect(addDays("2026-04-04", 1)).toBe("2026-04-05");
    expect(addDays("2026-10-03", 1)).toBe("2026-10-04");
  });
});

describe("cycles longer than a week", () => {
  it("a fortnight is 14 days and its second week is the right dates", () => {
    const days = periodDays("2026-06-29", "Fortnightly");
    expect(days).toHaveLength(14);
    expect(days[0]).toEqual(["MON", 29, "Jun"]);
    expect(days[7]).toEqual(["MON", 6, "Jul"]); // day 7 is a MONDAY, not a Sunday
    expect(days[13]).toEqual(["SUN", 12, "Jul"]);
  });

  it("marks BOTH weekends in a fortnight", () => {
    // the bug this whole change exists to kill: with a fixed 7-column
    // assumption, day 12 (the second Saturday) read as a Friday
    const days = periodDays("2026-06-29", "Fortnightly");
    const weekendDays = days.map((d, i) => [i, d[0]]).filter(([, n]) => n === "SAT" || n === "SUN");
    expect(weekendDays).toEqual([
      [5, "SAT"],
      [6, "SUN"],
      [12, "SAT"],
      [13, "SUN"],
    ]);
  });

  /* The fortnight anchor is a fixed epoch Monday rather than a date anyone
     picked, so these assert the PROPERTIES that matter — always a Monday,
     stable, 14 apart, and every day of the fortnight resolving to one start —
     instead of hardcoding boundaries that just re-state the epoch. */
  it("always starts on a Monday", () => {
    for (const d of ["2026-06-29", "2026-07-05", "2026-07-08", "2026-12-31"]) {
      expect(mondayIndex(periodStartFor(d, "Fortnightly"))).toBe(0);
    }
  });

  it("resolves every day of a fortnight to the same start", () => {
    const start = periodStartFor("2026-06-30", "Fortnightly");
    for (let i = 0; i < 14; i++) {
      expect(periodStartFor(addDays(start, i), "Fortnightly")).toBe(start);
    }
    // and the very next day belongs to the following fortnight
    expect(periodStartFor(addDays(start, 14), "Fortnightly")).toBe(addDays(start, 14));
  });

  it("steps the switcher by a fortnight, not a week", () => {
    const p = recentPeriods("2026-07-01", "Fortnightly", 3);
    expect(p[0]).toBe(periodStartFor("2026-07-01", "Fortnightly"));
    expect(p[1]).toBe(addDays(p[0], -14));
    expect(p[2]).toBe(addDays(p[0], -28));
  });

  it("a month is its own calendar length, including February", () => {
    expect(periodDays("2026-07-01", "Monthly")).toHaveLength(31);
    expect(periodDays("2026-06-01", "Monthly")).toHaveLength(30);
    expect(periodDays("2026-02-01", "Monthly")).toHaveLength(28);
    expect(periodDays("2028-02-01", "Monthly")).toHaveLength(29); // leap year
    expect(periodStartFor("2026-07-17", "Monthly")).toBe("2026-07-01");
    expect(periodLabel("2026-07-01", "Monthly")).toBe("Jul");
  });

  it("todayIndex saturates at the real end of the period", () => {
    expect(todayIndex("2026-06-29", "2026-07-09", "Fortnightly")).toBe(10);
    expect(todayIndex("2026-06-29", "2026-09-01", "Fortnightly")).toBe(13);
    expect(todayIndex("2026-07-01", "2026-09-01", "Monthly")).toBe(30);
  });

  it("steps monthly periods back over uneven month lengths", () => {
    expect(recentPeriods("2026-03-15", "Monthly", 3)).toEqual([
      "2026-03-01",
      "2026-02-01",
      "2026-01-01",
    ]);
  });
});
