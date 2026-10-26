/**
 * @jest-environment node
 */

/* The phone's second set of reads: a job's photos and files (behind the
   board's grant, inside the member's own workspace), and the member's OWN
   card and leave (no capability, but only ever theirs: found by the token's
   user, never by an id the phone hands in). The token check is the real one;
   the loaders record what they were asked for. */

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
let cards: Record<string, string> = {};
jest.mock("@/lib/workboard/projects-query", () => ({
  staffIdFor: async (orgId: string, userId: string) => {
    asked.push(`staffId ${orgId} ${userId}`);
    return cards[`${orgId}/${userId}`] ?? null;
  },
}));
jest.mock("@/lib/workboard/all-jobs-query", () => ({
  resolveJobCard: async (orgId: string, id: string) => {
    asked.push(`resolve ${orgId} ${id}`);
    return { parentRemoteId: id === "claim-7" ? "job-3342" : id, focusRemoteId: null };
  },
  familyMediaSources: async (orgId: string, id: string) => {
    asked.push(`claims ${orgId} ${id}`);
    return [{ remoteId: "claim-7", claimNumber: "1" }];
  },
}));
jest.mock("@/lib/workboard/job-media-query", () => ({
  readJobMediaGroups: async (orgId: string, id: string, claims: unknown[]) => {
    asked.push(`media ${orgId} ${id} +${claims.length}`);
    return { photos: [{ remoteId: "p1", url: "https://signed/p1" }], documents: [], elsewhere: [], truncated: false };
  },
}));
jest.mock("@/lib/org/query", () => ({ orgExpiryWindow: async () => ({ warnDays: 30, email: false }) }));
jest.mock("@/lib/staff/query", () => ({
  getStaff: async (orgId: string, staffId: string, opts: unknown, warnDays: number) => {
    asked.push(`staff ${orgId} ${staffId} ${JSON.stringify(opts)} ${warnDays}`);
    return {
      row: { name: "Lyle Irving", initials: "LI", role: "Lead technician", employmentType: "Full time", started: "4 March 2021", years: "5 years", status: "Active", compliance: { label: "Current", state: "ok", expiresDays: 200 }, email: "lyle@example.com" },
      profile: { phone: "0400 000 000", birthday: "1994-05-02", state: "NSW", emergency_name: "Jess Irving", emergency_relationship: "Partner", emergency_phone: "0400 765 432", emergency_alt_phone: "  ", hourly_wage: 99 },
      licences: [{ id: "l1", typeName: "ARC refrigerant handling", licenceNumber: "L123", expiryDate: "2027-01-01", color: null }],
    };
  },
}));
jest.mock("@/lib/fleet/query", () => ({
  getOwnVehicle: async () => ({ name: "", make: "Toyota", model: "Hiace", plate: "XQG 41B", plateState: "NSW", odometer: 1 }),
}));
jest.mock("@/lib/au-dates", () => ({ todayInAu: () => "2026-10-26" }));
jest.mock("@/lib/timepay/leave-page", () => ({
  loadLeaveFor: async (ctx: { orgId: string; staffId: string; today: string }) => {
    asked.push(`leave ${ctx.orgId} ${ctx.staffId} ${ctx.today}`);
    return { today: ctx.today, balances: [], requests: [], holidays: [] };
  },
}));

import { GET as media } from "../jobs/[id]/media/route";
import { GET as card } from "../card/route";
import { GET as leave } from "../leave/route";
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
    { user_id: "auth0|otto", org_id: "org-other", role: "owner", permissions: {} },
  ];
  cards = { "org-diamond/auth0|lyle": "card-lyle", "org-other/auth0|otto": "card-otto" };
});
afterAll(() => {
  process.env = env;
});

describe("refused before anything is read", () => {
  test.each([
    ["photos", () => media(req("jobs/job-3342/media"), params("job-3342"))],
    ["card", () => card(req("card"))],
    ["leave", () => leave(req("leave"))],
  ] as const)("%s without a token is a 401", async (_n, go) => {
    expect((await go()).status).toBe(401);
    expect(asked).toEqual([]);
  });

  test("another business's workspace is refused for each", async () => {
    expect((await media(req("jobs/otto-job/media", "auth0|lyle", "org-other"), params("otto-job"))).status).toBe(403);
    expect((await card(req("card", "auth0|lyle", "org-other"))).status).toBe(403);
    expect((await leave(req("leave", "auth0|lyle", "org-other"))).status).toBe(403);
    expect(asked).toEqual([]);
  });

  test("the photos need the board; your own card and leave don't", async () => {
    members[0]!.permissions = { workboard: false };
    expect((await media(req("jobs/job-3342/media", "auth0|lyle"), params("job-3342"))).status).toBe(403);
    expect((await card(req("card", "auth0|lyle"))).status).toBe(200);
    expect((await leave(req("leave", "auth0|lyle"))).status).toBe(200);
  });
});

test("a job's photos are read in the member's workspace, a claim's with its job", async () => {
  const body = await (await media(req("jobs/claim-7/media", "auth0|lyle"), params("claim-7"))).json();
  expect(body.photos).toEqual([{ remoteId: "p1", url: "https://signed/p1" }]);
  expect(asked).toEqual(["resolve org-diamond claim-7", "claims org-diamond job-3342", "media org-diamond job-3342 +1"]);
});

test("your card is your own, without pay or notes, with your vehicle", async () => {
  const body = await (await card(req("card", "auth0|lyle"))).json();
  expect(asked).toEqual(["staffId org-diamond auth0|lyle", 'staff org-diamond card-lyle {"pay":false,"notes":false} 30']);
  expect(body).toMatchObject({
    name: "Lyle Irving",
    title: "Lead technician",
    phone: "0400 000 000",
    state: "NSW",
    emergency: { name: "Jess Irving", relationship: "Partner", phone: "0400 765 432", altPhone: null },
    vehicle: { make: "Toyota", model: "Hiace", plate: "XQG 41B", plateState: "NSW", name: null },
  });
  expect(JSON.stringify(body)).not.toContain("hourly_wage");
});

test("your leave is read for your own card, today in Australia", async () => {
  expect((await leave(req("leave", "auth0|lyle"))).status).toBe(200);
  expect(asked).toEqual(["staffId org-diamond auth0|lyle", "leave org-diamond card-lyle 2026-10-26"]);
});

test("someone with no staff card in the workspace is told so, for the card and the leave", async () => {
  cards = {};
  expect((await card(req("card", "auth0|lyle"))).status).toBe(404);
  expect((await leave(req("leave", "auth0|lyle"))).status).toBe(404);
});
