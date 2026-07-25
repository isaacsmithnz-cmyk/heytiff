import {
  DAYS_PER_MONTH,
  agoLabel,
  daysDuration,
  dueIn,
  durationDays,
  expiresIn,
  expiryClause,
  inLabel,
  magnitudeLabel,
} from "../duration";

/* The thresholds are the product decision, so they are pinned literally rather
   than derived from the constants — a test that recomputes the rule cannot
   catch the rule being changed. */

describe("daysDuration — the granularity ladder", () => {
  it("counts in days up to a fortnight", () => {
    expect(daysDuration(2).label).toBe("2 days");
    expect(daysDuration(9).label).toBe("9 days");
    expect(daysDuration(13).label).toBe("13 days"); // last day-shaped day
  });

  it("switches to weeks at 14 days and stays there to 60", () => {
    expect(daysDuration(14).label).toBe("2 weeks"); // first week-shaped day
    expect(daysDuration(45).label).toBe("6 weeks");
    expect(daysDuration(60).label).toBe("8 weeks"); // last week-shaped day
  });

  it("switches to months at 61 days", () => {
    expect(daysDuration(61).label).toBe("2 months"); // first month-shaped day
    expect(daysDuration(90).label).toBe("3 months");
    expect(daysDuration(365).label).toBe("12 months");
  });

  it("carries the number and unit apart, for markup that styles them apart", () => {
    expect(daysDuration(45)).toEqual({ value: "6", unit: "weeks", label: "6 weeks", past: false });
  });

  it("names today, tomorrow and yesterday instead of counting them", () => {
    expect(daysDuration(0)).toEqual({ value: "", unit: "", label: "today", past: false });
    expect(daysDuration(1)).toEqual({ value: "", unit: "", label: "tomorrow", past: false });
    expect(daysDuration(-1)).toEqual({ value: "", unit: "", label: "yesterday", past: true });
  });

  it("reads a past gap as a magnitude plus a flag, not a negative number", () => {
    expect(daysDuration(-45)).toEqual({ value: "6", unit: "weeks", label: "6 weeks", past: true });
    expect(daysDuration(-9).label).toBe("9 days");
  });

  it("tolerates a fractional or negative-zero day count", () => {
    expect(daysDuration(13.9).label).toBe("13 days"); // truncated, not rounded up
    expect(daysDuration(-0).label).toBe("today");
  });
});

/* THE LOAD-BEARING PROPERTY.

   Every coarser unit rounds, and the direction of that rounding is a promise:
   the label may never claim more time than actually exists. Read the label back
   at its most generous interpretation — a week is 7 days, a month is 30 — and
   it must still fit inside the real gap. A single ">" here is the difference
   between "book it in week 6" and missing a rego renewal. */
describe("never overstates the gap", () => {
  it("holds for every day count out to a year and beyond", () => {
    for (let n = 1; n <= 400; n++) {
      const claimed = durationDays(daysDuration(n));
      expect(claimed).toBeLessThanOrEqual(n);
      // and the same, in the past tense — never claim MORE time has passed
      expect(durationDays(daysDuration(-n))).toBeLessThanOrEqual(n);
    }
  });

  it("is as precise as the unit allows — never needlessly coarse", () => {
    // one more of whatever unit was chosen would have overshot; that is what
    // makes this a floor rather than an excuse to under-report wildly.
    for (let n = 2; n <= 400; n++) {
      const d = daysDuration(n);
      const step = d.unit.startsWith("month") ? DAYS_PER_MONTH : d.unit.startsWith("week") ? 7 : 1;
      expect(durationDays(d) + step).toBeGreaterThan(n);
    }
  });

  it("is exact on the day counts that divide evenly", () => {
    expect(durationDays(daysDuration(14))).toBe(14);
    expect(durationDays(daysDuration(90))).toBe(90);
  });
});

describe("expiresIn / expiryClause", () => {
  it("reads as a sentence in both tenses", () => {
    expect(expiresIn(45)).toBe("Expires in 6 weeks");
    expect(expiresIn(12)).toBe("Expires in 12 days");
    expect(expiresIn(-14)).toBe("Expired 2 weeks ago");
  });

  it("drops the preposition for the wordy specials", () => {
    expect(expiresIn(0)).toBe("Expires today");
    expect(expiresIn(1)).toBe("Expires tomorrow");
    expect(expiresIn(-1)).toBe("Expired yesterday");
  });

  it("has an uncapitalised twin, for labels that name the thing first", () => {
    expect(expiryClause(45)).toBe("expires in 6 weeks");
    expect(`ARC licence ${expiryClause(45)}`).toBe("ARC licence expires in 6 weeks");
    expect(`Rego ${expiryClause(-4)}`).toBe("Rego expired 4 days ago");
  });
});

describe("dueIn", () => {
  it("counts down, then says so plainly once it is past", () => {
    expect(dueIn(12)).toBe("Due in 12 days");
    expect(dueIn(0)).toBe("Due today");
    expect(dueIn(1)).toBe("Due tomorrow");
    expect(dueIn(-14)).toBe("Overdue 2 weeks");
  });

  it("says how overdue, not when — 'Overdue yesterday' is not English", () => {
    expect(dueIn(-1)).toBe("Overdue 1 day");
    expect(dueIn(-4)).toBe("Overdue 4 days");
  });
});

describe("agoLabel", () => {
  it("puts elapsed time in the past tense", () => {
    expect(agoLabel(45)).toBe("6 weeks ago");
    expect(agoLabel(3)).toBe("3 days ago");
  });

  it("uses the words for the very recent past", () => {
    expect(agoLabel(0)).toBe("today");
    expect(agoLabel(1)).toBe("yesterday");
  });

  it("takes elapsed days whichever sign the caller happens to hold", () => {
    // chips carry a negative `daysUntil`; studio carries a positive count
    expect(agoLabel(-45)).toBe("6 weeks ago");
  });
});

describe("inLabel / magnitudeLabel", () => {
  it("supplies the preposition only when there is a quantity to precede", () => {
    expect(inLabel(45)).toBe("in 6 weeks");
    expect(inLabel(0)).toBe("today"); // never "in today"
    expect(inLabel(1)).toBe("tomorrow");
    expect(`renews ${inLabel(21)}`).toBe("renews in 3 weeks");
  });

  it("strips every special and tense down to the bare quantity", () => {
    expect(magnitudeLabel(1)).toBe("1 day");
    expect(magnitudeLabel(-1)).toBe("1 day");
    expect(magnitudeLabel(0)).toBe("0 days");
    expect(magnitudeLabel(-45)).toBe("6 weeks");
  });
});

