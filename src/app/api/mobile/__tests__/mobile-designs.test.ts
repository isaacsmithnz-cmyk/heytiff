/**
 * @jest-environment node
 */

/* The phone's Design: behind `studio`, read for the workspace the real
   token check verified, and "not here" for a design that isn't theirs. */

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
const asked: string[] = [];
jest.mock("@/lib/mobile/designs", () => ({
  listDesigns: async (orgId: string, q: string) => (asked.push(`list ${orgId} "${q}"`), [{ id: "d1" }]),
  readDesign: async (orgId: string, id: string) => (asked.push(`read ${orgId} ${id}`), id === "d1" ? { id: "d1" } : null),
  readScene: async (orgId: string, id: string) => (asked.push(`scene ${orgId} ${id}`), id === "d1" ? { scene: {}, floors: [] } : null),
}));

import { GET as list } from "../designs/route";
import { GET as one } from "../designs/[id]/route";
import { GET as scene } from "../designs/[id]/scene/route";
import { MOBILE_AUDIENCE } from "@/lib/mobile/token";

const DOMAIN = "tenant.example.auth0.com";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string) => {
  const h = b64({ alg: "RS256", kid: "k1" });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};
const req = (path: string, sub?: string) => new Request(`https://go.hey-tiff.com/api/mobile/${path}`, { headers: sub ? { authorization: `Bearer ${mint(sub)}` } : {} });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const env = process.env;
beforeEach(() => {
  process.env = { ...env, AUTH0_DOMAIN: DOMAIN };
  asked.length = 0;
  members = [
    { user_id: "auth0|lyle", org_id: "org-diamond", role: "staff", permissions: {} },
    { user_id: "auth0|nostudio", org_id: "org-diamond", role: "staff", permissions: { studio: false } },
  ];
});
afterAll(() => {
  process.env = env;
});

it("lists and reads in the verified workspace", async () => {
  expect(await (await list(req("designs?q=Railway", "auth0|lyle"))).json()).toEqual({ designs: [{ id: "d1" }] });
  expect((await one(req("designs/d1", "auth0|lyle"), params("d1"))).status).toBe(200);
  expect((await one(req("designs/zz", "auth0|lyle"), params("zz"))).status).toBe(404);
  expect((await scene(req("designs/d1/scene", "auth0|lyle"), params("d1"))).status).toBe(200);
  expect((await scene(req("designs/zz/scene", "auth0|lyle"), params("zz"))).status).toBe(404);
  expect(asked).toEqual(['list org-diamond "Railway"', "read org-diamond d1", "read org-diamond zz", "scene org-diamond d1", "scene org-diamond zz"]);
});

it("refuses without a token check, and without the studio", async () => {
  expect((await list(req("designs"))).status).toBe(401);
  expect((await list(req("designs", "auth0|nostudio"))).status).toBe(403);
  expect((await one(req("designs/d1", "auth0|nostudio"), params("d1"))).status).toBe(403);
  expect((await scene(req("designs/d1/scene", "auth0|nostudio"), params("d1"))).status).toBe(403);
  expect(asked).toEqual([]);
});
