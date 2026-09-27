/**
 * @jest-environment node
 */

/* HOME'S LIST, READ OVER OUR BOOKINGS (two-way phase 3, PR E).

   HeyTiff never writes its copy of ServiceM8, so until the next sync the
   list asks the overlay: a won job with a booking we sent that the mirror
   doesn't hold yet leaves at once, one whose only booking we took out
   stays, and one whose booking of ours hasn't gone stays with that
   booking's line. A future booking on a finished job is a leftover. Where
   the deployment doesn't name `booking`, the list makes exactly main's
   reads and hands back exactly main's shape (E-10).

   Against the in-memory database the engine's own suites use, with the real
   overlay, the real zone and the real lines; only the write state is handed
   in. The fake has no `.range` and no `gte` inside `.or()`, so the two the
   list uses are shimmed here: one page, and the won window left to the
   list's own suite (home-list-query.test), which holds it. */

import { makeFakeDb } from "@/lib/integrations/__tests__/fixtures/sm8-fake-db";

const fake = makeFakeDb();
type Q = Record<string, unknown> & { limit: (n: number) => Q; or: (e: string) => Q };
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (t: string) => {
      const q = fake.from(t) as unknown as Q;
      const or = q.or;
      q.or = (e: string) => (e.includes(".gte.") ? q : or(e));
      q.range = (a: number, b: number) =>
        a === 0 ? q.limit(b - a + 1) : { then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res) };
      return q;
    },
    rpc: (n: string, a: Record<string, unknown>) => fake.rpc(n, a),
  },
}));
let state: Sm8WriteState;
const readSm8WriteState = jest.fn(async () => state);
jest.mock("@/lib/integrations/sm8-writes", () => ({ readSm8WriteState: () => readSm8WriteState() }));

import { loadHomeList, loadLeftovers, type HomeListContext, type ListBookings } from "../home-list-query";
import type { Sm8WriteState } from "@/lib/integrations/sm8-write-plan";
import type { Capability } from "@/lib/permissions";
import { BOOKING_WORDS } from "@/lib/integrations/sm8-booking-plan";

type Row = Record<string, unknown>;

const ORG = "org-1";
const TENANT = "vendor-1";
const ZONE = "Australia/Sydney";
/* Tuesday 6 October 2026, 9:00 am in Sydney */
const NOW = Date.parse("2026-10-05T22:00:00Z");
const TODAY = "2026-10-06";
const TOMORROW = "2026-10-07";
const YESTERDAY = "2026-10-05";

const SAM = "5a0e5a0e-0000-4000-8000-00000000b001";
const job = (n: number) => `0b1e0b1e-0000-4000-8000-00000000f${String(n).padStart(3, "0")}`;
const act = (n: number) => `7e7e7e7e-0000-4000-8000-00000000c${String(n).padStart(3, "0")}`;

const LIVE: Sm8WriteState = {
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

const ctx = (over: Partial<HomeListContext> = {}, ...caps: Capability[]): HomeListContext => ({
  orgId: ORG,
  caps: new Set<Capability>(caps.length ? caps : ["workboard", "workboard_manage"]),
  railDay: TODAY,
  tz: ZONE,
  names: new Map(),
  shared: { expiry: { warnDays: 21 } },
  connected: true,
  isOwner: true,
  ...over,
});

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
  edit_date: "2026-10-01 10:00:00",
  ...over,
});

let seq = 0;
/** A booking row of ours: a create, unless it says otherwise. */
const ours = (jobUuid: string, over: Row = {}): Row => {
  seq += 1;
  return {
    id: `r${seq}`,
    org_id: ORG,
    tenant_id: TENANT,
    kind: "booking",
    op: "create",
    status: "sent",
    subject: `slot:${SAM}:${TOMORROW}T0${seq}:00`,
    sm8_job_uuid: jobUuid,
    remote_uuid: act(900 + seq),
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
    verb_id: `v${seq}`,
    requested_by: null,
    requested_by_user: "auth0|test-presser",
    lease_until: null,
    landed_edit_date: null,
    seen_edit_date: null,
    created_at: `2026-10-05T2${seq % 10}:00:00.000Z`,
    updated_at: "2026-10-05T21:00:00.000Z",
    ...over,
  };
};

beforeEach(() => {
  fake.reset();
  seq = 0;
  state = LIVE;
  fake.db.sm8_jobs = [];
  fake.db.sm8_job_activities = [];
  fake.db.sm8_writes = [];
  fake.db.sm8_staff = [{ org_id: ORG, uuid: SAM, first: "Sam", last: "Tester" }];
  fake.db.sm8_vendor = [{ org_id: ORG, timezone_name: ZONE }];
  fake.db.maintenance_visits = [];
  jest.spyOn(Date, "now").mockReturnValue(NOW);
  jest.spyOn(console, "error").mockImplementation(() => {});
  readSm8WriteState.mockClear();
  process.env.SM8_WRITES = "attachment,note,booking";
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  delete process.env.SM8_WRITES;
});

const wonIds = (reads: Awaited<ReturnType<typeof loadHomeList>>) => reads.wins.map((w) => w.job.remoteId).sort();

describe("E-2: which won jobs are still to book, over our bookings", () => {
  it("takes a job off the list the moment a booking we sent for it went, before the mirror has it", async () => {
    fake.db.sm8_jobs.push(workOrder(job(1), "4001"), workOrder(job(2), "4002"));
    fake.db.sm8_writes.push(ours(job(1)));
    const reads = await loadHomeList(ctx());
    expect(wonIds(reads)).toEqual([job(2)]);
  });

  it("finds our booking's job whatever the case its uuid was pressed in", async () => {
    fake.db.sm8_jobs.push(workOrder(job(1), "4001"));
    fake.db.sm8_writes.push(ours(job(1).toUpperCase()));
    expect(wonIds(await loadHomeList(ctx()))).toEqual([]);
  });

  it("keeps a job whose only booking we took out, though the mirror still holds it", async () => {
    fake.db.sm8_jobs.push(workOrder(job(1), "4001"), workOrder(job(2), "4002"));
    const a = act(1);
    fake.db.sm8_job_activities.push(activity(a, job(1)), activity(act(2), job(2)));
    const create = ours(job(1), { remote_uuid: a, taken_back_at: "2026-10-05T21:30:00.000Z" });
    fake.db.sm8_writes.push(
      create,
      ours(job(1), { op: "delete", depends_on: create.id, target_uuid: a, verify_uuids: [a.toLowerCase()], subject: `undo:${create.id}` }),
    );
    const reads = await loadHomeList(ctx());
    // job 2 is booked in the mirror, as ever; job 1's booking is gone
    expect(wonIds(reads)).toEqual([job(1)]);
    // taken back and settled: no line, the won line stands
    expect(reads.bookingLines).toEqual({});
  });

  it("keeps a job whose booking failed, is unsure or was a trial, with that booking's line", async () => {
    fake.db.sm8_jobs.push(workOrder(job(1), "4001"), workOrder(job(2), "4002"), workOrder(job(3), "4003"));
    fake.db.sm8_writes.push(
      ours(job(1), { status: "failed", last_error: BOOKING_WORDS.row.refused }),
      ours(job(2), { status: "failed", maybe_landed: true, last_error: BOOKING_WORDS.row.bookingUnsure }),
      ours(job(3), { status: "trial" }),
    );
    const reads = await loadHomeList(ctx());
    expect(wonIds(reads)).toEqual([job(1), job(2), job(3)]);
    expect(reads.bookingLines![job(1)]).toMatchObject({ text: "Not booked. ServiceM8 refused the booking.", tone: "bad" });
    expect(reads.bookingLines![job(2)]).toMatchObject({ text: BOOKING_WORDS.line.unsure, tone: "bad" });
    expect(reads.bookingLines![job(3)]).toMatchObject({ text: BOOKING_WORDS.line.trial, tone: null });
  });

  it("keeps a job whose booking is held, saying why it waits", async () => {
    state = { ...LIVE, mode: "paused", pausedReason: "owner" } as Sm8WriteState;
    fake.db.sm8_jobs.push(workOrder(job(1), "4001"));
    fake.db.sm8_writes.push(ours(job(1), { status: "queued", attempts: 0 }));
    const reads = await loadHomeList(ctx());
    expect(wonIds(reads)).toEqual([job(1)]);
    expect(reads.bookingLines![job(1)].text).toBe("Not booked yet. Sending is paused.");
  });

  it("says the newest press's line when a job has had several", async () => {
    fake.db.sm8_jobs.push(workOrder(job(1), "4001"));
    fake.db.sm8_writes.push(
      ours(job(1), { status: "failed", last_error: BOOKING_WORDS.row.refused, created_at: "2026-10-04T01:00:00.000Z" }),
      ours(job(1), { status: "trial", created_at: "2026-10-05T01:00:00.000Z" }),
    );
    expect((await loadHomeList(ctx())).bookingLines![job(1)].text).toBe(BOOKING_WORDS.line.trial);
  });

  /* S1: a Try again keeps its row, and the row's created_at */
  it("counts a press by when it was last pressed, not when its row was made", async () => {
    fake.db.sm8_jobs.push(workOrder(job(1), "4001"));
    fake.db.sm8_writes.push(
      ours(job(1), {
        status: "failed",
        last_error: BOOKING_WORDS.row.refused,
        created_at: "2026-10-01T01:00:00.000Z",
        pressed_at: "2026-10-05T21:00:00.000Z",
      }),
      ours(job(1), { status: "trial", created_at: "2026-10-04T01:00:00.000Z", pressed_at: "2026-10-04T01:00:00.000Z" }),
    );
    expect((await loadHomeList(ctx())).bookingLines![job(1)].text).toBe("Not booked. ServiceM8 refused the booking.");
  });

  it("reads only the account connected now: an old account's booking books nothing", async () => {
    fake.db.sm8_jobs.push(workOrder(job(1), "4001"));
    fake.db.sm8_writes.push(ours(job(1), { tenant_id: "vendor-old" }));
    const reads = await loadHomeList(ctx());
    expect(wonIds(reads)).toEqual([job(1)]);
    expect(reads.bookingLines).toEqual({});
  });
});

describe("E-1: whether Book in books here (caps.bookIn)", () => {
  it("is on for an owner with Workboard manage, while bookings are offered", async () => {
    expect((await loadHomeList(ctx())).caps.bookIn).toBe(true);
  });

  it("is off for a manager who isn't the owner, while bookings are the owner's (DECISIONS 7)", async () => {
    expect((await loadHomeList(ctx({ isOwner: false }))).caps.bookIn).toBe(false);
  });

  it("is off without Workboard manage", async () => {
    expect((await loadHomeList(ctx({}, "workboard"))).caps.bookIn).toBe(false);
  });

  it("is off with Bookings switched off, while the lines still show", async () => {
    state = { ...LIVE, ownerKinds: ["attachment", "note"] };
    fake.db.sm8_jobs.push(workOrder(job(1), "4001"));
    fake.db.sm8_writes.push(ours(job(1), { status: "failed", last_error: BOOKING_WORDS.row.refused }));
    const reads = await loadHomeList(ctx());
    expect(reads.caps.bookIn).toBe(false);
    expect(reads.bookingLines![job(1)].tone).toBe("bad");
  });
});

describe("E-3: the leftover bookings", () => {
  const finished = (uuid: string, number: string, status = "Completed"): Row => workOrder(uuid, number, { status });

  it("lists future bookings on Completed and Unsuccessful jobs, soonest first, by first name", async () => {
    fake.db.sm8_jobs.push(finished(job(10), "4010"), finished(job(11), "4011", "Unsuccessful"), workOrder(job(12), "4012"));
    fake.db.sm8_job_activities.push(
      activity(act(10), job(10), { start_date: `${TOMORROW} 13:00:00`, end_date: `${TOMORROW} 15:00:00` }),
      activity(act(11), job(11)),
      // a booking on an open job is no leftover
      activity(act(12), job(12)),
    );
    const reads = await loadHomeList(ctx());
    expect(reads.leftovers).toEqual([
      { activityUuid: act(11), jobUuid: job(11), jobNumber: "4011", jobStatus: "Unsuccessful", staffName: "Sam", start: `${TOMORROW} 08:00:00` },
      { activityUuid: act(10), jobUuid: job(10), jobNumber: "4010", jobStatus: "Completed", staffName: "Sam", start: `${TOMORROW} 13:00:00` },
    ]);
  });

  it("is the one rule: not one that has started, recorded time, one with no person, or one deleted", async () => {
    fake.db.sm8_jobs.push(finished(job(10), "4010"));
    fake.db.sm8_job_activities.push(
      activity(act(1), job(10), { start_date: `${TODAY} 08:00:00`, end_date: `${TODAY} 10:00:00` }),
      activity(act(2), job(10), { start_date: `${YESTERDAY} 08:00:00`, end_date: `${YESTERDAY} 10:00:00` }),
      activity(act(3), job(10), { activity_was_scheduled: 0 }),
      activity(act(4), job(10), { staff_uuid: null }),
      activity(act(5), job(10), { active: 0 }),
      activity(act(6), job(10), { start_date: `${TODAY} 10:00:00`, end_date: `${TODAY} 11:00:00` }),
    );
    const reads = await loadHomeList(ctx());
    // 10 am today is ahead of 9 am now; 8 am today has started
    expect(reads.leftovers!.map((l) => l.activityUuid)).toEqual([act(6)]);
  });

  it("leaves out one we cleared, for as long as the Clear's row is there", async () => {
    fake.db.sm8_jobs.push(finished(job(10), "4010"));
    fake.db.sm8_job_activities.push(activity(act(1), job(10)), activity(act(2), job(10), { start_date: `${TOMORROW} 11:00:00` }));
    fake.db.sm8_writes.push(
      ours(job(10), { op: "delete", target_uuid: act(1), remote_uuid: act(1), verify_uuids: [act(1)], subject: `clear:${act(1)}` }),
    );
    expect((await loadHomeList(ctx())).leftovers!.map((l) => l.activityUuid)).toEqual([act(2)]);
  });

  it("lists none without the account's zone: there is no Sydney fallback", async () => {
    fake.db.sm8_vendor = [{ org_id: ORG, timezone_name: null }];
    fake.db.sm8_jobs.push(finished(job(10), "4010"));
    fake.db.sm8_job_activities.push(activity(act(1), job(10)));
    const reads = await loadHomeList(ctx());
    expect(reads.leftovers).toEqual([]);
    expect(fake.on("sm8_job_activities").filter((s) => (s.columns ?? "").includes("staff_uuid"))).toHaveLength(0);
  });

  it("lists none, and reads nothing of bookings, in a workspace without ServiceM8", async () => {
    fake.db.sm8_jobs.push(finished(job(10), "4010"));
    fake.db.sm8_job_activities.push(activity(act(1), job(10)));
    const reads = await loadHomeList(ctx({ connected: false }));
    expect(reads.leftovers).toBeUndefined();
    expect(readSm8WriteState).not.toHaveBeenCalled();
    expect(fake.on("sm8_writes")).toHaveLength(0);
  });

  it("carries twenty at most", async () => {
    fake.db.sm8_jobs.push(finished(job(10), "4010"));
    for (let i = 0; i < 25; i++) {
      fake.db.sm8_job_activities.push(activity(act(100 + i), job(10), { start_date: `${TOMORROW} ${String(10 + (i % 10)).padStart(2, "0")}:${String(i).padStart(2, "0")}:00` }));
    }
    const bk: ListBookings = { state: LIVE, zone: ZONE, hold: null, offered: true, trial: false, bookIn: true };
    expect(await loadLeftovers(ORG, TODAY, bk, NOW)).toHaveLength(20);
  });
});

describe("E-10: without `booking`, the list makes main's reads and hands back main's shape", () => {
  const seed = () => {
    fake.db.sm8_jobs.push(workOrder(job(1), "4001"), workOrder(job(2), "4002"), workOrder(job(10), "4010", { status: "Completed" }));
    fake.db.sm8_job_activities.push(activity(act(1), job(2)), activity(act(10), job(10)));
    fake.db.sm8_writes.push(ours(job(1)));
  };
  const shape = () => fake.log.map((s) => `${s.table} ${s.op} ${s.columns ?? ""} ${[...s.filters].sort().join(";")}`).sort();

  it.each(["1", "attachment,note", ""])("SM8_WRITES=%s", async (writes) => {
    process.env.SM8_WRITES = writes;
    seed();
    const reads = await loadHomeList(ctx());
    expect(Object.keys(reads).sort()).toEqual(["caps", "day", "names", "tz", "visits", "warnDays", "wins"]);
    expect(reads.caps).toEqual({ assetsAll: false, placeVisits: true, money: false, sm8: true });
    // our sent booking books nothing here: the mirror alone decides, as on main
    expect(wonIds(reads)).toEqual([job(1)]);
    expect(readSm8WriteState).not.toHaveBeenCalled();
    expect(shape()).toEqual(
      [
        `maintenance_visits select id, agreement_id, due_date booked_date is null;due_date<=;org_id=${ORG};remote_id is null;status in`,
        `sm8_job_activities select job_uuid active=1;activity_was_scheduled=1;job_uuid in;org_id=${ORG}`,
        `sm8_jobs select uuid, generated_job_id, status, company_uuid, geo_city, category_uuid, job_description, date, quote_date, completion_date, work_order_date active=1;org_id=${ORG};status=Work Order`,
      ].sort(),
    );
  });

  it("while with it, the same page reads our bookings (so the test above can see a difference)", async () => {
    seed();
    await loadHomeList(ctx());
    expect(fake.on("sm8_writes").length).toBeGreaterThan(0);
    expect(shape()).not.toContain(`sm8_job_activities select job_uuid active=1;activity_was_scheduled=1;job_uuid in;org_id=${ORG}`);
  });
});
