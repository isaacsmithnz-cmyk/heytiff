import {
  candidateLabel,
  candidateRoleLabel,
  sortCandidates,
  transferWarning,
  type OwnerCandidate,
} from "../ownership";

/* The handover's pure half — what a person is CALLED in the picker, what they
   are today, and what changes if they are chosen. */

const of = (over: Partial<OwnerCandidate>): OwnerCandidate => ({
  userId: "auth0|x",
  name: "Liv Nguyen",
  email: "liv@smithair.com.au",
  role: "admin",
  ...over,
});

describe("what a candidate is called", () => {
  it("prefers the profile name", () => {
    expect(candidateLabel(of({}))).toBe("Liv Nguyen");
  });

  /* A membership exists from the first sign-in; a NAME only arrives if the
     identity provider had one. The address is a better answer than the id. */
  it("falls back to the email's local part", () => {
    expect(candidateLabel(of({ name: null }))).toBe("liv");
    expect(candidateLabel(of({ name: "   " }))).toBe("liv");
  });

  it("falls back to the user id only when there is nothing else", () => {
    expect(candidateLabel(of({ name: null, email: null, userId: "auth0|x" }))).toBe("auth0|x");
  });
});

describe("what they are today", () => {
  it("says Co-owner, never Owner — there is only one of those", () => {
    expect(candidateRoleLabel(of({ role: "owner" }))).toBe("Co-owner");
    expect(candidateRoleLabel(of({ role: "admin" }))).toBe("Admin");
    expect(candidateRoleLabel(of({ role: "staff" }))).toBe("Staff");
  });
});

describe("what changes if they are chosen", () => {
  /* A co-owner already holds every capability, so nothing about what they can
     SEE changes — only who cannot be demoted does. Warning about a promotion
     that isn't happening would spend the reader's attention on nothing. */
  it("warns about nothing when the person is already an owner", () => {
    expect(transferWarning(of({ role: "owner" }))).toBeNull();
  });

  it("names the promotion that rides along for anyone else", () => {
    expect(transferWarning(of({ role: "admin" }))).toContain("becomes an owner as part of this");
    expect(transferWarning(of({ role: "staff" }))).toContain("Liv Nguyen");
  });
});

describe("the order they are offered in", () => {
  /* Co-owners first because they are the safest handover on the list — no
     promotion rides along — then admins, then staff, each A–Z. */
  it("puts co-owners first, then admins, then staff, alphabetically", () => {
    const list = [
      of({ userId: "1", name: "Zoe Ash", role: "staff" }),
      of({ userId: "2", name: "Amy Brown", role: "staff" }),
      of({ userId: "3", name: "Sam Reed", role: "owner" }),
      of({ userId: "4", name: "Liv Nguyen", role: "admin" }),
    ];
    expect(sortCandidates(list).map((c) => c.name)).toEqual([
      "Sam Reed",
      "Liv Nguyen",
      "Amy Brown",
      "Zoe Ash",
    ]);
  });

  it("does not mutate what it was handed", () => {
    const list = [of({ userId: "1", name: "Zoe", role: "staff" }), of({ userId: "2", name: "Sam", role: "owner" })];
    sortCandidates(list);
    expect(list.map((c) => c.name)).toEqual(["Zoe", "Sam"]);
  });
});
