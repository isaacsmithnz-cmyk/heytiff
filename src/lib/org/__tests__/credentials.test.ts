import {
  ORG_CRED_TYPES,
  buildOrgCredentialRow,
  credSuggestions,
  defaultColorFor,
  isCredKind,
  normaliseCredName,
  orgCredBadge,
  sortOrgCredentials,
  termFieldsFor,
  type OrgCredential,
} from "../credentials";

/* The same guarantees lib/staff/licence.ts makes, one level up: what may be
   stored, what a card is stamped with, and what order a wall of them reads in.
   Pure, so the modal and the action can both run it. */

describe("isCredKind", () => {
  it("accepts only what the table's CHECK accepts", () => {
    expect(isCredKind("licence")).toBe(true);
    expect(isCredKind("insurance")).toBe(true);
    for (const junk of ["Licence", "warranty", "", null, 7, "__proto__"]) {
      expect(isCredKind(junk)).toBe(false);
    }
  });
});

describe("buildOrgCredentialRow", () => {
  it("normalises a full credential", () => {
    const built = buildOrgCredentialRow({
      kind: "insurance",
      name: "  Public liability  ",
      number: " PL-9 ",
      issuer: " QBE ",
      expiryDate: "01/03/2027",
      color: "#2E68FF",
    });
    expect(built).toEqual({
      row: {
        kind: "insurance",
        name: "Public liability",
        number: "PL-9",
        issuer: "QBE",
        expiry_date: "2027-03-01",
        color: "#2E68FF",
      },
    });
  });

  it("takes the ISO a picker emits as readily as dd/mm/yyyy", () => {
    const built = buildOrgCredentialRow({
      kind: "licence",
      name: "ARC",
      expiryDate: "2027-03-01",
    });
    expect(built).toEqual({ row: expect.objectContaining({ expiry_date: "2027-03-01" }) });
  });

  it("insists on a kind and a name", () => {
    expect(buildOrgCredentialRow({ kind: "warranty", name: "x" })).toEqual({
      error: "Choose whether this is a licence or an insurance policy.",
    });
    expect(buildOrgCredentialRow({ kind: "licence", name: "   " })).toEqual({
      error: "Give this licence or policy a name.",
    });
  });

  /* A direct POST can send anything, so the impossible date is refused here
     even though the modal's calendar can't hold one. */
  it("refuses an impossible expiry", () => {
    expect(buildOrgCredentialRow({ kind: "licence", name: "ARC", expiryDate: "31/02/2027" })).toEqual(
      { error: "Check the expiry date — use dd/mm/yyyy." }
    );
  });

  it("keeps a blank expiry as no expiry, not as an error", () => {
    expect(buildOrgCredentialRow({ kind: "licence", name: "ARC", expiryDate: "  " })).toEqual({
      row: expect.objectContaining({ expiry_date: null, number: null, issuer: null }),
    });
  });

  it("caps the long fields and drops a colour that isn't a hex", () => {
    const built = buildOrgCredentialRow({
      kind: "licence",
      name: "N".repeat(200),
      number: "9".repeat(200),
      issuer: "I".repeat(200),
      color: "javascript:alert(1)",
    });
    expect("row" in built && built.row.name).toHaveLength(120);
    expect("row" in built && built.row.number).toHaveLength(80);
    expect("row" in built && built.row.issuer).toHaveLength(120);
    expect("row" in built && built.row.color).toBeNull();
  });
});

describe("badges & suggestions", () => {
  it("stamps the named types from the registry", () => {
    expect(
      orgCredBadge({ kind: "licence", name: "ARC refrigerant trading authorisation" })
    ).toEqual({ code: "ARC", color: "#00A389" });
    expect(orgCredBadge({ kind: "licence", name: "Contractor licence" })).toEqual({
      code: "CL",
      color: "#F0A431",
    });
  });

  it("gives every insurance the same blue INS, whatever it is called", () => {
    expect(orgCredBadge({ kind: "insurance", name: "Public liability" })).toEqual({
      code: "INS",
      color: "#2E68FF",
    });
    expect(orgCredBadge({ kind: "insurance", name: "Marine cargo cover" })).toEqual({
      code: "INS",
      color: "#2E68FF",
    });
  });

  it("initials anything custom, via the staff card's own rule", () => {
    expect(orgCredBadge({ kind: "licence", name: "Working at Heights" }).code).toBe("WAH");
  });

  it("lets a stored colour override the derived one", () => {
    expect(orgCredBadge({ kind: "insurance", name: "Public liability", color: "#8A2BE2" })).toEqual(
      { code: "INS", color: "#8A2BE2" }
    );
    // junk in the column is ignored rather than piped into a style
    expect(
      orgCredBadge({ kind: "insurance", name: "Public liability", color: "red; content:x" }).color
    ).toBe("#2E68FF");
  });

  it("suggests the names of its own kind and no others", () => {
    expect(credSuggestions("insurance")).toEqual([
      "Public liability",
      "Professional indemnity",
      "Workers compensation",
    ]);
    expect(credSuggestions("licence")).toHaveLength(2);
    expect(ORG_CRED_TYPES).toHaveLength(5);
  });

  it("hands a known name its colour and a custom licence none", () => {
    expect(defaultColorFor("licence", "Contractor licence")).toBe("#F0A431");
    expect(defaultColorFor("licence", "Working at Heights")).toBe("");
    expect(defaultColorFor("insurance", "Marine cargo cover")).toBe("#2E68FF");
  });
});

describe("sortOrgCredentials", () => {
  const c = (over: Partial<OrgCredential>): OrgCredential => ({
    id: over.name ?? "x",
    kind: "licence",
    name: "x",
    number: null,
    issuer: null,
    expiryDate: null,
    color: null,
    ...over,
  });

  it("puts licences first, then the soonest expiry, with no-expiry last", () => {
    const sorted = sortOrgCredentials([
      c({ name: "policy-late", kind: "insurance", expiryDate: "2028-01-01" }),
      c({ name: "lic-none" }),
      c({ name: "lic-soon", expiryDate: "2026-08-01" }),
      c({ name: "policy-soon", kind: "insurance", expiryDate: "2026-09-01" }),
    ]).map((r) => r.name);
    expect(sorted).toEqual(["lic-soon", "lic-none", "policy-soon", "policy-late"]);
  });

  it("doesn't mutate what it was given", () => {
    const rows = [c({ name: "b", expiryDate: "2027-01-01" }), c({ name: "a", expiryDate: "2026-01-01" })];
    sortOrgCredentials(rows);
    expect(rows.map((r) => r.name)).toEqual(["b", "a"]);
  });
});


/* A PERSON'S WORDS HAVE TO REACH THE REGISTRY.

   Everything the registry gives a card — badge, colour, WHICH FIELDS IT
   CARRIES and what Tiff is asked to read off it — hangs on matching the name,
   and the name box is free text. An exact-string match meant "Workers comp"
   silently fell back to the generic insurance set: a Limit of liability box
   the certificate cannot fill, and a model asked for a limit that is not on
   the page. Same failure that lost the certificate, other clothes. */
describe("naming a card in your own words", () => {
  const wc = (name: string) => termFieldsFor("insurance", name);

  it("finds workers compensation however it is written", () => {
    for (const name of [
      "Workers compensation",
      "workers comp",
      "Workers' Compensation",
      "WorkCover",
      "Work Cover",
      "workers compensation insurance",
      "  WORKERS   COMP  ",
    ]) {
      expect(wc(name)).toContain("workers");
      expect(wc(name)).not.toContain("sumInsured");
    }
  });

  it("still gives an unknown policy the full set", () => {
    // a guess that HIDES a box is worse than one that shows an empty one
    expect(wc("Marine transit")).toContain("sumInsured");
    expect(wc("")).toContain("sumInsured");
  });

  it("reads the insurer's own words off the page", () => {
    // "Broadform liability" is what QBE prints on Isaac's certificate
    expect(orgCredBadge({ kind: "insurance", name: "Broadform liability" }).code).toBe("INS");
    expect(defaultColorFor("licence", "ARCtick")).toBe("#00A389");
    expect(defaultColorFor("licence", "refrigerant trading authorisation")).toBe("#00A389");
  });

  it("takes licence and license alike", () => {
    expect(defaultColorFor("licence", "contractors license")).toBe("#F0A431");
    expect(defaultColorFor("licence", "Contractor licence")).toBe("#F0A431");
  });

  /* Two types claiming one spelling would resolve to whichever sits earlier in
     the array — a silent, order-dependent answer. */
  it("never lets two types claim the same words", () => {
    const seen = new Map<string, string>();
    for (const t of ORG_CRED_TYPES) {
      for (const a of [t.name, ...(t.aliases ?? [])]) {
        const key = `${t.kind}:${normaliseCredName(a)}`;
        expect(seen.get(key)).toBeUndefined();
        seen.set(key, t.name);
      }
    }
  });

  it("does not match a name that is only punctuation", () => {
    expect(termFieldsFor("insurance", " - ")).toEqual(termFieldsFor("insurance", ""));
  });
});
