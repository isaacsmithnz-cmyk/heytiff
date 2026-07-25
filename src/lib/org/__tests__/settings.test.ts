import {
  AU_STATES,
  ORG_EDITABLE_SECTIONS,
  buildOrgPatch,
  formatAbn,
  formatAcn,
  isOrgSection,
  isValidAbn,
  isValidAcn,
  normalizeAbn,
  preValidateOrg,
} from "../settings";

describe("section guard", () => {
  it("accepts the two org sections", () => {
    for (const s of ["identity", "contact"]) expect(isOrgSection(s)).toBe(true);
  });

  /* `compliance` was the third card — five flat columns holding one ARC
     authorisation, one contractor licence and one insurance policy. Those are
     rows in org_credentials now, so the section is not merely unrendered: the
     guard refuses it, and buildOrgPatch can no longer produce a patch that
     touches those columns even from a hand-written POST. */
  it("refuses the retired compliance section", () => {
    expect(isOrgSection("compliance")).toBe(false);
    expect(buildOrgPatch("identity", [["insurance_expiry", "01/03/2027"]]).patch).toEqual({});
  });

  it("rejects junk, staff sections and prototype names", () => {
    for (const s of ["personal", "payroll", "", "__proto__", "toString", 7, null]) {
      expect(isOrgSection(s)).toBe(false);
    }
  });
});

describe("allowlist contents", () => {
  it("never reaches ownership, the legacy name, or the logo column", () => {
    const all = Object.values(ORG_EDITABLE_SECTIONS).flat() as string[];
    for (const forbidden of ["primary_owner_user_id", "name", "id", "logo_url", "created_at"]) {
      expect(all).not.toContain(forbidden);
    }
  });

  /* The logo is set by setOrgLogo, which verifies the document behind it —
     never by a section patch carrying a path somebody typed. */
  it("keeps the retired compliance columns out of every section", () => {
    const all = Object.values(ORG_EDITABLE_SECTIONS).flat() as string[];
    for (const gone of [
      "arc_rta",
      "contractor_licence",
      "insurer",
      "insurance_policy",
      "insurance_expiry",
    ]) {
      expect(all).not.toContain(gone);
    }
  });
});

describe("formatting for reading", () => {
  it("groups an ABN 2-3-3-3 and an ACN 3-3-3", () => {
    expect(formatAbn("51824753556")).toBe("51 824 753 556");
    expect(formatAbn("51 824 753 556")).toBe("51 824 753 556");
    expect(formatAcn("123456789")).toBe("123 456 789");
  });

  it("leaves anything that isn't the right length alone", () => {
    expect(formatAbn("5182475")).toBe("5182475");
    expect(formatAbn(null)).toBe("");
    expect(formatAcn(undefined)).toBe("");
  });
});

/* The card runs the same rules the action runs, so a typo'd ABN is answered on
   the field instead of after a round trip. The messages are copied from the
   action verbatim — the same mistake has to read the same either way. */
describe("preValidateOrg", () => {
  it("marks a bad ABN, with the action's own wording", () => {
    expect(preValidateOrg("identity", { abn: "51824753557" })).toEqual({
      error: "That ABN doesn't check out — it should be 11 digits.",
      fields: ["abn"],
    });
  });

  it("marks a bad ACN", () => {
    expect(preValidateOrg("identity", { acn: "1234" })).toEqual({
      error: "An ACN is 9 digits.",
      fields: ["acn"],
    });
  });

  it("passes a clean identity, a blank ABN and any contact patch", () => {
    expect(preValidateOrg("identity", { abn: "51 824 753 556", acn: "123456789" })).toBeNull();
    expect(preValidateOrg("identity", { abn: "", acn: "" })).toBeNull();
    expect(preValidateOrg("contact", { postcode: "not a postcode" })).toBeNull();
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
