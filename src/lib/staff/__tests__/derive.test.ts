import {
  EXPIRY_WARN_DAYS,
  daysUntil,
  deriveCompliance,
  initialsFrom,
  startedLabel,
  yearsSince,
} from "../derive";
import type { StaffLicence } from "../types";

const NOW = new Date("2026-07-19T00:00:00Z");

const lic = (typeName: string, expiryDate: string | null): StaffLicence => ({
  id: typeName,
  typeName,
  licenceNumber: null,
  expiryDate,
  color: null,
});

const CLEAR = { status: null, verifiedAt: null };

describe("yearsSince", () => {
  it("returns one decimal place", () => {
    expect(yearsSince("2021-03-01", NOW)).toBe("5.4");
    expect(yearsSince("2024-01-15", NOW)).toBe("2.5");
  });

  it("returns an em dash when there is no start date", () => {
    expect(yearsSince(null, NOW)).toBe("—");
    expect(yearsSince(undefined, NOW)).toBe("—");
    expect(yearsSince("", NOW)).toBe("—");
  });

  it("returns an em dash for an unparseable date", () => {
    expect(yearsSince("not a date", NOW)).toBe("—");
  });

  it("returns an em dash for a future start date rather than a negative", () => {
    expect(yearsSince("2027-01-01", NOW)).toBe("—");
  });

  it("reads a timestamp as well as a bare date", () => {
    expect(yearsSince("2021-03-01T09:30:00Z", NOW)).toBe("5.4");
  });

  it("is 0.0 on the start date itself", () => {
    expect(yearsSince("2026-07-19", NOW)).toBe("0.0");
  });
});

describe("initialsFrom", () => {
  it("takes the first letter of the first two words", () => {
    expect(initialsFrom("Jordan Mills")).toBe("JM");
    expect(initialsFrom("  liam  o'brien  ")).toBe("LO");
  });

  it("takes two letters from a single name", () => {
    expect(initialsFrom("Cher")).toBe("CH");
  });

  it("falls back to the email, then to ?", () => {
    expect(initialsFrom(null, "priya@heytiff.co")).toBe("PR");
    expect(initialsFrom("", "")).toBe("?");
    expect(initialsFrom(null, null)).toBe("?");
  });
});

describe("startedLabel", () => {
  it("renders a short month and year", () => {
    expect(startedLabel("2021-03-01")).toMatch(/Mar 2021/);
  });

  it("returns an em dash when unset or unparseable", () => {
    expect(startedLabel(null)).toBe("—");
    expect(startedLabel("nope")).toBe("—");
  });
});

describe("daysUntil", () => {
  it("counts forward and backward from today", () => {
    expect(daysUntil("2026-07-29", NOW)).toBe(10);
    expect(daysUntil("2026-07-09", NOW)).toBe(-10);
    expect(daysUntil("2026-07-19", NOW)).toBe(0);
  });

  it("is null when there is no date", () => {
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil("nope", NOW)).toBeNull();
  });
});

describe("deriveCompliance", () => {
  it("flags an expired licence as bad, naming it", () => {
    const c = deriveCompliance([lic("White Card", "2026-07-16")], CLEAR, NOW);
    expect(c.state).toBe("bad");
    expect(c.label).toBe("White Card expired");
    expect(c.expiresDays).toBe(-3);
  });

  it("warns inside the 30-day window", () => {
    const c = deriveCompliance([lic("ARC licence", "2026-08-02")], CLEAR, NOW);
    expect(c.state).toBe("warn");
    expect(c.label).toBe("ARC licence expires 14d");
    expect(c.expiresDays).toBe(14);
  });

  it("treats the boundary day itself as a warning", () => {
    const at = new Date(NOW.getTime() + EXPIRY_WARN_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(deriveCompliance([lic("ARC licence", at)], CLEAR, NOW).state).toBe("warn");
  });

  it("is ok well beyond the window", () => {
    const c = deriveCompliance([lic("ARC licence", "2028-01-01")], CLEAR, NOW);
    expect(c.state).toBe("ok");
    expect(c.label).toBe("Compliant");
  });

  it("reports the soonest expiry when several licences are held", () => {
    const c = deriveCompliance(
      [
        lic("Driver’s licence", "2029-01-01"),
        lic("White Card", "2026-07-27"), // soonest
        lic("ARC licence", "2027-06-01"),
      ],
      CLEAR,
      NOW
    );
    expect(c.label).toBe("White Card expires 8d");
    expect(c.expiresDays).toBe(8);
  });

  it("prefers an expired licence over an expiring one", () => {
    const c = deriveCompliance(
      [lic("ARC licence", "2026-07-29"), lic("White Card", "2026-06-01")],
      CLEAR,
      NOW
    );
    expect(c.state).toBe("bad");
    expect(c.label).toBe("White Card expired");
  });

  it("ignores licences with no expiry recorded", () => {
    const c = deriveCompliance([lic("Contractor licence", null)], CLEAR, NOW);
    expect(c.label).toBe("—");
    expect(c.state).toBe("ok");
  });

  it("warns on work rights recorded but not verified", () => {
    const c = deriveCompliance([], { status: "482 TSS", verifiedAt: null }, NOW);
    expect(c.state).toBe("warn");
    expect(c.label).toBe("Work rights unverified");
  });

  it("does not warn once work rights are verified", () => {
    const c = deriveCompliance(
      [],
      { status: "Australian citizen", verifiedAt: "2026-01-01T00:00:00Z" },
      NOW
    );
    expect(c.state).toBe("ok");
  });

  it("a licence problem outranks unverified work rights", () => {
    const c = deriveCompliance(
      [lic("White Card", "2026-06-01")],
      { status: "482 TSS", verifiedAt: null },
      NOW
    );
    expect(c.label).toBe("White Card expired");
  });

  it("a brand-new hire with nothing recorded is not flagged", () => {
    // the important one: an empty card must not read as non-compliant
    const c = deriveCompliance([], CLEAR, NOW);
    expect(c.state).toBe("ok");
    expect(c.label).toBe("—");
    expect(c.expiresDays).toBeGreaterThan(365);
  });

  it("sorts by urgency — worst first — when used as a sort key", () => {
    const rows = [
      deriveCompliance([], CLEAR, NOW), // nothing recorded
      deriveCompliance([lic("A", "2026-08-02")], CLEAR, NOW), // 14d
      deriveCompliance([lic("B", "2026-06-01")], CLEAR, NOW), // expired
      deriveCompliance([lic("C", "2029-01-01")], CLEAR, NOW), // fine
    ].sort((a, b) => a.expiresDays - b.expiresDays);
    expect(rows.map((r) => r.state)).toEqual(["bad", "warn", "ok", "ok"]);
    expect(rows[3].label).toBe("—"); // nothing-recorded sorts last
  });
});
