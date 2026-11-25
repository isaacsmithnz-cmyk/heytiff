/**
 * @jest-environment node
 */

/* Deleting your own account from the phone (App Store 5.1.1(v)): only the
   verified token's own login, never an id off the request; an owner is told
   which business is theirs and nothing is touched; the login goes before the
   records, so a refusal from Auth0 changes nothing. */

import { generateKeyPairSync, sign } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
jest.mock("@/lib/mobile/token", () => ({
  ...jest.requireActual("@/lib/mobile/token"),
  tenantKeys: () => async (kid: string) => (kid === "k1" ? publicKey : null),
}));

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
const rpcs: { fn: string; args: unknown }[] = [];
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const keep: ((r: Row) => boolean)[] = [];
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => (keep.push((r) => r[c] === v), q),
        in: (c: string, vs: unknown[]) => (keep.push((r) => vs.includes(r[c])), q),
        order: () => q,
        then: (res: (v: unknown) => unknown) => res({ data: (tables[table] ?? []).filter((r) => keep.every((k) => k(r))), error: null }),
      };
      return q;
    },
    rpc: async (fn: string, args: unknown) => (rpcs.push({ fn, args }), { data: "deleted", error: null }),
  },
}));

const deleted: string[] = [];
let auth0Answer: { ok: true; value: true } | { ok: false; error: "NO_GRANT" } = { ok: true, value: true };
jest.mock("@/lib/integrations/auth0-management", () => ({
  deleteUser: async (id: string) => (deleted.push(id), auth0Answer),
}));

import { DELETE } from "../me/route";
import { MOBILE_AUDIENCE } from "@/lib/mobile/token";

const DOMAIN = "tenant.example.auth0.com";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string) => {
  const h = b64({ alg: "RS256", kid: "k1" });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};
const call = (sub?: string, body: unknown = {}) =>
  DELETE(
    new Request("https://go.hey-tiff.com/api/mobile/me", {
      method: "DELETE",
      headers: { "content-type": "application/json", ...(sub ? { authorization: `Bearer ${mint(sub)}` } : {}) },
      body: JSON.stringify(body),
    }),
  );

const env = process.env;
beforeEach(() => {
  process.env = { ...env, AUTH0_DOMAIN: DOMAIN };
  deleted.length = 0;
  rpcs.length = 0;
  auth0Answer = { ok: true, value: true };
  tables = {
    memberships: [
      { user_id: "auth0|owner", org_id: "org-a", role: "owner", permissions: {} },
      { user_id: "auth0|tech", org_id: "org-a", role: "staff", permissions: {} },
    ],
    organizations: [{ id: "org-a", trading_name: "Example Air", primary_owner_user_id: "auth0|owner" }],
  };
});
afterAll(() => {
  process.env = env;
});

it("deletes the verified person's own login, then what is only theirs, whatever the body names", async () => {
  const res = await call("auth0|tech", { userId: "auth0|owner" });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ deleted: true });
  expect(deleted).toEqual(["auth0|tech"]);
  expect(rpcs).toEqual([{ fn: "delete_account", args: { p_user: "auth0|tech" } }]);
});

it("tells an owner which business is theirs and touches nothing", async () => {
  const res = await call("auth0|owner");
  expect(res.status).toBe(409);
  const body = await res.json();
  expect(body.owns).toEqual(["Example Air"]);
  expect(body.error).toMatch(/You own Example Air/);
  expect(deleted).toEqual([]);
  expect(rpcs).toEqual([]);
});

it("changes nothing when Auth0 refuses", async () => {
  auth0Answer = { ok: false, error: "NO_GRANT" };
  const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  const res = await call("auth0|tech");
  expect(res.status).toBe(503);
  expect(rpcs).toEqual([]);
  spy.mockRestore();
});

it("refuses without a signed-in phone", async () => {
  expect((await call()).status).toBe(401);
  expect(deleted).toEqual([]);
});
