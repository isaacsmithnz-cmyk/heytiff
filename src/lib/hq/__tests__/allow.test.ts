import { hqAllowlist, isHqUser } from "../allow";

describe("hqAllowlist", () => {
  it("splits, trims and drops blanks", () => {
    expect(hqAllowlist("auth0|abc, google-oauth2|123 ,, auth0|def,")).toEqual([
      "auth0|abc",
      "google-oauth2|123",
      "auth0|def",
    ]);
  });

  it("is empty for undefined / empty / whitespace-only", () => {
    expect(hqAllowlist(undefined)).toEqual([]);
    expect(hqAllowlist("")).toEqual([]);
    expect(hqAllowlist("  ,  , ")).toEqual([]);
  });
});

describe("isHqUser", () => {
  const raw = "auth0|6a3a0a461bc41e0eea64e546, auth0|staff";

  it("matches the account id, whatever space surrounds it", () => {
    expect(isHqUser("auth0|6a3a0a461bc41e0eea64e546", raw)).toBe(true);
    expect(isHqUser(" auth0|staff ", raw)).toBe(true);
  });

  it("is exact: Auth0 ids are case-sensitive, and another identity is another user", () => {
    expect(isHqUser("auth0|6A3A0A461BC41E0EEA64E546", raw)).toBe(false);
    expect(isHqUser("google-oauth2|6a3a0a461bc41e0eea64e546", raw)).toBe(false);
  });

  it("rejects ids not on the list", () => {
    expect(isHqUser("auth0|stranger", raw)).toBe(false);
  });

  it("fails closed: empty id or empty allowlist ⇒ false", () => {
    expect(isHqUser(null, raw)).toBe(false);
    expect(isHqUser(undefined, raw)).toBe(false);
    expect(isHqUser("", raw)).toBe(false);
    expect(isHqUser("auth0|staff", "")).toBe(false);
    expect(isHqUser("auth0|staff", undefined)).toBe(false);
  });
});
