/**
 * @jest-environment node
 */

/* The phone's routes read only for a signed-in member, only inside their own
   workspace, and only what their capabilities allow. The token check is the
   real one (a test key stands in for the tenant's); the memberships are a
   stand-in table and the loaders record what they were asked for, so a test
   can see that a refused call never reached them and an allowed one read the
   member's own workspace. */

import { generateKeyPairSync, sign } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
jest.mock("@/lib/mobile/token", () => ({
  ...jest.requireActual("@/lib/mobile/token"),
  tenantKeys: () => async (kid: string) => (kid === "k1" ? publicKey : null),
}));

type Row = { user_id: string; org_id: string; role: string | null; permissions: unknown };
let members: Row[] = [];
jest.mock("@/lib/supabase-server", () => {
  const table = (name: string) => {
    const f: Record<string, unknown> = {};
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => ((f[c] = v), q),
      in: (c: string, v: unknown) => ((f[c] = v), q),
      order: () => q,
      maybeSingle: async () => ({
        data: name === "staff_profiles" ? { id: `card-${f.user_id}`, full_name: "Lyle Irving" } : null,
        error: null,
      }),
      then: (res: (v: unknown) => unknown) => {
        if (name === "memberships") return res({ data: members.filter((m) => m.user_id === f.user_id), error: null });
        if (name === "organizations")
          return res({ data: (f.id as string[]).map((id) => ({ id, trading_name: `Trading ${id}` })), error: null });
        return res({ data: [], error: null });
      },
    };
    return q;
  };
  return { supabaseAdmin: { from: table } };
});

const asked: string[] = [];
jest.mock("@/lib/workboard/schedule-query", () => ({
  loadScheduleDay: async (orgId: string, day: string, opts: unknown) => {
    asked.push(`schedule ${orgId} ${day} ${JSON.stringify(opts)}`);
    return { dayISO: day, activities: [], staff: [], jobs: [], onSite: [], addresses: {} };
  },
}));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: async () => "Australia/Sydney" }));
jest.mock("@/lib/workboard/dates", () => ({ todayInZone: () => "2026-10-26" }));
jest.mock("@/lib/workboard/all-jobs-query", () => ({
  searchAllMirrorJobs: async (orgId: string, q: string, today: string, opts: unknown) => {
    asked.push(`search ${orgId} "${q}" ${today} ${JSON.stringify(opts)}`);
    return [];
  },
  resolveJobCard: async (orgId: string, id: string) => {
    asked.push(`resolve ${orgId} ${id}`);
    return { parentRemoteId: id === "claim-7" ? "job-3342" : id, focusRemoteId: id === "claim-7" ? id : null };
  },
  readMirrorJobDetail: async (orgId: string, id: string, _today: string, opts: unknown) => {
    asked.push(`detail ${orgId} ${id} ${JSON.stringify(opts)}`);
    return id === "gone" ? null : { uuid: id };
  },
  familyMediaSources: async () => [{ remoteId: "claim-7", claimNumber: "1" }],
  readJobNotes: async (orgId: string, id: string, claims: unknown[]) => {
    asked.push(`notes ${orgId} ${id} +${claims.length}`);
    return [{ text: "Both outdoor units up" }];
  },
}));
jest.mock("@/lib/workboard/job-notes-query", () => ({
  readOurJobNotes: async (orgId: string, id: string) => {
    asked.push(`ours ${orgId} ${id}`);
    return [{ id: "n1", text: "Pipe run is 14 m", at: "2026-10-26 09:12:00", author: "Lyle Irving" }];
  },
}));
jest.mock("@/lib/integrations/links", () => ({
  sm8StaffLinkMap: async () => new Map([["sm8-lyle", "card-auth0|lyle"]]),
}));

import { GET as me } from "../me/route";
import { GET as schedule } from "../schedule/route";
import { GET as jobs } from "../jobs/route";
import { GET as job } from "../jobs/[id]/route";
import { MOBILE_AUDIENCE } from "@/lib/mobile/token";

const DOMAIN = "tenant.example.auth0.com";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string) => {
  const h = b64({ alg: "RS256", kid: "k1" });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};
const req = (path: string, sub?: string, org?: string) =>
  new Request(`https://go.hey-tiff.com/api/mobile/${path}`, {
    headers: { ...(sub ? { authorization: `Bearer ${mint(sub)}` } : {}), ...(org ? { "x-heytiff-org": org } : {}) },
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const env = process.env;
beforeEach(() => {
  process.env = { ...env, AUTH0_DOMAIN: DOMAIN };
  asked.length = 0;
  members = [
    { user_id: "auth0|lyle", org_id: "org-diamond", role: "staff", permissions: {} },
    { user_id: "auth0|isaac", org_id: "org-diamond", role: "owner", permissions: {} },
    { user_id: "auth0|otto", org_id: "org-other", role: "owner", permissions: {} },
  ];
});
afterAll(() => {
  process.env = env;
});

describe("refused before anything is read", () => {
  const calls: [string, () => Promise<Response>][] = [
    ["me", () => me(req("me"))],
    ["schedule", () => schedule(req("schedule?day=2026-10-26"))],
    ["jobs", () => jobs(req("jobs?q=rifkin"))],
    ["a job", () => job(req("jobs/job-3342"), params("job-3342"))],
  ];
  test.each(calls)("%s without a token is a 401", async (_n, go) => {
    const res = await go();
    expect([res.status, res.headers.get("cache-control")]).toEqual([401, "no-store"]);
    expect(asked).toEqual([]);
  });

  test("another business's workspace, named by its job's id, is refused: Lyle can't read Otto's job", async () => {
    const res = await job(req("jobs/otto-job", "auth0|lyle", "org-other"), params("otto-job"));
    expect(res.status).toBe(403);
    expect(asked).toEqual([]);
  });

  test("the schedule and the search refuse another workspace the same way", async () => {
    expect((await schedule(req("schedule?day=2026-10-26", "auth0|lyle", "org-other"))).status).toBe(403);
    expect((await jobs(req("jobs?q=a", "auth0|lyle", "org-other"))).status).toBe(403);
    expect(asked).toEqual([]);
  });

  test("someone whose board access was taken away is refused the board's reads", async () => {
    members[0]!.permissions = { workboard: false };
    expect((await schedule(req("schedule?day=2026-10-26", "auth0|lyle"))).status).toBe(403);
    expect((await jobs(req("jobs?q=a", "auth0|lyle"))).status).toBe(403);
    expect((await job(req("jobs/job-3342", "auth0|lyle"), params("job-3342"))).status).toBe(403);
    expect(asked).toEqual([]);
  });
});

test("/me says who, which workspace, what they may do and which ServiceM8 person they are", async () => {
  const body = await (await me(req("me", "auth0|lyle"))).json();
  expect(body).toMatchObject({
    userId: "auth0|lyle",
    name: "Lyle Irving",
    staffId: "card-auth0|lyle",
    sm8StaffUuid: "sm8-lyle",
    role: "staff",
    org: { id: "org-diamond", name: "Trading org-diamond" },
    orgs: [{ id: "org-diamond", name: "Trading org-diamond" }],
  });
  expect(body.capabilities).toContain("workboard");
  expect(body.capabilities).not.toContain("workboard_money");
});

test("the schedule reads the member's own workspace's day, with who's off", async () => {
  const res = await schedule(req("schedule?day=2026-10-26", "auth0|lyle"));
  expect(res.status).toBe(200);
  expect(asked).toEqual(['schedule org-diamond 2026-10-26 {"away":true}']);
});

test("a day that isn't a bare date is a 400 that never reaches the diary", async () => {
  for (const day of ["", "26/10/2026", "2026-10-26' or 1=1", "2026-10-26T00:00"]) {
    expect((await schedule(req(`schedule?day=${encodeURIComponent(day)}`, "auth0|lyle"))).status).toBe(400);
  }
  expect(asked).toEqual([]);
});

test("the search carries money only for someone who holds it", async () => {
  await jobs(req("jobs?q=rifkin", "auth0|lyle"));
  await jobs(req("jobs?q=rifkin", "auth0|isaac"));
  expect(asked).toEqual([
    'search org-diamond "rifkin" 2026-10-26 {"includeMoney":false}',
    'search org-diamond "rifkin" 2026-10-26 {"includeMoney":true}',
  ]);
});

test("a job is read in the member's workspace, a claim opens its job, and money and designs follow the grants", async () => {
  const body = await (await job(req("jobs/claim-7", "auth0|lyle"), params("claim-7"))).json();
  expect(body).toEqual({
    detail: { uuid: "job-3342" },
    notes: [{ text: "Both outdoor units up" }],
    ourNotes: [{ id: "n1", text: "Pipe run is 14 m", at: "2026-10-26 09:12:00", author: "Lyle Irving" }],
    focusRemoteId: "claim-7",
  });
  expect(asked).toEqual([
    "resolve org-diamond claim-7",
    'detail org-diamond job-3342 {"includeMoney":false,"includeDesigns":true,"timezone":"Australia/Sydney"}',
    "notes org-diamond job-3342 +1",
    "ours org-diamond job-3342",
  ]);
});

test("a job the workspace doesn't hold is a 404", async () => {
  expect((await job(req("jobs/gone", "auth0|isaac"), params("gone"))).status).toBe(404);
});
