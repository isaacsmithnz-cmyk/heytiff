import { NEAR, fuzzyWord, nearestIn, similarity, trigrams, wordsOf } from "../fuzzy";

/* A word near enough, counted as pg_trgm counts it (Isaac, 2026-10-11). */
describe("a word near enough", () => {
  it("counts its three-letter runs padded as pg_trgm pads them", () => {
    expect([...trigrams("Cat")]).toEqual(["  c", " ca", "cat", "at "]);
  });

  it("finds a letter out near, and a different word far", () => {
    expect(similarity("difuser", "diffuser")).toBeCloseTo(0.7, 5);
    expect(similarity("isolater", "isolator")).toBeCloseTo(0.5, 5);
    expect(similarity("cone", "core")).toBeLessThan(NEAR);
  });

  it("takes the nearest of a text's words, and nothing under half", () => {
    expect(nearestIn("difuser", wordsOf("CONE DIFFUSER PLASTIC 200"))).toBeCloseTo(0.7, 5);
    expect(nearestIn("cone", wordsOf("CORE HOLE 200"))).toBe(0);
  });

  it("loosens words only, never codes or short words", () => {
    expect(fuzzyWord("diffuser")).toBe(true);
    expect(fuzzyWord("vh250")).toBe(false);
    expect(fuzzyWord("tap")).toBe(false);
  });
});
