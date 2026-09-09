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

/* WHAT THE PAPER CAN ACTUALLY CARRY.

   The kind says what the document IS; the name says which facts it can hold.
   A workers compensation certificate prints no limit of liability — the
   employer's liability under the state Act is the full amount and is not
   capped — and asking a model for one is how it comes back with the WIC wages
   figure instead. Isaac's icare certificate did exactly that. */
describe("what each paper is asked for", () => {
  it("does not ask a workers compensation certificate for a limit or an excess", () => {
    const p = orgCredPrompt("insurance", "Workers compensation");
    expect(p).not.toContain("LIMIT OF LIABILITY");
    expect(p).not.toContain("the standard or basic excess");
    // and says they are absent rather than leaving the model to guess
    expect(p).toContain("this paper has no sum insured");
    expect(p).toContain("this paper has no excess");
  });

  it("still asks a public liability policy for both", () => {
    const p = orgCredPrompt("insurance", "Public liability");
    expect(p).toContain("LIMIT OF LIABILITY");
    expect(p).toContain("the standard or basic excess");
  });

  it("asks an unnamed policy for everything — a guess that hides a box is worse", () => {
    expect(orgCredPrompt("insurance", "")).toContain("LIMIT OF LIABILITY");
    expect(orgCredPrompt("insurance", "Marine transit")).toContain("LIMIT OF LIABILITY");
  });

  const cert = {
    issuer: "icare Workers Insurance",
    number: "127993501",
    cover: "Employer's liability",
    sumInsured: null,
    premium: 2400,
    excess: null,
    startsOn: "2026-02-28",
    expiresOn: "2027-02-28",
  };

  it("drops a limit and an excess a workers compensation read hands back anyway", () => {
    const read = parseOrgCredRead(
      { ...cert, sumInsured: 943669.32, excess: 500 },
      "insurance",
      "Workers compensation"
    );
    expect(read.sumInsured).toBeNull();
    expect(read.excess).toBeNull();
    // everything the paper DOES carry survives
    expect(read.issuer).toBe(cert.issuer);
    expect(read.expiresOn).toBe(cert.expiresOn);
    expect(read.premium).toBe(cert.premium);
  });

  it("keeps them for the policy that prints them", () => {
    const read = parseOrgCredRead({ ...cert, sumInsured: 20000000 }, "insurance", "Public liability");
    expect(read.sumInsured).toBe(20000000);
  });
});
