/**
 * @jest-environment node
 */

/* Site notes from the phone: the web's own actions (recorded here), behind
   the real token check and the job card's gate, `workboard`, run as the
   token's person through the real session wrapper — never the browser's,
   and never without a token. A write answers with the read again. */

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

const did: string[] = [];
const who = async () => {
  const { auth0 } = jest.requireActual("@/lib/auth0") as typeof import("@/lib/auth0");
  const s = await auth0.getSession();
  return `${s?.user.sub}@${s?.orgId}`;
};
const READ = {
  noSite: false,
  street: "12 Example Street",
  place: "Sampleton NSW 2000",
  unit: "2",
  notes: [{ id: "n-1", kind: "access", words: "Lockbox 1234", unit: null, by: "Sam Lee", when: "9 Nov", job: { uuid: "job-1", number: "100" }, video: null }],
  jobs: [{ uuid: "job-2", number: "101", title: "Unit 4: Service", line: "Done 2 Feb", open: false }],
  videos: [{ ref: "doc:v1", name: "Video, 9 Nov" }],
};
jest.mock("@/app/actions/site-notes", () => ({
  readSiteNotes: async (job: string) => (did.push(`read ${job} as ${await who()}`), job === "job-1" ? READ : null),
  readSiteNoteCount: async (job: string) => (did.push(`count ${job} as ${await who()}`), job === "job-1" ? 1 : null),
  addSiteNote: async (i: { jobUuid: string; kind: unknown; words: unknown; whole: unknown; video?: unknown }) => (
    did.push(`add ${i.jobUuid} ${String(i.kind)} "${String(i.words)}" whole=${String(i.whole)} video=${String(i.video)} as ${await who()}`),
    i.kind === "access" ? { ok: true, id: "n-2" } : { ok: false, error: "Choose what kind of note it is." }
  ),
  changeSiteNote: async (i: { jobUuid: string; id: string; words: unknown }) => (did.push(`change ${i.jobUuid} ${i.id} "${String(i.words)}" as ${await who()}`), { ok: true, id: "n-3" }),
  removeSiteNote: async (i: { jobUuid: string; id: string }) => (did.push(`remove ${i.jobUuid} ${i.id} as ${await who()}`), { ok: true, id: i.id }),
}));

import { DELETE, GET, PATCH, POST } from "../site-notes/route";
import { MOBILE_AUDIENCE } from "@/lib/mobile/token";

const DOMAIN = "tenant.example.auth0.com";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string) => {
  const h = b64({ alg: "RS256", kid: "k1" });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};
const req = (sub: string | null, method: string, query = "", body?: unknown) =>
  new Request(`https://go.hey-tiff.com/api/mobile/site-notes${query}`, {
    method,
    headers: { ...(sub ? { authorization: `Bearer ${mint(sub)}` } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const env = process.env;
beforeEach(() => {
  process.env = { ...env, AUTH0_DOMAIN: DOMAIN };
  did.length = 0;
  members = [{ user_id: "auth0|sam", org_id: "org-1", role: "staff", permissions: {} }];
});
afterAll(() => {
  process.env = env;
});

test("no token, nothing read or kept", async () => {
  expect((await GET(req(null, "GET", "?job=job-1"))).status).toBe(401);
  expect((await POST(req(null, "POST", "", { job: "job-1", kind: "access", words: "Gate 1234" }))).status).toBe(401);
  expect((await DELETE(req(null, "DELETE", "?job=job-1&id=n-1"))).status).toBe(401);
  expect(did).toEqual([]);
});

test("someone without the job card's gate is refused, loudly", async () => {
  members = [{ user_id: "auth0|sam", org_id: "org-1", role: "staff", permissions: { workboard: false } }];
  expect((await GET(req("auth0|sam", "GET", "?job=job-1"))).status).toBe(403);
  expect((await PATCH(req("auth0|sam", "PATCH", "", { job: "job-1", id: "n-1", kind: "access", words: "x" }))).status).toBe(403);
  expect(did).toEqual([]);
});

test("reads the job's site as the token's own person, and its count", async () => {
  const res = await GET(req("auth0|sam", "GET", "?job=job-1"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(READ);
  expect(await (await GET(req("auth0|sam", "GET", "?job=job-1&count=1"))).json()).toEqual({ count: 1 });
  expect((await GET(req("auth0|sam", "GET", "?job=elsewhere"))).status).toBe(404);
  expect((await GET(req("auth0|sam", "GET", "?job=elsewhere&count=1"))).status).toBe(404);
  expect((await GET(req("auth0|sam", "GET"))).status).toBe(400);
  expect(did).toEqual(["read job-1 as auth0|sam@org-1", "count job-1 as auth0|sam@org-1", "read elsewhere as auth0|sam@org-1", "count elsewhere as auth0|sam@org-1"]);
});

test("adds, changes and removes as them, each answered with the read again", async () => {
  const added = await POST(req("auth0|sam", "POST", "", { job: "job-1", kind: "access", words: "Gate 1234", whole: false, video: "doc:v1" }));
  expect(added.status).toBe(200);
  expect(await added.json()).toEqual({ id: "n-2", site: READ });

  const bad = await POST(req("auth0|sam", "POST", "", { job: "job-1", kind: "nope", words: "Gate 1234" }));
  expect(bad.status).toBe(400);
  expect(await bad.json()).toEqual({ error: "Choose what kind of note it is." });

  expect(await (await PATCH(req("auth0|sam", "PATCH", "", { job: "job-1", id: "n-1", kind: "access", words: "Lockbox 5678" }))).json()).toEqual({ id: "n-3", site: READ });
  expect(await (await DELETE(req("auth0|sam", "DELETE", "?job=job-1&id=n-1"))).json()).toEqual({ id: "n-1", site: READ });

  expect(did).toEqual([
    'add job-1 access "Gate 1234" whole=false video=doc:v1 as auth0|sam@org-1',
    "read job-1 as auth0|sam@org-1",
    'add job-1 nope "Gate 1234" whole=undefined video=undefined as auth0|sam@org-1',
    'change job-1 n-1 "Lockbox 5678" as auth0|sam@org-1',
    "read job-1 as auth0|sam@org-1",
    "remove job-1 n-1 as auth0|sam@org-1",
    "read job-1 as auth0|sam@org-1",
  ]);
});

test("a write names its job and its note", async () => {
  expect((await POST(req("auth0|sam", "POST", "", { kind: "access", words: "Gate 1234" }))).status).toBe(400);
  expect((await PATCH(req("auth0|sam", "PATCH", "", { job: "job-1", kind: "access", words: "x" }))).status).toBe(400);
  expect((await DELETE(req("auth0|sam", "DELETE", "?job=job-1"))).status).toBe(400);
  expect(did).toEqual([]);
});
