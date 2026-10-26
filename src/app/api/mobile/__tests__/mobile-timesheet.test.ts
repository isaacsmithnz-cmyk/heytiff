/**
 * @jest-environment node
 */

/* The phone's timesheet: only ever the member's own (found by the token's
   user, no id handed in), read by the page's own loader, and worked out with
   the page's own rules so the phone only draws. The token check is real; the
   loader is a stand-in that records what it was asked for; derive and
   dayClass are the real ones. */

import { generateKeyPairSync, sign } from "node:crypto";
import { DEFAULT_SETTINGS } from "@/components/timepay/logic";

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
jest.mock("@/lib/workboard/projects-query", () => ({
  staffIdFor: async (orgId: string, userId: string) => (orgId === "org-diamond" && userId === "auth0|lyle" ? "card-lyle" : null),
}));
jest.mock("@/lib/au-dates", () => ({ todayInAu: () => "2026-10-28" }));
jest.mock("@/lib/timepay/query", () => ({ getPaySettings: async () => ({ settings: DEFAULT_SETTINGS, configured: true }) }));
let subbie = false;
jest.mock("@/lib/timepay/page-data", () => ({
  loadTimesheetFor: async (ctx: { orgId: string; staffId: string; today: string }, _s: unknown, requested?: string) => {
    asked.push(`timesheet ${ctx.orgId} ${ctx.staffId} ${ctx.today} ${requested ?? "current"}`);
    if (subbie) return { subcontractor: true };
    return {
      me: {
        id: ctx.staffId,
        name: "Lyle Irving",
        role: "Lead technician",
        rate: null,
        days: [
          { t: "work", in: "07:00", out: "15:30", h: 8 },
          { t: "work", in: "07:00", out: "16:30", h: 9 },
          { t: "empty" },
          { t: "empty" },
          { t: "empty" },
          { t: "empty" },
          { t: "empty" },
        ],
        dayHours: 8,
        holidayDays: [],
        certMissing: [],
      },
      sources: ["entered", "entered", null, null, null, null, null],
      workDays: [0, 1, 2, 3, 4],
      through: 1,
      week: [
        ["MON", 26, "Oct"],
        ["TUE", 27, "Oct"],
        ["WED", 28, "Oct"],
        ["THU", 29, "Oct"],
        ["FRI", 30, "Oct"],
        ["SAT", 31, "Oct"],
        ["SUN", 1, "Nov"],
      ],
      today: 2,
      todayISO: ctx.today,
      periodStart: "2026-10-26",
      periodEnd: "2026-11-01",
      periods: [{ start: "2026-10-26", range: "26 Oct – 1 Nov", year: 2026, live: true, note: "" }],
      periodIndex: 0,
      sheet: { status: "draft" },
      pastSend: false,
    };
  },
}));

import { GET } from "../timesheet/route";
import { MOBILE_AUDIENCE } from "@/lib/mobile/token";

const DOMAIN = "tenant.example.auth0.com";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string) => {
  const h = b64({ alg: "RS256", kid: "k1" });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};
const req = (qs: string, sub?: string, org?: string) =>
  new Request(`https://go.hey-tiff.com/api/mobile/timesheet${qs}`, {
    headers: { ...(sub ? { authorization: `Bearer ${mint(sub)}` } : {}), ...(org ? { "x-heytiff-org": org } : {}) },
  });

const env = process.env;
beforeEach(() => {
  process.env = { ...env, AUTH0_DOMAIN: DOMAIN };
  asked.length = 0;
  subbie = false;
  members = [
    { user_id: "auth0|lyle", org_id: "org-diamond", role: "staff", permissions: {} },
    { user_id: "auth0|otto", org_id: "org-other", role: "owner", permissions: {} },
  ];
});
afterAll(() => {
  process.env = env;
});

test("without a token, or naming another business's workspace, nothing is read", async () => {
  expect((await GET(req(""))).status).toBe(401);
  expect((await GET(req("", "auth0|lyle", "org-other"))).status).toBe(403);
  expect(asked).toEqual([]);
});

test("someone with no staff card here is told so", async () => {
  expect((await GET(req("", "auth0|otto"))).status).toBe(404);
  expect(asked).toEqual([]);
});

test("your own week, the period asked for, today in Australia, worked out by the page's rules", async () => {
  const res = await GET(req("?period=2026-10-26", "auth0|lyle"));
  expect(res.status).toBe(200);
  expect(asked).toEqual(["timesheet org-diamond card-lyle 2026-10-28 2026-10-26"]);
  const body = await res.json();
  expect(body.period).toEqual({ start: "2026-10-26", end: "2026-11-01", range: "26 Oct – 1 Nov", live: true });
  expect(body.status).toBe("draft");
  expect(body.days.slice(0, 3).map((d: { date: string; word: string }) => [d.date, d.word])).toEqual([
    ["2026-10-26", "Normal"],
    ["2026-10-27", "Overtime"],
    ["2026-10-28", "No entry"],
  ]);
  expect(body.totals.worked).toBe(17);
});

test("without a period it's the current one", async () => {
  await GET(req("", "auth0|lyle"));
  expect(asked).toEqual(["timesheet org-diamond card-lyle 2026-10-28 current"]);
});

test("a subcontractor has no timesheet, and is told so plainly", async () => {
  subbie = true;
  expect(await (await GET(req("", "auth0|lyle"))).json()).toEqual({ subcontractor: true });
});
