/* The names people go by — the pure rules (Isaac, 2026-09-29). */

import { ALIASES_MAX, aliasFromAnswer, aliasListText, learnable, looksLikeName, normAlias, parseAliasList } from "../aliases";

const PEOPLE = [{ fullName: "Isaac Smith" }, { fullName: "Leonardo Martins" }, { fullName: "Bobby Tran" }];

describe("what can be a nickname", () => {
  it("is one to three words of letters", () => {
    for (const ok of ["Bobo", "Big Leo", "O'Neil", "Jean-Luc", "Zé", "Tiny Big Mick"]) expect([ok, looksLikeName(ok)]).toEqual([ok, true]);
    for (const no of ["", "  ", "Bobo2", "a b c d", "me", "Myself", "someone", "the sparky", "my apprentice", "@bobo", "x".repeat(41)]) {
      expect([no, looksLikeName(no)]).toEqual([no, false]);
    }
  });

  it("(F) is never somebody's real name, first or full", () => {
    expect(learnable("Bobo", PEOPLE)).toBe(true);
    expect(learnable("bobby", PEOPLE)).toBe(false);
    expect(learnable("Leonardo Martins", PEOPLE)).toBe(false);
    expect(learnable("Leo", PEOPLE)).toBe(true);
  });

  it("compares in lower case with one space", () => {
    expect(normAlias("  Big   LEO ")).toBe("big leo");
  });
});

describe("aliasFromAnswer — what Tiff learns", () => {
  it("(F) learns Bobo is Leonardo from one unknown name and one person named", () => {
    expect(aliasFromAnswer(["Bobo"], ["s-leo"], PEOPLE)).toEqual({ alias: "Bobo", staffId: "s-leo" });
    // the same name on two tasks is still one name
    expect(aliasFromAnswer(["Bobo", "bobo"], ["s-leo", "s-leo"], PEOPLE)).toEqual({ alias: "Bobo", staffId: "s-leo" });
  });

  it("(F) learns nothing it can't pin down", () => {
    expect(aliasFromAnswer(["Bobo", "Tiny"], ["s-leo"], PEOPLE)).toBeNull(); // which is whom?
    expect(aliasFromAnswer(["Bobo"], ["s-leo", "s-bobby"], PEOPLE)).toBeNull();
    expect(aliasFromAnswer(["Bobo"], [], PEOPLE)).toBeNull(); // "Me"
    expect(aliasFromAnswer([], ["s-leo"], PEOPLE)).toBeNull();
    expect(aliasFromAnswer(["Bobby"], ["s-leo"], PEOPLE)).toBeNull(); // a real name
    expect(aliasFromAnswer(["the sparky"], ["s-leo"], PEOPLE)).toBeNull(); // a role
  });
});

describe("the card's list", () => {
  it("splits, tidies and keeps each name once, in the order typed", () => {
    expect(parseAliasList(" Bobo,  big  leo ;bobo\nLeo, ")).toEqual({ names: ["Bobo", "big leo", "Leo"], refused: [] });
    expect(aliasListText(["Bobo", "Leo"])).toBe("Bobo, Leo");
  });

  it("(F) reports what isn't a name instead of keeping it", () => {
    expect(parseAliasList("Bobo, R2D2, Leo")).toEqual({ names: ["Bobo", "Leo"], refused: ["R2D2"] });
  });

  it("keeps at most twelve", () => {
    const many = Array.from({ length: 15 }, (_, i) => `Name${"abcdefghijklmnop"[i]}`).join(", ");
    expect(parseAliasList(many.replace(/\d/g, "")).names).toHaveLength(ALIASES_MAX);
  });
});
