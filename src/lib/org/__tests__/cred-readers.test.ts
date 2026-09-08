import { ORG_CRED_READ_SCHEMA, orgCredPrompt, parseOrgCredRead } from "../cred-readers";

/* What Tiff is asked, and what is believed of the answer.

   The rule the parse enforces is the one that matters: A FIELD THAT CANNOT
   BELONG TO THIS KIND OF DOCUMENT IS DROPPED, not stored. A licence has no
   sum insured and no excess; a model that offers one has misread the page, and
   storing it would put a limit of liability on a card that has none. */

describe("the prompt", () => {
  it("asks a certificate of currency for the limit, and a licence for its classes", () => {
    const ins = orgCredPrompt("insurance");
    expect(ins).toContain("certificate of currency");
    expect(ins).toContain("LIMIT OF LIABILITY");

    const lic = orgCredPrompt("licence");
    expect(lic).toContain("licence certificate");
    expect(lic).toContain("classes or categories of work");
    // a licence has neither, and is told so rather than left to guess
    expect(lic).toContain("sumInsured: null");
    expect(lic).toContain("excess: null");
  });

  it("says a guessed expiry is worse than a blank one", () => {
    /* The whole feature counts down to this date. A model that fills it in
       from a hunch silences a real warning, which is worse than a card that
       plainly says nothing is recorded. */
    for (const kind of ["insurance", "licence"] as const) {
      expect(orgCredPrompt(kind)).toContain("guessed expiry is worse than a blank one");
      expect(orgCredPrompt(kind)).toContain("the LATER date is expiresOn");
    }
  });

  it("names every field the schema requires", () => {
    for (const kind of ["insurance", "licence"] as const) {
      const prompt = orgCredPrompt(kind);
      for (const field of ORG_CRED_READ_SCHEMA.required) {
        expect(prompt).toContain(field);
      }
    }
  });
});

describe("what is believed", () => {
  const full = {
    issuer: " QBE ",
    number: "PL-9",
    cover: "Public and products liability",
    sumInsured: 20_000_000,
    premium: 2400,
    excess: 500,
    startsOn: "2025-08-07",
    expiresOn: "2026-08-07",
  };

  it("takes a well-formed insurance read whole, trimmed", () => {
    expect(parseOrgCredRead(full, "insurance")).toEqual({ ...full, issuer: "QBE" });
  });

  it("drops the insurance-only fields off a licence read", () => {
    const read = parseOrgCredRead(full, "licence");
    expect(read.sumInsured).toBeNull();
    expect(read.excess).toBeNull();
    // everything a licence really does print survives
    expect(read.issuer).toBe("QBE");
    expect(read.cover).toBe("Public and products liability");
    expect(read.expiresOn).toBe("2026-08-07");
  });

  it("refuses a date that is not an ISO day", () => {
    const read = parseOrgCredRead({ ...full, expiresOn: "7 August 2026", startsOn: "2025-8-7" }, "insurance");
    expect(read.expiresOn).toBeNull();
    expect(read.startsOn).toBeNull();
  });

  it("refuses money that is not a non-negative number", () => {
    const read = parseOrgCredRead({ ...full, premium: "2400", excess: -5, sumInsured: NaN }, "insurance");
    expect(read.premium).toBeNull();
    expect(read.excess).toBeNull();
    expect(read.sumInsured).toBeNull();
  });

  it("answers a document it could not read at all with nulls, not with junk", () => {
    expect(parseOrgCredRead(null, "insurance")).toEqual({
      issuer: null,
      number: null,
      cover: null,
      sumInsured: null,
      premium: null,
      excess: null,
      startsOn: null,
      expiresOn: null,
    });
  });

  it("never lets a long string past the column's width", () => {
    const read = parseOrgCredRead({ ...full, issuer: "x".repeat(500), cover: "y".repeat(500) }, "insurance");
    expect(read.issuer).toHaveLength(120);
    expect(read.cover).toHaveLength(160);
  });
});
