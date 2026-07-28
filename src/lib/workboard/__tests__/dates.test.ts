/* The board's clock. ServiceM8 timestamps are wall-clock strings in the
   ACCOUNT's zone, so "today" must be asked on that clock — the canonical
   failure is a Perth account whose Monday services turn overdue while it's
   still Sunday in Perth. */

import { plusDays, todayInZone } from "../dates";

describe("todayInZone", () => {
  // 13:30 UTC: Brisbane (+10) is still on the 15th, Sydney (DST, +11) has
  // rolled to the 16th — the exact disagreement the vendor zone exists for.
  const instant = new Date("2026-01-15T13:30:00Z");

  it("answers on the account's wall clock", () => {
    expect(todayInZone("Australia/Brisbane", instant)).toBe("2026-01-15");
    expect(todayInZone("Australia/Sydney", instant)).toBe("2026-01-16");
    expect(todayInZone("Australia/Perth", instant)).toBe("2026-01-15");
  });

  it("falls back to the AU anchor when the zone is missing or junk", () => {
    const anchor = todayInZone("Australia/Sydney", instant);
    expect(todayInZone(null, instant)).toBe(anchor);
    expect(todayInZone(undefined, instant)).toBe(anchor);
    expect(todayInZone("", instant)).toBe(anchor);
    expect(todayInZone("Not/AZone", instant)).toBe(anchor);
  });
});

describe("plusDays", () => {
  it("is calendar-safe across month ends and leap years", () => {
    expect(plusDays("2026-07-28", 7)).toBe("2026-08-04");
    expect(plusDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(plusDays("2028-02-28", 1)).toBe("2028-02-29"); // leap
    expect(plusDays("2026-03-01", -1)).toBe("2026-02-28"); // not
    expect(plusDays("2026-07-28", -14)).toBe("2026-07-14");
  });
});
