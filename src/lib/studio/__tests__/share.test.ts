/* Live-link lifetime — the rule the public route and the Summary card both
   read. Fixed clock throughout; nothing here may depend on "now". */

import {
  SHARE_TTL_DAYS,
  shareExpiresAt,
  isShareExpired,
  shareDaysLeft,
} from "../share";

const NOW = new Date("2026-07-23T12:00:00.000Z");
const daysBefore = (n: number): string =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("share link lifetime", () => {
  it("runs for a fortnight", () => {
    expect(SHARE_TTL_DAYS).toBe(14);
    expect(shareExpiresAt("2026-07-01T00:00:00.000Z").toISOString()).toBe(
      "2026-07-15T00:00:00.000Z"
    );
  });

  it("a fresh link is live, a three-week-old one is dead", () => {
    expect(isShareExpired(daysBefore(0), NOW)).toBe(false);
    expect(isShareExpired(daysBefore(13), NOW)).toBe(false);
    expect(isShareExpired(daysBefore(21), NOW)).toBe(true);
  });

  it("expires ON the boundary, not after it", () => {
    // exactly 14 days old — the link is done
    expect(isShareExpired(daysBefore(14), NOW)).toBe(true);
    const hairBefore = new Date(NOW.getTime() - 14 * 86_400_000 + 1000).toISOString();
    expect(isShareExpired(hairBefore, NOW)).toBe(false);
  });

  it("FAILS CLOSED — no timestamp or an unreadable one counts as expired", () => {
    // rows that predate the expiry column must not become immortal links
    expect(isShareExpired(null, NOW)).toBe(true);
    expect(isShareExpired(undefined, NOW)).toBe(true);
    expect(isShareExpired("not a date", NOW)).toBe(true);
    expect(shareDaysLeft(null, NOW)).toBe(0);
  });

  it("counts whole days left, rounding up so the last day still shows", () => {
    expect(shareDaysLeft(daysBefore(0), NOW)).toBe(14);
    expect(shareDaysLeft(daysBefore(13), NOW)).toBe(1);
    // 13.5 days old — part of a day left, still reads as 1
    expect(shareDaysLeft(new Date(NOW.getTime() - 13.5 * 86_400_000), NOW)).toBe(1);
    expect(shareDaysLeft(daysBefore(14), NOW)).toBe(0);
    expect(shareDaysLeft(daysBefore(99), NOW)).toBe(0);
  });
});
