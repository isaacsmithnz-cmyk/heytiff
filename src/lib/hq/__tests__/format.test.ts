import { formatDate, formatDateTime, formatTenure } from "../format";

/* HQ's formatters are pinned to the same AU anchor as lib/au-dates, because
   the change log GROUPS BY the formatted day — a different zone files an edit
   under a different date than every customer screen. These pin the zone, so a
   quiet revert to the server clock (or the old Pacific/Auckland pin) fails. */

describe("formatDate", () => {
  it("names the AU day of the instant, not the UTC one", () => {
    // 20:00 UTC on 9 Jan is 07:00 on the 10th in Sydney (AEDT, UTC+11)
    expect(formatDate("2026-01-09T20:00:00Z")).toBe("10 Jan 2026");
  });

  it("keeps a mid-UTC-day instant on the same date (AEST)", () => {
    expect(formatDate("2026-07-26T02:00:00Z")).toBe("26 July 2026");
  });

  it("dashes out empties and junk", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("nope")).toBe("—");
  });
});

describe("formatDateTime", () => {
  it("renders the Sydney wall-clock time, 24h", () => {
    // 09:30 UTC = 19:30 AEST
    expect(formatDateTime("2026-07-26T09:30:00Z")).toBe("26 July, 19:30");
  });

  it("dashes out empties", () => {
    expect(formatDateTime(undefined)).toBe("—");
  });
});

describe("formatTenure", () => {
  it("counts from a fixed now", () => {
    const now = new Date("2026-07-26T00:00:00Z");
    expect(formatTenure("2026-07-26T00:00:00Z", now)).toBe("today");
    expect(formatTenure("2026-07-20T00:00:00Z", now)).toBe("6 days");
    expect(formatTenure(null, now)).toBe("—");
  });
});
