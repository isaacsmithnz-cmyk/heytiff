import {
  assertNotSeeded,
  buildKeyterms,
  cleanTerm,
  KEYTERM_DEFAULT_CAP,
} from "../keyterms";

describe("cleanTerm", () => {
  it("strips the characters ElevenLabs rejects", () => {
    expect(cleanTerm("PUMY-SP112 [outdoor]")).toBe("PUMY-SP112 outdoor");
  });

  it("rejects a term that is too long or too wordy", () => {
    expect(cleanTerm("x".repeat(51))).toBeNull();
    expect(cleanTerm("one two three four five six")).toBeNull();
  });

  it("rejects a term that is nothing but unsupported characters", () => {
    expect(cleanTerm("[]{}")).toBeNull();
  });
});

describe("buildKeyterms", () => {
  it("fills the cap in pool priority order — people before vocabulary", () => {
    const { terms } = buildKeyterms(
      { people: ["Luke", "Mick"], vocab: ["condensate"] },
      { max: 2 },
    );
    expect(terms).toEqual(["Luke", "Mick"]);
  });

  it("reports what it had to drop rather than silently truncating", () => {
    const { terms, rejected } = buildKeyterms(
      { people: ["Luke"], vocab: ["condensate", "penetrations"] },
      { max: 2 },
    );
    expect(terms).toHaveLength(2);
    expect(rejected).toEqual([{ term: "penetrations", reason: "over-cap" }]);
  });

  it("de-duplicates case-insensitively across pools", () => {
    const { terms } = buildKeyterms({ people: ["Luke"], clients: ["luke"] });
    expect(terms).toEqual(["Luke"]);
  });

  it("defaults to the conservative documented cap", () => {
    const many = Array.from({ length: 200 }, (_, i) => `term${i}`);
    expect(buildKeyterms({ vocab: many }).terms).toHaveLength(KEYTERM_DEFAULT_CAP);
  });

  it("accepts a raised cap so the doc conflict can be settled live", () => {
    const many = Array.from({ length: 200 }, (_, i) => `term${i}`);
    expect(buildKeyterms({ vocab: many }, { max: 1000 }).terms).toHaveLength(200);
  });
});

describe("assertNotSeeded", () => {
  it("throws when the pools are just this case's answers", () => {
    expect(() =>
      assertNotSeeded({ people: ["Luke"], vocab: ["condensate"] }, ["Luke", "condensate"]),
    ).toThrow(/seeded/i);
  });

  it("accepts a real roster where most people are not in this note", () => {
    expect(() =>
      assertNotSeeded(
        { people: ["Luke", "Mick", "Dave", "Sam", "Jo", "Pat", "Alex", "Kim"] },
        ["Luke"],
      ),
    ).not.toThrow();
  });

  it("says nothing about empty pools — that is a missing vocab file, not cheating", () => {
    expect(() => assertNotSeeded({}, ["Luke"])).not.toThrow();
  });
});
