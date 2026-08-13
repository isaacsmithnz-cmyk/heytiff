import {
  EXPIRY_WARN_DAYS,
  daysUntil,
  deriveCompliance,
  initialsFrom,
  startedLabel,
  yearsSince,
  type WorkRightsFacts,
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

const CLEAR: WorkRightsFacts = {
  status: null,
  visaType: null,
  visaExpiry: null,
  vevoCheckedAt: null,
};
/** An otherwise-blank work-rights record with the named facts filled in. */
const wr = (over: Partial<WorkRightsFacts> = {}): WorkRightsFacts => ({ ...CLEAR, ...over });

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

  it("resolves 'today' on the AU clock, not the UTC one", () => {
    // 15:00 UTC on the 19th is already the 20th in Sydney: a licence expiring
    // on the 20th expires TODAY. The old toISOString() derivation said 1 —
    // "expires tomorrow" in the Team directory while the dashboard chip,
    // anchored on todayInAu, said "expires today" all morning.
    expect(daysUntil("2026-07-20", new Date("2026-07-19T15:00:00Z"))).toBe(0);
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
    expect(c.label).toBe("ARC licence expires in 2 weeks");
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
    expect(c.label).toBe("White Card expires in 8 days");
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

  it("warns on work rights recorded but never VEVO-checked", () => {
    const c = deriveCompliance([], wr({ status: "482 TSS" }), NOW);
    expect(c.state).toBe("warn");
    expect(c.label).toBe("Work rights unverified");
  });

  /* THE ONE THAT WAS BROKEN. The warning read `work_rights_verified_at`, which
     no form in the app writes — so recording the VEVO check on the profile
     saved `vevo_checked_at` and the chip went on warning forever. */
  it("clears once the VEVO check is recorded — the column the forms write", () => {
    const c = deriveCompliance(
      [],
      wr({ status: "Australian citizen", vevoCheckedAt: "2026-01-01" }),
      NOW
    );
    expect(c.state).toBe("ok");
  });

  /* THE OTHER ONE. A visa expiry was never passed in at all, so someone whose
     right to work had lapsed read "Compliant" in the Team directory while the
     dashboard showed them red. */
  it("flags an expired visa, naming the visa type", () => {
    const c = deriveCompliance(
      [],
      wr({ status: "482 TSS", visaType: "482 TSS", visaExpiry: "2026-07-16", vevoCheckedAt: "2026-01-01" }),
      NOW
    );
    expect(c.state).toBe("bad");
    expect(c.label).toBe("482 TSS expired");
    expect(c.expiresDays).toBe(-3);
  });

  it("warns on a visa inside the window even when every licence is in date", () => {
    const c = deriveCompliance(
      [lic("ARC licence", "2029-01-01")],
      wr({ status: "482 TSS", visaType: "482 TSS", visaExpiry: "2026-08-02", vevoCheckedAt: "2026-01-01" }),
      NOW
    );
    expect(c.state).toBe("warn");
    expect(c.label).toBe("482 TSS expires in 2 weeks");
  });

  it("falls back to 'Visa' when no type was recorded", () => {
    const c = deriveCompliance([], wr({ visaExpiry: "2026-07-16" }), NOW);
    expect(c.label).toBe("Visa expired");
  });

  it("ranks the visa against the licences, soonest first", () => {
    const soonestIsTheVisa = deriveCompliance(
      [lic("White Card", "2026-08-10")],
      wr({ visaType: "482 TSS", visaExpiry: "2026-07-27" }),
      NOW
    );
    expect(soonestIsTheVisa.label).toBe("482 TSS expires in 8 days");

    const soonestIsTheLicence = deriveCompliance(
      [lic("White Card", "2026-07-27")],
      wr({ visaType: "482 TSS", visaExpiry: "2026-08-10" }),
      NOW
    );
    expect(soonestIsTheLicence.label).toBe("White Card expires in 8 days");
  });

  it("a citizen with no visa recorded is not flagged for one", () => {
    const c = deriveCompliance(
      [],
      wr({ status: "Australian citizen", vevoCheckedAt: "2026-01-01" }),
      NOW
    );
    expect(c.state).toBe("ok");
    expect(c.label).toBe("—");
  });

  it("a licence problem outranks unverified work rights", () => {
    const c = deriveCompliance(
      [lic("White Card", "2026-06-01")],
      wr({ status: "482 TSS" }),
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
