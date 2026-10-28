/**
 * @jest-environment node
 */

/* Approvals on the phone: only for whoever holds `approvals`, never your
   own leave or sheet, read by the Team screen's own loaders and decided by
   the web's own actions run AS the token's person (the real lib/auth0 over a
   stand-in SDK whose browser session is nobody's phone). */

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
jest.mock("server-only", () => ({}));
jest.mock("@auth0/nextjs-auth0/server", () => ({
  Auth0Client: class {
    async getSession() {
      return { user: { sub: "auth0|browser" }, orgId: "org-browser" };
    }
  },
}));

const asked: string[] = [];
const as = async () => {
  const { auth0 } = jest.requireActual("@/lib/auth0") as typeof import("@/lib/auth0");
  const s = await auth0.getSession();
  return `${s?.user.sub}@${s?.orgId}`;
};
jest.mock("@/lib/workboard/projects-query", () => ({ staffIdFor: async (_o: string, u: string) => (u === "auth0|isaac" ? "card-isaac" : null) }));
jest.mock("@/lib/timepay/leave-query", () => ({
  pendingRequests: async () => [
    { id: "lr-1", staffId: "card-alex", staffName: "Alex Lorenz", kind: "annual", startDate: "2026-11-02", endDate: "2026-11-06", hours: 40, status: "pending", certExpected: false },
    { id: "lr-2", staffId: "card-isaac", staffName: "Isaac Smith", kind: "annual", startDate: "2026-12-22", endDate: "2026-12-24", hours: 24, status: "pending" },
  ],
}));
const sheetOf = (start: string, range: string, index: number) => ({
  staff: [
    { id: "card-alex", name: "Alex Lorenz", role: "", rate: null, days: [{ t: "work", in: "7:00 AM", out: "4:00 PM", h: 9 }, { t: "work", in: "7:00 AM", out: "3:00 PM", h: 8 }], workDays: [0, 1, 2, 3, 4], dayHours: 8, holidayDays: [], certMissing: [] },
    { id: "card-isaac", name: "Isaac Smith", role: "", rate: null, days: [], workDays: [0, 1, 2, 3, 4], dayHours: 8, holidayDays: [], certMissing: [] },
  ],
  settings: DEFAULT_SETTINGS,
  week: [["MON", 19, "Oct"], ["TUE", 20, "Oct"]],
  today: 1,
  through: 1,
  periods: [{ start: "2026-10-26", range: "26 Oct to 1 Nov", live: true }, { start: "2026-10-19", range: "19 to 25 Oct", live: false }],
  periodIndex: index,
  sheets: start === "2026-10-19" ? { "card-alex": { status: "submitted" }, "card-isaac": { status: "submitted" } } : {},
  range,
});
jest.mock("@/lib/timepay/page-data", () => ({
  loadTimepay: async (_o: unknown, requested?: string) => {
    asked.push(`read sheets as ${await as()}: ${requested ?? "current"}`);
    return requested ? sheetOf(requested, "19 to 25 Oct", 1) : sheetOf("2026-10-26", "26 Oct to 1 Nov", 0);
  },
}));
jest.mock("@/app/actions/leave", () => ({
  approveLeave: async (id: string) => (asked.push(`approve leave as ${await as()}: ${id}`), { ok: true }),
  declineLeave: async (id: string, why: string) => (asked.push(`decline leave as ${await as()}: ${id} "${why}"`), why ? { ok: true } : { ok: false, error: "Give a reason." }),
}));
jest.mock("@/app/actions/timepay", () => ({
  approveWeek: async (staff: string, period: string) => (asked.push(`approve sheet as ${await as()}: ${staff} ${period}`), { ok: true }),
  sendBackWeek: async (staff: string, period: string, q: string) => (asked.push(`send back as ${await as()}: ${staff} ${period} "${q}"`), { ok: true }),
}));

import { GET, POST } from "../approvals/route";
import { MOBILE_AUDIENCE } from "@/lib/mobile/token";

const DOMAIN = "tenant.example.auth0.com";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string) => {
  const h = b64({ alg: "RS256", kid: "k1" });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};
const call = (method: "GET" | "POST", sub: string | null, body?: unknown) =>
  (method === "GET" ? GET : POST)(
    new Request("https://go.hey-tiff.com/api/mobile/approvals", {
      method,
      headers: { ...(sub ? { authorization: `Bearer ${mint(sub)}` } : {}), "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    })
  );

const env = process.env;
beforeEach(() => {
  process.env = { ...env, AUTH0_DOMAIN: DOMAIN };
  asked.length = 0;
  members = [
    { user_id: "auth0|isaac", org_id: "org-1", role: "owner", permissions: {} },
    { user_id: "auth0|alex", org_id: "org-1", role: "staff", permissions: {} },
  ];
});
afterAll(() => {
  process.env = env;
});

test("no token, or no approvals, sees and decides nothing", async () => {
  expect((await call("GET", null)).status).toBe(401);
  expect((await call("GET", "auth0|alex")).status).toBe(403);
  expect((await call("POST", "auth0|alex", { do: "leave", id: "lr-1", decision: "approve" })).status).toBe(403);
  expect(asked).toEqual([]);
});

test("leave asked for and sheets sent, never your own, read as the token's person", async () => {
  const body = await (await call("GET", "auth0|isaac")).json();
  expect(body.leave.map((l: { id: string }) => l.id)).toEqual(["lr-1"]);
  expect(body.sheets).toEqual([
    { staffId: "card-alex", name: "Alex Lorenz", period: { start: "2026-10-19", range: "19 to 25 Oct" }, worked: 17, normal: 16, ot: 1, ot2: 0, paidAbsence: 0 },
  ]);
  expect(asked).toEqual(["read sheets as auth0|isaac@org-1: current", "read sheets as auth0|isaac@org-1: 2026-10-19"]);
});

test("decisions are the web's own actions, as the token's person; a refusal comes back in their words", async () => {
  await call("POST", "auth0|isaac", { do: "leave", id: "lr-1", decision: "approve" });
  await call("POST", "auth0|isaac", { do: "sheet", staffId: "card-alex", period: "2026-10-19", decision: "send_back", question: "Was Tuesday 9 h?" });
  expect(asked).toEqual(['approve leave as auth0|isaac@org-1: lr-1', 'send back as auth0|isaac@org-1: card-alex 2026-10-19 "Was Tuesday 9 h?"']);
  const r = await call("POST", "auth0|isaac", { do: "leave", id: "lr-1", decision: "decline", reason: "" });
  expect(r.status).toBe(400);
  expect((await r.json()).error).toBe("Give a reason.");
});
