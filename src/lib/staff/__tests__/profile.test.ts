import {
  SELF_EDITABLE_SECTIONS,
  buildPatch,
  formatAuDate,
  isSelfSection,
  parseAuDate,
} from "../profile";
import { dateInputValue } from "@/lib/au-dates";

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

  /* The columns that say what the BUSINESS has decided about someone, as
     opposed to what they know about themselves. `status` is the one that bites:
     it reads as cosmetic but it is the filter on the Time & Pay staff list, the
     leave page, dashboard tasks and the drift sweep — so a self-service
     Inactive drops you out of your own pay run. Team's Deactivate is gated on
     `team` and arms before it fires; this is the same write. */
  it("lets nobody set their own employment state", () => {
    const all = Object.values(SELF_EDITABLE_SECTIONS).flat() as string[];
    for (const col of ["status", "state"]) expect(all).not.toContain(col);
  });

  it("drops a status a self save tries to carry, rather than writing it", () => {
    const { patch, invalid } = buildPatch("personal", [
      ["first_name", "Priya"],
      ["status", "Inactive"],
    ]);
    expect(patch).toEqual({ first_name: "Priya" });
    expect(patch).not.toHaveProperty("status");
    expect(invalid).toEqual([]);
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
    for (const bad of ["5 March 2026", "5/3/26", "abc", "5//2026"]) {
      expect(parseAuDate(bad)).toBeNull();
    }
  });

  /* Every date the staff card edits is a calendar picker now, and a picker
     speaks ISO — so yyyy-mm-dd is the NORMAL input here, not a malformed one.
     dd/mm/yyyy above stays accepted: the organisation screen still types them,
     and a direct POST from an older client must not start failing because the
     UI moved on. */
  describe("ISO, straight from a date picker", () => {
    it("passes a valid yyyy-mm-dd through untouched", () => {
      expect(parseAuDate("2026-03-05")).toBe("2026-03-05");
      expect(parseAuDate(" 2025-12-31 ")).toBe("2025-12-31");
    });

    it("still refuses an impossible one — a picker is no licence to skip the check", () => {
      expect(parseAuDate("2026-02-31")).toBeNull();
      expect(parseAuDate("2026-13-01")).toBeNull();
      expect(parseAuDate("2026-01-32")).toBeNull();
      expect(parseAuDate("2026-01-00")).toBeNull();
      expect(parseAuDate("2026-00-01")).toBeNull();
    });

    it("keeps a real leap day and refuses one that isn't", () => {
      expect(parseAuDate("2024-02-29")).toBe("2024-02-29");
      expect(parseAuDate("2026-02-29")).toBeNull();
    });

    it("insists on the padded shape, so nothing loose sneaks in year-first", () => {
      expect(parseAuDate("2026-3-5")).toBeNull();
      expect(parseAuDate("26-03-05")).toBeNull();
    });

    it("still reads dd-mm-yyyy day-first — ISO must not swallow it", () => {
      expect(parseAuDate("05-03-2026")).toBe("2026-03-05");
    });
  });
});

describe("dateInputValue", () => {
  it("hands a stored date to a picker as yyyy-mm-dd", () => {
    expect(dateInputValue("2026-03-05")).toBe("2026-03-05");
  });

  it("trims a timestamp to its calendar day", () => {
    // a driver may return a `date` column as a full timestamp; the native
    // input renders EMPTY for anything that isn't exactly yyyy-mm-dd, which
    // reads as data loss rather than as a bug
    expect(dateInputValue("2026-03-05T00:00:00Z")).toBe("2026-03-05");
  });

  it("is empty for nothing, and for anything it can't vouch for", () => {
    expect(dateInputValue(null)).toBe("");
    expect(dateInputValue(undefined)).toBe("");
    expect(dateInputValue("")).toBe("");
    expect(dateInputValue("05/03/2026")).toBe("");
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
      ["first_name", "Should Be Dropped"],
      ["hourly_wage", "999"],
    ]);
    expect(patch).toEqual({ emergency_name: "Sarah Mills" });
  });

  it("drops payroll columns even when the section is legitimate", () => {
    const { patch } = buildPatch("personal", [
      ["first_name", "Jordan"],
      ["hourly_wage", "500"],
      ["cost_split", '{"install":100}'],
      ["notes", "give me a raise"],
    ]);
    expect(patch).toEqual({ first_name: "Jordan" });
  });

  it("won't let a direct POST set the derived full_name", () => {
    // full_name is composed from first + last on save; accepting it here would
    // let a hand-rolled POST leave the two out of step
    const { patch } = buildPatch("personal", [["full_name", "Someone Else"]]);
    expect(patch).toEqual({});
  });

  it("converts dd/mm/yyyy date columns to ISO", () => {
    const { patch, invalid } = buildPatch("personal", [["start_date", "01/06/2020"]]);
    expect(patch).toEqual({ start_date: "2020-06-01" });
    expect(invalid).toEqual([]);
  });

  it("reports unparseable dates instead of silently dropping them", () => {
    const { patch, invalid } = buildPatch("personal", [
      ["birthday", "31/02/1990"],
      ["first_name", "Jordan"],
    ]);
    expect(invalid).toEqual(["birthday"]);
    expect(patch).toEqual({ first_name: "Jordan" });
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
    const { patch } = buildPatch("personal", [["last_name", "  van der Berg  "]]);
    expect(patch).toEqual({ last_name: "van der Berg" });
  });

  /* This case used to run `status` through the SELF builder, because that was
     the only enum column the self allowlist could reach. Its subject was always
     enum validation, not who may set a status — so it moved to the admin
     builder with `status` rather than being deleted with it. See
     admin-sections.test.ts. */

  it("returns an empty patch when nothing is allowed through", () => {
    const { patch } = buildPatch("workrights", [["first_name", "x"]]);
    expect(patch).toEqual({});
  });

  it("handles every section without throwing", () => {
    for (const section of Object.keys(SELF_EDITABLE_SECTIONS) as Array<
      keyof typeof SELF_EDITABLE_SECTIONS
    >) {
      expect(() => buildPatch(section, [["first_name", "x"]])).not.toThrow();
    }
  });
});
