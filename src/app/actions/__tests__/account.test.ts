/* changeMySignInEmail is an account-takeover endpoint if it is wrong, so the
   things pinned here are mostly refusals.

   `update:users` can move ANY address in the tenant. The only thing stopping
   this function being a way to take somebody else's account is that it reads
   the user id from the session and never from its argument — so that is the
   first test, and it is written as "whatever you pass, the id sent to Auth0
   is the session's" rather than as a happy path that happens to work. */

const patched: { userId: string; email: string; name?: string }[] = [];
const verified: string[] = [];
const profileUpdates: { patch: Record<string, unknown>; userId: string }[] = [];
const sessionWrites: Record<string, unknown>[] = [];
let sessionWriteThrows = false;

/* Open on purpose: a real session carries name, picture, email_verified and
   whatever else the login minted, and the "leaves every other claim alone"
   test has to be able to put them there. */
let session: { user: { sub?: string; email?: string; [claim: string]: unknown } } | null = {
  user: { sub: "auth0|isaac", email: "isaac@old.com" },
};
let configured = true;
let setResult: { ok: boolean; error?: string } = { ok: true };
let verifyResult: { ok: boolean; error?: string } = { ok: true };

jest.mock("@/lib/auth0", () => ({
  auth0: {
    getSession: async () => session,
    /* THE MOCK HAS TO HAVE THIS, and the first version of it did not — so
       `updateSession` was undefined, calling it threw, the action's own
       try/catch swallowed the TypeError, and every test passed while the
       cookie was never rewritten. A fake that omits a method does not fail
       loudly; it fails silently in exactly the shape of a working system. */
    updateSession: async (next: Record<string, unknown>) => {
      if (sessionWriteThrows) throw new Error("cookie jar unavailable");
      sessionWrites.push(next);
    },
  },
}));

jest.mock("next/cache", () => ({ revalidatePath: () => {} }));

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => ({
      update: (patch: Record<string, unknown>) => ({
        eq: async (_col: string, userId: string) => {
          profileUpdates.push({ patch, userId });
          return { error: null };
        },
      }),
    }),
  },
}));

jest.mock("@/lib/integrations/auth0-management", () => ({
  isAuth0ManagementConfigured: () => configured,
  /* `name` IS CAPTURED, and the first version of this mock dropped it — which
     would have let "the name follows the address" pass while nothing was ever
     sent to Auth0. A fake that quietly ignores an argument tests the fake. */
  setUserEmail: async (userId: string, email: string, name?: string) => {
    if (!setResult.ok) return { ok: false, error: setResult.error };
    patched.push({ userId, email, name });
    return { ok: true, value: { email } };
  },
  sendVerificationEmail: async (userId: string) => {
    if (!verifyResult.ok) return { ok: false, error: verifyResult.error };
    verified.push(userId);
    return { ok: true, value: true };
  },
}));

import { changeMySignInEmail } from "../account";

beforeEach(() => {
  patched.length = 0;
  verified.length = 0;
  profileUpdates.length = 0;
  sessionWrites.length = 0;
  sessionWriteThrows = false;
  session = { user: { sub: "auth0|isaac", email: "isaac@old.com" } };
  configured = true;
  setResult = { ok: true };
  verifyResult = { ok: true };
});

describe("whose address gets changed", () => {
  it("only ever the session's, whatever the caller passes", () => {
    /* THE WHOLE SECURITY MODEL. There is no id parameter to abuse, and this
       test exists so that adding one is a failing test rather than a code
       review someone was rushing. */
    expect(changeMySignInEmail.length).toBe(1);
  });

  it("sends the session's user id to Auth0, not anything derived from input", async () => {
    const res = await changeMySignInEmail("new@example.com");
    expect(res.ok).toBe(true);
    expect(patched).toEqual([{ userId: "auth0|isaac", email: "new@example.com" }]);
  });

  it("refuses when nobody is signed in", async () => {
    session = null;
    const res = await changeMySignInEmail("new@example.com");
    expect(res).toEqual({ ok: false, error: "You need to be signed in." });
    expect(patched).toEqual([]);
  });

  it("refuses a session with no subject rather than patching an empty id", async () => {
    session = { user: { email: "isaac@old.com" } };
    const res = await changeMySignInEmail("new@example.com");
    expect(res.ok).toBe(false);
    expect(patched).toEqual([]);
  });
});

describe("what it refuses before touching the network", () => {
  it("a malformed address", async () => {
    const res = await changeMySignInEmail("not-an-address");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/doesn’t look like an email/i);
    expect(patched).toEqual([]);
  });

  it("the address it already is", async () => {
    /* Auth0 would accept this and mark a verified address unverified. */
    const res = await changeMySignInEmail("ISAAC@old.com");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/already your sign-in address/i);
    expect(patched).toEqual([]);
  });

  it("says so plainly when there is no identity provider configured", async () => {
    configured = false;
    const res = await changeMySignInEmail("new@example.com");
    expect(res.ok).toBe(false);
    expect(patched).toEqual([]);
  });
});

describe("when Auth0 says no", () => {
  it("names the grant as the problem, because that is the one that will happen", async () => {
    /* The application has to be authorised for the Management API with
       update:users. Until someone does that in the dashboard, every call 403s
       — and "something went wrong" would send them looking in the wrong
       place entirely. */
    setResult = { ok: false, error: "NO_GRANT" };
    const res = await changeMySignInEmail("new@example.com");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/update:users/);
  });

  it("says an address is taken rather than blaming the network", async () => {
    setResult = { ok: false, error: "EMAIL_IN_USE" };
    const res = await changeMySignInEmail("new@example.com");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/already signs in with that/i);
  });

  it("promises nothing changed when it could not reach Auth0", async () => {
    setResult = { ok: false, error: "UNAVAILABLE" };
    const res = await changeMySignInEmail("new@example.com");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/nothing was changed/i);
    expect(profileUpdates).toEqual([]);
  });
});

describe("after it has moved", () => {
  it("brings our own copy level so the screen doesn't show the old one", async () => {
    await changeMySignInEmail("new@example.com");
    expect(profileUpdates).toEqual([
      { patch: { email: "new@example.com" }, userId: "auth0|isaac" },
    ]);
  });

  it("asks Auth0 to send the verification, and says whether it went", async () => {
    const res = await changeMySignInEmail("new@example.com");
    expect(verified).toEqual(["auth0|isaac"]);
    expect(res).toMatchObject({ ok: true, verificationSent: true });
  });

  it("still SUCCEEDS when the verification mail fails to send", async () => {
    /* The address has already moved. Reporting failure here would tell
       someone nothing happened when their sign-in address had in fact
       changed — the worst of both, because they would not go looking for the
       verification mail either. */
    verifyResult = { ok: false, error: "UNAVAILABLE" };
    const res = await changeMySignInEmail("new@example.com");
    expect(res).toMatchObject({ ok: true, email: "new@example.com", verificationSent: false });
    expect(patched).toHaveLength(1);
  });

  it("rewrites the session cookie, because an email change does not reissue it", async () => {
    /* THE BUG THIS EXISTS FOR (Isaac, prod, 2026-09-01). He changed his
       address, verified it, came back, and both Sign-in and Summary still
       showed the old one — Auth0 had the new address and so did `profiles`,
       but `session.user.email` is a claim minted at LOGIN and nothing had
       minted a new one. Without this the only cure was signing out and back
       in, which is not a fix, it is a workaround with instructions. */
    await changeMySignInEmail("new@example.com");
    expect(sessionWrites).toHaveLength(1);
    expect((sessionWrites[0] as { user: { email: string } }).user.email).toBe("new@example.com");
  });

  it("leaves every other claim in the session alone", async () => {
    /* Only `email` is known to be stale. The rest are the ones the login
       issued, and inventing fresher values would be guessing — including
       `email_verified`, which Auth0 owns and which changes again the moment
       the person clicks the link in the mail. */
    session = {
      user: { sub: "auth0|isaac", email: "isaac@old.com", name: "Isaac Smith", email_verified: true },
    };
    await changeMySignInEmail("new@example.com");
    const written = sessionWrites[0] as { user: Record<string, unknown> };
    expect(written.user.name).toBe("Isaac Smith");
    expect(written.user.sub).toBe("auth0|isaac");
    expect(written.user.email_verified).toBe(true);
  });

  it("still SUCCEEDS when the cookie cannot be rewritten", async () => {
    /* The address has already moved. A stale cookie is a display problem
       that the next sign-in cures; reporting failure would say nothing
       happened when everything did. */
    sessionWriteThrows = true;
    const res = await changeMySignInEmail("new@example.com");
    expect(res).toMatchObject({ ok: true, email: "new@example.com" });
  });

  it("stores the address lowercased, the way it will be compared", async () => {
    await changeMySignInEmail("  New.Person@Example.COM ");
    expect(patched[0].email).toBe("new.person@example.com");
  });
});

/* THE NAME THAT WAS AN ADDRESS.

   Auth0 seeds `name` with the email when it creates a database user, so a
   person who never typed a real name has their address doing double duty.
   Moving the email alone froze that name as the OLD address — and
   `beforeSessionSaved` copies the name claim into `profiles` on every login,
   so it spread to the profile card, the team list and HQ. Isaac hit it live:
   email isaac@diamondairsolutions.com, name isaacsmithnz1@gmail.com.

   The dangerous half of this fix is the other direction. A real name is a
   fact the person chose, and overwriting it with an email address would be a
   worse bug than the one being fixed — so "leaves a real name alone" is the
   test that matters most here. */
describe("the name follows the address, but only when it WAS the address", () => {
  it("renames when the name is the old address", async () => {
    session = {
      user: { sub: "auth0|isaac", email: "isaac@old.com", name: "isaac@old.com" },
    };
    const res = await changeMySignInEmail("isaac@new.com");
    expect(res).toMatchObject({ ok: true });
    expect(patched.at(-1)).toEqual({
      userId: "auth0|isaac",
      email: "isaac@new.com",
      name: "isaac@new.com",
    });
  });

  it("LEAVES A REAL NAME ALONE", async () => {
    session = {
      user: { sub: "auth0|isaac", email: "isaac@old.com", name: "Isaac Smith" },
    };
    await changeMySignInEmail("isaac@new.com");
    // undefined, not the email — the PATCH must not carry `name` at all.
    expect(patched.at(-1)?.name).toBeUndefined();
  });

  it("matches the old address through the same normalisation as the email", async () => {
    // Casing and padding are not a different name.
    session = {
      user: { sub: "auth0|isaac", email: "isaac@old.com", name: "  Isaac@OLD.com " },
    };
    await changeMySignInEmail("isaac@new.com");
    expect(patched.at(-1)?.name).toBe("isaac@new.com");
  });

  it("does nothing when there is no name claim at all", async () => {
    session = { user: { sub: "auth0|isaac", email: "isaac@old.com" } };
    await changeMySignInEmail("isaac@new.com");
    expect(patched.at(-1)?.name).toBeUndefined();
  });

  it("carries the new name into our own copy and the cookie, together", async () => {
    // All three have to agree, or the screen shows one of them stale until
    // the next sign-in — which is the bug this whole action exists to avoid.
    session = {
      user: { sub: "auth0|isaac", email: "isaac@old.com", name: "isaac@old.com" },
    };
    await changeMySignInEmail("isaac@new.com");
    expect(profileUpdates.at(-1)?.patch).toEqual({
      email: "isaac@new.com",
      name: "isaac@new.com",
    });
    expect((sessionWrites.at(-1) as { user: Record<string, unknown> }).user).toMatchObject({
      email: "isaac@new.com",
      name: "isaac@new.com",
    });
  });

  it("does not write a name into profiles when the name was real", async () => {
    session = {
      user: { sub: "auth0|isaac", email: "isaac@old.com", name: "Isaac Smith" },
    };
    await changeMySignInEmail("isaac@new.com");
    expect(profileUpdates.at(-1)?.patch).toEqual({ email: "isaac@new.com" });
  });
});
