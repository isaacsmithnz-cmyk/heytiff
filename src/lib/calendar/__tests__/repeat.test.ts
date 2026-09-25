import {
  MAX_OCCURRENCES,
  eventsDoor,
  occurrences,
  readRepeatRule,
  repeatPhrase,
  repeatPlan,
  repeatsFact,
  type RepeatRule,
} from "../repeat";

/* The window a series stops at: the calendar's, from today (Thu 24 Sept 2026)
   to the last day of Aug 2027. */
const FROM = "2026-09-24";
const UNTIL = "2027-08-31";

describe("occurrences", () => {
  it("counts the first Thursday of every month to the window's end: 11 dates, 1 Oct … 5 Aug", () => {
    const rule: RepeatRule = { every: "month", day: "thu", nth: 1 };
    const days = occurrences(rule, FROM, UNTIL);
    expect(days).toEqual([
      "2026-10-01",
      "2026-11-05",
      "2026-12-03",
      "2027-01-07",
      "2027-02-04",
      "2027-03-04",
      "2027-04-01",
      "2027-05-06",
      "2027-06-03",
      "2027-07-01",
      "2027-08-05",
    ]);
    expect(eventsDoor(days.length)).toBe("11 events on the calendar");
    expect(repeatsFact(rule, days[days.length - 1])).toBe("Monthly, until Aug 2027");
    expect(repeatPlan(rule, days[days.length - 1])).toBe("Every month, the first Thursday, until Aug 2027");
    expect(repeatPhrase(rule)).toBe("the first Thursday of every month");
  });

  it("skips this month's date when it is already past (the first Thursday of Sept was the 3rd)", () => {
    expect(occurrences({ every: "month", day: "thu", nth: 1 }, "2026-09-24", "2026-10-31")).toEqual(["2026-10-01"]);
  });

  it("counts the last Friday of each month, the start day itself included", () => {
    expect(occurrences({ every: "month", day: "fri", nth: "last" }, "2026-09-25", "2026-12-31")).toEqual([
      "2026-09-25",
      "2026-10-30",
      "2026-11-27",
      "2026-12-25",
    ]);
  });

  it("counts the third Wednesday", () => {
    expect(occurrences({ every: "month", day: "wed", nth: 3 }, "2027-01-01", "2027-03-31")).toEqual([
      "2027-01-20",
      "2027-02-17",
      "2027-03-17",
    ]);
  });

  it("counts a fortnight from the first matching day on or after the start", () => {
    expect(occurrences({ every: "fortnight", day: "tue" }, FROM, "2026-11-30")).toEqual([
      "2026-09-29",
      "2026-10-13",
      "2026-10-27",
      "2026-11-10",
      "2026-11-24",
    ]);
  });

  it("counts a week, the start day included when it is the day", () => {
    expect(occurrences({ every: "week", day: "thu" }, FROM, "2026-10-15")).toEqual([
      "2026-09-24",
      "2026-10-01",
      "2026-10-08",
      "2026-10-15",
    ]);
  });

  it("stops at MAX_OCCURRENCES however far the end is", () => {
    const days = occurrences({ every: "week", day: "mon" }, "2026-01-01", "2030-12-31");
    expect(days).toHaveLength(MAX_OCCURRENCES);
    expect(days[0]).toBe("2026-01-05");
    const monthly = occurrences({ every: "month", day: "mon", nth: 1 }, "2026-01-01", "2099-12-31");
    expect(monthly).toHaveLength(MAX_OCCURRENCES);
  });

  it("gives nothing for a span that runs backwards or a day that is not a day", () => {
    expect(occurrences({ every: "week", day: "mon" }, "2026-10-01", "2026-09-01")).toEqual([]);
    expect(occurrences({ every: "week", day: "mon" }, "2026-02-31", "2026-09-01")).toEqual([]);
  });

  it("refuses a fifth Thursday rather than spilling it into the next month", () => {
    const bad = { every: "month", day: "thu", nth: 5 } as unknown as RepeatRule;
    expect(occurrences(bad, FROM, UNTIL)).toEqual([]);
  });

  it("refuses a weekday it cannot read", () => {
    const bad = { every: "week", day: "someday" } as unknown as RepeatRule;
    expect(occurrences(bad, FROM, UNTIL)).toEqual([]);
  });
});

describe("readRepeatRule", () => {
  it("reads the rule however the model spelt it", () => {
    expect(readRepeatRule({ every: "monthly", day: "Thursday", nth: "first" })).toEqual({ every: "month", day: "thu", nth: 1 });
    expect(readRepeatRule({ every: "month", day: "fri", nth: -1 })).toEqual({ every: "month", day: "fri", nth: "last" });
    expect(readRepeatRule({ every: "month", day: "tues", nth: "2" })).toEqual({ every: "month", day: "tue", nth: 2 });
    expect(readRepeatRule({ every: "Fortnightly", day: "WED" })).toEqual({ every: "fortnight", day: "wed" });
    expect(readRepeatRule({ every: "week", day: "sun", nth: 3 })).toEqual({ every: "week", day: "sun" });
  });

  it("refuses anything it cannot count", () => {
    expect(readRepeatRule(null)).toBeNull();
    expect(readRepeatRule("first thursday")).toBeNull();
    expect(readRepeatRule([])).toBeNull();
    expect(readRepeatRule({ every: "yearly", day: "thu" })).toBeNull();
    expect(readRepeatRule({ every: "month", day: "thu" })).toBeNull(); // which Thursday?
    expect(readRepeatRule({ every: "month", day: "thu", nth: 5 })).toBeNull();
    expect(readRepeatRule({ every: "month", day: "th", nth: 1 })).toBeNull();
  });
});

describe("the words", () => {
  it("says every week and every fortnight the way Tiff says them", () => {
    expect(repeatPhrase({ every: "week", day: "tue" })).toBe("every Tuesday");
    expect(repeatPhrase({ every: "fortnight", day: "tue" })).toBe("every second Tuesday");
    expect(repeatPhrase({ every: "month", day: "fri", nth: "last" })).toBe("the last Friday of every month");
    expect(repeatsFact({ every: "week", day: "tue" }, "2027-08-31")).toBe("Weekly, until Aug 2027");
    expect(repeatsFact({ every: "fortnight", day: "tue" }, "2027-08-24")).toBe("Fortnightly, until Aug 2027");
    expect(repeatPlan({ every: "fortnight", day: "tue" }, "2027-08-24")).toBe("Every fortnight, on Tuesday, until Aug 2027");
  });

  it('counts one event as "1 event on the calendar"', () => {
    expect(eventsDoor(1)).toBe("1 event on the calendar");
  });
});
