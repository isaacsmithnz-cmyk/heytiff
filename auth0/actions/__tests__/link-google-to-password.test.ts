/* The linking rule, which is the whole security surface of that Action.

   Auto-linking on a verified email is a decision with a real attack behind
   it: get this predicate wrong and whoever holds an inbox is handed somebody
   else's company. The Action is otherwise plumbing — a Management call and a
   deny — so this is the file that matters, and every case below is a REFUSAL
   except the one that should succeed. */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { linkDecision } = require("../link-google-to-password.js");

type Match = { user_id: string; identities: { provider: string }[] };

const googleLogin = (over: Record<string, unknown> = {}) => ({
  connection: { strategy: "google-oauth2" },
  user: {
    user_id: "google-oauth2|111",
    email: "isaac@example.com",
    email_verified: true,
    identities: [{ provider: "google-oauth2", user_id: "111" }],
    ...over,
  },
});

const passwordUser = (id = "auth0|abc"): Match => ({
  user_id: id,
  identities: [{ provider: "auth0" }],
});

describe("it links, but only in the one safe case", () => {
  it("links a Google login to the single password account on that address", () => {
    expect(linkDecision(googleLogin(), [passwordUser()])).toEqual({
      link: true,
      primaryUserId: "auth0|abc",
    });
  });
});

describe("the refusals", () => {
  it("REFUSES an unverified address — the guard everything rests on", () => {
    // Without this the Action links on a claim the user could have typed,
    // which is precisely the attack Auth0 warns about.
    const d = linkDecision(googleLogin({ email_verified: false }), [passwordUser()]);
    expect(d.link).toBe(false);
    expect(d.why).toMatch(/verified/);
  });

  it("REFUSES when two accounts hold the address", () => {
    // Picking one would be guessing whose workspace to hand over.
    const d = linkDecision(googleLogin(), [passwordUser("auth0|a"), passwordUser("auth0|b")]);
    expect(d.link).toBe(false);
    expect(d.why).toMatch(/more than one/);
  });

  it("REFUSES a login that is not Google", () => {
    const d = linkDecision(
      { ...googleLogin(), connection: { strategy: "auth0" } },
      [passwordUser()],
    );
    expect(d.link).toBe(false);
  });

  it("REFUSES another social provider, whose verification policy is not ours", () => {
    const d = linkDecision(
      { ...googleLogin(), connection: { strategy: "windowslive" } },
      [passwordUser()],
    );
    expect(d.link).toBe(false);
  });

  it("REFUSES when there is no password account to join", () => {
    // A genuinely new person. They belong on /start, founding a company on
    // purpose — which is the whole point of #603.
    const d = linkDecision(googleLogin(), []);
    expect(d.link).toBe(false);
    expect(d.why).toMatch(/no existing password account/);
  });

  it("REFUSES to link a user to itself", () => {
    // The Management lookup returns the caller too; treating that as a match
    // would link an identity to the account it already belongs to.
    const self: Match = {
      user_id: "google-oauth2|111",
      identities: [{ provider: "auth0" }],
    };
    expect(linkDecision(googleLogin(), [self]).link).toBe(false);
  });

  it("REFUSES to match another SOCIAL account on the same address", () => {
    // Only a database account is a valid link target — two socials on one
    // address have no password to have been forgotten.
    const otherSocial: Match = {
      user_id: "windowslive|222",
      identities: [{ provider: "windowslive" }],
    };
    expect(linkDecision(googleLogin(), [otherSocial]).link).toBe(false);
  });

  it("REFUSES a login with no email at all", () => {
    const d = linkDecision(googleLogin({ email: undefined }), [passwordUser()]);
    expect(d.link).toBe(false);
  });

  it("survives the Management call returning nothing", () => {
    expect(linkDecision(googleLogin(), undefined).link).toBe(false);
    expect(linkDecision(googleLogin(), null).link).toBe(false);
  });
});
