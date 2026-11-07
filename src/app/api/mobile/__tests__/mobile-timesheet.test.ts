/**
 * @jest-environment node
 */

/* The phone's timesheet: only ever the member's own (found by the token's
   user, no id handed in), read by the page's own loader, and worked out with
   the page's own rules so the phone only draws. The token check is real; the
   loader is a stand-in that records what it was asked for; derive and
   dayClass are the real ones. Changing it is the page's own saveDay and
   submitWeek (recorded here), run as the token's own person through the real
   lib/auth0 over a stand-in SDK whose browser session is nobody's phone. */

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
jest.mock("server-only", () => ({}));
jest.mock("@auth0/nextjs-auth0/server", () => ({
  Auth0Client: class {
    async getSession() {
      return { user: { sub: "auth0|browser" }, orgId: "org-browser" };
    }
  },
}));
const as = async () => {
  const { auth0 } = jest.requireActual("@/lib/auth0") as typeof import("@/lib/auth0");
  const s = await auth0.getSession();
  return `${s?.user.sub}@${s?.orgId}`;
};
let refuse: string | null = null;
jest.mock("@/app/actions/timepay", () => ({
  saveDay: async (period: string, index: number, entry: unknown) => {
    asked.push(`save as ${await as()}: ${period} day ${index} ${JSON.stringify(entry)}`);
    return refuse ? { ok: false, error: refuse } : { ok: true };
  },
  submitWeek: async (period: string) => {
    asked.push(`send as ${await as()}: ${period}`);
    return { ok: true };
  },
}));
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
      normal: { start: "7:00 AM", end: "3:00 PM" },
      holidays: [],
      employment: "permanent",
      salaried: false,
    };
  },
}));

import { GET, POST } from "../timesheet/route";
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
  refuse = null;
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
  /* hourly here; a salaried person whose overtime is inside the salary sees Worked and Paid side by side */
  expect(body.pay).toEqual({ salaried: false, otPaid: DEFAULT_SETTINGS.salariedOtPaid });
});

test("without a period it's the current one", async () => {
  await GET(req("", "auth0|lyle"));
  expect(asked).toEqual(["timesheet org-diamond card-lyle 2026-10-28 current"]);
});

test("a subcontractor has no timesheet, and is told so plainly", async () => {
  subbie = true;
  expect(await (await GET(req("", "auth0|lyle"))).json()).toEqual({ subcontractor: true });
});

test("the week says what the page says beside Send, and what each day is", async () => {
  const body = await (await GET(req("", "auth0|lyle"))).json();
  expect(body.sheet).toEqual({
    label: "Draft",
    sub: "Send this week once Fri 30 Oct is over. If you don't, it sends itself Sun 3:00 PM and locks.",
    canSend: false,
    sendWord: "Send week",
    locked: false,
  });
  expect(body.days[0]).toEqual(expect.objectContaining({ note: "You logged this day.", expected: true, over: true, holiday: null }));
  expect(body.days[5]).toEqual(expect.objectContaining({ expected: false, over: false }));
  expect(body.week).toEqual({ workDays: [0, 1, 2, 3, 4], dayHours: 8, holidays: [] });
});

const post = (body: unknown, sub?: string) =>
  POST(
    new Request("https://go.hey-tiff.com/api/mobile/timesheet", {
      method: "POST",
      headers: { ...(sub ? { authorization: `Bearer ${mint(sub)}` } : {}), "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );

test("without a token nothing is saved or sent", async () => {
  expect((await post({ do: "send", period: "2026-10-26" })).status).toBe(401);
  expect(asked).toEqual([]);
});

test("a day is saved AS the token's own person, never the browser's, with its hours worked out from the clocks", async () => {
  const r = await post({ do: "day", period: "2026-10-26", index: 0, entry: { t: "work", in: "7:00 AM", out: "3:30 PM", h: 24 } }, "auth0|lyle");
  expect(r.status).toBe(200);
  expect(asked).toEqual(['save as auth0|lyle@org-diamond: 2026-10-26 day 0 {"t":"work","in":"7:00 AM","out":"3:30 PM","h":8.5}']);
  await post({ do: "day", period: "2026-10-26", index: 2, entry: { t: "off" } }, "auth0|lyle");
  expect(asked.slice(-1)).toEqual(['save as auth0|lyle@org-diamond: 2026-10-26 day 2 {"t":"off"}']);
});

test("the page's refusals come back in its words, and what isn't a day is refused before it", async () => {
  refuse = "This week is with your manager — ask them to send it back to edit it.";
  const r = await post({ do: "day", period: "2026-10-26", index: 0, entry: { t: "off" } }, "auth0|lyle");
  expect(r.status).toBe(400);
  expect((await r.json()).error).toBe(refuse);
  asked.length = 0;
  expect((await post({ do: "day", period: "2026-10-26", index: 0, entry: { t: "leave", h: 8 } }, "auth0|lyle")).status).toBe(400);
  expect((await post({ do: "day", period: "2026-10-26", index: 0, entry: { t: "work", in: "soon", out: "later" } }, "auth0|lyle")).status).toBe(400);
  expect(asked).toEqual([]);
});

test("Send week is the page's submitWeek, as the token's person", async () => {
  expect((await post({ do: "send", period: "2026-10-26" }, "auth0|lyle")).status).toBe(200);
  expect(asked).toEqual(["send as auth0|lyle@org-diamond: 2026-10-26"]);
});

test("a preview says what the day would come to, by the page's rules, and saves nothing", async () => {
  const week = { workDays: [0, 1, 2, 3, 4], dayHours: 8, holidays: [] };
  const long = await (await post({ do: "preview", period: "2026-10-26", index: 0, entry: { t: "work", in: "7:00 AM", out: "3:30 PM" }, week }, "auth0|lyle")).json();
  expect(long).toEqual({ h: 8.5, cls: "over", word: "Overtime", split: { n: 8, o15: 0.5, o2: 0, forPayroll: 8.75 }, short: null });
  const short = await (await post({ do: "preview", period: "2026-10-26", index: 0, entry: { t: "work", in: "7:45 AM", out: "3:00 PM" }, week }, "auth0|lyle")).json();
  expect(short).toEqual(expect.objectContaining({ h: 7.25, cls: "under", word: "Short", split: null, short: "Short of your 8h day, your manager will see it" }));
  const sat = await (await post({ do: "preview", period: "2026-10-26", index: 5, entry: { t: "work", in: "7:00 AM", out: "11:00 AM" }, week }, "auth0|lyle")).json();
  expect(sat).toEqual(expect.objectContaining({ word: "Weekend rates", short: null }));
  expect((await post({ do: "preview", period: "2026-10-27", index: 0, entry: { t: "off" }, week }, "auth0|lyle")).status).toBe(400);
  expect(asked).toEqual([]);
});
