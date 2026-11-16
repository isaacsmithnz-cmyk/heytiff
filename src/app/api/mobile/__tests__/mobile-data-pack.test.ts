/**
 * @jest-environment node
 */

/* The phone's Data pack: behind the Library's `tiff` grant, every unit from
   the real packs, and Combine checked as the system builder checks it. The
   token check is the real one; the packs are read off disk without HQ's
   corrections. */

import { generateKeyPairSync, sign } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
jest.mock("@/lib/mobile/token", () => ({
  ...jest.requireActual("@/lib/mobile/token"),
  tenantKeys: () => async (kid: string) => (kid === "k1" ? publicKey : null),
}));
jest.mock("server-only", () => ({}));

type Row = { user_id: string; org_id: string; role: string | null; permissions: unknown };
let members: Row[] = [];
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const f: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => ((f[c] = v), q),
        order: () => q,
        then: (res: (v: unknown) => unknown) =>
          res(table === "memberships" ? { data: members.filter((m) => m.user_id === f.user_id), error: null } : { data: [], error: null }),
      };
      return q;
    },
  },
}));
let read = 0;
jest.mock("@/lib/library/packs-server", () => {
  const { installedPacks, loadInstalledPack } = jest.requireActual("@/lib/studio/packs/server");
  const { packUnits } = jest.requireActual("@/lib/library/data-pack");
  const BASE = jest.requireActual("node:path").join(process.cwd(), "data/packs");
  const packs = async () => {
    read++;
    const refs = await installedPacks(BASE);
    return Promise.all(refs.map((r: { brand: string; version: string }) => loadInstalledPack(r.brand, r.version, BASE).then((p: { pack: unknown }) => p.pack)));
  };
  return { libraryPacks: packs, libraryUnits: async () => packUnits(await packs()) };
});

import { GET as units } from "../data-pack/route";
import { POST as combine } from "../data-pack/combine/route";
import { MOBILE_AUDIENCE } from "@/lib/mobile/token";

const DOMAIN = "tenant.example.auth0.com";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string) => {
  const h = b64({ alg: "RS256", kid: "k1" });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};
const req = (p: string, sub?: string, body?: unknown) =>
  new Request(`https://go.hey-tiff.com/api/mobile/${p}`, {
    method: body ? "POST" : "GET",
    headers: { ...(sub ? { authorization: `Bearer ${mint(sub)}` } : {}), "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

const env = process.env;
beforeEach(() => {
  process.env = { ...env, AUTH0_DOMAIN: DOMAIN };
  read = 0;
  members = [{ user_id: "auth0|lyle", org_id: "org-diamond", role: "staff", permissions: {} }];
});
afterAll(() => {
  process.env = env;
});

test("refused without a token or the Library grant, before a pack is read", async () => {
  expect((await units(req("data-pack"))).status).toBe(401);
  members[0]!.permissions = { tiff: false };
  expect((await units(req("data-pack", "auth0|lyle"))).status).toBe(403);
  expect((await combine(req("data-pack/combine", "auth0|lyle", { outdoor: "x", heads: [] }))).status).toBe(403);
  expect(read).toBe(0);
});

test("every unit, smallest first, with the brands and kinds to filter by", async () => {
  const res = await units(req("data-pack", "auth0|lyle"));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { units: { model: string; coolKw: number }[]; brands: { name: string }[]; kinds: { name: string }[] };
  expect(body.units.length).toBeGreaterThan(1100);
  expect(body.units[0].coolKw).toBeLessThanOrEqual(body.units.at(-1)!.coolKw);
  expect(body.brands).toHaveLength(6);
  expect(body.kinds.map((k) => k.name)).toContain("Ducted");
});

test("combines a multi outdoor with its heads", async () => {
  const res = await combine(
    req("data-pack/combine", "auth0|lyle", {
      outdoor: "o:mitsubishi-electric:MXZ-4F71VGD",
      heads: ["i:mitsubishi-electric:MSZ-AP25VGD2", "i:mitsubishi-electric:MSZ-AP25VGD2", "i:mitsubishi-electric:PEAD-M50JAA(D)"],
    }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { verdict: { tone: string; word: string }; offered: string[] };
  expect(body.verdict).toMatchObject({ tone: "good", word: "In the combination table" });
  expect(body.offered).toContain("i:mitsubishi-electric:PEAD-M50JAA(D)");
  expect((await combine(req("data-pack/combine", "auth0|lyle", { outdoor: "o:nobody:X", heads: [] }))).status).toBe(404);
});
