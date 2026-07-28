/* The keyterm rules, which cost real money to get wrong.

   ElevenLabs charges a 20% surcharge for keyterm biasing and imposes a
   20-second minimum billable duration per clip once you pass 100 terms — so
   the cap isn't tidiness, it's the bill. The per-term rules (under 50 chars,
   at most 5 words, no bracket characters) come from their API reference:
   a term that breaks one is rejected upstream, taking the whole request with
   it, so they're enforced here instead. */

import {
  isTranscriptionConfigured,
  KEYTERM_LIMIT,
  prepareKeyterms,
  TRADE_KEYTERMS,
} from "../transcribe";

describe("prepareKeyterms", () => {
  it("keeps ordinary trade words and staff names", () => {
    expect(prepareKeyterms(["Luke", "condensate", "return air"])).toEqual([
      "Luke",
      "condensate",
      "return air",
    ]);
  });

  it("trims, and drops the empty", () => {
    expect(prepareKeyterms(["  grille  ", "", "   "])).toEqual(["grille"]);
  });

  it("de-duplicates case-insensitively — the surcharge is per term", () => {
    expect(prepareKeyterms(["Grille", "grille", "GRILLE"])).toEqual(["Grille"]);
  });

  it("drops terms the vendor documents it will reject", () => {
    expect(prepareKeyterms(["a".repeat(50)])).toEqual([]); // 50 chars is not "less than 50"
    expect(prepareKeyterms(["one two three four five six"])).toEqual([]); // >5 words
    for (const bad of ["<grille>", "a{b}", "a[b]", "back\\slash"]) {
      expect(prepareKeyterms([bad])).toEqual([]);
    }
  });

  it("keeps the boundary cases that are legal", () => {
    expect(prepareKeyterms(["a".repeat(49)])).toHaveLength(1);
    expect(prepareKeyterms(["one two three four five"])).toHaveLength(1);
  });

  it("caps well below the 100 that triggers a 20-second minimum charge", () => {
    const many = Array.from({ length: 500 }, (_, i) => `term${i}`);
    const out = prepareKeyterms(many);
    expect(out).toHaveLength(KEYTERM_LIMIT);
    expect(KEYTERM_LIMIT).toBeLessThan(100);
  });

  it("the built-in trade list survives its own rules", () => {
    expect(prepareKeyterms(TRADE_KEYTERMS)).toHaveLength(TRADE_KEYTERMS.length);
  });
});

describe("isTranscriptionConfigured", () => {
  const saved = process.env.ELEVENLABS_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = saved;
  });

  it("is false without a key, so the caller offers a typed note instead", () => {
    delete process.env.ELEVENLABS_API_KEY;
    expect(isTranscriptionConfigured()).toBe(false);
    process.env.ELEVENLABS_API_KEY = "k";
    expect(isTranscriptionConfigured()).toBe(true);
  });
});
