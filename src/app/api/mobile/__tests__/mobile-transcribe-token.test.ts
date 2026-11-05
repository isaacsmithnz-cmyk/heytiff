/**
 * @jest-environment node
 */

/* Speaking to the phone, live: the web's own key-minting door behind the real
   token check, run as the token's person through the real session wrapper —
   its gate is theirs, the key and the words come back, and nothing is minted
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
      return null;
    }
  },
}));
const heard: string[] = [];
jest.mock("@/lib/voice/can-dictate", () => ({
  canDictate: async () => {
    const { auth0 } = jest.requireActual("@/lib/auth0") as typeof import("@/lib/auth0");
    const s = await auth0.getSession();
    heard.push(`gate ${s?.user.sub ?? "nobody"}`);
    return s?.user.sub === "auth0|isaac";
  },
}));
jest.mock("@/lib/staff/aliases-query", () => ({
  spokenStaffNames: async (orgId: string) => (heard.push(`names for ${orgId}`), ["Luke", "Bobo"]),
}));
jest.mock("@/lib/voice/transcribe", () => ({
  ...jest.requireActual("@/lib/voice/transcribe"),
  TRADE_KEYTERMS: ["grilles", "commissioning"],
  mintRealtimeToken: async () => (heard.push("minted"), { ok: true, token: "sutkn_live" }),
}));

import { POST } from "../transcribe/token/route";
import { MOBILE_AUDIENCE } from "@/lib/mobile/token";

const DOMAIN = "tenant.example.auth0.com";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string) => {
  const h = b64({ alg: "RS256", kid: "k1" });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};
const ask = (sub: string | null) =>
  POST(new Request("https://go.hey-tiff.com/api/mobile/transcribe/token", { method: "POST", headers: sub ? { authorization: `Bearer ${mint(sub)}` } : {} }));

const env = process.env;
beforeEach(() => {
  process.env = { ...env, AUTH0_DOMAIN: DOMAIN };
  heard.length = 0;
  members = [
    { user_id: "auth0|isaac", org_id: "org-1", role: "owner", permissions: {} },
    { user_id: "auth0|lyle", org_id: "org-1", role: "staff", permissions: {} },
  ];
});
afterAll(() => {
  process.env = env;
});

test("the phone's person gets a single-use key and their org's words, names first", async () => {
  const res = await ask("auth0|isaac");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ token: "sutkn_live", keyterms: ["Luke", "Bobo", "grilles", "commissioning"] });
  expect(heard).toEqual(["gate auth0|isaac", "minted", "names for org-1"]);
});

test("someone who can't dictate gets no key, and nothing is spent", async () => {
  const res = await ask("auth0|lyle");
  expect(res.status).toBe(403);
  expect(heard).toEqual(["gate auth0|lyle"]);
});

test("no token, no key", async () => {
  const res = await ask(null);
  expect(res.status).toBe(401);
  expect(heard).toEqual([]);
});
