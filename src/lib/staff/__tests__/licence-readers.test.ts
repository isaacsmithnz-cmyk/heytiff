import { LICENCE_READ_PROMPT, LICENCE_READ_SCHEMA, parseLicenceRead } from "../licence-readers";

/* What Tiff is asked of a government ID, and what is believed of the answer.

   THE RULE THAT MATTERS HERE IS A PRIVACY ONE. A driver licence carries a date
   of birth, an address, a signature and a face. None of it is asked for, none
   of it has a field to land in, and the prompt says so in words — because a
   model told only to "read this licence" will helpfully return the lot. */

describe("the prompt", () => {
  it("refuses the personal details a licence also carries", () => {
    for (const banned of ["date of birth", "address", "signature", "photograph"]) {
      expect(LICENCE_READ_PROMPT).toContain(banned);
    }
    expect(LICENCE_READ_PROMPT).toContain("DO NOT return");
    // and it says so about the holder's NAME specifically
    expect(LICENCE_READ_PROMPT).toMatch(/DO NOT return[\s\S]*holder's name/);
  });

  it("says a guessed expiry is worse than a blank one", () => {
    expect(LICENCE_READ_PROMPT).toContain("guessed expiry is worse than a blank one");
    expect(LICENCE_READ_PROMPT).toContain("the LATER date is expiresOn");
  });

  it("names every field the schema requires, and asks for nothing else", () => {
    for (const field of LICENCE_READ_SCHEMA.required) {
      expect(LICENCE_READ_PROMPT).toContain(field);
    }
    expect(Object.keys(LICENCE_READ_SCHEMA.properties).sort()).toEqual(
      [...LICENCE_READ_SCHEMA.required].sort()
    );
    // the schema is closed: there is no property for anything else to arrive in
    expect(LICENCE_READ_SCHEMA.additionalProperties).toBe(false);
  });
});

describe("what is believed", () => {
  const full = {
    number: " AU123 ",
    issuer: "Australian Refrigeration Council",
    issuingState: "NSW",
    classes: "Split systems",
    startsOn: "2024-08-07",
    expiresOn: "2026-08-07",
  };

  it("takes a well-formed read whole, trimmed", () => {
    expect(parseLicenceRead(full)).toEqual({ ...full, number: "AU123" });
  });

  it("drops a state it does not recognise rather than storing it", () => {
    /* "New South Wales, Australia" in a 12-character column is a truncation
       waiting to happen, and a state that is not a state is not a fact. */
    expect(parseLicenceRead({ ...full, issuingState: "New South Wales" }).issuingState).toBeNull();
    expect(parseLicenceRead({ ...full, issuingState: "nsw" }).issuingState).toBe("NSW");
  });

  it("refuses a date that is not an ISO day", () => {
    const read = parseLicenceRead({ ...full, expiresOn: "7 August 2026", startsOn: "2024-8-7" });
    expect(read.expiresOn).toBeNull();
    expect(read.startsOn).toBeNull();
  });

  it("answers a document it could not read at all with nulls, not with junk", () => {
    expect(parseLicenceRead(null)).toEqual({
      number: null,
      issuer: null,
      issuingState: null,
      classes: null,
      startsOn: null,
      expiresOn: null,
    });
  });

  it("has nowhere to put a personal detail even if one arrives", () => {
    const read = parseLicenceRead({
      ...full,
      name: "Bob Smith",
      dateOfBirth: "1988-02-03",
      address: "12 Trade St, Ringwood",
    } as Record<string, unknown>);
    expect(read).not.toHaveProperty("name");
    expect(read).not.toHaveProperty("dateOfBirth");
    expect(read).not.toHaveProperty("address");
    expect(Object.keys(read).sort()).toEqual(
      ["classes", "expiresOn", "issuer", "issuingState", "number", "startsOn"]
    );
  });

  it("never lets a long string past the column's width", () => {
    const read = parseLicenceRead({ ...full, number: "x".repeat(500), classes: "y".repeat(500) });
    expect(read.number).toHaveLength(80);
    expect(read.classes).toHaveLength(160);
  });
});
