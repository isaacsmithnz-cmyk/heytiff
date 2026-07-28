import {
  ADMIN_SECTIONS,
  buildAdminPatch,
  capabilityFor,
  isAdminSection,
} from "../admin-sections";
import { SELF_EDITABLE_SECTIONS } from "../profile";

describe("isAdminSection", () => {
  it("accepts the six admin-editable sections", () => {
    for (const s of ["personal", "emergency", "workrights", "licences", "payroll", "notes"]) {
      expect(isAdminSection(s)).toBe(true);
    }
  });

  it("rejects junk and prototype keys", () => {
    for (const s of ["", "__proto__", "constructor", "toString", "PAYROLL", null, 7, {}]) {
      expect(isAdminSection(s)).toBe(false);
    }
  });

  it("does not accept `permissions` — that path writes memberships, not columns", () => {
    expect(isAdminSection("permissions")).toBe(false);
  });
});

describe("capability gating per section", () => {
  it("puts pay behind `financials` and everything else behind `team`", () => {
    expect(capabilityFor("payroll")).toBe("financials");
    for (const s of ["personal", "emergency", "workrights", "licences", "notes"] as const) {
      expect(capabilityFor(s)).toBe("team");
    }
  });
});

describe("the admin and self allowlists stay separate", () => {
  /* The whole point of two lists: a wage column must never be one typo away
     from the self-profile allowlist. */
  it("never lets a self-editable section reach a pay column", () => {
    const selfCols = Object.values(SELF_EDITABLE_SECTIONS).flat() as string[];
    for (const col of ["hourly_wage", "contracted_hours", "utilisation", "cost_split", "notes"]) {
      expect(selfCols).not.toContain(col);
    }
  });

  it("keeps pay columns only in the payroll section", () => {
    for (const [name, sec] of Object.entries(ADMIN_SECTIONS)) {
      if (name === "payroll") continue;
      for (const col of ["hourly_wage", "contracted_hours", "utilisation"]) {
        expect(sec.columns as readonly string[]).not.toContain(col);
      }
    }
  });

  it("keeps notes only in the notes section", () => {
    for (const [name, sec] of Object.entries(ADMIN_SECTIONS)) {
      if (name === "notes") continue;
      expect(sec.columns as readonly string[]).not.toContain("notes");
    }
  });

  it("never exposes ownership or identity columns", () => {
    const all = Object.values(ADMIN_SECTIONS).flatMap((s) => s.columns as readonly string[]);
    for (const col of ["id", "org_id", "user_id", "created_at"]) {
      expect(all).not.toContain(col);
    }
  });
});

describe("buildAdminPatch — columns", () => {
  it("keeps only the section's own columns", () => {
    const { patch } = buildAdminPatch("emergency", [
      ["emergency_name", "Sarah Mills"],
      ["hourly_wage", "999"],
      ["notes", "sneaky"],
    ]);
    expect(patch).toEqual({ emergency_name: "Sarah Mills" });
  });

  it("lets an admin set job_title, which self-edit cannot", () => {
    const { patch } = buildAdminPatch("personal", [["job_title", "Lead Installer"]]);
    expect(patch).toEqual({ job_title: "Lead Installer" });
  });

  it("converts dd/mm/yyyy dates", () => {
    const { patch } = buildAdminPatch("personal", [["start_date", "01/06/2020"]]);
    expect(patch).toEqual({ start_date: "2020-06-01" });
  });
});

describe("buildAdminPatch — numbers", () => {
  it("parses a wage, tolerating $ and commas", () => {
    expect(buildAdminPatch("payroll", [["hourly_wage", "$1,052.50"]]).patch).toEqual({
      hourly_wage: 1052.5,
    });
  });

  it("rejects a mistyped wage rather than coercing it", () => {
    // "45o" must not become 45, and must not silently become NULL
    const { patch, invalid } = buildAdminPatch("payroll", [["hourly_wage", "45o"]]);
    expect(invalid).toContain("hourly_wage");
    expect(patch).not.toHaveProperty("hourly_wage");
  });

  it("rejects a negative wage", () => {
    expect(buildAdminPatch("payroll", [["hourly_wage", "-10"]]).invalid).toContain("hourly_wage");
  });

  it("clears a wage when the field is emptied", () => {
    const { patch, invalid } = buildAdminPatch("payroll", [["hourly_wage", ""]]);
    expect(patch).toEqual({ hourly_wage: null });
    expect(invalid).toEqual([]);
  });
});

describe("buildAdminPatch — cost split", () => {
  it("collapses the three sliders into one jsonb column", () => {
    const { patch, invalid } = buildAdminPatch("payroll", [
      ["cost_install", "50"],
      ["cost_service", "30"],
      ["cost_admin", "20"],
    ]);
    expect(patch).toEqual({ cost_split: { install: 50, service: 30, admin: 20 } });
    expect(invalid).toEqual([]);
    // the raw slider names are not columns and must not survive
    expect(patch).not.toHaveProperty("cost_install");
  });

  it("refuses a split that doesn't total 100", () => {
    const { patch, invalid } = buildAdminPatch("payroll", [
      ["cost_install", "50"],
      ["cost_service", "30"],
      ["cost_admin", "10"],
    ]);
    expect(invalid).toContain("cost_split");
    expect(patch).not.toHaveProperty("cost_split");
  });

  it("ignores a partial split rather than writing half of one", () => {
    const { patch } = buildAdminPatch("payroll", [["cost_install", "50"]]);
    expect(patch).not.toHaveProperty("cost_split");
  });
});

describe("buildAdminPatch — holiday state", () => {
  /* The state column guards which public-holiday calendar pays a person, so
     only a real AU state may land — and clearing it must write NULL, which is
     how "same as the organisation" is spelled. */
  it("accepts a real state", () => {
    const { patch } = buildAdminPatch("personal", [["state", "NSW"]]);
    expect(patch.state).toBe("NSW");
  });

  it("drops junk rather than risking the CHECK constraint", () => {
    const { patch } = buildAdminPatch("personal", [["state", "Narnia"]]);
    expect(patch).not.toHaveProperty("state");
  });

  it("clears to null — back to the organisation's calendar", () => {
    const { patch } = buildAdminPatch("personal", [["state", ""]]);
    expect(patch.state).toBeNull();
  });

  it("is not reachable from the self-editable sections", () => {
    const selfCols = Object.values(SELF_EDITABLE_SECTIONS).flat() as string[];
    expect(selfCols).not.toContain("state");
  });
});

describe("buildAdminPatch — pay basis", () => {
  it("accepts only the two bases, on the payroll section", () => {
    expect(buildAdminPatch("payroll", [["pay_basis", "salary"]]).patch.pay_basis).toBe("salary");
    expect(buildAdminPatch("payroll", [["pay_basis", "hourly"]]).patch.pay_basis).toBe("hourly");
    expect(buildAdminPatch("payroll", [["pay_basis", "weekly"]]).patch).not.toHaveProperty("pay_basis");
    // not an identity fact — the personal section must not reach it
    expect(buildAdminPatch("personal", [["pay_basis", "salary"]]).patch).not.toHaveProperty("pay_basis");
  });
});
