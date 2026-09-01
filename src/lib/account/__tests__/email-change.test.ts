import {
  confirmationMatches,
  normaliseEmail,
  sameEmail,
  validateNewEmail,
} from "../email-change";

/* The rules that stand between a typo and a lockout.

   There is no undo here and no verify-then-switch — this app cannot send its
   own email, so the address moves on submit and a database-connection login
   uses it as the username. Everything below is pinned because the failure
   mode is somebody unable to sign in to their own workspace. */

describe("normaliseEmail", () => {
  it("trims and lowercases", () => {
    expect(normaliseEmail("  Isaac@Example.COM ")).toBe("isaac@example.com");
  });
});

describe("sameEmail", () => {
  it("ignores case and surrounding space", () => {
    expect(sameEmail("isaac@example.com", " ISAAC@Example.com ")).toBe(true);
  });

  it("treats a missing side as 'not the same' rather than a match", () => {
    /* Two unknowns are not equal. A null-equals-null match here would let a
       card with no address recorded pass the unchanged check. */
    expect(sameEmail(null, null)).toBe(false);
    expect(sameEmail("a@b.com", null)).toBe(false);
    expect(sameEmail(undefined, "a@b.com")).toBe(false);
  });
});

describe("validateNewEmail", () => {
  const CURRENT = "isaac@diamondair.com.au";

  it("accepts an ordinary address and hands back the stored form", () => {
    const v = validateNewEmail("  Isaac.Smith@Diamond-Air.com.AU ", CURRENT);
    expect(v).toEqual({ ok: true, email: "isaac.smith@diamond-air.com.au" });
  });

  it("asks for something rather than sending nothing", () => {
    for (const empty of ["", "   ", null, undefined, 42, {}]) {
      const v = validateNewEmail(empty, CURRENT);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.error).toMatch(/enter the new email/i);
    }
  });

  it("refuses what is obviously not an address", () => {
    /* Deliberately not an RFC parser — the inbox is the only real authority.
       These are the shapes a person actually mistypes. */
    for (const bad of [
      "isaac",
      "isaac@",
      "@example.com",
      "isaac@example",
      "isaac example@x.com",
      "isaac@@example.com",
      "isaac@.com",
      "isaac@example.",
    ]) {
      const v = validateNewEmail(bad, CURRENT);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.error).toMatch(/doesn’t look like an email/i);
    }
  });

  it("refuses a paste that is far too long to be an address", () => {
    const v = validateNewEmail(`${"a".repeat(320)}@example.com`, CURRENT);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toMatch(/too long/i);
  });

  it("refuses the address it already is, in ANY case", () => {
    /* THE ONE AUTH0 WOULD HAPPILY ACCEPT. Patching a user to the address it
       already has succeeds — and succeeds having set email_verified false.
       The person would be told it worked and then asked to re-verify an
       address that never moved. */
    for (const same of [CURRENT, CURRENT.toUpperCase(), `  ${CURRENT}  `]) {
      const v = validateNewEmail(same, CURRENT);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.error).toMatch(/already your sign-in address/i);
    }
  });

  it("still works for an account whose current address is unknown", () => {
    /* Nothing to compare against is not a reason to refuse a valid change. */
    expect(validateNewEmail("new@example.com", null)).toEqual({
      ok: true,
      email: "new@example.com",
    });
  });
});

describe("confirmationMatches", () => {
  it("passes when the two typings agree, case and space aside", () => {
    expect(confirmationMatches("isaac@example.com", " Isaac@Example.com ")).toBe(true);
  });

  it("catches the typo it exists for", () => {
    /* One character out in the domain — the mistake that sends a sign-in
       address somewhere nobody can read, with no way back. */
    expect(confirmationMatches("isaac@example.com", "isaac@exampel.com")).toBe(false);
    expect(confirmationMatches("isaac@example.com", "")).toBe(false);
  });
});
