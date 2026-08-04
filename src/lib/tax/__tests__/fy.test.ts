import { fyChoices, fyElapsed, fyIsCurrent, fyLabel, fyOf, fyRange } from "../fy";

/* The financial year. Every test here is a boundary, because the middle of a
   year has never been the thing that goes wrong. */

describe("fyOf", () => {
  it("names a year by the year it ends in", () => {
    expect(fyOf("2025-09-14")).toBe(2026);
    expect(fyOf("2026-03-01")).toBe(2026);
  });

  it("puts 30 June and 1 July in different years", () => {
    // The one boundary that matters: a fill on the evening of 30 June is last
    // year's deduction, and one the next morning is this year's.
    expect(fyOf("2026-06-30")).toBe(2026);
    expect(fyOf("2026-07-01")).toBe(2027);
  });

  it("reads the date as a calendar day, never as an instant", () => {
    // No Date parsing, so no timezone can move it. Same answer on any server.
    expect(fyOf("2025-07-01")).toBe(2026);
    expect(fyOf("2025-06-30")).toBe(2025);
  });
});

describe("fyRange", () => {
  it("runs 1 July to 30 June inclusive", () => {
    expect(fyRange(2026)).toEqual({ start: "2025-07-01", end: "2026-06-30" });
  });

  it("agrees with fyOf at both ends", () => {
    const { start, end } = fyRange(2026);
    expect(fyOf(start)).toBe(2026);
    expect(fyOf(end)).toBe(2026);
  });
});

describe("fyLabel", () => {
  it("writes the year the way a tax return does", () => {
    expect(fyLabel(2026)).toBe("2025–26");
    expect(fyLabel(2030)).toBe("2029–30");
  });

  it("keeps the leading zero on an '0x year", () => {
    expect(fyLabel(2100)).toBe("2099–00");
  });
});

describe("fyChoices", () => {
  it("offers five years, current first", () => {
    expect(fyChoices("2026-08-04")).toEqual([2027, 2026, 2025, 2024, 2023]);
  });

  it("rolls over on 1 July", () => {
    expect(fyChoices("2026-06-30")[0]).toBe(2026);
    expect(fyChoices("2026-07-01")[0]).toBe(2027);
  });
});

describe("fyIsCurrent", () => {
  it("is true only for the year today falls in", () => {
    expect(fyIsCurrent(2027, "2026-08-04")).toBe(true);
    expect(fyIsCurrent(2026, "2026-08-04")).toBe(false);
  });
});

describe("fyElapsed", () => {
  it("is 1 for a closed year and 0 for one that hasn't started", () => {
    expect(fyElapsed(2025, "2026-08-04")).toBe(1);
    expect(fyElapsed(2030, "2026-08-04")).toBe(0);
  });

  it("is a fraction part-way through", () => {
    const part = fyElapsed(2027, "2026-08-04");
    expect(part).toBeGreaterThan(0);
    expect(part).toBeLessThan(0.2);
  });
});
