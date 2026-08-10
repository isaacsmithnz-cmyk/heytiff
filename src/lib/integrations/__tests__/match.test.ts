import {
  matchOne,
  nameKey,
  normEmail,
  normName,
  staffName,
  suggestMatches,
  type RemoteCandidate,
  type StaffCandidate,
} from "../match";

/* The stakes here are why these tests are picky: a wrong suggestion that a
   tired person clicks through attaches someone's pay to a stranger's payroll
   record. The cases that matter most are the ones where the matcher must
   REFUSE to answer. */

/* Remote records arrive as the matcher's own RemoteCandidate — each provider
   maps its shape down at the call boundary, so the fixtures here are already
   provider-neutral. */
const rem = (over: Partial<RemoteCandidate> & { id: string }): RemoteCandidate => ({
  name: over.name ?? "Someone Else",
  email: null,
  ...over,
});

const staff = (over: Partial<StaffCandidate> & { staffProfileId: string }): StaffCandidate => ({
  firstName: null,
  lastName: null,
  fullName: null,
  email: null,
  ...over,
});

describe("normalisation", () => {
  it("folds email case and whitespace, and nothing else", () => {
    expect(normEmail("  Dan@Example.COM ")).toBe("dan@example.com");
    // no dot-stripping or plus-tag folding: those rules are provider folklore,
    // and applying them invents matches
    expect(normEmail("d.an+work@example.com")).toBe("d.an+work@example.com");
    expect(normEmail(null)).toBe("");
  });

  it("flattens punctuation, spacing and accents in names", () => {
    expect(normName("O'Brien")).toBe("o brien");
    expect(normName("O Brien")).toBe("o brien");
    expect(normName("Renée")).toBe("renee");
    expect(normName("  Dan   Smith  ")).toBe("dan smith");
  });

  it("makes a name key that ignores word order", () => {
    expect(nameKey("Dan Smith")).toBe(nameKey("Smith Dan"));
    expect(nameKey("Dan Smith")).toBe("dan smith");
  });

  it("gives an empty key for nothing, so two blanks never match", () => {
    expect(nameKey(null)).toBe("");
    expect(nameKey("   ")).toBe("");
    expect(nameKey("!!!")).toBe("");
  });

  it("prefers the name halves over the derived full_name", () => {
    // full_name is derived from the halves and can lag a rename
    expect(staffName(staff({ staffProfileId: "s", firstName: "Danny", lastName: "Smith", fullName: "Dan Smith" }))).toBe(
      "Danny Smith"
    );
    expect(staffName(staff({ staffProfileId: "s", fullName: "Dan Smith" }))).toBe("Dan Smith");
  });
});

describe("matchOne", () => {
  const employees = [
    rem({ id: "x1", name: "Dan Smith", email: "dan@acme.com" }),
    rem({ id: "x2", name: "Jo Blogs", email: "jo@acme.com" }),
  ];

  it("matches on email", () => {
    const out = matchOne(staff({ staffProfileId: "s1", email: "DAN@acme.com" }), employees, new Set());
    expect(out).toEqual({ kind: "suggested", remoteId: "x1", reason: "email" });
  });

  it("falls back to name when there is no email — the never-invited case", () => {
    // user_id is null until an invite is accepted, so email is legitimately
    // absent for a staff card created ahead of onboarding
    const out = matchOne(staff({ staffProfileId: "s1", fullName: "Jo Blogs" }), employees, new Set());
    expect(out).toEqual({ kind: "suggested", remoteId: "x2", reason: "name" });
  });

  it("matches a name given in the other order", () => {
    const out = matchOne(staff({ staffProfileId: "s1", firstName: "Smith", lastName: "Dan" }), employees, new Set());
    expect(out).toEqual({ kind: "suggested", remoteId: "x1", reason: "name" });
  });

  /* The one that matters: two people who genuinely share a name. Offering
     either is a coin flip with someone's pay on it. */
  it("refuses to choose between two identical names", () => {
    const twoDans = [
      rem({ id: "x1", name: "Dan Smith" }),
      rem({ id: "x2", name: "Dan Smith" }),
    ];
    const out = matchOne(staff({ staffProfileId: "s1", fullName: "Dan Smith" }), twoDans, new Set());
    expect(out).toEqual({ kind: "ambiguous", remoteIds: ["x1", "x2"] });
  });

  it("refuses when two Xero employees share an address", () => {
    const shared = [
      rem({ id: "x1", name: "Dan Smith", email: "office@acme.com" }),
      rem({ id: "x2", name: "Jo Blogs", email: "office@acme.com" }),
    ];
    const out = matchOne(staff({ staffProfileId: "s1", email: "office@acme.com" }), shared, new Set());
    expect(out.kind).toBe("ambiguous");
  });

  it("never offers an employee that is already taken", () => {
    const out = matchOne(staff({ staffProfileId: "s1", email: "dan@acme.com" }), employees, new Set(["x1"]));
    expect(out).toEqual({ kind: "none" });
  });

  it("says nothing rather than guessing when there is nothing to go on", () => {
    expect(matchOne(staff({ staffProfileId: "s1" }), employees, new Set())).toEqual({ kind: "none" });
    expect(matchOne(staff({ staffProfileId: "s1", fullName: "Nobody Here" }), employees, new Set())).toEqual({
      kind: "none",
    });
  });
});

describe("suggestMatches", () => {
  /* The ordering trap: if names were matched in roster order, the first
     person's weak name match could consume the employee that a later person
     matches by EMAIL — strong evidence losing to weak by accident of sorting. */
  it("resolves every email match before any name match", () => {
    const employees = [rem({ id: "x1", name: "Dan Smith", email: "dan.smith@acme.com" })];
    const roster = [
      // would win on name if names went first
      staff({ staffProfileId: "s-name", fullName: "Dan Smith" }),
      // the person the address actually belongs to
      staff({ staffProfileId: "s-email", fullName: "Daniel Smyth", email: "dan.smith@acme.com" }),
    ];

    const { suggestions } = suggestMatches(roster, employees);

    expect(suggestions).toEqual([{ staffProfileId: "s-email", remoteId: "x1", reason: "email" }]);
  });

  it("never offers one remote record to two same-named people — both go ambiguous, nobody wins by sort order", () => {
    const employees = [rem({ id: "x1", name: "Dan Smith" })];
    const roster = [
      staff({ staffProfileId: "s1", fullName: "Dan Smith" }),
      staff({ staffProfileId: "s2", fullName: "Dan Smith" }),
    ];

    const { suggestions, ambiguous } = suggestMatches(roster, employees);

    // the mirrored accident-of-sorting: before this rule, whichever Dan came
    // first in the roster silently took the record
    expect(suggestions).toEqual([]);
    expect([...ambiguous].sort()).toEqual(["s1", "s2"]);
  });

  it("two cards holding one address that names somebody: both ambiguous, the address proves nothing", () => {
    const employees = [rem({ id: "x1", name: "Office Dan", email: "office@acme.com" })];
    const roster = [
      staff({ staffProfileId: "s1", fullName: "Dan Smith", email: "office@acme.com" }),
      staff({ staffProfileId: "s2", fullName: "Jo Blogs", email: "office@acme.com" }),
    ];

    const { suggestions, ambiguous } = suggestMatches(roster, employees);

    expect(suggestions).toEqual([]);
    expect([...ambiguous].sort()).toEqual(["s1", "s2"]);
  });

  it("shared evidence that points at nobody stays quiet — no ambiguity noise", () => {
    const employees = [rem({ id: "x1", name: "Unrelated Person" })];
    const roster = [
      staff({ staffProfileId: "s1", fullName: "Dan Smith" }),
      staff({ staffProfileId: "s2", fullName: "Dan Smith" }),
    ];

    expect(suggestMatches(roster, employees)).toEqual({ suggestions: [], ambiguous: [] });
  });

  it("leaves already-linked employees alone", () => {
    const employees = [rem({ id: "x1", name: "Dan Smith", email: "dan@acme.com" })];
    const roster = [staff({ staffProfileId: "s1", email: "dan@acme.com" })];

    const { suggestions } = suggestMatches(roster, employees, new Set(["x1"]));

    expect(suggestions).toEqual([]);
  });

  it("handles an empty payroll and an empty roster without inventing anything", () => {
    expect(suggestMatches([], [])).toEqual({ suggestions: [], ambiguous: [] });
    expect(suggestMatches([staff({ staffProfileId: "s1", fullName: "Dan" })], [])).toEqual({
      suggestions: [],
      ambiguous: [],
    });
  });
});
