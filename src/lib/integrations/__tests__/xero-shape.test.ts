import { shapeAccounts, shapeCalendars, shapeEmployee, shapeEmployees } from "../xero-shape";

/* Shaping is the boundary: everything Xero sends that we don't name here can
   never reach a screen. These tests pin both halves of that — what we keep, and
   what we refuse to build a row out of. */

const raw = {
  employeeID: "x-1",
  firstName: "Dan",
  lastName: "Smith",
  email: "dan@acme.com",
  jobTitle: "Refrigeration tech",
  status: "ACTIVE",
  employmentType: "EMPLOYEE",
  payrollCalendarID: "cal-1",
  // things a real payload carries that must NOT survive
  dateOfBirth: "1990-01-01",
  homeAddress: { addressLine1: "1 Somewhere St" },
  bankAccounts: [{ accountNumber: "123456" }],
};

describe("shapeEmployee", () => {
  it("keeps only the fields the linking screen needs", () => {
    const shaped = shapeEmployee(raw)!;

    expect(shaped).toEqual({
      employeeId: "x-1",
      firstName: "Dan",
      lastName: "Smith",
      name: "Dan Smith",
      email: "dan@acme.com",
      jobTitle: "Refrigeration tech",
      active: true,
      employmentType: "EMPLOYEE",
      payrollCalendarId: "cal-1",
    });
  });

  /* The whole point of the boundary: a date of birth and a bank account are in
     the upstream payload and must not be one prop-spread away from a browser. */
  it("drops personal data we never asked to hold", () => {
    const json = JSON.stringify(shapeEmployee(raw));
    expect(json).not.toContain("1990-01-01");
    expect(json).not.toContain("Somewhere St");
    expect(json).not.toContain("123456");
  });

  it("treats a missing status as active", () => {
    // Xero omits it on organisations that have never terminated anyone;
    // defaulting the other way would show a healthy payroll as gone
    expect(shapeEmployee({ ...raw, status: undefined })!.active).toBe(true);
  });

  it("marks a terminated employee inactive", () => {
    expect(shapeEmployee({ ...raw, status: "TERMINATED" })!.active).toBe(false);
  });

  it("reads employment type only when Xero actually says", () => {
    expect(shapeEmployee({ ...raw, employmentType: "CONTRACTOR" })!.employmentType).toBe("CONTRACTOR");
    expect(shapeEmployee({ ...raw, employmentType: undefined })!.employmentType).toBeNull();
    expect(shapeEmployee({ ...raw, employmentType: "SOMETHING_NEW" })!.employmentType).toBeNull();
  });

  it("turns blank optional fields into null rather than empty strings", () => {
    const shaped = shapeEmployee({ ...raw, email: "   ", jobTitle: "" })!;
    expect(shaped.email).toBeNull();
    expect(shaped.jobTitle).toBeNull();
  });

  /* An employee with no id could never be linked to — there'd be nothing to
     put in remote_id — and one with no name can't be told apart in a picker.
     Both are dropped rather than rendered as a row that does nothing. */
  it("refuses a record it could never link or display", () => {
    expect(shapeEmployee({ ...raw, employeeID: undefined })).toBeNull();
    expect(shapeEmployee({ ...raw, firstName: "", lastName: "" })).toBeNull();
    expect(shapeEmployee(null)).toBeNull();
    expect(shapeEmployee("nope")).toBeNull();
  });

  it("builds a name from whichever half exists", () => {
    expect(shapeEmployee({ ...raw, lastName: "" })!.name).toBe("Dan");
    expect(shapeEmployee({ ...raw, firstName: "" })!.name).toBe("Smith");
  });
});

describe("shapeEmployees", () => {
  it("drops junk without losing the good rows around it", () => {
    const list = shapeEmployees([raw, null, { firstName: "No" }, { ...raw, employeeID: "x-2" }]);
    expect(list.map((e) => e.employeeId)).toEqual(["x-1", "x-2"]);
  });

  it("degrades to empty for a non-array", () => {
    expect(shapeEmployees(undefined)).toEqual([]);
    expect(shapeEmployees({ employees: [] })).toEqual([]);
  });
});

describe("shapeCalendars", () => {
  it("keeps id, name and type", () => {
    expect(
      shapeCalendars([{ payrollCalendarID: "c1", name: "Weekly crew", calendarType: "weekly" }])
    ).toEqual([{ payrollCalendarId: "c1", name: "Weekly crew", calendarType: "WEEKLY" }]);
  });

  it("falls back to the id when a calendar has no name", () => {
    expect(shapeCalendars([{ payrollCalendarID: "c1" }])[0].name).toBe("c1");
  });

  it("drops a calendar with no id", () => {
    expect(shapeCalendars([{ name: "Nameless" }])).toEqual([]);
  });
});

/* Real rows from the Demo Company (AU) chart of accounts, in the shape the API
   returns them (type/status as enum codes, not the CSV's display names). */
describe("shapeAccounts", () => {
  const CHART = [
    { code: "090", name: "Business Bank Account", type: "BANK", status: "ACTIVE" },
    { code: "200", name: "Sales", type: "REVENUE", status: "ACTIVE" },
    { code: "300", name: "Purchases", type: "DIRECTCOSTS", status: "ACTIVE" },
    { code: "310", name: "Cost of Goods Sold", type: "DIRECTCOSTS", status: "ACTIVE" },
    { code: "400", name: "Advertising", type: "EXPENSE", status: "ACTIVE" },
    { code: "416", name: "Depreciation", type: "DEPRECIATN", status: "ACTIVE" },
    { code: "505", name: "Income Tax Expense", type: "EXPENSE", status: "ACTIVE" },
    { code: "710", name: "Office Equipment", type: "FIXED", status: "ACTIVE" },
    { code: "820", name: "GST", type: "CURRLIAB", status: "ACTIVE" },
    { code: "999", name: "Old Marketing Account", type: "EXPENSE", status: "ARCHIVED" },
  ];

  /* The whole point of the read: which accounts could ever reach the cost pool.
     DIRECTCOSTS must NOT — it renders under Cost of Sales, and nothing in
     "Purchases" or "Cost of Goods Sold" marks them out by name. */
  it("marks exactly the accounts that render as operating expenses", () => {
    const ops = shapeAccounts(CHART).filter(a => a.operatingExpense).map(a => a.name);
    expect(ops).toEqual([
      "Advertising",
      "Depreciation",
      "Income Tax Expense",
      "Old Marketing Account",
    ]);
  });

  it("knows an archived account can't explain a gap in a report", () => {
    const byName = Object.fromEntries(shapeAccounts(CHART).map(a => [a.name, a.active]));
    expect(byName["Advertising"]).toBe(true);
    expect(byName["Old Marketing Account"]).toBe(false);
  });

  it("keeps a type it has never seen rather than flattening it", () => {
    const [a] = shapeAccounts([{ name: "Bank Revaluations", type: "BANKREVALUATION" }]);
    expect(a.type).toBe("BANKREVALUATION");
    expect(a.operatingExpense).toBe(false);
  });

  it("drops what it can't name, and survives junk", () => {
    expect(shapeAccounts([{ code: "500", type: "EXPENSE" }])).toEqual([]);
    expect(shapeAccounts(null)).toEqual([]);
    expect(shapeAccounts([null, "nope", 7])).toEqual([]);
  });
});
