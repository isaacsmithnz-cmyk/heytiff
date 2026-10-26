/**
 * @jest-environment node
 */

/* Talking to Tiff from the phone: the web's own `answer` loop for the
   person the real token check verified, refused for someone with nothing
   to ask about; her "take me there" as the phone's own screen; what only
   the web can do left out; and the conversations kept under the verified
   person, behind `tiff`. */

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
let readTools = true;
jest.mock("@/lib/tiff/registry/viewer", () => ({
  viewerForUser: async (orgId: string, userId: string) => (asked.push(`viewer ${orgId} ${userId}`), { orgId, userId }),
}));
jest.mock("@/lib/tiff/registry", () => ({ toolsFor: () => (readTools ? [{ risk: "read" }] : []) }));
jest.mock("@/lib/brain/turn", () => ({
  shapeAsk: (raw: { question?: unknown }) => (typeof raw?.question === "string" && raw.question.trim() ? { question: raw.question.trim() } : null),
  answer: async function* (viewer: { orgId: string }, body: { question: string }) {
    asked.push(`answer ${viewer.orgId} "${body.question}"`);
    yield { type: "tool", name: "jobs.search", label: "Looking at jobs" };
    yield { type: "delta", text: "Job 2935 is booked " };
    yield { type: "delta", text: "for Monday." };
    yield { type: "screen", href: "/dashboard/jobs/j-2935", label: "Job 2935" };
    yield { type: "screen", href: "/dashboard/analytics", label: "Reports" };
    yield { type: "offer", offer: { total: 100 } };
    yield { type: "apply", target: "design-roof", designId: "d1", roof: {} };
    yield { type: "done" };
  },
}));
const kept: { op: string; owner: unknown; upsert?: unknown; remove?: unknown }[] = [];
jest.mock("@/lib/tiff/threads-server", () => ({
  readThreads: async (owner: unknown) => (kept.push({ op: "read", owner }), { kept: true, threads: [{ id: "t-1", title: "Stanmore", updatedAt: 1, messages: [] }] }),
  writeThreads: async (owner: unknown, upsert: unknown, remove: unknown) => (kept.push({ op: "write", owner, upsert, remove }), true),
}));

import { POST as ask } from "../tiff/route";
import { GET as threads, POST as keep } from "../tiff/threads/route";
import { MOBILE_AUDIENCE } from "@/lib/mobile/token";

const DOMAIN = "tenant.example.auth0.com";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string) => {
  const h = b64({ alg: "RS256", kid: "k1" });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};
const req = (path: string, body?: unknown, sub?: string, method = "POST") =>
  new Request(`https://go.hey-tiff.com/api/mobile/${path}`, {
    method,
    headers: { "content-type": "application/json", ...(sub ? { authorization: `Bearer ${mint(sub)}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const lines = async (res: Response) => (await res.text()).trim().split("\n").map((l) => JSON.parse(l));

const env = process.env;
beforeEach(() => {
  process.env = { ...env, AUTH0_DOMAIN: DOMAIN };
  asked.length = 0;
  kept.length = 0;
  readTools = true;
  members = [
    { user_id: "auth0|lyle", org_id: "org-diamond", role: "staff", permissions: {} },
    { user_id: "auth0|nobody", org_id: "org-diamond", role: "staff", permissions: { tiff: false } },
  ];
});
afterAll(() => {
  process.env = env;
});

it("answers in the web's own words for the verified person, the phone's screen for 'take me there', and nothing only the web can do", async () => {
  const res = await ask(req("tiff", { question: "When is Stanmore booked?" }, "auth0|lyle"));
  expect(res.headers.get("content-type")).toContain("application/x-ndjson");
  expect(await lines(res)).toEqual([
    { t: "tool", name: "jobs.search", label: "Looking at jobs" },
    { t: "delta", text: "Job 2935 is booked " },
    { t: "delta", text: "for Monday." },
    { t: "screen", path: "/job?id=j-2935", label: "Job 2935" },
    { t: "done" },
  ]);
  expect(asked).toEqual(["viewer org-diamond auth0|lyle", 'answer org-diamond "When is Stanmore booked?"']);
});

it("refuses without a token check, with nothing to ask about, or a question it can't read", async () => {
  expect((await ask(req("tiff", { question: "hi" }))).status).toBe(401);
  readTools = false;
  expect((await ask(req("tiff", { question: "hi" }, "auth0|lyle"))).status).toBe(403);
  readTools = true;
  expect((await ask(req("tiff", { question: "   " }, "auth0|lyle"))).status).toBe(400);
  expect(asked.filter((a) => a.startsWith("answer"))).toEqual([]);
});

it("reads and keeps the verified person's own conversations, behind tiff", async () => {
  const read = await threads(req("tiff/threads", undefined, "auth0|lyle", "GET"));
  expect(await read.json()).toEqual({ threads: [{ id: "t-1", title: "Stanmore", updatedAt: 1, messages: [] }] });
  const thread = { id: "t-2", title: "Coil", updatedAt: Date.now(), messages: [{ role: "user", text: "hi", at: Date.now() }] };
  expect((await keep(req("tiff/threads", { upsert: [thread], userSub: "auth0|someone-else" }, "auth0|lyle"))).status).toBe(200);
  expect(kept.map((k) => k.owner)).toEqual([
    { orgId: "org-diamond", userSub: "auth0|lyle" },
    { orgId: "org-diamond", userSub: "auth0|lyle" },
  ]);
  expect((await threads(req("tiff/threads", undefined, "auth0|nobody", "GET"))).status).toBe(403);
  expect((await keep(req("tiff/threads", { upsert: [{ id: "bad id!" }] }, "auth0|lyle"))).status).toBe(400);
});
