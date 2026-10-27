/**
 * @jest-environment node
 */

/* Your clock from the phone, end to end: the real token check, the shared
   check-in rules, the booking queue and its sender, over an in-memory
   database (fixtures/sm8-fake-db) and a ServiceM8 that behaves as the live
   account did (fixtures/sm8-live-bookings). Clock on holds the time in
   HeyTiff; Clock off ends it at the time picked, and ServiceM8 gets it once,
   as the person's own recorded time; nothing else goes, and nobody else's
   clock is touched. */

import { generateKeyPairSync, sign } from "node:crypto";
import { makeFakeDb } from "@/lib/integrations/__tests__/fixtures/sm8-fake-db";
import { makeSm8Bookings, type Sm8Bookings } from "@/lib/integrations/__tests__/fixtures/sm8-live-bookings";

type Row = Record<string, unknown>;

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
jest.mock("@/lib/mobile/token", () => ({
  ...jest.requireActual("@/lib/mobile/token"),
  tenantKeys: () => async (kid: string) => (kid === "k1" ? publicKey : null),
}));

const fake = makeFakeDb();
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: { from: (t: string) => fake.from(t), rpc: (n: string, a: Record<string, unknown>) => fake.rpc(n, a) },
}));
jest.mock("server-only", () => ({}));
jest.mock("next/server", () => ({ after: () => {} }));
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: async () => null } }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: async (_o: string, userId: string) => `card-${userId}` }));
jest.mock("@/lib/workboard/job-notes-query", () => ({ staffDisplayNames: async () => new Map() }));

const ACCESS = { accessToken: "token-1", tenantId: "vendor-1", grant: "g1", meter: "vendor-1" };
jest.mock("@/lib/integrations/sm8-store", () => ({
  sm8AccessResult: async () => ({ ok: true, access: ACCESS }),
  renewSm8Access: async () => ({ ok: true, access: ACCESS }),
  markSm8NeedsReauth: async () => true,
}));
const postSm8Booking = jest.fn();
let sm8: Sm8Bookings;
jest.mock("@/lib/integrations/sm8-write", () => ({
  ...jest.requireActual("@/lib/integrations/sm8-write"),
  postSm8Booking: (...a: unknown[]) => postSm8Booking(...a),
  readSm8Booking: (...a: [unknown, string]) => sm8.readBooking(...a),
  readSm8Job: (...a: [unknown, string]) => sm8.readJob(...a),
  readSm8JobBookings: (...a: [unknown, string]) => sm8.readJobBookings(...a),
}));

import { GET, POST } from "../clock/route";
import { MOBILE_AUDIENCE } from "@/lib/mobile/token";
import { CLOCK_WORDS, wallMinute } from "@/lib/mobile/clock";
import { localNow, wallInstant } from "@/lib/integrations/sm8-booking-plan";

const DOMAIN = "tenant.example.auth0.com";
const ORG = "org-1";
const TENANT = "vendor-1";
const ZONE = "Australia/Sydney";
const JOB = "0b1e0b1e-0000-4000-8000-000000002935";
const OTHER_JOB = "0b1e0b1e-0000-4000-8000-000000003304";
const SAM_SM8 = "5a0e5a0e-0000-4000-8000-00000000a001";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string) => {
  const h = b64({ alg: "RS256", kid: "k1" });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};
const req = (sub: string | null, method = "GET", body?: unknown) =>
  new Request("https://go.hey-tiff.com/api/mobile/clock", {
    method,
    headers: { ...(sub ? { authorization: `Bearer ${mint(sub)}` } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const press = async (sub: string, body: unknown) => {
  const res = await POST(req(sub, "POST", body));
  return { status: res.status, body: (await res.json()) as Row };
};

const today = localNow(ZONE, Date.now())!.slice(0, 10);
const checkIns = () => fake.db.job_check_ins as Row[];
const openOf = (user: string) => checkIns().find((c) => c.user_id === user && c.checked_out_at == null)!;
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const posted = () => postSm8Booking.mock.calls.map((c) => c[1] as Row);

const env = process.env;
beforeEach(() => {
  process.env = { ...env, AUTH0_DOMAIN: DOMAIN, SM8_WRITES: "attachment,note,booking" };
  fake.reset();
  sm8 = makeSm8Bookings();
  sm8.job(JOB, { status: "Work Order", kept: { generated_job_id: "2935" } as never });
  sm8.job(OTHER_JOB, { status: "Work Order", kept: { generated_job_id: "3304" } as never });
  postSm8Booking.mockReset().mockImplementation(sm8.postBooking);
  fake.db.memberships = [
    { id: "m1", user_id: "auth0|sam", org_id: ORG, role: "staff", permissions: {}, created_at: "2026-01-01T00:00:00Z" },
    { id: "m2", user_id: "auth0|nolink", org_id: ORG, role: "staff", permissions: {}, created_at: "2026-01-01T00:00:00Z" },
  ];
  fake.db.integration_connections = [
    {
      org_id: ORG,
      provider: "servicem8",
      status: "connected",
      tenant_id: TENANT,
      tenants: [{ tenantId: TENANT, tenantName: "Acme Air", timezoneName: ZONE }],
      scopes: "vendor read_jobs read_schedule manage_attachments publish_job_notes manage_schedule manage_jobs",
      write_mode: "live",
      paused_reason: null,
      paused_at: null,
      write_scope_refused: {},
      connected_at: "2026-09-01T00:00:00.000Z",
      write_kinds: ["attachment", "note", "booking"],
    },
  ];
  fake.db.integration_links = [
    { id: "l1", org_id: ORG, provider: "servicem8", kind: "staff", tenant_id: TENANT, staff_profile_id: "card-auth0|sam", remote_id: SAM_SM8, matched_by: "manual", linked_at: "2026-09-01T00:00:00Z" },
  ];
  fake.db.sm8_vendor = [{ org_id: ORG, uuid: TENANT, name: "Acme Air", timezone_name: ZONE }];
  fake.db.sm8_staff = [{ org_id: ORG, uuid: SAM_SM8, first: "Sam", last: "Tester", active: 1 }];
  fake.db.sm8_jobs = [
    { org_id: ORG, uuid: JOB, active: 1, status: "Work Order", generated_job_id: "2935", job_address: "72 Railway Avenue\nStanmore NSW 2048", geo_city: "Stanmore" },
    { org_id: ORG, uuid: OTHER_JOB, active: 1, status: "Work Order", generated_job_id: "3304", job_address: "14 Thorn Street", geo_city: "Pennant Hills" },
  ];
  /* Sam is booked on 2935 all of today */
  fake.db.sm8_job_activities = [
    { org_id: ORG, uuid: "b0b0b0b0-0000-4000-8000-00000000b001", job_uuid: JOB, staff_uuid: SAM_SM8, start_date: `${today} 00:00:00`, end_date: `${today} 23:45:00`, activity_was_scheduled: 1, active: 1 },
  ];
  fake.db.job_check_ins = [];
  fake.db.sm8_writes = [];
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  process.env = env;
});

test("a call without a token reads and clocks nothing", async () => {
  expect((await GET(req(null))).status).toBe(401);
  expect((await POST(req(null, "POST", { do: "on", jobUuid: JOB }))).status).toBe(401);
  expect(checkIns()).toEqual([]);
});

test("Clock on: on the job now, with its number, its street and the end of your booking there", async () => {
  const r = await press("auth0|sam", { do: "on", jobUuid: JOB });
  expect(r.status).toBe(200);
  expect(r.body.said).toBe("Clocked on at 2935.");
  const end = new Date(wallInstant(`${today} 23:45:00`, ZONE, "earliest")!).toISOString();
  expect((r.body.state as Row).on).toMatchObject({ jobUuid: JOB, number: "2935", where: "72 Railway Avenue, Stanmore", bookingEnd: end });
  expect(checkIns()).toHaveLength(1);
  /* pressed again on the same job: still the one stint */
  await press("auth0|sam", { do: "on", jobUuid: JOB });
  expect(checkIns()).toHaveLength(1);
  const got = (await (await GET(req("auth0|sam"))).json()) as Row;
  expect((got.on as Row).id).toBe(openOf("auth0|sam").id);
  expect(posted()).toEqual([]);
  /* a job HeyTiff doesn't hold clocks nothing */
  expect((await press("auth0|sam", { do: "on", jobUuid: "not-a-job" })).status).toBe(404);
});

test("Clock off at the time you picked: the stint ends there, and ServiceM8 gets it once as your recorded time", async () => {
  await press("auth0|sam", { do: "on", jobUuid: JOB });
  const stint = openOf("auth0|sam");
  stint.checked_in_at = ago(3);
  const at = ago(1);
  const r = await press("auth0|sam", { do: "off", at });
  expect(r.status).toBe(200);
  expect(r.body.said).toBe("Clocked off, 2 h 0 m.");
  expect(stint.checked_out_at).toBe(at);
  expect(posted()).toHaveLength(1);
  expect(posted()[0]).toMatchObject({ jobUuid: JOB.toLowerCase(), staffUuid: SAM_SM8, start: wallMinute(ago(3), ZONE), end: wallMinute(at, ZONE), recorded: true });
  const state = r.body.state as Row;
  expect(state.on).toBeNull();
  expect(state.last).toMatchObject({ id: stint.id, number: "2935", sm8: "sent", why: null });
  /* clocked off already: nothing to end, nothing more goes */
  expect((await press("auth0|sam", { do: "off", at: ago(0) })).body).toEqual({ error: CLOCK_WORDS.notOn });
  expect(posted()).toHaveLength(1);
});

test("never before you clocked on, never after now, and always a time", async () => {
  await press("auth0|sam", { do: "on", jobUuid: JOB });
  openOf("auth0|sam").checked_in_at = ago(2);
  expect((await press("auth0|sam", { do: "off", at: ago(3) })).status).toBe(400);
  expect((await press("auth0|sam", { do: "off", at: new Date(Date.now() + 5 * 60_000).toISOString() })).body).toEqual({ error: CLOCK_WORDS.future });
  expect((await press("auth0|sam", { do: "off", at: "3pm" })).body).toEqual({ error: CLOCK_WORDS.noTime });
  expect((await press("auth0|sam", { do: "nap" })).status).toBe(400);
  expect(openOf("auth0|sam")).toBeTruthy();
  expect(posted()).toEqual([]);
});

test("clocking on somewhere else ends the last stint now, and its time goes", async () => {
  await press("auth0|sam", { do: "on", jobUuid: JOB });
  openOf("auth0|sam").checked_in_at = ago(2);
  const r = await press("auth0|sam", { do: "on", jobUuid: OTHER_JOB });
  expect(r.body.said).toBe("Clocked on at 3304.");
  expect(checkIns()).toHaveLength(2);
  expect(openOf("auth0|sam").sm8_job_uuid).toBe(OTHER_JOB);
  expect(posted()).toHaveLength(1);
  expect(posted()[0]).toMatchObject({ jobUuid: JOB.toLowerCase(), recorded: true });
  expect((r.body.state as Row).last).toMatchObject({ number: "2935", sm8: "sent" });
});

test("with no ServiceM8 link, or ServiceM8 not taking bookings, the time stays in HeyTiff and says why", async () => {
  await press("auth0|nolink", { do: "on", jobUuid: JOB });
  openOf("auth0|nolink").checked_in_at = ago(2);
  const r = await press("auth0|nolink", { do: "off", at: ago(1) });
  expect((r.body.state as Row).last).toMatchObject({ sm8: "none", why: CLOCK_WORDS.noLink });

  process.env.SM8_WRITES = "attachment,note";
  await press("auth0|sam", { do: "on", jobUuid: JOB });
  openOf("auth0|sam").checked_in_at = ago(2);
  const s = await press("auth0|sam", { do: "off", at: ago(1) });
  expect((s.body.state as Row).last).toMatchObject({ sm8: "none", why: CLOCK_WORDS.notTaking });
  expect(posted()).toEqual([]);
});

test("a stint ServiceM8 refused says so, and Try again sends it", async () => {
  postSm8Booking.mockResolvedValueOnce({ status: 422, outcome: { kind: "rejected", status: 422 }, remote: null, recordUuid: null });
  await press("auth0|sam", { do: "on", jobUuid: JOB });
  openOf("auth0|sam").checked_in_at = ago(2);
  const r = await press("auth0|sam", { do: "off", at: ago(1) });
  expect((r.body.state as Row).last).toMatchObject({ sm8: "failed" });
  for (const w of fake.db.sm8_writes as Row[]) w.next_attempt_at = ago(0);
  const again = await press("auth0|sam", { do: "send" });
  expect(again.status).toBe(200);
  expect((again.body.state as Row).last).toMatchObject({ sm8: "sent" });
  expect(posted()).toHaveLength(2);
});

test("your Clock off ends only your own stint", async () => {
  await press("auth0|sam", { do: "on", jobUuid: JOB });
  await press("auth0|nolink", { do: "on", jobUuid: JOB });
  openOf("auth0|sam").checked_in_at = ago(2);
  await press("auth0|sam", { do: "off", at: ago(1) });
  expect(openOf("auth0|nolink")).toBeTruthy();
  expect(posted().map((p) => p.staffUuid)).toEqual([SAM_SM8]);
});
