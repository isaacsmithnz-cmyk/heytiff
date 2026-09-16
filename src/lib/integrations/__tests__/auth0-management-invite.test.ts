/**
 * @jest-environment node
 */

/* The three Management API calls the invitation's set-password door makes.

   What is pinned is what Auth0 is actually SENT, because every one of these
   bodies has a field whose absence is silent: a create without
   `verify_email: false` posts Auth0's own verification mail on top of the
   invitation; a ticket without `client_id` finishes on a screen with no way
   back to the app; a ticket without `mark_email_as_verified` leaves an address
   the person just proved unproven. */

jest.mock("server-only", () => ({}));

/* A module, not a script: with no top-level import this file's `load` would be
   a GLOBAL declaration, colliding with every other test file's `load` in tsc. */
export {};

const sent: { url: string; init: RequestInit }[] = [];
let replies: Array<{ status: number; body: unknown }> = [];

beforeAll(() => {
  process.env.AUTH0_DOMAIN = "dev-tenant.us.auth0.com";
  process.env.AUTH0_CLIENT_ID = "client-123";
  process.env.AUTH0_CLIENT_SECRET = "secret-456";
});

beforeEach(() => {
  sent.length = 0;
  replies = [];
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} });
    // the token request is always first and always succeeds unless a case says otherwise
    if (String(url).endsWith("/oauth/token")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 86400 }), { status: 200 });
    }
    const r = replies.shift() ?? { status: 500, body: {} };
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
});

async function load() {
  let mod!: typeof import("../auth0-management");
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require("../auth0-management");
  });
  return mod;
}

const apiCall = () => sent.find((s) => !s.url.endsWith("/oauth/token"))!;
const bodyOf = (s: { init: RequestInit }) => JSON.parse(String(s.init.body));

describe("findUsersByEmail", () => {
  it("asks for the address, encoded, and reads logins as used or unused", async () => {
    const { findUsersByEmail } = await load();
    replies = [
      {
        status: 200,
        body: [
          { user_id: "auth0|a", logins_count: 3, email: "x" },
          // a login that has never been used carries no count at all
          { user_id: "auth0|b", email: "x" },
        ],
      },
    ];
    const res = await findUsersByEmail("luke+crew@diamondairsolutions.com");
    expect(apiCall().url).toBe(
      "https://dev-tenant.us.auth0.com/api/v2/users-by-email?email=luke%2Bcrew%40diamondairsolutions.com"
    );
    expect(res).toEqual({
      ok: true,
      value: [
        { userId: "auth0|a", loginsCount: 3 },
        { userId: "auth0|b", loginsCount: 0 },
      ],
    });
  });

  it("says NO_GRANT when the scope is missing, so the route can fall back", async () => {
    const { findUsersByEmail } = await load();
    replies = [{ status: 403, body: { message: "Insufficient scope" } }];
    await expect(findUsersByEmail("a@b.co")).resolves.toEqual({ ok: false, error: "NO_GRANT" });
  });
});

describe("createPasswordUser", () => {
  it("makes a password login with an unusable password, unverified, and posts no mail", async () => {
    const { createPasswordUser, PASSWORD_CONNECTION } = await load();
    replies = [{ status: 201, body: { user_id: "auth0|new" } }];

    const res = await createPasswordUser({ email: "luke@diamondairsolutions.com", name: "Luke Brennan" });

    expect(res).toEqual({ ok: true, value: { userId: "auth0|new" } });
    const call = apiCall();
    expect(call.url).toBe("https://dev-tenant.us.auth0.com/api/v2/users");
    expect(call.init.method).toBe("POST");
    const body = bodyOf(call);
    expect(PASSWORD_CONNECTION).toBe("Username-Password-Authentication");
    expect(body).toMatchObject({
      connection: "Username-Password-Authentication",
      email: "luke@diamondairsolutions.com",
      email_verified: false,
      verify_email: false,
      name: "Luke Brennan",
    });
    // long, random, and never the same twice
    expect(typeof body.password).toBe("string");
    expect(body.password.length).toBeGreaterThanOrEqual(40);
  });

  it("never mints the same password twice", async () => {
    const { createPasswordUser } = await load();
    replies = [
      { status: 201, body: { user_id: "auth0|1" } },
      { status: 201, body: { user_id: "auth0|2" } },
    ];
    await createPasswordUser({ email: "a@b.co" });
    await createPasswordUser({ email: "c@d.co" });
    const passwords = sent.filter((s) => s.url.endsWith("/api/v2/users")).map((s) => bodyOf(s).password);
    expect(new Set(passwords).size).toBe(2);
  });

  /* Auth0 defaults `name` to the email — how profiles.name came to hold
     addresses. No name, or an address posing as one, sends nothing. */
  it("sends no name rather than an address or a blank", async () => {
    const { createPasswordUser } = await load();
    replies = [
      { status: 201, body: { user_id: "auth0|1" } },
      { status: 201, body: { user_id: "auth0|2" } },
      { status: 201, body: { user_id: "auth0|3" } },
    ];
    await createPasswordUser({ email: "a@b.co" });
    await createPasswordUser({ email: "a@b.co", name: "  " });
    await createPasswordUser({ email: "a@b.co", name: "a@b.co" });
    for (const s of sent.filter((x) => x.url.endsWith("/api/v2/users"))) {
      expect(bodyOf(s)).not.toHaveProperty("name");
    }
  });

  it("tells a login that already exists apart from every other failure", async () => {
    const { createPasswordUser } = await load();
    replies = [
      { status: 409, body: { message: "The user already exists." } },
      { status: 400, body: "PasswordStrengthError" },
    ];
    await expect(createPasswordUser({ email: "a@b.co" })).resolves.toEqual({ ok: false, error: "EMAIL_IN_USE" });
    await expect(createPasswordUser({ email: "a@b.co" })).resolves.toMatchObject({ ok: false, error: "REJECTED" });
  });
});

describe("createPasswordTicket", () => {
  it("opens the password screen for one user, verifies the address on finish, and comes back to the app", async () => {
    const { createPasswordTicket, PASSWORD_TICKET_TTL_SEC } = await load();
    replies = [{ status: 201, body: { ticket: "https://dev-tenant.us.auth0.com/u/reset-verify?ticket=x#" } }];

    const res = await createPasswordTicket("auth0|new");

    expect(res).toEqual({ ok: true, value: "https://dev-tenant.us.auth0.com/u/reset-verify?ticket=x#" });
    const call = apiCall();
    expect(call.url).toBe("https://dev-tenant.us.auth0.com/api/v2/tickets/password-change");
    expect(bodyOf(call)).toEqual({
      user_id: "auth0|new",
      client_id: "client-123",
      ttl_sec: PASSWORD_TICKET_TTL_SEC,
      mark_email_as_verified: true,
    });
    // an hour, not Auth0's five days of a reset link in somebody's history
    expect(PASSWORD_TICKET_TTL_SEC).toBe(3600);
  });

  it("refuses to redirect anywhere that is not an https ticket", async () => {
    const { createPasswordTicket } = await load();
    replies = [
      { status: 201, body: { ticket: "javascript:alert(1)" } },
      { status: 201, body: {} },
    ];
    await expect(createPasswordTicket("auth0|new")).resolves.toEqual({ ok: false, error: "UNAVAILABLE" });
    await expect(createPasswordTicket("auth0|new")).resolves.toEqual({ ok: false, error: "UNAVAILABLE" });
  });
});
