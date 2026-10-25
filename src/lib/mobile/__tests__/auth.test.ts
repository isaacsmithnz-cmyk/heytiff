/**
 * @jest-environment node
 */

/* The phone reads for one person in one of THEIR workspaces, never another
   business's. The token is real (signed with a test key); the memberships
   are a stand-in table, with Lyle in two workspaces and nobody in the third. */

import { generateKeyPairSync, sign } from "node:crypto";

type Row = { user_id: string; org_id: string; role: string | null; permissions: unknown };
let rows: Row[] = [];
let readFails = false;
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table !== "memberships") throw new Error(`unexpected table ${table}`);
      let user = "";
      const q = {
        select: () => q,
        eq: (c: string, v: string) => {
          if (c === "user_id") user = v;
          return q;
        },
        order: () => q,
        then: (res: (v: unknown) => unknown) =>
          res(readFails ? { data: null, error: { message: "down" } } : { data: rows.filter((r) => r.user_id === user), error: null }),
      };
      return q;
    },
  },
}));

import { requireMobile, type MobileCtx } from "../auth";
import { MOBILE_AUDIENCE } from "../token";

const DOMAIN = "tenant.example.auth0.com";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const NOW = 1_800_000_000;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string, claims: Record<string, unknown> = {}) => {
  const h = b64({ alg: "RS256", kid: "k1" });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub, exp: NOW + 3600, ...claims });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};
const keyFor = async (kid: string) => (kid === "k1" ? publicKey : null);
const call = (headers: Record<string, string>, capability?: Parameters<typeof requireMobile>[1]) =>
  requireMobile(new Request("https://go.hey-tiff.com/api/mobile/me", { headers }), capability, { keyFor, now: NOW });
const as = (sub: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${mint(sub)}`, ...extra });

const env = process.env;
beforeEach(() => {
  process.env = { ...env, AUTH0_DOMAIN: DOMAIN };
  readFails = false;
  rows = [
    { user_id: "auth0|lyle", org_id: "org-diamond", role: "staff", permissions: {} },
    { user_id: "auth0|lyle", org_id: "org-second", role: "admin", permissions: {} },
    { user_id: "auth0|isaac", org_id: "org-diamond", role: "owner", permissions: {} },
    { user_id: "auth0|otto", org_id: "org-other", role: "owner", permissions: {} },
  ];
});
afterAll(() => {
  process.env = env;
});

const status = async (r: MobileCtx | Response) => (r instanceof Response ? [r.status, (await r.json()).error] : "ctx");

test("no token, a broken one, or one for another tenant is a 401 that says to sign in again", async () => {
  expect(await status(await call({}))).toEqual([401, "Sign in again."]);
  expect(await status(await call({ authorization: "Basic abc" }))).toEqual([401, "Sign in again."]);
  expect(await status(await call({ authorization: "Bearer not.a.token" }))).toEqual([401, "Sign in again."]);
  process.env.AUTH0_DOMAIN = "another.example.auth0.com";
  expect(await status(await call(as("auth0|lyle")))).toEqual([401, "Sign in again."]);
});

test("without AUTH0_DOMAIN nothing is believed", async () => {
  delete process.env.AUTH0_DOMAIN;
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  expect(await status(await call(as("auth0|lyle")))).toEqual([401, "Sign in again."]);
  spy.mockRestore();
});

test("someone signed in with no workspace is told to be invited on the web first", async () => {
  expect(await status(await call(as("auth0|stranger")))).toEqual([
    403,
    "This sign-in has no HeyTiff workspace. Ask to be invited on the web first.",
  ]);
});

test("without a workspace named, it's the one the website opens: the oldest", async () => {
  const ctx = (await call(as("auth0|lyle"))) as MobileCtx;
  expect([ctx.userId, ctx.orgId, ctx.role, ctx.orgIds]).toEqual(["auth0|lyle", "org-diamond", "staff", ["org-diamond", "org-second"]]);
});

test("a workspace of their own can be named, and is read with that membership's role", async () => {
  const ctx = (await call(as("auth0|lyle", { "x-heytiff-org": "org-second" }))) as MobileCtx;
  expect([ctx.orgId, ctx.role, ctx.orgIds]).toEqual(["org-second", "admin", ["org-second", "org-diamond"]]);
});

describe("another business's workspace", () => {
  test("named by someone who isn't in it is refused, never swapped for their own", async () => {
    expect(await status(await call(as("auth0|lyle", { "x-heytiff-org": "org-other" })))).toEqual([403, "You're not a member of that workspace."]);
  });

  test("an owner of one business can't read another by naming it", async () => {
    expect(await status(await call(as("auth0|isaac", { "x-heytiff-org": "org-other" })))).toEqual([403, "You're not a member of that workspace."]);
  });

  test("a token whose subject is changed after signing is a 401, not somebody else", async () => {
    const [h, , s] = mint("auth0|lyle").split(".");
    const forged = `${h}.${b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub: "auth0|otto", exp: NOW + 3600 })}.${s}`;
    expect(await status(await call({ authorization: `Bearer ${forged}` }))).toEqual([401, "Sign in again."]);
  });
});

describe("what they may do is the membership's, read on every call", () => {
  test("a capability their role hasn't got is a 403", async () => {
    expect(await status(await call(as("auth0|lyle"), "financials"))).toEqual([403, "You don't have access to that."]);
  });

  test("a revoke the owner just made is honoured", async () => {
    rows[0]!.permissions = { workboard: false };
    expect(await status(await call(as("auth0|lyle"), "workboard"))).toEqual([403, "You don't have access to that."]);
  });

  test("a grant is honoured too", async () => {
    rows[0]!.permissions = { workboard_money: true };
    const ctx = (await call(as("auth0|lyle"), "workboard_money")) as MobileCtx;
    expect(ctx.caps.has("workboard_money")).toBe(true);
  });

  test("the owner holds everything", async () => {
    const ctx = (await call(as("auth0|isaac"), "financials")) as MobileCtx;
    expect(ctx.orgId).toBe("org-diamond");
  });
});

test("a database that can't be read is a 503, not an empty answer", async () => {
  readFails = true;
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  expect(await status(await call(as("auth0|lyle")))).toEqual([503, "HeyTiff couldn't be reached. Try again."]);
  spy.mockRestore();
});
