/**
 * @jest-environment node
 */

/* This phone, for push: kept under the person and workspace the real token
   check verified, never a body field; only a real Expo token; and signing
   out takes back only your own phone's row. */

import { generateKeyPairSync, sign } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
jest.mock("@/lib/mobile/token", () => ({
  ...jest.requireActual("@/lib/mobile/token"),
  tenantKeys: () => async (kid: string) => (kid === "k1" ? publicKey : null),
}));

type Row = { user_id: string; org_id: string; role: string | null; permissions: unknown };
let members: Row[] = [];
const writes: { op: string; row?: unknown; where?: Record<string, unknown> }[] = [];
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const f: Record<string, unknown> = {};
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => ((f[c] = v), q),
        order: () => q,
        upsert: async (row: unknown) => (writes.push({ op: "upsert", row }), { error: null }),
        delete: () => {
          const d: Record<string, unknown> = {
            eq: (c: string, v: unknown) => ((f[c] = v), d),
            then: (res: (v: unknown) => unknown) => (writes.push({ op: "delete", where: { ...f } }), res({ error: null })),
          };
          return d;
        },
        then: (res: (v: unknown) => unknown) =>
          res({ data: table === "memberships" ? members.filter((m) => m.user_id === f.user_id) : [], error: null }),
      };
      return q;
    },
  },
}));

import { DELETE, POST } from "../push/devices/route";
import { MOBILE_AUDIENCE } from "@/lib/mobile/token";

const DOMAIN = "tenant.example.auth0.com";
const TOKEN = "ExponentPushToken[abcDEF0123456789xyz]";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string) => {
  const h = b64({ alg: "RS256", kid: "k1" });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};
const call = (fn: typeof POST, body: unknown, sub?: string) =>
  fn(
    new Request("https://go.hey-tiff.com/api/mobile/push/devices", {
      method: "POST",
      headers: { "content-type": "application/json", ...(sub ? { authorization: `Bearer ${mint(sub)}` } : {}) },
      body: JSON.stringify(body),
    }),
  );

const env = process.env;
beforeEach(() => {
  process.env = { ...env, AUTH0_DOMAIN: DOMAIN };
  writes.length = 0;
  members = [{ user_id: "auth0|lyle", org_id: "org-diamond", role: "staff", permissions: {} }];
});
afterAll(() => {
  process.env = env;
});

it("keeps a phone under the verified person and workspace, whatever the body says", async () => {
  const res = await call(POST, { token: TOKEN, platform: "android", user_sub: "auth0|someone-else", org_id: "org-other" }, "auth0|lyle");
  expect(res.status).toBe(200);
  expect(writes).toEqual([{ op: "upsert", row: expect.objectContaining({ token: TOKEN, org_id: "org-diamond", user_sub: "auth0|lyle", platform: "android" }) }]);
});

it("refuses without a token check, and anything that isn't an Expo token", async () => {
  expect((await call(POST, { token: TOKEN })).status).toBe(401);
  expect((await call(POST, { token: "not a token" }, "auth0|lyle")).status).toBe(400);
  expect((await call(POST, { token: "ExponentPushToken[x]" }, "auth0|lyle")).status).toBe(400);
  expect(writes).toEqual([]);
});

it("signing out takes back only this person's row for that phone", async () => {
  expect((await call(DELETE, { token: TOKEN }, "auth0|lyle")).status).toBe(200);
  expect(writes).toEqual([{ op: "delete", where: expect.objectContaining({ token: TOKEN, org_id: "org-diamond", user_sub: "auth0|lyle" }) }]);
});
