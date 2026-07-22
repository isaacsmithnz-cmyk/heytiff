import {
  AU_STATES,
  ORG_EDITABLE_SECTIONS,
  buildOrgPatch,
  isOrgSection,
  isValidAbn,
  isValidAcn,
  normalizeAbn,
} from "../settings";

describe("section guard", () => {
  it("accepts the three org sections", () => {
    for (const s of ["identity", "contact", "compliance"]) expect(isOrgSection(s)).toBe(true);
  });

  it("rejects junk, staff sections and prototype names", () => {
    for (const s of ["personal", "payroll", "", "__proto__", "toString", 7, null]) {
      expect(isOrgSection(s)).toBe(false);
    }
  });
});

describe("allowlist contents", () => {
  it("never reaches ownership, the legacy name, or the deferred logo", () => {
    const all = Object.values(ORG_EDITABLE_SECTIONS).flat() as string[];
    for (const forbidden of ["primary_owner_user_id", "name", "id", "logo_url", "created_at"]) {
      expect(all).not.toContain(forbidden);
    }
  });
});

describe("ABN validation (ATO checksum)", () => {
  it("accepts the ATO's published example, spaced or not", () => {
    expect(isValidAbn("51 824 753 556")).toBe(true);
    expect(isValidAbn("51824753556")).toBe(true);
  });

  it("rejects a single-digit typo", () => {
    expect(isValidAbn("51824753557")).toBe(false);
    expect(isValidAbn("51824753546")).toBe(false);
  });

  it("rejects a transposition", () => {
    expect(isValidAbn("15824753556")).toBe(false);
  });

  it("rejects wrong lengths and non-digits", () => {
    expect(isValidAbn("5182475355")).toBe(false);
    expect(isValidAbn("518247535561")).toBe(false);
    expect(isValidAbn("51 824 75E 556")).toBe(false);
    expect(isValidAbn("")).toBe(false);
  });

  it("normalizes spacing", () => {
    expect(normalizeAbn(" 51 824 753 556 ")).toBe("51824753556");
  });
});

describe("ACN validation", () => {
  it("is nine digits, spaces tolerated", () => {
    expect(isValidAcn("123 456 789")).toBe(true);
    expect(isValidAcn("123456789")).toBe(true);
    expect(isValidAcn("12345678")).toBe(false);
    expect(isValidAcn("12345678X")).toBe(false);
  });
});

describe("buildOrgPatch", () => {
  it("keeps only the section's own columns", () => {
    const { patch } = buildOrgPatch("identity", [
      ["trading_name", "Smith Air"],
      ["email", "should be dropped — contact section"],
      ["primary_owner_user_id", "attack"],
    ]);
    expect(patch).toEqual({ trading_name: "Smith Air" });
  });

  it("converts the insurance expiry from dd/mm/yyyy", () => {
    const { patch, invalid } = buildOrgPatch("compliance", [["insurance_expiry", "01/03/2027"]]);
    expect(patch).toEqual({ insurance_expiry: "2027-03-01" });
    expect(invalid).toEqual([]);
  });

  it("reports an unreadable expiry instead of dropping it", () => {
    const { invalid } = buildOrgPatch("compliance", [["insurance_expiry", "31/02/2027"]]);
    expect(invalid).toEqual(["insurance_expiry"]);
  });

  it("accepts real states, clears on empty, drops junk", () => {
    expect(buildOrgPatch("contact", [["state", "VIC"]]).patch).toEqual({ state: "VIC" });
    expect(buildOrgPatch("contact", [["state", ""]]).patch).toEqual({ state: null });
    expect(buildOrgPatch("contact", [["state", "Auckland"]]).patch).toEqual({});
    expect(AU_STATES).toHaveLength(8);
  });

  it("passes the GST segmented values through and clears on empty", () => {
    expect(buildOrgPatch("identity", [["gst_registered", "Yes"]]).patch).toEqual({ gst_registered: "Yes" });
    expect(buildOrgPatch("identity", [["gst_registered", "No"]]).patch).toEqual({ gst_registered: "No" });
    expect(buildOrgPatch("identity", [["gst_registered", ""]]).patch).toEqual({ gst_registered: null });
    expect(buildOrgPatch("identity", [["gst_registered", "maybe"]]).patch).toEqual({});
  });

  it("stores an emptied text field as null", () => {
    expect(buildOrgPatch("contact", [["suburb", "  "]]).patch).toEqual({ suburb: null });
  });
});
