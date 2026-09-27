/**
 * @jest-environment node
 */

/* S3: WHAT ONE HOME LOAD COSTS, WITH BOOKINGS ON (PR E review).

   A workspace with sixty won jobs — forty booked ahead, ten booked long
   ago, one with a booking we sent that the mirror doesn't hold yet, one
   whose booking failed, eight never booked — two finished jobs still
   booked, and a hundred bookings of ours in flight on other jobs across
   the account. The list's reads are counted and the number held, so a
   change that reads more is seen: it was 31 before the review.

   And the sending state and the account's zone are read ONCE for the whole
   page — the list, today's day, the next day and the bell's two items —
   by React cache(), which is inert outside a request, so a request is
   stood up here: one memo per test, as one server request has. */

import { makeFakeDb } from "@/lib/integrations/__tests__/fixtures/sm8-fake-db";

const memo = new Map<unknown, Map<string, unknown>>();
jest.mock("react", () => ({
  ...jest.requireActual("react"),
  cache:
    <A extends unknown[], R>(fn: (...a: A) => R) =>
    (...a: A): R => {
      const seen = memo.get(fn) ?? new Map<string, unknown>();
      memo.set(fn, seen);
      const key = JSON.stringify(a);
      if (!seen.has(key)) seen.set(key, fn(...a));
      return seen.get(key) as R;
    },
}));

const fake = makeFakeDb();
type Q = Record<string, unknown> & { limit: (n: number) => Q; or: (e: string) => Q };
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (t: string) => {
      const q = fake.from(t) as unknown as Q;
      const or = q.or;
      // the won window is the list's own suite's (home-list-query.test)
      q.or = (e: string) => (e.includes(".gte.") ? q : or(e));
      q.range = (a: number, b: number) =>
        a === 0 ? q.limit(b - a + 1) : { then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res) };
      return q;
    },
    rpc: (n: string, a: Record<string, unknown>) => fake.rpc(n, a),
  },
}));
const readSm8WriteState = jest.fn(async () => STATE);
jest.mock("@/lib/integrations/sm8-writes", () => ({ readSm8WriteState: (...a: unknown[]) => readSm8WriteState(...(a as [])) }));

import { loadHomeList, type HomeListContext } from "../home-list-query";
import { bookingGuardTripped, myBookingTrouble } from "../booking-bell-query";
import { readBookingsOver } from "@/lib/workboard/all-jobs-query";
import { BOOKING_WORDS } from "@/lib/integrations/sm8-booking-plan";
import type { Sm8WriteState } from "@/lib/integrations/sm8-write-plan";
import type { Capability } from "@/lib/permissions";

type Row = Record<string, unknown>;
const ORG = "org-1";
const TENANT = "vendor-1";
const ZONE = "Australia/Sydney";
/* Tuesday 6 October 2026, 9:00 am in Sydney */
const NOW = Date.parse("2026-10-05T22:00:00Z");
const TODAY = "2026-10-06";
const TOMORROW = "2026-10-07";
const SAM = "5a0e5a0e-0000-4000-8000-00000000b001";
const job = (n: number) => `0b1e0b1e-0000-4000-8000-00000000f${String(n).padStart(3, "0")}`;
const act = (n: number) => `7e7e7e7e-0000-4000-8000-00000000c${String(n).padStart(3, "0")}`;

const STATE: Sm8WriteState = {
  readable: true,
  kinds: ["attachment", "note", "booking"],
  deployment: true,
  mode: "live",
  modeStored: "live",
  pausedReason: null,
  pausedAt: null,
  linked: true,
  connected: true,
  tenantId: TENANT,
  granted: ["attachment", "note", "booking"],
  refused: [],
  timezoneName: ZONE,
  ownerKinds: ["attachment", "note", "booking"],
  ownerKindsRead: true,
};

const ctx: HomeListContext = {
  orgId: ORG,
  caps: new Set<Capability>(["workboard", "workboard_manage"]),
  railDay: TODAY,
  tz: ZONE,
  names: new Map(),
  shared: { expiry: { warnDays: 21 } },
  connected: true,
  isOwner: true,
};

const workOrder = (uuid: string, number: string, over: Row = {}): Row => ({
  org_id: ORG,
  uuid,
  generated_job_id: number,
  status: "Work Order",
  active: 1,
  company_uuid: null,
  geo_city: "Testville",
  category_uuid: null,
  job_description: "Install a unit",
  date: "2026-10-01 09:00:00",
  quote_date: null,
  completion_date: null,
  work_order_date: "2026-10-05 10:00:00",
  ...over,
});

const activity = (uuid: string, jobUuid: string, over: Row = {}): Row => ({
  org_id: ORG,
  uuid,
  job_uuid: jobUuid,
  staff_uuid: SAM,
  start_date: `${TOMORROW} 08:00:00`,
  end_date: `${TOMORROW} 10:00:00`,
  activity_was_scheduled: 1,
  active: 1,
  ...over,
});

let seq = 0;
const ours = (jobUuid: string, over: Row = {}): Row => {
  seq += 1;
  return {
    id: `r${seq}`,
    org_id: ORG,
    tenant_id: TENANT,
    kind: "booking",
    op: "create",
    status: "sent",
    subject: `slot:${SAM}:x${seq}`,
    sm8_job_uuid: jobUuid,
    remote_uuid: `7e7e7e7e-0000-4000-8000-0000000d${String(seq).padStart(4, "0")}`,
    replaced_uuids: [],
    verify_uuids: [],
    maybe_landed: false,
    booking_staff_uuid: SAM,
    booking_start: `${TOMORROW} 09:00:00`,
    booking_end: `${TOMORROW} 11:00:00`,
    booking_zone: ZONE,
    taken_back_at: null,
    last_error: null,
    attempts: 1,
    depends_on: null,
    target_uuid: null,
    requested_by_user: "auth0|test-presser",
    created_at: "2026-10-05T21:00:00.000Z",
    pressed_at: "2026-10-05T21:00:00.000Z",
    updated_at: "2026-10-05T21:00:00.000Z",
    ...over,
  };
};

beforeEach(() => {
  fake.reset();
  memo.clear();
  seq = 0;
  fake.db.sm8_jobs = [];
  fake.db.sm8_job_activities = [];
  fake.db.sm8_writes = [];
  fake.db.sm8_staff = [{ org_id: ORG, uuid: SAM, first: "Sam", last: "Tester" }];
  fake.db.sm8_vendor = [{ org_id: ORG, timezone_name: ZONE }];
  fake.db.maintenance_visits = [];
  for (let i = 1; i <= 60; i++) fake.db.sm8_jobs.push(workOrder(job(i), String(4000 + i)));
  for (let i = 1; i <= 40; i++) fake.db.sm8_job_activities.push(activity(act(i), job(i)));
  // booked long ago, week after week: six visits each
  for (let i = 41; i <= 50; i++)
    for (let w = 0; w < 6; w++)
      fake.db.sm8_job_activities.push(
        activity(act(i * 10 + w + 500), job(i), { start_date: `2026-08-0${w + 1} 08:00:00`, end_date: `2026-08-0${w + 1} 10:00:00` }),
      );
  fake.db.sm8_writes.push(ours(job(51)), ours(job(52), { status: "failed", last_error: BOOKING_WORDS.row.refused }));
  fake.db.sm8_jobs.push(workOrder(job(90), "4090", { status: "Completed" }), workOrder(job(91), "4091", { status: "Unsuccessful" }));
  fake.db.sm8_job_activities.push(activity(act(90), job(90)), activity(act(91), job(91)), activity(act(92), job(91)));
  for (let i = 0; i < 100; i++) {
    const other = `0b1e0b1e-0000-4000-8000-0000000a${String(i).padStart(4, "0")}`;
    fake.db.sm8_jobs.push(workOrder(other, String(6000 + i), { status: "Quote" }));
    fake.db.sm8_writes.push(ours(other));
  }
  jest.spyOn(Date, "now").mockReturnValue(NOW);
  jest.spyOn(console, "error").mockImplementation(() => {});
  readSm8WriteState.mockClear();
  process.env.SM8_WRITES = "attachment,note,booking";
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  delete process.env.SM8_WRITES;
});

it("the list answers as it did, in 17 reads where it took 31", async () => {
  const reads = await loadHomeList(ctx);
  // the answer is the one the review's changes must keep
  expect(reads.wins.map((w) => w.job.remoteId).sort()).toEqual([52, 53, 54, 55, 56, 57, 58, 59, 60].map(job));
  expect(reads.bookingLines![job(52)].text).toBe("Not booked. ServiceM8 refused the booking.");
  expect(reads.leftovers!.map((l) => l.activityUuid)).toEqual([act(90), act(91), act(92)]);
  expect(fake.log).toHaveLength(17);
  // not one read of our hundred bookings in flight elsewhere, nor of their jobs
  const sentReads = fake.on("sm8_writes").filter((s) => s.filters.includes("op=create") && !s.filters.includes("sm8_job_uuid in"));
  expect(sentReads).toHaveLength(2); // the two gone-only asks, each an empty window
  expect(fake.on("sm8_jobs").filter((s) => s.filters.includes("uuid in") && !s.filters.includes("status in"))).toHaveLength(1);
});

it("reads the sending state and the account's zone once for the whole page", async () => {
  await Promise.all([
    loadHomeList(ctx),
    // today's day and the next, each through the Schedule's reader
    readBookingsOver(ORG, { from: TODAY, to: TOMORROW, rows: false }, NOW),
    readBookingsOver(ORG, { from: TOMORROW, to: "2026-10-08", rows: false }, NOW),
    myBookingTrouble(ORG, "auth0|test-presser", "2026-09-29", NOW),
    bookingGuardTripped(ORG, "2026-09-29"),
  ]);
  expect(readSm8WriteState).toHaveBeenCalledTimes(1);
  expect(fake.on("sm8_vendor")).toHaveLength(1);
});

/* PR D's Schedule reads the write state once and hands it on: a state
   handed in is the one used, and the request's is never read for it */
it("takes the state a caller hands in over the request's", async () => {
  const over = await readBookingsOver(ORG, { from: TODAY, to: TOMORROW, rows: false }, NOW, { linked: true, tenantId: "vendor-handed" });
  expect(readSm8WriteState).not.toHaveBeenCalled();
  expect(over?.tenantId).toBe("vendor-handed");
});
