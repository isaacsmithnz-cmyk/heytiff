import { hqAllowlist, isHqEmail } from "../allow";

describe("hqAllowlist", () => {
  it("splits, trims, lowercases and drops blanks", () => {
    expect(hqAllowlist("A@x.com, b@Y.com ,, c@z.com,")).toEqual([
      "a@x.com",
      "b@y.com",
      "c@z.com",
    ]);
  });

  it("is empty for undefined / empty / whitespace-only", () => {
    expect(hqAllowlist(undefined)).toEqual([]);
    expect(hqAllowlist("")).toEqual([]);
    expect(hqAllowlist("  ,  , ")).toEqual([]);
  });
});

describe("isHqEmail", () => {
  const raw = "isaac@heytiff.com, staff@heytiff.com";

  it("matches case-insensitively regardless of surrounding space", () => {
    expect(isHqEmail("isaac@heytiff.com", raw)).toBe(true);
    expect(isHqEmail("ISAAC@heytiff.com", raw)).toBe(true);
    expect(isHqEmail("  staff@HEYTIFF.com ", raw)).toBe(true);
  });

  it("rejects emails not on the list", () => {
    expect(isHqEmail("stranger@gmail.com", raw)).toBe(false);
  });

  it("fails closed: empty email or empty allowlist ⇒ false", () => {
    expect(isHqEmail(null, raw)).toBe(false);
    expect(isHqEmail(undefined, raw)).toBe(false);
    expect(isHqEmail("", raw)).toBe(false);
    expect(isHqEmail("isaac@heytiff.com", "")).toBe(false);
    expect(isHqEmail("isaac@heytiff.com", undefined)).toBe(false);
  });
});
