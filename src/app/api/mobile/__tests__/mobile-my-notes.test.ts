/**
 * @jest-environment node
 */

/* My notes only from the phone: the web's own addMyNote and deleteMyNote
   (recorded here), behind the real token check and run as the token's
   person through the real session wrapper — never the browser's, and never
   without a token. */

import { generateKeyPairSync, sign } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
jest.mock("@/lib/mobile/token", () => ({
  ...jest.requireActual("@/lib/mobile/token"),
  tenantKeys: () => async (kid: string) => (kid === "k1" ? publicKey : null),
}));
type Row = { user_id: string; org_id: string; role: string | null; permissions: unknown };
let members: Row[] = [];
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => {
      const f: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => ((f[c] = v), q),
        order: () => q,
        then: (res: (v: unknown) => unknown) => res({ data: members.filter((m) => m.user_id === f.user_id), error: null }),
      };
      return q;
    },
  },
}));
jest.mock("server-only", () => ({}));
jest.mock("@auth0/nextjs-auth0/server", () => ({
  Auth0Client: class {
    async getSession() {
      return { user: { sub: "auth0|browser" }, orgId: "org-browser" };
    }
  },
}));
const kept: string[] = [];
const who = async () => {
  const { auth0 } = jest.requireActual("@/lib/auth0") as typeof import("@/lib/auth0");
  const s = await auth0.getSession();
  return `${s?.user.sub}@${s?.orgId}`;
};
jest.mock("@/app/actions/my-notes", () => ({
  addMyNote: async (input: { body: string; source: string }) => (kept.push(`keep as ${await who()}: ${input.body} (${input.source})`), input.body.trim() ? { ok: true, id: "sn-1" } : { ok: false, error: "Write something first." }),
  deleteMyNote: async (id: string) => (kept.push(`delete as ${await who()}: ${id}`), { ok: true }),
}));

import { POST } from "../my-notes/route";
import { DELETE } from "../my-notes/[id]/route";
import { MOBILE_AUDIENCE } from "@/lib/mobile/token";

const DOMAIN = "tenant.example.auth0.com";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string) => {
  const h = b64({ alg: "RS256", kid: "k1" });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};
const req = (sub: string | null, method: string, body?: unknown) =>
  new Request("https://go.hey-tiff.com/api/mobile/my-notes", { method, headers: { ...(sub ? { authorization: `Bearer ${mint(sub)}` } : {}), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

const env = process.env;
beforeEach(() => {
  process.env = { ...env, AUTH0_DOMAIN: DOMAIN };
  kept.length = 0;
  members = [{ user_id: "auth0|isaac", org_id: "org-1", role: "staff", permissions: {} }];
});
afterAll(() => {
  process.env = env;
});

test("no token, nothing kept", async () => {
  expect((await POST(req(null, "POST", { body: "Check the 3304 gas" }))).status).toBe(401);
  expect(kept).toEqual([]);
});

test("kept for the token's own person, and its Undo deletes it as them", async () => {
  const res = await POST(req("auth0|isaac", "POST", { body: "Check the 3304 gas", source: "voice" }));
  expect(await res.json()).toEqual({ id: "sn-1" });
  expect((await POST(req("auth0|isaac", "POST", { body: "  " }))).status).toBe(400);
  expect((await DELETE(req("auth0|isaac", "DELETE"), { params: Promise.resolve({ id: "sn-1" }) })).status).toBe(200);
  expect(kept).toEqual(["keep as auth0|isaac@org-1: Check the 3304 gas (voice)", "keep as auth0|isaac@org-1:    (text)", "delete as auth0|isaac@org-1: sn-1"]);
});
