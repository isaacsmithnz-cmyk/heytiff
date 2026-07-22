import {
  SELF_EDITABLE_SECTIONS,
  buildPatch,
  formatAuDate,
  isSelfSection,
  parseAuDate,
} from "../profile";

describe("isSelfSection", () => {
  it("accepts the four self-editable sections", () => {
    for (const s of ["personal", "emergency", "workrights", "licences"]) {
      expect(isSelfSection(s)).toBe(true);
    }
  });

  it("rejects the admin-only sections", () => {
    for (const s of ["payroll", "permissions", "notes"]) {
      expect(isSelfSection(s)).toBe(false);
    }
  });

  it("rejects junk and prototype keys", () => {
    for (const s of ["", "__proto__", "constructor", "toString", "PERSONAL", null, 7, {}]) {
      expect(isSelfSection(s)).toBe(false);
    }
  });
});

describe("allowlist contents", () => {
  it("contains no payroll, permissions or notes column anywhere", () => {
    const all = Object.values(SELF_EDITABLE_SECTIONS).flat() as string[];
    const forbidden = [
      "hourly_wage",
      "contracted_hours",
      "utilisation",
      "cost_split",
      "notes",
      "job_title",
      "org_id",
      "user_id",
      "id",
    ];
    for (const col of forbidden) expect(all).not.toContain(col);
  });
});

describe("parseAuDate", () => {
  it("parses dd/mm/yyyy to ISO", () => {
    expect(parseAuDate("05/03/2026")).toBe("2026-03-05");
    expect(parseAuDate("5/3/2026")).toBe("2026-03-05");
    expect(parseAuDate(" 31 / 12 / 2025 ")).toBe("2025-12-31");
    expect(parseAuDate("1-2-2024")).toBe("2024-02-01");
  });

  it("reads day-first, not month-first", () => {
    // 03/04 is 3 April in AU, not 4 March
    expect(parseAuDate("03/04/2026")).toBe("2026-04-03");
  });

  it("returns null for empty input", () => {
    expect(parseAuDate("")).toBeNull();
    expect(parseAuDate("   ")).toBeNull();
  });

  it("rejects impossible dates rather than rolling them forward", () => {
    expect(parseAuDate("31/02/2026")).toBeNull();
    expect(parseAuDate("32/01/2026")).toBeNull();
    expect(parseAuDate("01/13/2026")).toBeNull();
    expect(parseAuDate("00/01/2026")).toBeNull();
  });

  it("accepts a real leap day and rejects a fake one", () => {
    expect(parseAuDate("29/02/2024")).toBe("2024-02-29");
    expect(parseAuDate("29/02/2025")).toBeNull();
  });

  it("rejects malformed input", () => {
    for (const bad of ["2026-03-05", "5 March 2026", "5/3/26", "abc", "5//2026"]) {
      expect(parseAuDate(bad)).toBeNull();
    }
  });
});

describe("formatAuDate", () => {
  it("renders ISO as dd/mm/yyyy", () => {
    expect(formatAuDate("2026-03-05")).toBe("05/03/2026");
    expect(formatAuDate("2026-03-05T00:00:00Z")).toBe("05/03/2026");
  });

  it("renders nothing for null/empty/malformed", () => {
    expect(formatAuDate(null)).toBe("");
    expect(formatAuDate(undefined)).toBe("");
    expect(formatAuDate("")).toBe("");
    expect(formatAuDate("not a date")).toBe("");
  });

  it("round-trips with parseAuDate", () => {
    expect(formatAuDate(parseAuDate("7/9/2021"))).toBe("07/09/2021");
  });
});

describe("buildPatch", () => {
  it("keeps only the section's own columns", () => {
    const { patch } = buildPatch("emergency", [
      ["emergency_name", "Sarah Mills"],
      ["full_name", "Should Be Dropped"],
      ["hourly_wage", "999"],
    ]);
    expect(patch).toEqual({ emergency_name: "Sarah Mills" });
  });

  it("drops payroll columns even when the section is legitimate", () => {
    const { patch } = buildPatch("personal", [
      ["full_name", "Jordan"],
      ["hourly_wage", "500"],
      ["cost_split", '{"install":100}'],
      ["notes", "give me a raise"],
    ]);
    expect(patch).toEqual({ full_name: "Jordan" });
  });

  it("converts dd/mm/yyyy date columns to ISO", () => {
    const { patch, invalid } = buildPatch("personal", [["start_date", "01/06/2020"]]);
    expect(patch).toEqual({ start_date: "2020-06-01" });
    expect(invalid).toEqual([]);
  });

  it("reports unparseable dates instead of silently dropping them", () => {
    const { patch, invalid } = buildPatch("personal", [
      ["birthday", "31/02/1990"],
      ["full_name", "Jordan"],
    ]);
    expect(invalid).toEqual(["birthday"]);
    expect(patch).toEqual({ full_name: "Jordan" });
  });

  it("clears a date when the field is emptied", () => {
    const { patch, invalid } = buildPatch("personal", [["birthday", "  "]]);
    expect(patch).toEqual({ birthday: null });
    expect(invalid).toEqual([]);
  });

  it("stores an emptied text field as null, not an empty string", () => {
    const { patch } = buildPatch("personal", [["address", ""]]);
    expect(patch).toEqual({ address: null });
  });

  it("trims whitespace", () => {
    const { patch } = buildPatch("personal", [["full_name", "  Jordan Mills  "]]);
    expect(patch).toEqual({ full_name: "Jordan Mills" });
  });

  it("accepts valid status values and ignores invalid ones", () => {
    expect(buildPatch("personal", [["status", "Active"]]).patch).toEqual({ status: "Active" });
    expect(buildPatch("personal", [["status", "Inactive"]]).patch).toEqual({ status: "Inactive" });
    // would violate the CHECK constraint — dropped rather than sent
    expect(buildPatch("personal", [["status", "Deleted"]]).patch).toEqual({});
    expect(buildPatch("personal", [["status", ""]]).patch).toEqual({});
  });

  it("returns an empty patch when nothing is allowed through", () => {
    const { patch } = buildPatch("workrights", [["full_name", "x"]]);
    expect(patch).toEqual({});
  });

  it("handles every section without throwing", () => {
    for (const section of Object.keys(SELF_EDITABLE_SECTIONS) as Array<
      keyof typeof SELF_EDITABLE_SECTIONS
    >) {
      expect(() => buildPatch(section, [["full_name", "x"]])).not.toThrow();
    }
  });
});
