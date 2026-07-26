import type { StaffProfile } from "../profile";
import {
  PROFILE_FIELDS,
  completenessSummary,
  profileCompleteness,
} from "../completeness";

/* The ring, the checklist and the tab dots all read this one model, so what it
   counts is the whole contract. */

const blank: StaffProfile = {
  id: "p1",
  org_id: "o1",
  user_id: "auth0|1",
  first_name: null,
  last_name: null,
  full_name: null,
  preferred_name: null,
  phone: null,
  birthday: null,
  address: null,
  start_date: null,
  employment_type: null,
  job_title: null,
  status: "Active",
  photo_url: null,
  emergency_name: null,
  emergency_phone: null,
  emergency_relationship: null,
  emergency_alt_phone: null,
  work_rights_status: null,
  visa_type: null,
  visa_expiry: null,
  hours_condition: null,
  vevo_checked_at: null,
  work_rights_doc_url: null,
  work_rights_verified_at: null,
  qualifications: null,
};

const full: StaffProfile = {
  ...blank,
  first_name: "Jordan",
  last_name: "Mills",
  phone: "0400 000 000",
  birthday: "1990-12-25",
  address: "12 Smith St, Newtown NSW 2042",
  start_date: "2020-06-01",
  employment_type: "Full-time",
  emergency_name: "Sarah Mills",
  emergency_phone: "0411 111 111",
  work_rights_status: "Australian citizen",
};

describe("what counts", () => {
  it("only tracks fields the profile screen can actually set", () => {
    // an item with no control behind it is a checklist that never empties
    const keys = PROFILE_FIELDS.map((f) => f.key);
    expect(keys).not.toContain("photo_url");
    expect(keys).not.toContain("preferred_name");
    expect(keys).not.toContain("full_name");
  });

  it("counts an empty card as 0% with everything missing", () => {
    const c = profileCompleteness(blank);
    expect(c.percent).toBe(0);
    expect(c.filled).toBe(0);
    expect(c.missing).toHaveLength(c.total);
    expect(c.complete).toBe(false);
  });

  it("counts a finished card as 100% and complete", () => {
    const c = profileCompleteness(full);
    expect(c.percent).toBe(100);
    expect(c.missing).toHaveLength(0);
    expect(c.complete).toBe(true);
    expect(c.sectionsMissing.size).toBe(0);
  });

  it("treats a null profile like an empty one rather than throwing", () => {
    expect(profileCompleteness(null).percent).toBe(0);
  });

  it("does not accept whitespace as a filled field", () => {
    const c = profileCompleteness({ ...full, address: "   " });
    expect(c.missing.map((f) => f.key)).toContain("address");
  });
});

describe("required vs wanted", () => {
  it("counts only the obliged fields as required", () => {
    const c = profileCompleteness({ ...full, phone: null, birthday: null });
    expect(c.missing).toHaveLength(2);
    // date of birth is payroll's problem; a mobile number is not
    expect(c.requiredMissing).toBe(1);
  });

  it("holds work rights to the required bar — the law, not payroll", () => {
    const spec = PROFILE_FIELDS.find((f) => f.key === "work_rights_status");
    expect(spec?.required).toBe(true);
    expect(spec?.section).toBe("workrights");
  });
});

describe("sections needing attention", () => {
  it("names every section holding a missing field, and no others", () => {
    const c = profileCompleteness({ ...full, emergency_phone: null });
    expect([...c.sectionsMissing]).toEqual(["emergency"]);
  });

  it("names a section once however many of its fields are missing", () => {
    const c = profileCompleteness({ ...full, first_name: null, address: null });
    expect([...c.sectionsMissing]).toEqual(["personal"]);
  });
});

describe("the line under the ring", () => {
  it("counts the fields and calls out the required ones", () => {
    const c = profileCompleteness({ ...full, phone: null, birthday: null });
    expect(completenessSummary(c)).toBe("2 of 10 fields missing · 1 required");
  });

  it("drops the required clause when none of the missing ones are", () => {
    const c = profileCompleteness({ ...full, phone: null });
    expect(completenessSummary(c)).toBe("1 of 10 fields missing");
  });

  it("says so plainly when there is nothing left", () => {
    expect(completenessSummary(profileCompleteness(full))).toBe(
      "Every field we ask for is filled in"
    );
  });
});
