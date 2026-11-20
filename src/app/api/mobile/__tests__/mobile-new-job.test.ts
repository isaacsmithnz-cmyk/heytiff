/**
 * @jest-environment node
 */

/* The phone's New › Job (Isaac, 20 November 2026: "Yes, build it" to
   https://claude.ai/artifact/JLF86oYMASuBt4gKDRr1VR), behind the real token
   check: only for someone who runs the board, nothing at all where new jobs
   don't go, and every read and Create the web form's own action, run as the
   phone's own person. Drawn on JT Construct: 13 sites, Unit 41 at Mackillop
   Grange. The actions are stand-ins that record who asked. */

import { generateKeyPairSync, sign } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
jest.mock("@/lib/mobile/token", () => ({
  ...jest.requireActual("@/lib/mobile/token"),
  tenantKeys: () => async (kid: string) => (kid === "k1" ? publicKey : null),
}));

type Row = { user_id: string; org_id: string; role: string | null; permissions: unknown };
let members: Row[] = [];
let mirror: { uuid: string; generated_job_id: string }[] = [];
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (name: string) => {
      const f: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => ((f[c] = v), q),
        order: () => q,
        maybeSingle: async () => ({ data: name === "sm8_jobs" ? (mirror.find((m) => m.uuid === f.uuid && f.org_id === "org-diamond") ?? null) : null, error: null }),
        then: (res: (v: unknown) => unknown) => res({ data: members.filter((m) => m.user_id === f.user_id), error: null }),
      };
      return q;
    },
  },
}));
jest.mock("server-only", () => ({}));
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: async () => null } }));

let offered = true;
jest.mock("@/lib/workboard/new-job-offer", () => ({ newJobOffered: async () => offered }));

/* who the web's code would think is signed in, as each action is run */
import { phoneSession } from "@/lib/phone-session";
const asked: string[] = [];
const as = () => `${phoneSession()?.orgId}/${phoneSession()?.user.sub}`;
const JT = { uuid: "11111111-1111-4111-8111-111111111111", name: "JT Construct", address: null, sites: 13, contacts: [{ name: "Josh Terrett", mobile: null, phone: null, email: null }] };
const UNIT41 = { uuid: "22222222-2222-4222-8222-222222222222", name: "41/28 Mackillop Grange", address: "Unit 41/28 Wudgong St,\nMosman NSW 2088", parentName: "JT Construct", lastJob: null };
const created = jest.fn();
jest.mock("@/app/actions/job-new", () => ({
  searchNewJobClients: async (q: string) => (asked.push(`clients "${q}" as ${as()}`), [JT]),
  searchClientSites: async (p: string, q: string) => (asked.push(`sites ${p} "${q}" as ${as()}`), [UNIT41]),
  matchPreviousSite: async (a: string) => (asked.push(`match "${a}" as ${as()}`), null),
  readNewJobCategories: async () => (asked.push(`kinds as ${as()}`), [{ uuid: "33333333-3333-4333-8333-333333333333", name: "Install", colour: null }]),
  nearNewJobSite: async (lat: number, lng: number) => (asked.push(`near ${lat},${lng} as ${as()}`), { client: JT, site: UNIT41 }),
  createNewJob: async (input: unknown) => {
    asked.push(`create as ${as()}`);
    created(input);
    return { ok: true, rowId: "w1", jobUuid: "44444444-4444-4444-8444-444444444444", sm8Url: null, line: { state: "in", words: "In ServiceM8 as job 3531.", number: "3531" } };
  },
}));

import { GET, POST } from "../jobs/new/route";
import { MOBILE_AUDIENCE } from "@/lib/mobile/token";

const DOMAIN = "tenant.example.auth0.com";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string) => {
  const h = b64({ alg: "RS256", kid: "k1" });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};
const req = (query: string, sub: string | null) => new Request(`https://go.hey-tiff.com/api/mobile/jobs/new${query}`, { headers: sub ? { authorization: `Bearer ${mint(sub)}` } : {} });
const post = (sub: string | null, body: unknown) =>
  new Request("https://go.hey-tiff.com/api/mobile/jobs/new", {
    method: "POST",
    headers: { "content-type": "application/json", ...(sub ? { authorization: `Bearer ${mint(sub)}` } : {}) },
    body: JSON.stringify(body),
  });

const env = process.env;
beforeEach(() => {
  process.env = { ...env, AUTH0_DOMAIN: DOMAIN };
  members = [
    { user_id: "auth0|isaac", org_id: "org-diamond", role: "owner", permissions: {} },
    { user_id: "auth0|lyle", org_id: "org-diamond", role: "staff", permissions: {} },
  ];
  mirror = [];
  offered = true;
  asked.length = 0;
  created.mockClear();
});
afterAll(() => {
  process.env = env;
});

const PRESS = "55555555-5555-4555-8555-555555555555";
const BODY = {
  pressId: PRESS,
  clientName: "JT Construct",
  client: { kind: "existing", uuid: UNIT41.uuid },
  jobAddress: UNIT41.address,
  description: "Unit 41 wants the same ducted system as 34.",
  categoryUuid: "33333333-3333-4333-8333-333333333333",
  contact: { first: "Josh", last: "Terrett", mobile: "", email: "" },
  via: "an existing customer",
};

test("without a token, or without running the board, nothing is read or made", async () => {
  expect((await GET(req("?start=1", null))).status).toBe(401);
  expect((await POST(post(null, BODY))).status).toBe(401);
  expect((await GET(req("?q=jt", "auth0|lyle"))).status).toBe(403);
  expect((await POST(post("auth0|lyle", BODY))).status).toBe(403);
  expect(asked).toEqual([]);
});

test("where new jobs don't go, the start says so and reads nothing else", async () => {
  offered = false;
  const body = await (await GET(req("?start=1&near=-33.83,151.24", "auth0|isaac"))).json();
  expect(body).toMatchObject({ offered: false, categories: [], here: null });
  expect(body.why).toMatch(/switched off/);
  expect(asked).toEqual([]);
});

test("the start: the kinds and the site you're standing at, read as the phone's own person", async () => {
  const body = await (await GET(req("?start=1&near=-33.8301,151.2442", "auth0|isaac"))).json();
  expect(body.offered).toBe(true);
  expect(body.categories).toEqual([{ uuid: "33333333-3333-4333-8333-333333333333", name: "Install", colour: null }]);
  expect(body.here).toEqual({ client: JT, site: UNIT41 });
  expect(asked).toEqual(["kinds as org-diamond/auth0|isaac", "near -33.8301,151.2442 as org-diamond/auth0|isaac"]);
});

test("a place that isn't a place is never looked for", async () => {
  const body = await (await GET(req("?start=1&near=nowhere", "auth0|isaac"))).json();
  expect(body.here).toBeNull();
  expect(asked).toEqual(["kinds as org-diamond/auth0|isaac"]);
});

test("customers, a builder's sites and a previous site, each the web form's own", async () => {
  expect((await (await GET(req("?q=jt", "auth0|isaac"))).json()).clients).toEqual([JT]);
  expect((await (await GET(req(`?sites=${JT.uuid}&q=41`, "auth0|isaac"))).json()).sites).toEqual([UNIT41]);
  expect((await (await GET(req("?match=9%2F6%20Holbrook%20Ave", "auth0|isaac"))).json()).match).toBeNull();
  expect((await GET(req("?sites=not-a-uuid", "auth0|isaac"))).status).toBe(400);
  expect(asked).toEqual([`clients "jt" as org-diamond/auth0|isaac`, `sites ${JT.uuid} "41" as org-diamond/auth0|isaac`, `match "9/6 Holbrook Ave" as org-diamond/auth0|isaac`]);
});

test("Create job is the web's createNewJob with the form's words, as the phone's person", async () => {
  const res = await POST(post("auth0|isaac", BODY));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ jobUuid: "44444444-4444-4444-8444-444444444444", state: "in", words: "In ServiceM8 as job 3531.", number: "3531" });
  expect(asked).toEqual(["create as org-diamond/auth0|isaac"]);
  expect(created).toHaveBeenCalledWith({
    pressId: PRESS,
    clientName: "JT Construct",
    client: { kind: "existing", uuid: UNIT41.uuid },
    jobAddress: UNIT41.address,
    description: "Unit 41 wants the same ducted system as 34.",
    categoryUuid: "33333333-3333-4333-8333-333333333333",
    contact: { first: "Josh", last: "Terrett", mobile: "", phone: "", email: "" },
    via: "an existing customer",
    next: null,
  });
});

test("a body that isn't a job never reaches Create", async () => {
  expect((await POST(post("auth0|isaac", { ...BODY, pressId: "twice" }))).status).toBe(400);
  expect((await POST(post("auth0|isaac", { ...BODY, client: { kind: "existing", uuid: "x" } }))).status).toBe(400);
  expect((await POST(post("auth0|isaac", { ...BODY, client: { kind: "new", name: "  " } }))).status).toBe(400);
  expect(asked).toEqual([]);
});

test("whether the mirror holds the new job yet, in the caller's own workspace", async () => {
  const id = "44444444-4444-4444-8444-444444444444";
  expect(await (await GET(req(`?landed=${id}`, "auth0|isaac"))).json()).toEqual({ landed: false, number: null });
  mirror = [{ uuid: id, generated_job_id: "3531" }];
  expect(await (await GET(req(`?landed=${id}`, "auth0|isaac"))).json()).toEqual({ landed: true, number: "3531" });
});
