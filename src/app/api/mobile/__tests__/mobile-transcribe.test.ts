/**
 * @jest-environment node
 */

/* Speaking to the phone: the web's own dictation route behind the real token
   check, run as the token's person through the real session wrapper — its
   gate is theirs, the words come back, and nothing is heard without a token. */

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
jest.mock("@/lib/staff/aliases-query", () => ({ spokenStaffNames: async () => ["Luke"] }));
jest.mock("@/lib/voice/transcribe", () => ({
  TRADE_KEYTERMS: ["grilles"],
  transcribeAudio: async (audio: Blob, o: { keyterms: string[] }) => (heard.push(`heard ${audio.size} bytes with ${o.keyterms.join(",")}`), { ok: true, text: "Make Luke a task to order the grilles" }),
}));

import { POST } from "../transcribe/route";
import { MOBILE_AUDIENCE } from "@/lib/mobile/token";

const DOMAIN = "tenant.example.auth0.com";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string) => {
  const h = b64({ alg: "RS256", kid: "k1" });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};
const send = (sub: string | null) => {
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(4000)], { type: "audio/m4a" }), "note.m4a");
  return POST(new Request("https://go.hey-tiff.com/api/mobile/transcribe", { method: "POST", headers: sub ? { authorization: `Bearer ${mint(sub)}` } : {}, body: form }));
};

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

test("no token, nothing heard", async () => {
  expect((await send(null)).status).toBe(401);
  expect(heard).toEqual([]);
});

test("the web's own route, gated as the token's person, gives the words back", async () => {
  const res = await send("auth0|isaac");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ text: "Make Luke a task to order the grilles" });
  expect(heard).toEqual(["gate auth0|isaac", "heard 4000 bytes with Luke,grilles"]);
  /* someone the gate refuses is refused, as on the web */
  expect((await send("auth0|lyle")).status).toBe(403);
});
