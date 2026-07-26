import { shapeCalendars, shapeEmployee, shapeEmployees } from "../xero-shape";

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
