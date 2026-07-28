import {
  buildLinkingRows,
  calendarAdvisory,
  cycleOfCalendar,
  employmentDrift,
  payBasisDrift,
  unaccountedEmployees,
  type LinkingStaff,
} from "../linking";
import type { IntegrationLink } from "../links";
import type { XeroEmployee, XeroPayCalendar } from "../xero-shape";

const emp = (over: Partial<XeroEmployee> & { employeeId: string; name: string }): XeroEmployee => ({
  firstName: "",
  lastName: "",
  email: null,
  jobTitle: null,
  active: true,
  employmentType: null,
  payrollCalendarId: null,
  ...over,
});

const person = (over: Partial<LinkingStaff> & { staffProfileId: string; name: string }): LinkingStaff => ({
  firstName: null,
  lastName: null,
  fullName: over.name,
  email: null,
  employmentType: null,
  payBasis: "hourly",
  ...over,
});

const link = (over: Partial<IntegrationLink> & { staffProfileId: string; remoteId: string }): IntegrationLink => ({
  id: "l1",
  remoteLabel: null,
  matchedBy: "manual",
  linkedAt: "2026-07-26T00:00:00.000Z",
  ...over,
});

describe("buildLinkingRows", () => {
  const employees = [
    emp({ employeeId: "x1", name: "Dan Smith", email: "dan@acme.com" }),
    emp({ employeeId: "x2", name: "Jo Blogs" }),
  ];

  it("shows a confirmed link", () => {
    const rows = buildLinkingRows(
      [person({ staffProfileId: "s1", name: "Dan Smith" })],
      employees,
      [link({ staffProfileId: "s1", remoteId: "x1" })]
    );
    expect(rows[0].state).toMatchObject({ kind: "linked", employee: { employeeId: "x1" } });
  });

  /* Someone who left Xero is not a broken link — the link is still correct,
     the person just isn't on payroll any more. Silently unlinking would throw
     away a fact; this needs a human to decide. */
  it("keeps a link to someone who has left, and says so", () => {
    const rows = buildLinkingRows(
      [person({ staffProfileId: "s1", name: "Gone Person" })],
      [emp({ employeeId: "x9", name: "Gone Person", active: false })],
      [link({ staffProfileId: "s1", remoteId: "x9" })]
    );
    expect(rows[0].state.kind).toBe("linked_left");
  });

  it("keeps a link whose employee Xero no longer returns at all", () => {
    const rows = buildLinkingRows(
      [person({ staffProfileId: "s1", name: "Dan Smith" })],
      employees,
      [link({ staffProfileId: "s1", remoteId: "gone", remoteLabel: "Dan Smith" })]
    );
    expect(rows[0].state).toEqual({ kind: "linked_missing", remoteLabel: "Dan Smith" });
  });

  it("offers a suggestion with the reason attached", () => {
    const rows = buildLinkingRows(
      [person({ staffProfileId: "s1", name: "Dan Smith", email: "dan@acme.com" })],
      employees,
      []
    );
    expect(rows[0].state).toMatchObject({ kind: "suggested", reason: "email" });
  });

  it("offers nothing when two people share a name", () => {
    const twoDans = [emp({ employeeId: "x1", name: "Dan Smith" }), emp({ employeeId: "x2", name: "Dan Smith" })];
    const rows = buildLinkingRows([person({ staffProfileId: "s1", name: "Dan Smith" })], twoDans, []);
    expect(rows[0].state).toEqual({ kind: "ambiguous" });
  });

  /* The load-bearing one: an employee an existing link already claims must
     never be suggested to a second person. Two claimants on one payroll record
     is the disagreement the whole design exists to prevent. */
  it("never suggests an employee an existing link already claims", () => {
    const rows = buildLinkingRows(
      [
        person({ staffProfileId: "s1", name: "Dan Smith" }),
        person({ staffProfileId: "s2", name: "Dan Smith" }),
      ],
      [emp({ employeeId: "x1", name: "Dan Smith" })],
      [link({ staffProfileId: "s1", remoteId: "x1" })]
    );

    expect(rows[0].state.kind).toBe("linked");
    expect(rows[1].state).toEqual({ kind: "unmatched" });
  });

  it("says plainly when there is nothing to match to", () => {
    const rows = buildLinkingRows([person({ staffProfileId: "s1", name: "Nobody Here" })], employees, []);
    expect(rows[0].state).toEqual({ kind: "unmatched" });
  });

  /* Drift against a SUGGESTION would put "change their employment type" next
     to a match nobody has agreed to yet. */
  it("reports drift only against a confirmed link", () => {
    const contractor = [emp({ employeeId: "x1", name: "Dan Smith", employmentType: "CONTRACTOR" })];
    const staff = [person({ staffProfileId: "s1", name: "Dan Smith", employmentType: "Full-time" })];

    expect(buildLinkingRows(staff, contractor, []).map((r) => r.employment)).toEqual([null]);
    expect(
      buildLinkingRows(staff, contractor, [link({ staffProfileId: "s1", remoteId: "x1" })])[0].employment
    ).toMatchObject({ kind: "suggest_subbie" });
  });
});

describe("employmentDrift", () => {
  const contractor = emp({ employeeId: "x1", name: "Dan", employmentType: "CONTRACTOR" });
  const employee = emp({ employeeId: "x1", name: "Dan", employmentType: "EMPLOYEE" });

  it("suggests Subcontractor when Xero pays them as one and we don't", () => {
    expect(employmentDrift("Full-time", contractor)).toEqual({
      kind: "suggest_subbie",
      suggested: "Subcontractor",
    });
  });

  /* employment_type is null for nearly every existing row, and that classifies
     as permanent — so a contractor with nothing set is exactly the backfill
     case this suggestion exists to start. */
  it("suggests it for an unset employment type too", () => {
    expect(employmentDrift(null, contractor)).toMatchObject({ kind: "suggest_subbie" });
  });

  it("says nothing when both sides already agree", () => {
    expect(employmentDrift("Subcontractor", contractor)).toBeNull();
    expect(employmentDrift("Full-time", employee)).toBeNull();
    // an apprentice is an employee — classifyEmployment calls that permanent
    expect(employmentDrift("Apprentice", employee)).toBeNull();
  });

  it("flags the contradiction, and offers no fix for it", () => {
    const drift = employmentDrift("Subcontractor", employee);
    expect(drift).toMatchObject({ kind: "contradiction" });
    // deliberately no `suggested` — neither side is obviously the right one
    expect(drift && "suggested" in drift).toBe(false);
  });

  it("says nothing when Xero doesn't say", () => {
    expect(employmentDrift("Full-time", emp({ employeeId: "x", name: "D" }))).toBeNull();
    expect(employmentDrift("Full-time", null)).toBeNull();
  });
});

describe("cycleOfCalendar", () => {
  it("maps the three Xero cycles HeyTiff also has", () => {
    expect(cycleOfCalendar("WEEKLY")).toBe("Weekly");
    expect(cycleOfCalendar("fortnightly")).toBe("Fortnightly");
    expect(cycleOfCalendar("MONTHLY")).toBe("Monthly");
  });

  /* Twice-monthly and four-weekly have no pay_settings equivalent. Forcing one
     into "Monthly" would invent a disagreement, or hide a real one. */
  it("refuses to force a cycle we don't have", () => {
    expect(cycleOfCalendar("TWICEMONTHLY")).toBeNull();
    expect(cycleOfCalendar("FOURWEEKLY")).toBeNull();
    expect(cycleOfCalendar(null)).toBeNull();
  });
});

describe("calendarAdvisory", () => {
  const calendars: XeroPayCalendar[] = [
    { payrollCalendarId: "c-w", name: "Weekly", calendarType: "WEEKLY" },
    { payrollCalendarId: "c-f", name: "Fortnightly", calendarType: "FORTNIGHTLY" },
  ];
  const employees = [
    emp({ employeeId: "x1", name: "Dan Smith", payrollCalendarId: "c-f" }),
    emp({ employeeId: "x2", name: "Jo Blogs", payrollCalendarId: "c-w" }),
  ];

  const rowsFor = (ids: string[]) =>
    buildLinkingRows(
      ids.map((id, i) => person({ staffProfileId: `s${i}`, name: `P${i}` })),
      employees,
      ids.map((remoteId, i) => link({ staffProfileId: `s${i}`, remoteId }))
    );

  it("stays quiet when Xero and pay_settings agree", () => {
    const advisory = calendarAdvisory(rowsFor(["x2"]), employees, calendars, "Weekly");
    expect(advisory).toMatchObject({ differs: false, note: null });
  });

  it("names the difference without changing anything", () => {
    const advisory = calendarAdvisory(rowsFor(["x1"]), employees, calendars, "Weekly");
    expect(advisory.differs).toBe(true);
    expect(advisory.note).toContain("Fortnightly");
    expect(advisory.note).toContain("Weekly");
    // the wording has to make clear nothing was touched
    expect(advisory.note).toContain("Nothing has been changed");
  });

  it("lists every cycle when linked people sit on more than one", () => {
    const advisory = calendarAdvisory(rowsFor(["x1", "x2"]), employees, calendars, "Weekly");
    expect(advisory.xeroCycles).toEqual(["Fortnightly", "Weekly"]);
    expect(advisory.differs).toBe(true);
  });

  it("has nothing to say when nobody is linked", () => {
    const rows = buildLinkingRows([person({ staffProfileId: "s1", name: "Nobody" })], employees, []);
    expect(calendarAdvisory(rows, employees, calendars, "Weekly")).toMatchObject({ differs: false });
  });
});

describe("unaccountedEmployees", () => {
  const employees = [
    emp({ employeeId: "x1", name: "Dan Smith" }),
    emp({ employeeId: "x2", name: "Jo Blogs" }),
    emp({ employeeId: "x3", name: "Left Already", active: false }),
  ];

  it("lists only active Xero people nobody here is linked to or suggested for", () => {
    const rows = buildLinkingRows(
      [person({ staffProfileId: "s1", name: "Dan Smith" })],
      employees,
      [link({ staffProfileId: "s1", remoteId: "x1" })]
    );
    expect(unaccountedEmployees(rows, employees).map((e) => e.employeeId)).toEqual(["x2"]);
  });

  it("excludes someone currently being suggested — they're already on screen", () => {
    const rows = buildLinkingRows([person({ staffProfileId: "s1", name: "Jo Blogs" })], employees, []);
    expect(unaccountedEmployees(rows, employees).map((e) => e.employeeId)).toEqual(["x1"]);
  });
});

describe("payBasisDrift — Xero's pay template knows who is salaried", () => {
  /* The suggestion reads the WAGE drift, not the employee list: the list
     can't tell salary from hourly, only the pay template can. */
  const salaryBasis = { annual: 95_000, hoursPerWeek: 38 };

  it("suggests salary when Xero pays one and here they're hourly", () => {
    expect(payBasisDrift("hourly", { kind: "salary", annual: 95_000, hoursPerWeek: null, here: 50 }))
      .toEqual({ kind: "suggest_salary" });
    // a converted salary carries its working — same statement, different shape
    expect(payBasisDrift("hourly", { kind: "match", rate: 48.08, basis: salaryBasis }))
      .toEqual({ kind: "suggest_salary" });
    expect(payBasisDrift("hourly", { kind: "differs", here: 50, xero: 48.08, delta: -1.92, basis: salaryBasis }))
      .toEqual({ kind: "suggest_salary" });
  });

  it("says nothing when the two already agree", () => {
    expect(payBasisDrift("salary", { kind: "match", rate: 48.08, basis: salaryBasis })).toBeNull();
    expect(payBasisDrift("hourly", { kind: "match", rate: 50 })).toBeNull();
  });

  it("contradicts when here is salaried but Xero pays an hourly template rate", () => {
    const d = payBasisDrift("salary", { kind: "match", rate: 50 });
    expect(d?.kind).toBe("contradiction");
    // a contradiction gets no button — neither side is obviously wrong
    expect(d).not.toHaveProperty("suggested");
  });

  it("stays silent with nothing to read", () => {
    expect(payBasisDrift("hourly", null)).toBeNull();
    expect(payBasisDrift("salary", { kind: "none", note: null })).toBeNull();
    // a failed read is not evidence of anything
    expect(payBasisDrift("hourly", { kind: "unreadable" })).toBeNull();
  });
});
