/* The two-a-month count for large uploads (large.ts): AU months, from what
   actually landed. */

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import { largeAllowanceFrom, largeUsedThisMonth } from "../large";

describe("large uploads this month", () => {
  // 10:30 am on 15 October in Sydney
  const now = new Date("2026-10-14T23:30:00Z");

  it("counts only this AU month's", () => {
    expect(
      largeUsedThisMonth(
        [
          "2026-10-02T03:00:00Z", // October
          "2026-09-20T03:00:00Z", // September: last month's turn
        ],
        now
      )
    ).toBe(1);
  });

  it("goes by the Australian calendar, not UTC's", () => {
    // 9:30 am on 1 October in Sydney is still 30 September in UTC
    expect(largeUsedThisMonth(["2026-09-30T23:30:00Z"], now)).toBe(1);
  });

  it("leaves what's left of two, never less than none, and resets on the 1st", () => {
    expect(largeAllowanceFrom(0, now)).toEqual({ left: 2, resetsOn: "2026-11-01" });
    expect(largeAllowanceFrom(1, now)).toEqual({ left: 1, resetsOn: "2026-11-01" });
    expect(largeAllowanceFrom(3, now)).toEqual({ left: 0, resetsOn: "2026-11-01" });
  });
});
