import { preValidate } from "../pre-validate";

/* Pre-flight runs the same builders the actions run, so a card can only ever
   refuse what the server would have refused — and says the same sentence when
   it does. It is convenience, never a control: the actions re-run both. */

describe("self sections", () => {
  it("passes a card that would save cleanly", () => {
    expect(preValidate("self", "personal", { birthday: "25/12/1990" })).toBeNull();
    expect(preValidate("self", "emergency", { emergency_name: "Sarah" })).toBeNull();
  });

  it("names the date it can't read, with the action's own wording", () => {
    expect(preValidate("self", "personal", { birthday: "31/02/1990" })).toEqual({
      error: "Check the date format — use dd/mm/yyyy.",
      fields: ["birthday"],
    });
  });

  it("reports every bad date, not just the first", () => {
    const bad = preValidate("self", "personal", { birthday: "nope", start_date: "also nope" });
    expect(bad?.fields.sort()).toEqual(["birthday", "start_date"]);
  });

  it("ignores keys outside the section — they are dropped, not rejected", () => {
    expect(preValidate("self", "emergency", { birthday: "31/02/1990" })).toBeNull();
  });

  it("says nothing about a section the self allowlist doesn't have", () => {
    // the action answers this one, and its answer is a refusal
    expect(preValidate("self", "payroll", { hourly_wage: "nope" })).toBeNull();
  });
});

describe("admin sections", () => {
  it("distinguishes a bad number from a bad date", () => {
    expect(preValidate("admin", "payroll", { hourly_wage: "45o" })).toEqual({
      error: "Check the numbers — they should be plain figures.",
      fields: ["hourly_wage"],
    });
    expect(preValidate("admin", "personal", { start_date: "nope" })).toEqual({
      error: "Check the date format — use dd/mm/yyyy.",
      fields: ["start_date"],
    });
  });

  it("catches a cost split that doesn't add up", () => {
    expect(
      preValidate("admin", "payroll", {
        cost_install: "50",
        cost_service: "30",
        cost_admin: "10",
      })
    ).toEqual({ error: "The cost split has to add up to 100%.", fields: ["cost_split"] });
  });

  it("passes a split that totals 100", () => {
    expect(
      preValidate("admin", "payroll", {
        cost_install: "50",
        cost_service: "30",
        cost_admin: "20",
      })
    ).toBeNull();
  });

  it("has nothing to pre-check for permissions — it writes no columns", () => {
    expect(preValidate("admin", "permissions", { org_role: "not-a-role" })).toBeNull();
  });

  it("has nothing to say about a section that isn't one", () => {
    expect(preValidate("admin", "invented", { x: "y" })).toBeNull();
  });
});
