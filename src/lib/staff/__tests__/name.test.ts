/* Names are stored as first + last. The rules that matter here are: full_name
   is derived and never split back apart, and a partial save can't truncate
   someone's name. */

import {
  composeFullName,
  displayNameOf,
  firstNameOf,
  fullNameOf,
  looksLikeAName,
  seedNameFor,
  splitName,
  withDerivedFullName,
} from "../name";

describe("composeFullName", () => {
  it("joins the two halves", () => {
    expect(composeFullName("Jordan", "Mills")).toBe("Jordan Mills");
  });

  it("keeps a multi-word surname whole", () => {
    expect(composeFullName("Sanne", "van der Berg")).toBe("Sanne van der Berg");
  });

  it("copes with either half missing", () => {
    expect(composeFullName("Cher", null)).toBe("Cher");
    expect(composeFullName(null, "Mills")).toBe("Mills");
    expect(composeFullName(null, null)).toBe("");
  });

  it("trims what people type", () => {
    expect(composeFullName("  Mary Anne ", " Mills  ")).toBe("Mary Anne Mills");
  });
});

describe("fullNameOf", () => {
  it("composes from the parts", () => {
    expect(fullNameOf({ first_name: "Jordan", last_name: "Mills" })).toBe("Jordan Mills");
  });

  it("falls back to a stored full_name for a row written before the split", () => {
    expect(fullNameOf({ full_name: "Jordan Mills" })).toBe("Jordan Mills");
  });

  it("prefers the parts over a stale full_name", () => {
    expect(
      fullNameOf({ first_name: "Sanne", last_name: "van der Berg", full_name: "Sanne Berg" })
    ).toBe("Sanne van der Berg");
  });
});

describe("displayNameOf", () => {
  it("lets a nickname win — that's the point of preferred_name", () => {
    expect(displayNameOf({ first_name: "Jordan", last_name: "Mills", preferred_name: "Jordy" })).toBe(
      "Jordy"
    );
  });

  it("falls back to the fallback when we know nothing", () => {
    expect(displayNameOf({})).toBe("Unnamed");
  });
});

describe("firstNameOf", () => {
  it("uses the stored first name", () => {
    expect(firstNameOf({ first_name: "Jordan", last_name: "Mills" })).toBe("Jordan");
  });

  it("prefers a nickname", () => {
    expect(firstNameOf({ first_name: "Jordan", preferred_name: "Jordy" })).toBe("Jordy");
  });

  it("falls back to the first token of a legacy full_name", () => {
    expect(firstNameOf({ full_name: "Jordan Mills" })).toBe("Jordan");
  });
});

describe("splitName — seeding only", () => {
  it("takes the first token as the first name and the rest as the last", () => {
    expect(splitName("Sanne van der Berg")).toEqual({
      first_name: "Sanne",
      last_name: "van der Berg",
    });
  });

  it("leaves a single-word name with no surname rather than inventing one", () => {
    expect(splitName("Cher")).toEqual({ first_name: "Cher", last_name: null });
  });

  it("returns nothing for nothing", () => {
    expect(splitName(null)).toEqual({ first_name: null, last_name: null });
    expect(splitName("   ")).toEqual({ first_name: null, last_name: null });
  });
});

describe("withDerivedFullName", () => {
  it("composes full_name when both halves are submitted", () => {
    expect(withDerivedFullName({ first_name: "Jordan", last_name: "Mills" })).toEqual({
      first_name: "Jordan",
      last_name: "Mills",
      full_name: "Jordan Mills",
    });
  });

  it("takes the missing half from the stored row", () => {
    expect(
      withDerivedFullName({ first_name: "Jordan" }, { first_name: "Jo", last_name: "Mills" })
    ).toEqual({ first_name: "Jordan", full_name: "Jordan Mills" });
  });

  it("honours a cleared half rather than resurrecting the stored one", () => {
    expect(
      withDerivedFullName({ last_name: null }, { first_name: "Cher", last_name: "Mills" })
    ).toEqual({ last_name: null, full_name: "Cher" });
  });

  it("nulls full_name when the whole name is cleared", () => {
    expect(withDerivedFullName({ first_name: null, last_name: null })).toEqual({
      first_name: null,
      last_name: null,
      full_name: null,
    });
  });

  it("leaves a patch that touches neither half alone", () => {
    const patch = { phone: "0400 000 000" };
    expect(withDerivedFullName(patch, { first_name: "Jordan", last_name: "Mills" })).toBe(patch);
  });
});

/* THE SEED — one rule for the name a brand-new card starts with, which lived
   twice and was wrong in one of the two places. */
describe("seedNameFor", () => {
  it("prefers what the org typed on the invitation", () => {
    expect(seedNameFor({ name: "Luke B", email: "luke@diamondairsolutions.com" }, "Luke Brennan")).toBe("Luke Brennan");
  });

  it("takes a provider claim that is really a name", () => {
    expect(seedNameFor({ name: "Luke Brennan", email: "luke@diamondairsolutions.com" })).toBe("Luke Brennan");
  });

  /* The production bug: a password sign-up's `name` claim IS the address, and
     `claim ?? prefix` never reached the prefix. */
  it("never seeds an address, whichever field it arrived in", () => {
    expect(seedNameFor({ name: "isaacsmithnz+test@gmail.com", email: "isaacsmithnz+test@gmail.com" })).toBe(
      "isaacsmithnz+test"
    );
    expect(seedNameFor({ name: "luke@diamondairsolutions.com", email: "luke@diamondairsolutions.com" }, "a@b.co")).toBe(
      "luke"
    );
  });

  it("has nothing to say with nothing to go on", () => {
    expect(seedNameFor({})).toBeNull();
    expect(seedNameFor({ name: "  ", email: "" })).toBeNull();
  });
});

describe("looksLikeAName", () => {
  it("offers back what could be somebody's name", () => {
    for (const n of ["luke", "Mary Anne", "van der Berg", "O'Brien", "Jean-Luc", "Zoë", "J. R."]) {
      expect(looksLikeAName(n)).toBe(true);
    }
  });

  it("holds back a handle somebody would have to delete before typing", () => {
    for (const n of ["isaacsmithnz+test", "luke@diamondairsolutions.com", "ben_91", "user123", "", "  "]) {
      expect(looksLikeAName(n)).toBe(false);
    }
  });
});
