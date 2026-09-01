/* changeMySignInEmail is an account-takeover endpoint if it is wrong, so the
   things pinned here are mostly refusals.

   `update:users` can move ANY address in the tenant. The only thing stopping
   this function being a way to take somebody else's account is that it reads
   the user id from the session and never from its argument — so that is the
   first test, and it is written as "whatever you pass, the id sent to Auth0
   is the session's" rather than as a happy path that happens to work. */

const patched: { userId: string; email: string }[] = [];
const verified: string[] = [];
const profileUpdates: { patch: Record<string, unknown>; userId: string }[] = [];

let session: { user: { sub?: string; email?: string } } | null = {
  user: { sub: "auth0|isaac", email: "isaac@old.com" },
};
let configured = true;
let setResult: { ok: boolean; error?: string } = { ok: true };
let verifyResult: { ok: boolean; error?: string } = { ok: true };

jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: async () => session },
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
  setUserEmail: async (userId: string, email: string) => {
    if (!setResult.ok) return { ok: false, error: setResult.error };
    patched.push({ userId, email });
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

  it("stores the address lowercased, the way it will be compared", async () => {
    await changeMySignInEmail("  New.Person@Example.COM ");
    expect(patched[0].email).toBe("new.person@example.com");
  });
});
