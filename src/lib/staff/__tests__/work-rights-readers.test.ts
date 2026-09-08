import {
  WORK_RIGHTS_READ_PROMPT,
  WORK_RIGHTS_READ_SCHEMA,
  parseWorkRightsRead,
} from "../work-rights-readers";
import { WORK_RIGHTS } from "../work-rights";

/* The most sensitive document this app reads, and the narrowest reader.

   A VEVO result and a visa grant notice carry the holder's full name, date of
   birth, NATIONALITY, passport number, document number and often an address.
   This file pins that none of it is asked for, none of it can arrive, and a
   made-up entitlement cannot reach a form. */

describe("the prompt", () => {
  it("refuses the personal details these documents also carry", () => {
    for (const banned of ["name", "date of birth", "passport number", "address"]) {
      expect(WORK_RIGHTS_READ_PROMPT).toContain(banned);
    }
    expect(WORK_RIGHTS_READ_PROMPT).toContain("DO NOT return");
  });

  it("names NATIONALITY explicitly", () => {
    /* It answers no question this feature has, and storing it would put a
       protected attribute in a table managers browse. Worth its own test so a
       future edit cannot quietly drop the word. */
    expect(WORK_RIGHTS_READ_PROMPT).toMatch(/NATIONALITY or country of citizenship/);
  });

  it("offers the entitlement from the closed list, in the app's own words", () => {
    for (const status of WORK_RIGHTS) expect(WORK_RIGHTS_READ_PROMPT).toContain(status);
    // and it translates the document's vocabulary into ours rather than
    // making a person do it
    expect(WORK_RIGHTS_READ_PROMPT).toContain("no work limitation");
  });

  it("says a guess here is worse than a blank", () => {
    expect(WORK_RIGHTS_READ_PROMPT).toMatch(/guessed entitlement or a guessed expiry is\s+much worse/);
    expect(WORK_RIGHTS_READ_PROMPT).toContain("legally work");
  });

  it("asks for exactly what the schema holds, and the schema is closed", () => {
    for (const field of WORK_RIGHTS_READ_SCHEMA.required) {
      expect(WORK_RIGHTS_READ_PROMPT).toContain(field);
    }
    expect(Object.keys(WORK_RIGHTS_READ_SCHEMA.properties).sort()).toEqual(
      [...WORK_RIGHTS_READ_SCHEMA.required].sort()
    );
    expect(WORK_RIGHTS_READ_SCHEMA.additionalProperties).toBe(false);
  });
});

describe("what is believed", () => {
  const full = {
    status: "Full working rights (visa)",
    visaType: " 482 Temporary Skill Shortage ",
    hoursCondition: "No work limitation",
    expiresOn: "2028-03-04",
    checkedOn: "2026-02-03",
  };

  it("takes a well-formed read whole, trimmed", () => {
    expect(parseWorkRightsRead(full)).toEqual({ ...full, visaType: "482 Temporary Skill Shortage" });
  });

  it("DROPS an entitlement that is not one of ours", () => {
    /* The one value here that must never reach a form. "Probably fine" in the
       status box is a person being told they may work. */
    expect(parseWorkRightsRead({ ...full, status: "Probably fine" }).status).toBeNull();
    expect(parseWorkRightsRead({ ...full, status: "full working rights (visa)" }).status).toBeNull();
  });

  it("refuses a date that is not an ISO day", () => {
    const read = parseWorkRightsRead({ ...full, expiresOn: "4 March 2028", checkedOn: "2026-2-3" });
    expect(read.expiresOn).toBeNull();
    expect(read.checkedOn).toBeNull();
  });

  it("answers a document it could not read with nulls, not junk", () => {
    expect(parseWorkRightsRead(null)).toEqual({
      status: null,
      visaType: null,
      hoursCondition: null,
      expiresOn: null,
      checkedOn: null,
    });
  });

  it("has nowhere to put a personal detail even if one arrives", () => {
    const read = parseWorkRightsRead({
      ...full,
      name: "Bob Smith",
      dateOfBirth: "1988-02-03",
      nationality: "Irish",
      passportNumber: "PA1234567",
    } as Record<string, unknown>);
    for (const banned of ["name", "dateOfBirth", "nationality", "passportNumber"]) {
      expect(read).not.toHaveProperty(banned);
    }
    expect(Object.keys(read).sort()).toEqual(
      ["checkedOn", "expiresOn", "hoursCondition", "status", "visaType"]
    );
  });

  it("never lets a long string past the column's width", () => {
    const read = parseWorkRightsRead({ ...full, visaType: "x".repeat(300), hoursCondition: "y".repeat(300) });
    expect(read.visaType).toHaveLength(80);
    expect(read.hoursCondition).toHaveLength(120);
  });
});
