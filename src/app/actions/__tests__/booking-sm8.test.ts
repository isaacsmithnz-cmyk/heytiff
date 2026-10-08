/**
 * @jest-environment node
 */

/* Booking a job in ServiceM8 — the actions (two-way phase 3, PR C).

   The panel's read, Book in, Undo, Try again, Clear and the card's poll,
   against the in-memory database that keeps the bookings migration's rules
   (fixtures/sm8-fake-db), with the real queue helpers and the real sender
   behind them, and ServiceM8 replaced at its request functions by a fake
   that behaves as the live account did (fixtures/sm8-live-bookings). Every
   action is a Server Function, reachable by direct POST: what is held here
   is what the server does, whatever a browser sends.

   First of all: PRODUCTION BOOKS NOTHING (SM8_WRITES is 1, or
   attachment,note), and there every action answers before its first read.

   The people and jobs are made up. */

import { randomUUID } from "node:crypto";
import { makeFakeDb } from "@/lib/integrations/__tests__/fixtures/sm8-fake-db";
import { makeSm8Bookings, type Sm8Bookings } from "@/lib/integrations/__tests__/fixtures/sm8-live-bookings";

type Row = Record<string, unknown>;

const fake = makeFakeDb();
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (t: string) => fake.from(t),
    rpc: (n: string, a: Record<string, unknown>) => fake.rpc(n, a),
    storage: { from: () => ({ download: async () => ({ data: null, error: null }) }) },
  },
}));
jest.unmock("@/app/actions/booking-sm8");

const sm8AccessResult = jest.fn();
const renewSm8Access = jest.fn();
jest.mock("@/lib/integrations/sm8-store", () => ({
  sm8AccessResult: (...a: unknown[]) => sm8AccessResult(...a),
  renewSm8Access: (...a: unknown[]) => renewSm8Access(...a),
  markSm8NeedsReauth: jest.fn(async () => true),
}));

/* ServiceM8, at the sender's request functions and at the page reader the
   panel's day read goes through */
const postSm8Booking = jest.fn();
const postSm8JobStatus = jest.fn();
const deleteSm8Booking = jest.fn();
const readSm8Booking = jest.fn();
const readSm8Job = jest.fn();
const readSm8JobBookings = jest.fn();
jest.mock("@/lib/integrations/sm8-write", () => ({
  ...jest.requireActual("@/lib/integrations/sm8-write"),
  postSm8Attachment: jest.fn(),
  readSm8Attachment: jest.fn(),
  postSm8Note: jest.fn(),
  updateSm8NoteCompleter: jest.fn(),
  deleteSm8Note: jest.fn(),
  readSm8Note: jest.fn(),
  postSm8Booking: (...a: unknown[]) => postSm8Booking(...a),
  postSm8JobStatus: (...a: unknown[]) => postSm8JobStatus(...a),
  deleteSm8Booking: (...a: unknown[]) => deleteSm8Booking(...a),
  readSm8Booking: (...a: unknown[]) => readSm8Booking(...a),
  readSm8Job: (...a: unknown[]) => readSm8Job(...a),
  readSm8JobBookings: (...a: unknown[]) => readSm8JobBookings(...a),
}));
const fetchSm8Page = jest.fn();
jest.mock("@/lib/integrations/sm8-read", () => ({
  ...jest.requireActual("@/lib/integrations/sm8-read"),
  fetchSm8Page: (...a: unknown[]) => fetchSm8Page(...a),
}));

/* who is signed in, what they may do, and the workspace each side names */
const OWNER = { user: "auth0|owner-test", staff: "staff-owner" as string | null };
const COOWNER = { user: "auth0|coowner-test", staff: "staff-coowner" as string | null };
const STAFF = { user: "auth0|staff-test", staff: "staff-member" as string | null };
let who = OWNER;
let caps = new Set(["workboard", "workboard_manage"]);
let role = "owner";
let orgs = { session: "org-1", required: "org-1" };
const getSession = jest.fn();
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: (...a: unknown[]) => getSession(...a) } }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => who.staff) }));
const requireOrg = jest.fn();
const getDbRole = jest.fn();
jest.mock("@/lib/permissions-server", () => ({
  requireOrg: (...a: unknown[]) => requireOrg(...a),
  getDbRole: (...a: unknown[]) => getDbRole(...a),
  can: jest.fn(async (c: string) => caps.has(c)),
}));
const NAMES: Record<string, string> = { "staff-owner": "Owner Tester", "staff-coowner": "Coowner Tester" };
jest.mock("@/lib/workboard/job-notes-query", () => ({
  staffDisplayNames: jest.fn(async (_org: string, ids: (string | null)[]) => {
    return new Map(ids.filter((i): i is string => !!i && !!NAMES[i]).map((i) => [i, NAMES[i]]));
  }),
}));

/* what runs behind an answer is kept, and run when a test says */
const scheduled: (() => Promise<unknown>)[] = [];
jest.mock("next/server", () => ({ after: (fn: () => Promise<unknown>) => void scheduled.push(fn) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

/* the send and the settle, watched, running the real ones */
const runSm8Writes = jest.fn();
jest.mock("@/lib/integrations/sm8-writes", () => {
  const actual = jest.requireActual("@/lib/integrations/sm8-writes");
  return { ...actual, runSm8Writes: (...a: unknown[]) => runSm8Writes(...a) };
});
const settlePressedWrites = jest.fn();
const drainSm8WritesAfterResponse = jest.fn();
jest.mock("@/lib/integrations/sm8-drain", () => {
  const actual = jest.requireActual("@/lib/integrations/sm8-drain");
  return {
    ...actual,
    settlePressedWrites: (...a: unknown[]) => settlePressedWrites(...a),
    drainSm8WritesAfterResponse: (...a: unknown[]) => drainSm8WritesAfterResponse(...a),
  };
});
/* two queue helpers, watched, so a test can hand in an answer PR B's
   review gives them */
const takeBackQueue = jest.fn();
const clearQueue = jest.fn();
jest.mock("@/app/actions/sm8-booking-queue", () => {
  const actual = jest.requireActual("@/app/actions/sm8-booking-queue");
  return {
    ...actual,
    queueBookingTakeBack: (...a: unknown[]) => takeBackQueue(...a),
    queueClear: (...a: unknown[]) => clearQueue(...a),
  };
});

import {
  bookJobIn,
  clearLeftoverBooking,
  markUnsuccessful,
  readBookingStates,
  readBookInContext,
  retryBooking,
  takeBackBooking,
} from "../booking-sm8";
import { BOOKING_WORDS, localNow } from "@/lib/integrations/sm8-booking-plan";
import { revalidatePath } from "next/cache";

const actualWrites = jest.requireActual("@/lib/integrations/sm8-writes");
const actualDrain = jest.requireActual("@/lib/integrations/sm8-drain");
const actualQueue = jest.requireActual("@/app/actions/sm8-booking-queue");

const ORG = "org-1";
const TENANT = "vendor-1";
const ZONE = "Australia/Sydney";
const JOB = "7c3a9e10-0000-4000-8000-000000009001";
const WO_JOB = "7c3a9e10-0000-4000-8000-000000009002";
const DONE_JOB = "7c3a9e10-0000-4000-8000-000000009003";
const LOST_JOB = "7c3a9e10-0000-4000-8000-000000009004";
const ALEX = "5b0c1d2e-0000-4000-8000-00000000a1e1";
const CASEY = "5b0c1d2e-0000-4000-8000-00000000c5e1";
const JORDAN = "5b0c1d2e-0000-4000-8000-00000000d0e1";
const BLAKE = "5b0c1d2e-0000-4000-8000-00000000b1e1";
const DREW = "5b0c1d2e-0000-4000-8000-00000000d2e1";
const EDITED = "2026-09-27 16:00:00";
const ACCESS = { accessToken: "tok-1", tenantId: TENANT, grant: "g1", meter: TENANT };

/** A day on the account's wall clock, `days` from today. */
const dayFrom = (days: number, zone = ZONE, now = Date.now()) => localNow(zone, now + days * 86_400_000)!.slice(0, 10);
const TOMORROW = dayFrom(1);
const at = (d: string, hhmm: string) => `${d} ${hhmm}:00`;

const KEPT = (n: string) => ({
  company_uuid: "c0ffee00-0000-4000-8000-000000000001",
  job_address: null,
  job_description: "A test job",
  category_uuid: null,
  purchase_order_number: null,
  generated_job_id: n,
});

const writes = () => (fake.db.sm8_writes ?? []) as Row[];
const booking = () => writes().filter((w) => w.kind === "booking");
const creates = () => booking().filter((w) => w.op === "create");
const statusRows = () => booking().filter((w) => w.op === "update");
const deletes = () => booking().filter((w) => w.op === "delete");

/** ServiceM8's copy of the account, as the live account behaves. */
let sm8: Sm8Bookings;

function wire(): void {
  readSm8Booking.mockImplementation(sm8.readBooking);
  readSm8Job.mockImplementation(sm8.readJob);
  readSm8JobBookings.mockImplementation(sm8.readJobBookings);
  postSm8Booking.mockImplementation(sm8.postBooking);
  postSm8JobStatus.mockImplementation(sm8.postJobStatus);
  deleteSm8Booking.mockImplementation(sm8.deleteBooking);
  /* the panel's day read: everything overlapping the day, as ServiceM8
     sends it */
  fetchSm8Page.mockImplementation(async (_call: unknown, endpoint: string, opts: { filter: string | null }) => {
    const m = /start_date lt '(\S+) 00:00:00' and end_date gt '(\S+) 00:00:00'/.exec(opts.filter ?? "");
    if (endpoint !== "jobactivity.json" || !m) return { ok: false, failure: "unavailable" };
    const rows = [...sm8.activities.values()]
      .filter((a) => a.active === 1 && (a.start ?? "") < `${m[1]} 00:00:00` && (a.end ?? "") > `${m[2]} 00:00:00`)
      .map((a) => ({
        uuid: a.uuid,
        job_uuid: a.jobUuid,
        staff_uuid: a.staffUuid,
        start_date: a.start,
        end_date: a.end,
        activity_was_scheduled: String(a.scheduled),
        activity_was_recorded: String(a.recorded),
        active: a.active,
        edit_date: a.editDate,
      }));
    return { ok: true, rows, nextCursor: null };
  });
}

function connection(over: Row = {}): Row {
  return {
    org_id: ORG,
    provider: "servicem8",
    status: "connected",
    tenant_id: TENANT,
    tenants: [{ tenantId: TENANT, tenantName: "Test Air", timezoneName: ZONE }],
    scopes: "vendor read_jobs read_schedule manage_attachments publish_job_notes manage_schedule manage_jobs",
    write_mode: "live",
    paused_reason: null,
    paused_at: null,
    write_scope_refused: {},
    connected_at: "2026-09-01T00:00:00.000Z",
    write_kinds: ["attachment", "note", "booking"],
    ...over,
  };
}

const as = (person: typeof OWNER, r = "owner") => {
  who = person;
  role = r;
};

beforeEach(() => {
  fake.reset();
  scheduled.length = 0;
  sm8 = makeSm8Bookings();
  sm8.job(JOB, { status: "Quote", editDate: EDITED, kept: KEPT("9001") });
  sm8.job(WO_JOB, { status: "Work Order", editDate: EDITED, kept: KEPT("9002") });
  sm8.job(DONE_JOB, { status: "Completed", editDate: EDITED, kept: KEPT("9003") });
  sm8.job(LOST_JOB, { status: "Unsuccessful", editDate: EDITED, kept: KEPT("9004") });
  fake.db.integration_connections = [connection()];
  fake.db.sm8_vendor = [{ org_id: ORG, uuid: TENANT, name: "Test Air", timezone_name: ZONE }];
  fake.db.sm8_staff = [
    { org_id: ORG, uuid: JORDAN, first: "Jordan", last: "Tester", active: 1 },
    { org_id: ORG, uuid: CASEY, first: "Casey", last: "Tester", active: 1 },
    { org_id: ORG, uuid: ALEX, first: "Alex", last: "Tester", active: 1 },
    { org_id: ORG, uuid: BLAKE, first: "Blake", last: "Tester", active: 1 },
    { org_id: ORG, uuid: DREW, first: "Drew", last: "Tester", active: 0 },
  ];
  fake.db.sm8_jobs = [
    { org_id: ORG, uuid: JOB, active: 1, status: "Quote", edit_date: EDITED, generated_job_id: "9001" },
    { org_id: ORG, uuid: WO_JOB, active: 1, status: "Work Order", edit_date: EDITED, generated_job_id: "9002" },
    { org_id: ORG, uuid: DONE_JOB, active: 1, status: "Completed", edit_date: EDITED, generated_job_id: "9003" },
    { org_id: ORG, uuid: LOST_JOB, active: 1, status: "Unsuccessful", edit_date: EDITED, generated_job_id: "9004" },
  ];
  fake.db.sm8_job_activities = [];
  fake.db.sm8_writes = [];
  fake.db.workboard_notes = [];
  fake.db.integration_links = [
    { org_id: ORG, provider: "servicem8", kind: "staff", tenant_id: TENANT, staff_profile_id: "staff-owner", remote_id: ALEX },
    { org_id: ORG, provider: "servicem8", kind: "staff", tenant_id: TENANT, staff_profile_id: "staff-coowner", remote_id: CASEY },
  ];
  process.env.SM8_WRITES = "attachment,note,booking";
  as(OWNER);
  caps = new Set(["workboard", "workboard_manage"]);
  orgs = { session: ORG, required: ORG };
  getSession.mockReset().mockImplementation(async () => ({ orgId: orgs.session, user: { sub: who.user } }));
  requireOrg.mockReset().mockImplementation(async (c?: string) => {
    if (c && !caps.has(c)) throw new Error("Insufficient permissions");
    return { orgId: orgs.required, userId: who.user };
  });
  getDbRole.mockReset().mockImplementation(async () => role);
  sm8AccessResult.mockReset().mockResolvedValue({ ok: true, access: ACCESS });
  renewSm8Access.mockReset().mockResolvedValue({ ok: false, reason: "reauth" });
  for (const m of [postSm8Booking, postSm8JobStatus, deleteSm8Booking, readSm8Booking, readSm8Job, readSm8JobBookings, fetchSm8Page]) {
    m.mockReset();
  }
  wire();
  runSm8Writes.mockReset().mockImplementation(actualWrites.runSm8Writes);
  settlePressedWrites.mockReset().mockImplementation(actualDrain.settlePressedWrites);
  drainSm8WritesAfterResponse.mockReset().mockImplementation(actualDrain.drainSm8WritesAfterResponse);
  takeBackQueue.mockReset().mockImplementation(actualQueue.queueBookingTakeBack);
  clearQueue.mockReset().mockImplementation(actualQueue.queueClear);
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  delete process.env.SM8_WRITES;
});

type BookIn = Parameters<typeof bookJobIn>[0];
const one = (over: Partial<BookIn["bookings"][number]> = {}) => ({ staffUuid: ALEX, day: TOMORROW, start: "20:00", minutes: 60, ...over });
const book = (over: Partial<BookIn> = {}, now = Date.now()) =>
  bookJobIn({
    jobUuid: JOB,
    pressId: randomUUID(),
    seen: { jobEditDate: EDITED, readAt: new Date(now).toISOString() },
    makeWorkOrder: false,
    bookings: [one()],
    ...over,
  });

/** ServiceM8 refusing a booking outright (a 403 that names no scope): the
    row fails, and its line offers Try again. */
const refusedOnce = async () => ({ status: 403, outcome: { kind: "forbidden", scope: false }, remote: null, recordUuid: null });

/** A sent booking of the owner's on JOB, as the sender left it. */
async function sentBooking(over: Partial<BookIn> = {}): Promise<Row> {
  const r = await book(over);
  if (!r.ok) throw new Error(r.error);
  const c = creates().at(-1)!;
  expect(c.status).toBe("sent");
  return c;
}

/** The mirror's copy of a booking, as the sync wrote it. */
const mirrored = (a: Row) =>
  (fake.db.sm8_job_activities as Row[]).push({
    org_id: ORG,
    activity_was_scheduled: 1,
    active: 1,
    edit_date: "2026-09-27 17:00:00",
    ...a,
  });

/** A leftover: a future booking on a finished job, in the mirror and in
    ServiceM8 alike. */
function leftover(job = DONE_JOB, over: Row = {}): Row {
  const a: Row = {
    uuid: randomUUID(),
    job_uuid: job,
    staff_uuid: CASEY,
    start_date: at(TOMORROW, "07:00"),
    end_date: at(TOMORROW, "09:00"),
    ...over,
  };
  mirrored(a);
  sm8.put({
    uuid: String(a.uuid),
    jobUuid: job,
    staffUuid: (a.staff_uuid as string | null) ?? null,
    start: (a.start_date as string | null) ?? null,
    end: (a.end_date as string | null) ?? null,
  });
  return a;
}

/* ── production ── */

describe("production books nothing (C-12)", () => {
  it.each(["1", "attachment,note"])("(F) with SM8_WRITES=%s every action answers before its first read", async (setting) => {
    process.env.SM8_WRITES = setting;
    fake.log.length = 0;
    const unavailable = { ok: false, error: BOOKING_WORDS.press.unavailable };
    expect(await readBookInContext({ jobUuid: JOB, days: [TOMORROW] })).toEqual(unavailable);
    expect(await book()).toEqual(unavailable);
    expect(await takeBackBooking({ jobUuid: JOB, rowId: randomUUID() })).toEqual(unavailable);
    expect(await retryBooking({ jobUuid: JOB, rowId: randomUUID() })).toEqual(unavailable);
    expect(
      await clearLeftoverBooking({ jobUuid: DONE_JOB, activityUuid: randomUUID(), seen: { staffUuid: CASEY, start: at(TOMORROW, "07:00") }, pressId: randomUUID() })
    ).toEqual(unavailable);
    expect(await readBookingStates({ jobUuid: JOB })).toBeNull();
    // no database, no session, no permission, no ServiceM8
    expect(fake.log).toEqual([]);
    expect(getSession).not.toHaveBeenCalled();
    expect(requireOrg).not.toHaveBeenCalled();
    expect(sm8AccessResult).not.toHaveBeenCalled();
    expect(readSm8Job).not.toHaveBeenCalled();
    expect(fetchSm8Page).not.toHaveBeenCalled();
    expect(scheduled).toEqual([]);
  });
});

/* ── the gates ── */

describe("the gates (C-4)", () => {
  const presses = () => [
    () => readBookInContext({ jobUuid: JOB, days: [TOMORROW] }),
    () => book(),
    () => takeBackBooking({ jobUuid: JOB, rowId: randomUUID() }),
    () => retryBooking({ jobUuid: JOB, rowId: randomUUID() }),
    () => clearLeftoverBooking({ jobUuid: DONE_JOB, activityUuid: randomUUID(), seen: { staffUuid: CASEY, start: at(TOMORROW, "07:00") }, pressId: randomUUID() }),
  ];
  const nothingRead = () => {
    expect(fake.on("integration_connections")).toEqual([]);
    expect(fake.on("sm8_writes")).toEqual([]);
    expect(readSm8Job).not.toHaveBeenCalled();
  };

  it("(F) without Workboard manage, every press is refused in the Workboard's words, and reads nothing", async () => {
    caps = new Set(["workboard"]);
    fake.log.length = 0;
    for (const press of presses()) expect(await press()).toEqual({ ok: false, error: BOOKING_WORDS.press.noManage });
    nothingRead();
  });

  it("(F) while bookings are the owner's (BOOKINGS_OPEN_TO_MANAGERS false), an admin with Workboard manage is refused", async () => {
    as(COOWNER, "admin");
    fake.log.length = 0;
    for (const press of presses()) expect(await press()).toEqual({ ok: false, error: BOOKING_WORDS.press.ownerOnly });
    nothingRead();
  });

  it("(F) a role or a session that can't be read refuses the press, never a server error", async () => {
    getDbRole.mockRejectedValue(new Error("the database fell over"));
    for (const press of presses()) expect(await press()).toEqual({ ok: false, error: BOOKING_WORDS.press.noManage });
    getDbRole.mockImplementation(async () => role);
    getSession.mockRejectedValue(new Error("the session store fell over"));
    for (const press of presses()) expect(await press()).toEqual({ ok: false, error: BOOKING_WORDS.press.noManage });
    expect(writes()).toEqual([]);
  });

  it("(F) with no press, or a press for another workspace, nothing is read or queued", async () => {
    getSession.mockResolvedValue(null);
    fake.log.length = 0;
    for (const press of presses()) expect(await press()).toEqual({ ok: false, error: BOOKING_WORDS.press.noManage });
    nothingRead();

    getSession.mockImplementation(async () => ({ orgId: "org-2", user: { sub: who.user } }));
    for (const press of presses()) expect(await press()).toEqual({ ok: false, error: BOOKING_WORDS.press.noManage });
    nothingRead();
    expect(writes()).toEqual([]);
  });

  it("(F) the poll needs only the Workboard: a member without manage reads the lines; one without the Workboard reads nothing", async () => {
    await sentBooking();
    as(STAFF, "staff");
    caps = new Set(["workboard"]);
    const read = await readBookingStates({ jobUuid: JOB });
    expect(read?.verbs).toHaveLength(1);
    caps = new Set();
    fake.log.length = 0;
    expect(await readBookingStates({ jobUuid: JOB })).toBeNull();
    expect(fake.log).toEqual([]);
  });
});

/* ── the panel's live read ── */

/* Isaac, 2026-10-08: "Owner only for the Mark Unsuccessful button" */
describe("Mark Unsuccessful, from Analytics: the owner's", () => {
  it("(F) an owner's press makes the Quote Unsuccessful in ServiceM8, its status alone", async () => {
    const r = await markUnsuccessful({ jobUuid: JOB, pressId: randomUUID() });
    expect(r).toMatchObject({ ok: true, state: "sent" });
    expect(postSm8JobStatus.mock.calls.map((c) => c.slice(1))).toEqual([[JOB, "Unsuccessful"]]);
    expect(writes()).toEqual([expect.objectContaining({ op: "update", job_status_from: "Quote", job_status_to: "Unsuccessful" })]);
  });

  it("(F) anyone but an owner is refused, and nothing is read or queued", async () => {
    as(COOWNER, "admin");
    expect((await markUnsuccessful({ jobUuid: JOB, pressId: randomUUID() })).ok).toBe(false);
    expect(writes()).toEqual([]);
    expect(postSm8JobStatus).not.toHaveBeenCalled();
  });
});

describe("the panel's read", () => {
  it("(F) checks ServiceM8 itself: the job, its bookings and the day's, who can be booked — you first — and the account's clock", async () => {
    sm8.put({ uuid: randomUUID(), jobUuid: JOB, staffUuid: CASEY, start: at(TOMORROW, "08:00"), end: at(TOMORROW, "09:00") });
    sm8.put({ uuid: randomUUID(), jobUuid: WO_JOB, staffUuid: ALEX, start: at(TOMORROW, "10:00"), end: at(TOMORROW, "12:00") });
    const r = await readBookInContext({ jobUuid: JOB, days: [TOMORROW] });
    if (!r.ok) throw new Error(r.error);
    expect(r).toMatchObject({
      ok: true,
      offered: true,
      trial: false,
      hold: null,
      zone: ZONE,
      today: dayFrom(0),
      job: { uuid: JOB, number: "9001", status: "Quote", editDate: EDITED },
    });
    expect(r.bookings.map((a) => a.staffUuid)).toEqual([CASEY]);
    expect(r.days[TOMORROW]!.map((a) => [a.jobUuid, a.start]).sort()).toEqual([
      [JOB, at(TOMORROW, "08:00")],
      [WO_JOB, at(TOMORROW, "10:00")],
    ]);
    expect(r.jobNumbers).toEqual({ [JOB]: "9001", [WO_JOB]: "9002" });
    // you, then those linked to HeyTiff, then everyone else, A to Z; nobody inactive
    expect(r.staff).toEqual([
      { uuid: ALEX, name: "Alex Tester", you: true, linked: true },
      { uuid: CASEY, name: "Casey Tester", you: false, linked: true },
      { uuid: BLAKE, name: "Blake Tester", you: false, linked: false },
      { uuid: JORDAN, name: "Jordan Tester", you: false, linked: false },
    ]);
    expect(Math.abs(Date.parse(r.readAt) - Date.now())).toBeLessThan(5_000);
    expect(writes()).toEqual([]);
  });

  /* TIME OFF (leave to ServiceM8, part two): from the mirror, beside the
     live read, and only where the mirror holds all of it. */
  it("(F) carries each asked day's time off from the mirror, once its first read has finished", async () => {
    const off = (over: Row) => ({
      org_id: ORG,
      uuid: randomUUID(),
      regarding_object: "staff",
      regarding_object_uuid: CASEY,
      name: "SICK",
      availability_type: "staff-annual-leave",
      start_timestamp: `${TOMORROW} 00:00:00`,
      end_timestamp: `${TOMORROW} 23:59:59`,
      active: 1,
      ...over,
    });
    fake.db.sm8_availability = [
      off({ uuid: "av-sick" }),
      off({ uuid: "av-holiday", regarding_object: "vendor", regarding_object_uuid: TENANT, name: "Labour Day", availability_type: "public-holiday" }),
      off({ uuid: "av-gone", active: 0 }),
      off({ uuid: "av-other-day", start_timestamp: `${dayFrom(3)} 00:00:00`, end_timestamp: `${dayFrom(3)} 23:59:59` }),
      off({ uuid: "av-other-org", org_id: "org-2" }),
    ];
    fake.db.sm8_sync_state = [{ org_id: ORG, object: "availability", backfill_done: false }];
    const before = await readBookInContext({ jobUuid: JOB, days: [TOMORROW] });
    if (!before.ok) throw new Error(before.error);
    // half a walk says nothing: somebody's leave may not be in it yet
    expect(before.off).toEqual({});

    fake.db.sm8_sync_state = [{ org_id: ORG, object: "availability", backfill_done: true }];
    const r = await readBookInContext({ jobUuid: JOB, days: [TOMORROW] });
    if (!r.ok) throw new Error(r.error);
    expect(r.off).toEqual({
      [TOMORROW]: {
        away: [{ uuid: "av-sick", staffUuid: CASEY, name: "SICK", start: `${TOMORROW} 00:00:00`, end: `${TOMORROW} 23:59:59` }],
        closed: [{ uuid: "av-holiday", kind: "holiday", name: "Labour Day", start: `${TOMORROW} 00:00:00`, end: `${TOMORROW} 23:59:59` }],
      },
    });
    expect(writes()).toEqual([]);
  });

  it("reads on without time off where the mirror can't be read", async () => {
    fake.db.sm8_sync_state = [{ org_id: ORG, object: "availability", backfill_done: true }];
    fake.failing.add("sm8_availability");
    const r = await readBookInContext({ jobUuid: JOB, days: [TOMORROW] });
    if (!r.ok) throw new Error(r.error);
    expect(r.off).toEqual({});
  });

  it("(F) says why a job can't be booked: its live status, or gone", async () => {
    sm8.jobs.get(JOB)!.status = "Completed";
    expect(await readBookInContext({ jobUuid: JOB, days: [TOMORROW] })).toEqual({
      ok: false,
      error: "This job is Completed in ServiceM8, so it can't be booked.",
    });
    sm8.jobs.delete(JOB);
    expect(await readBookInContext({ jobUuid: JOB, days: [TOMORROW] })).toEqual({ ok: false, error: BOOKING_WORDS.press.jobGone });
  });

  it("(F) with no zone, or Bookings not offered, says so before asking ServiceM8 anything; a zone it couldn't read is a read that failed", async () => {
    fake.db.sm8_vendor = [{ org_id: ORG, uuid: TENANT, timezone_name: null }];
    expect(await readBookInContext({ jobUuid: JOB, days: [TOMORROW] })).toEqual({ ok: false, error: BOOKING_WORDS.press.zoneUnknown });
    /* HeyTiff's own database, not ServiceM8: said as the panel's failed read */
    fake.failing.add("sm8_vendor");
    expect(await readBookInContext({ jobUuid: JOB, days: [TOMORROW] })).toEqual({ ok: false, error: BOOKING_WORDS.panel.readFailed });
    fake.failing.clear();
    fake.db.sm8_vendor = [{ org_id: ORG, uuid: TENANT, timezone_name: ZONE }];
    (fake.db.integration_connections[0] as Row).write_kinds = ["attachment", "note"];
    expect(await readBookInContext({ jobUuid: JOB, days: [TOMORROW] })).toEqual({ ok: false, error: BOOKING_WORDS.press.kindOff });
    expect(readSm8Job).not.toHaveBeenCalled();
    expect(sm8AccessResult).not.toHaveBeenCalled();
  });

  it("(F) a people list it couldn't read is the panel's failed read, not ServiceM8's", async () => {
    fake.failing.add("sm8_staff");
    expect(await readBookInContext({ jobUuid: JOB, days: [] })).toEqual({ ok: false, error: BOOKING_WORDS.panel.readFailed });
  });

  it("says a trial run, and what holds a booking", async () => {
    (fake.db.integration_connections[0] as Row).write_mode = "trial";
    expect(await readBookInContext({ jobUuid: JOB, days: [] })).toMatchObject({ ok: true, trial: true, hold: null });
    (fake.db.integration_connections[0] as Row).write_mode = "paused";
    expect(await readBookInContext({ jobUuid: JOB, days: [] })).toMatchObject({ ok: true, trial: false, hold: "paused" });
  });
});

/* ── Book in ── */

describe("Book in's refusals before anything is queued (C-5)", () => {
  const refused = async (over: Partial<BookIn>, error: string, now?: number) => {
    expect(await book(over, now)).toMatchObject({ ok: false, error });
    expect(booking()).toEqual([]);
    expect(postSm8Booking).not.toHaveBeenCalled();
  };

  it("(F) nine rows is more than a press books", async () => {
    await refused({ bookings: Array.from({ length: 9 }, (_, i) => one({ start: `${String(8 + i).padStart(2, "0")}:00` })) }, BOOKING_WORDS.press.tooMany);
  });

  it("(F) a start off the 15-minute grid, a length the panel doesn't offer, or a day that isn't one is refused", async () => {
    await refused({ bookings: [one({ start: "20:10" })] }, BOOKING_WORDS.press.unqueued);
    await refused({ bookings: [one({ minutes: 45 })] }, BOOKING_WORDS.press.unqueued);
    await refused({ bookings: [one({ day: "2026-02-30" })] }, BOOKING_WORDS.press.unqueued);
  });

  it("(F) a booking that would cross midnight is refused", async () => {
    await refused({ bookings: [one({ start: "23:00", minutes: 120 })] }, BOOKING_WORDS.press.crossesMidnight);
  });

  it("(F) the same person at the same start twice is refused", async () => {
    await refused({ bookings: [one(), one({ minutes: 120 })] }, BOOKING_WORDS.press.twice);
  });

  it("(F) someone ServiceM8 has inactive is refused by name", async () => {
    await refused({ bookings: [one({ staffUuid: DREW })] }, "Drew Tester isn't active in ServiceM8.");
  });

  it("(F) a start that has passed is refused", async () => {
    await refused({ bookings: [one({ day: dayFrom(-1) })] }, BOOKING_WORDS.press.past);
  });

  describe("with Make it a Work Order", () => {
    /* Brisbane keeps one offset all year, so an instant 12 minutes before
       a booking is simple arithmetic */
    const BRISBANE = "Australia/Brisbane";
    const day = dayFrom(1, BRISBANE);
    const eight = Date.parse(`${day}T20:00:00+10:00`);
    beforeEach(() => {
      fake.db.sm8_vendor = [{ org_id: ORG, uuid: TENANT, timezone_name: BRISBANE }];
    });
    const at12 = (ms: number) => {
      jest.spyOn(Date, "now").mockReturnValue(ms);
      return ms;
    };

    it("(F) a start less than 12 minutes off is refused tooSoon; the same start without the tick is booked", async () => {
      const now = at12(eight - 12 * 60_000 + 1);
      await refused({ makeWorkOrder: true, bookings: [one({ day })] }, BOOKING_WORDS.press.tooSoon, now);
      const r = await book({ makeWorkOrder: false, bookings: [one({ day })] }, now);
      expect(r.ok).toBe(true);
      expect(creates()).toHaveLength(1);
      expect(statusRows()).toEqual([]);
    });

    it("(F) a start exactly 12 minutes off passes, and its status change still goes at the end of the full two-minute wait", async () => {
      const now = at12(eight - 12 * 60_000);
      /* the press's own send held back, to be run at the wait's end */
      settlePressedWrites.mockResolvedValue(undefined);
      const r = await book({ makeWorkOrder: true, bookings: [one({ day })] }, now);
      expect(r.ok).toBe(true);
      const [s] = statusRows();
      const [c] = creates();
      expect(c.depends_on).toBe(s.id);
      /* exactly two minutes on: the booking is exactly 10 minutes off, and
         the alone rule's lead is inclusive */
      await runSm8Writes(ORG, "send", { clock: () => now + 2 * 60_000 });
      expect(s.status).toBe("sent");
      expect(c.status).toBe("sent");
      expect(sm8.statusPosts).toEqual([[JOB, "Work Order"]]);
    });
  });
});

describe("the clocks going forward", () => {
  /* Sydney's clocks go from 2:00 to 3:00 am on Sunday 4 October 2026 */
  const before = Date.parse("2026-09-30T00:00:00Z");

  it("(F) a start or an end in the hour the clocks skip is refused, and the hours either side of it are booked", async () => {
    jest.spyOn(Date, "now").mockReturnValue(before);
    const words = fillPlace("Sydney");
    for (const [start, minutes] of [
      ["02:00", 60],
      ["02:30", 30],
      ["02:45", 60],
      ["01:30", 60],
      ["01:00", 60],
    ] as const) {
      expect([start, await book({ bookings: [one({ day: "2026-10-04", start, minutes })] }, before)]).toEqual([
        start,
        { ok: false, error: words },
      ]);
    }
    expect(booking()).toEqual([]);
    /* 1:00 to 1:30 am, and 3:00 to 3:30 am, both happen */
    for (const start of ["01:00", "03:00"]) {
      const r = await book({ bookings: [one({ day: "2026-10-04", start, minutes: 30 })] }, before);
      expect([start, r]).toEqual([start, expect.objectContaining({ ok: true })]);
    }
  });

  it("an hour the clocks repeat, going back, is booked", async () => {
    /* Sydney's clocks go from 3:00 back to 2:00 am on Sunday 4 April 2027 */
    const then = Date.parse("2027-03-30T00:00:00Z");
    jest.spyOn(Date, "now").mockReturnValue(then);
    const r = await book({ bookings: [one({ day: "2027-04-04", start: "02:30", minutes: 30 })] }, then);
    expect(r.ok).toBe(true);
  });

  const fillPlace = (place: string) => BOOKING_WORDS.press.clocksForward.replace("{place}", place);
});

describe("Book in's zone (C-3)", () => {
  it("(F) with no zone known, Book in is refused zoneUnknown and queues nothing — there is no Sydney fallback", async () => {
    fake.db.sm8_vendor = [];
    expect(await book()).toEqual({ ok: false, error: BOOKING_WORDS.press.zoneUnknown });
    fake.db.sm8_vendor = [{ org_id: ORG, uuid: TENANT, timezone_name: "Mars/Base" }];
    expect(await book()).toEqual({ ok: false, error: BOOKING_WORDS.press.zoneUnknown });
    fake.failing.add("sm8_vendor");
    expect(await book()).toEqual({ ok: false, error: BOOKING_WORDS.press.unreadable });
    expect(booking()).toEqual([]);
  });
});

describe("Book in is fresh enough, as advice (C-6)", () => {
  it("(F) a read more than 10 minutes old is refused stale, with Look again", async () => {
    const r = await book({ seen: { jobEditDate: EDITED, readAt: new Date(Date.now() - 10 * 60_000 - 1_000).toISOString() } });
    expect(r).toEqual({ ok: false, error: BOOKING_WORDS.press.stale, lookAgain: true });
    expect(await book({ seen: { jobEditDate: EDITED, readAt: "not a time" } })).toMatchObject({ error: BOOKING_WORDS.press.stale });
    expect(booking()).toEqual([]);
  });

  it("(F) a job the mirror has edited since the read is refused changed, with Look again", async () => {
    (fake.db.sm8_jobs[0] as Row).edit_date = "2026-09-27 16:30:00";
    expect(await book()).toEqual({ ok: false, error: BOOKING_WORDS.press.changed, lookAgain: true });
    expect(booking()).toEqual([]);
  });

  it("(F) the job as the mirror has it: a job gone, or finished, is refused", async () => {
    expect(await book({ jobUuid: DONE_JOB })).toEqual({ ok: false, error: "This job is Completed in ServiceM8, so it can't be booked." });
    (fake.db.sm8_jobs[0] as Row).active = 0;
    expect(await book()).toEqual({ ok: false, error: BOOKING_WORDS.press.jobGone });
    expect(booking()).toEqual([]);
  });
});

describe("the status change follows the tick, not the browser (C-7)", () => {
  it("(F) Make it a Work Order queues the status change, then each booking behind it — and both go", async () => {
    const r = await book({ makeWorkOrder: true, bookings: [one(), one({ staffUuid: CASEY })] });
    if (!r.ok) throw new Error(r.error);
    const [s] = statusRows();
    expect(s).toMatchObject({ target_uuid: JOB, job_status_from: "Quote", job_status_to: "Work Order", seen_edit_date: EDITED });
    expect(creates().map((c) => c.depends_on)).toEqual([s.id, s.id]);
    expect([s.status, ...creates().map((c) => c.status)]).toEqual(["sent", "sent", "sent"]);
    // the answer is the press's one verb: the status change said once, then its bookings
    expect(r.verb.status?.state.key).toBe("line.statusSent");
    expect(r.verb.bookings.map((b) => [b.name, b.state.key])).toEqual([
      ["Alex Tester", "line.sent"],
      ["Casey Tester", "line.sent"],
    ]);
  });

  it("(F) ...whatever the job is: on a Work Order the status row is queued, and goes with no request", async () => {
    const r = await book({ jobUuid: WO_JOB, makeWorkOrder: true });
    expect(r.ok).toBe(true);
    const [s] = statusRows();
    expect(creates()[0].depends_on).toBe(s.id);
    expect(s.status).toBe("sent");
    expect(postSm8JobStatus).not.toHaveBeenCalled();
    expect(creates()[0].status).toBe("sent");
  });

  it("(F) without the tick, only the bookings are queued", async () => {
    const r = await book({ makeWorkOrder: false });
    expect(r.ok).toBe(true);
    expect(statusRows()).toEqual([]);
    expect(creates().map((c) => c.depends_on)).toEqual([null]);
  });

  it("(F) with the tick and no edit time to change it from, nothing is queued", async () => {
    expect(await book({ makeWorkOrder: true, seen: { jobEditDate: null, readAt: new Date().toISOString() } })).toEqual({
      ok: false,
      error: BOOKING_WORDS.press.changed,
      lookAgain: true,
    });
    expect(booking()).toEqual([]);
  });
});

describe("a press of Book in, again", () => {
  it("(F) the same press twice is one booking and one answer, even once the first has gone", async () => {
    const pressId = randomUUID();
    const first = await book({ pressId });
    const second = await book({ pressId });
    expect(first.ok && second.ok).toBe(true);
    expect(creates()).toHaveLength(1);
    expect(postSm8Booking).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("(F) the same press id from someone else is their own press, never an answer from mine", async () => {
    const pressId = randomUUID();
    const mine = await book({ pressId });
    expect(mine.ok).toBe(true);
    as(COOWNER);
    expect(await book({ pressId })).toEqual({ ok: false, error: "Alex Tester is already booked on this job at that time." });
    expect(creates()).toHaveLength(1);
  });

  it("(F) the job in another spelling is the same job: one slot, one row, under the mirror's uuid, and its lines read", async () => {
    const first = await book({ jobUuid: JOB.toUpperCase() });
    expect(first.ok && first.verb.bookings).toHaveLength(1);
    expect(creates().map((c) => c.sm8_job_uuid)).toEqual([JOB]);
    expect(await book()).toEqual({ ok: false, error: "Alex Tester is already booked on this job at that time." });
    expect(creates()).toHaveLength(1);
    /* the second press, in the other spelling, answers the same verb */
    const pressId = randomUUID();
    settlePressedWrites.mockResolvedValue(undefined);
    const a = await book({ pressId, bookings: [one({ start: "18:00" })] });
    const b = await book({ pressId, jobUuid: JOB.toUpperCase(), bookings: [one({ start: "18:00" })] });
    expect(b).toEqual(a);
    expect(creates()).toHaveLength(2);
    /* the poll and a line's own presses find them whatever the spelling */
    expect((await readBookingStates({ jobUuid: JOB.toUpperCase() }))?.verbs).toHaveLength(2);
    const c = creates()[0];
    settlePressedWrites.mockImplementation(actualDrain.settlePressedWrites);
    expect(await takeBackBooking({ jobUuid: JOB.toUpperCase(), rowId: String(c.id) })).toEqual({ ok: true, line: null });
  });

  it("(F) answers with the rows it queued when its lines couldn't be read, so the card polls for them", async () => {
    let failNow = false;
    fake.before.sm8_writes = (s) => (failNow && s.op === "select" && (s.columns ?? "").includes("created_at") ? "fail" : undefined);
    settlePressedWrites.mockImplementation(async () => {
      failNow = true;
    });
    const r = await book();
    expect(r).toMatchObject({ ok: true, verb: { bookings: [] }, rowIds: [creates()[0].id] });
  });

  it("(F) a slot already booked by another press is refused by name; one already on its way says so", async () => {
    await sentBooking();
    expect(await book()).toEqual({ ok: false, error: "Alex Tester is already booked on this job at that time." });
    settlePressedWrites.mockResolvedValue(undefined);
    await book({ bookings: [one({ start: "18:00" })] });
    expect(await book({ bookings: [one({ start: "18:00" })] })).toEqual({ ok: false, error: BOOKING_WORDS.press.onItsWay });
  });
});

/* ── a line's own presses ── */

describe("Undo (C-8, C-8b)", () => {
  it("(F) takes back its presser's booking: read, DELETEd once, and its line goes", async () => {
    const c = await sentBooking();
    const r = await takeBackBooking({ jobUuid: JOB, rowId: String(c.id) });
    expect(r).toEqual({ ok: true, line: null });
    expect(deletes()).toHaveLength(1);
    expect(sm8.deletes).toEqual([c.remote_uuid]);
  });

  it("(F) anyone else is refused, by the presser's name, and nothing changes", async () => {
    const c = await sentBooking();
    as(COOWNER);
    const r = await takeBackBooking({ jobUuid: JOB, rowId: String(c.id) });
    expect(r).toMatchObject({
      ok: false,
      error: "Only Owner Tester, who booked it, can take it back here. It can be removed in ServiceM8.",
      line: { key: "line.sent", acts: ["open_in_sm8"] },
    });
    expect(c.taken_back_at).toBeNull();
    expect(deletes()).toEqual([]);
  });

  it("(F) a booking that has started is refused notFuture, and nothing changes", async () => {
    const c = await sentBooking();
    const started = localNow(ZONE, Date.now() - 3_600_000)!.slice(0, 16) + ":00";
    c.booking_start = started;
    sm8.moveThere(String(c.remote_uuid), { start: started });
    const r = await takeBackBooking({ jobUuid: JOB, rowId: String(c.id) });
    expect(r).toMatchObject({ ok: false, error: BOOKING_WORDS.press.notFuture });
    expect(c.taken_back_at).toBeNull();
    expect(deletes()).toEqual([]);
  });

  it("(F, C-8b) one the mirror shows moved in ServiceM8 is refused changedNoUndo, and nothing is queued", async () => {
    const c = await sentBooking();
    mirrored({
      uuid: c.remote_uuid,
      job_uuid: JOB,
      staff_uuid: ALEX,
      start_date: at(TOMORROW, "20:30"),
      end_date: at(TOMORROW, "21:30"),
    });
    const r = await takeBackBooking({ jobUuid: JOB, rowId: String(c.id) });
    expect(r).toMatchObject({ ok: false, error: BOOKING_WORDS.press.changedNoUndo, line: { key: "line.changedThere", acts: [] } });
    expect(c.taken_back_at).toBeNull();
    expect(deletes()).toEqual([]);
    expect(sm8.deletes).toEqual([]);
  });

  it("(F) a row that isn't this job's booking is refused changed, and nothing changes", async () => {
    const c = await sentBooking();
    expect(await takeBackBooking({ jobUuid: WO_JOB, rowId: String(c.id) })).toEqual({ ok: false, error: BOOKING_WORDS.press.changed });
    expect(c.taken_back_at).toBeNull();
    expect(takeBackQueue).not.toHaveBeenCalled();
  });
});

describe("Try again", () => {
  it("(F) a time the clocks skip that day is said in the clocks' words", async () => {
    /* Sydney's clocks go from 2:00 to 3:00 am on Sunday 4 October 2026 */
    const before = Date.parse("2026-09-30T00:00:00Z");
    jest.spyOn(Date, "now").mockReturnValue(before);
    postSm8Booking.mockImplementationOnce(refusedOnce);
    await book({ bookings: [one({ day: "2026-10-03" })] }, before);
    const [c] = creates();
    expect(c.status).toBe("failed");
    Object.assign(c, { booking_start: "2026-10-04 02:30:00", booking_end: "2026-10-04 03:30:00" });
    expect(await retryBooking({ jobUuid: JOB, rowId: String(c.id) })).toMatchObject({
      ok: false,
      error: BOOKING_WORDS.press.clocksForward.replace("{place}", "Sydney"),
    });
    expect(c.status).toBe("failed");
  });

  it("(F) a row that isn't this job's booking is refused changed, and nothing goes", async () => {
    postSm8Booking.mockImplementationOnce(refusedOnce);
    await book();
    const [c] = creates();
    expect(c.status).toBe("failed");
    expect(await retryBooking({ jobUuid: WO_JOB, rowId: String(c.id) })).toEqual({ ok: false, error: BOOKING_WORDS.press.changed });
    expect(c.status).toBe("failed");
    expect(postSm8Booking).toHaveBeenCalledTimes(1);
  });

  it("(F) goes again through its one door, and answers with the line", async () => {
    postSm8Booking.mockImplementationOnce(refusedOnce);
    const r = await book();
    expect(r.ok).toBe(true);
    const [c] = creates();
    expect(c.status).toBe("failed");
    const again = await retryBooking({ jobUuid: JOB, rowId: String(c.id) });
    expect(again).toMatchObject({ ok: true, line: { key: "line.sent" } });
    expect(c.status).toBe("sent");
  });

  it("(F) a status change taken back sends the card to Look again, and queues nothing", async () => {
    settlePressedWrites.mockResolvedValue(undefined);
    await book({ makeWorkOrder: true });
    const [s] = statusRows();
    const [c] = creates();
    Object.assign(s, { status: "cancelled", taken_back_at: new Date().toISOString() });
    Object.assign(c, { status: "cancelled", last_error: BOOKING_WORDS.row.statusFirst });
    const r = await retryBooking({ jobUuid: JOB, rowId: String(c.id) });
    expect(r).toMatchObject({ ok: false, error: BOOKING_WORDS.press.changed, lookAgain: true });
    expect(c.status).toBe("cancelled");
  });
});

describe("Clear a leftover booking (C-9)", () => {
  const clearIt = (a: Row, over: Partial<Parameters<typeof clearLeftoverBooking>[0]> = {}) =>
    clearLeftoverBooking({
      jobUuid: String(a.job_uuid),
      activityUuid: String(a.uuid),
      seen: { staffUuid: String(a.staff_uuid), start: String(a.start_date) },
      pressId: randomUUID(),
      ...over,
    });

  it("(F) queues clear:<uuid> once with the mirror's copy, and takes it out of ServiceM8 — a double press is one row", async () => {
    const a = leftover();
    const r = await clearIt(a);
    expect(r).toEqual({ ok: true, line: null });
    const [d] = deletes();
    expect(d).toMatchObject({
      subject: `clear:${a.uuid}`,
      target_uuid: a.uuid,
      booking_staff_uuid: CASEY,
      booking_start: a.start_date,
      booking_end: a.end_date,
      status: "sent",
    });
    expect(sm8.active(String(a.uuid))).toBe(false);
    expect(await clearIt(a)).toEqual({ ok: true, line: null });
    expect(deletes()).toHaveLength(1);
    expect(sm8.deletes).toEqual([a.uuid]);
  });

  it("(F) covers an Unsuccessful job", async () => {
    const a = leftover(LOST_JOB);
    expect(await clearIt(a)).toEqual({ ok: true, line: null });
    expect(sm8.active(String(a.uuid))).toBe(false);
  });

  it("(F) refuses what isn't a leftover: a job still open, one with no person or no end", async () => {
    expect(await clearIt(leftover(WO_JOB))).toEqual({ ok: false, error: BOOKING_WORDS.press.notLeftover });
    expect(await clearIt(leftover(DONE_JOB, { staff_uuid: null }))).toEqual({ ok: false, error: BOOKING_WORDS.press.notLeftover });
    expect(await clearIt(leftover(DONE_JOB, { end_date: null }))).toEqual({ ok: false, error: BOOKING_WORDS.press.notLeftover });
    expect(deletes()).toEqual([]);
  });

  it("(F) refuses one whose person or start isn't the one the confirm showed — the browser's copy is only compared", async () => {
    const a = leftover();
    expect(await clearIt(a, { seen: { staffUuid: ALEX, start: String(a.start_date) } })).toEqual({ ok: false, error: BOOKING_WORDS.press.changed });
    expect(await clearIt(a, { seen: { staffUuid: CASEY, start: at(TOMORROW, "08:00") } })).toEqual({ ok: false, error: BOOKING_WORDS.press.changed });
    expect(deletes()).toEqual([]);
  });
});

/* ── the card's poll ── */

describe("the card's poll (C-11)", () => {
  /** A Book in whose status change went and whose bookings are still
      queued, never tried: a run the meter stopped right after it. */
  async function halfWay(job = JOB): Promise<{ s: Row; cs: Row[] }> {
    settlePressedWrites.mockResolvedValue(undefined);
    const r = await book({ jobUuid: job, makeWorkOrder: true, bookings: [one(), one({ staffUuid: CASEY })] });
    if (!r.ok) throw new Error(r.error);
    settlePressedWrites.mockImplementation(actualDrain.settlePressedWrites);
    const s = statusRows().find((x) => x.sm8_job_uuid === job)!;
    s.status = "sent";
    sm8.jobs.get(job)!.status = "Work Order";
    return { s, cs: creates().filter((c) => c.sm8_job_uuid === job) };
  }
  const run = async () => {
    for (const fn of scheduled.splice(0)) await fn();
  };
  /** Nothing the setting-up did is counted. */
  const fresh = () => {
    runSm8Writes.mockClear();
    settlePressedWrites.mockClear();
    scheduled.length = 0;
  };

  it("(F) sends only that job's bookings behind a status change that went, while every one is untried — and never drains", async () => {
    const mine = await halfWay(JOB);
    const theirs = await halfWay(WO_JOB);
    fresh();
    const read = await readBookingStates({ jobUuid: JOB });
    expect(read?.verbs).toHaveLength(1);
    await run();
    expect(runSm8Writes).toHaveBeenCalledTimes(1);
    const [org, trigger, opts] = runSm8Writes.mock.calls[0] as [string, string, { ids: string[]; budgetMs: number }];
    expect([org, trigger, [...opts.ids].sort(), opts.budgetMs]).toEqual([ORG, "send", mine.cs.map((c) => c.id).sort(), 8_000]);
    expect(Object.keys(opts).sort()).toEqual(["budgetMs", "ids"]);
    expect(mine.cs.map((c) => c.status)).toEqual(["sent", "sent"]);
    expect(theirs.cs.map((c) => c.status)).toEqual(["queued", "queued"]);
    expect(drainSm8WritesAfterResponse).not.toHaveBeenCalled();
    expect(settlePressedWrites).not.toHaveBeenCalled();
  });

  it("(F) sends nothing once one of them has met an unreachable ServiceM8: the verb waits for its retry time", async () => {
    const { cs } = await halfWay();
    cs[1].attempts = 1;
    fresh();
    await readBookingStates({ jobUuid: JOB });
    await run();
    expect(runSm8Writes).not.toHaveBeenCalled();
    expect(cs.map((c) => c.status)).toEqual(["queued", "queued"]);
  });

  it("(F) answers nothing, and sends nothing, when the write settings can't be read — never an empty list", async () => {
    await halfWay();
    fresh();
    fake.failing.add("integration_connections");
    expect(await readBookingStates({ jobUuid: JOB })).toBeNull();
    await run();
    expect(runSm8Writes).not.toHaveBeenCalled();
  });

  it("(F) sends nothing behind a status change that hasn't gone", async () => {
    const { s } = await halfWay();
    s.status = "queued";
    fresh();
    await readBookingStates({ jobUuid: JOB });
    await run();
    expect(runSm8Writes).not.toHaveBeenCalled();
  });

  it("(F) a presser who may no longer press keeps the lines, not the doors — nor anyone's Clear", async () => {
    const c = await sentBooking();
    const key = String(c.remote_uuid).toLowerCase();
    settlePressedWrites.mockResolvedValue(undefined);
    const a = leftover();
    await clearLeftoverBooking({ jobUuid: DONE_JOB, activityUuid: String(a.uuid), seen: { staffUuid: CASEY, start: String(a.start_date) }, pressId: randomUUID() });
    const d = deletes().find((x) => x.target_uuid === a.uuid)!;
    Object.assign(d, { status: "failed", last_error: BOOKING_WORDS.row.removeRefused });
    as(OWNER, "admin");
    expect((await readBookingStates({ jobUuid: JOB }))?.lines[key]?.acts).toEqual(["open_in_sm8"]);
    as(OWNER);
    caps = new Set(["workboard"]);
    expect((await readBookingStates({ jobUuid: JOB }))?.lines[key]?.acts).toEqual(["open_in_sm8"]);
    const clearLine = (await readBookingStates({ jobUuid: DONE_JOB }))?.verbs[0].bookings[0];
    expect(clearLine?.state.acts).toEqual([]);
    caps = new Set(["workboard", "workboard_manage"]);
    expect((await readBookingStates({ jobUuid: DONE_JOB }))?.verbs[0].bookings[0].state.acts).toEqual(["try_again"]);
  });

  it("(F) reads the lines with the presser's doors, and the job's bookings we removed", async () => {
    const c = await sentBooking();
    const key = String(c.remote_uuid).toLowerCase();
    expect((await readBookingStates({ jobUuid: JOB }))?.lines[key]?.acts).toEqual(["undo", "open_in_sm8"]);
    as(COOWNER);
    expect((await readBookingStates({ jobUuid: JOB }))?.lines[key]?.acts).toEqual(["open_in_sm8"]);
    as(OWNER);
    await takeBackBooking({ jobUuid: JOB, rowId: String(c.id) });
    expect(await readBookingStates({ jobUuid: JOB })).toEqual({ verbs: [], lines: {}, gone: [key] });
  });
});

/* ── what a press asks the pages for again ── */

describe("a press asks the pages again only when it changed something", () => {
  it("(F) a refused press revalidates nothing; one that queued does", async () => {
    const c = await sentBooking();
    const revalidate = revalidatePath as jest.Mock;
    expect(revalidate).toHaveBeenCalled();
    revalidate.mockClear();
    expect((await book()).ok).toBe(false);
    as(COOWNER);
    expect((await takeBackBooking({ jobUuid: JOB, rowId: String(c.id) })).ok).toBe(false);
    expect((await retryBooking({ jobUuid: JOB, rowId: String(c.id) })).ok).toBe(false);
    const a = leftover(WO_JOB);
    expect(
      (await clearLeftoverBooking({ jobUuid: WO_JOB, activityUuid: String(a.uuid), seen: { staffUuid: CASEY, start: String(a.start_date) }, pressId: randomUUID() })).ok
    ).toBe(false);
    expect(revalidate).not.toHaveBeenCalled();
    as(OWNER);
    await takeBackBooking({ jobUuid: JOB, rowId: String(c.id) });
    expect(revalidate).toHaveBeenCalled();
  });
});

/* ── every press drains ── */

describe("every press drains (C-13)", () => {
  const settled = () => settlePressedWrites.mock.calls.map((c) => [c[0], c[1], (c[2] as { budgetMs: number }).budgetMs]);

  it("(F) Book in, Undo, Try again and Clear each settle the rows they queued", async () => {
    const r = await book();
    expect(r.ok).toBe(true);
    const [c] = creates();
    expect(settled()).toEqual([[ORG, [c.id], 8_000]]);

    settlePressedWrites.mockClear();
    await takeBackBooking({ jobUuid: JOB, rowId: String(c.id) });
    expect(settled()).toEqual([[ORG, [deletes()[0].id], 8_000]]);

    postSm8Booking.mockImplementationOnce(refusedOnce);
    await book({ bookings: [one({ start: "18:00" })] });
    const failed = creates().at(-1)!;
    settlePressedWrites.mockClear();
    await retryBooking({ jobUuid: JOB, rowId: String(failed.id) });
    expect(settled()).toEqual([[ORG, [failed.id], 8_000]]);

    const a = leftover();
    settlePressedWrites.mockClear();
    await clearLeftoverBooking({
      jobUuid: DONE_JOB,
      activityUuid: String(a.uuid),
      seen: { staffUuid: CASEY, start: String(a.start_date) },
      pressId: randomUUID(),
    });
    expect(settled()).toEqual([[ORG, [deletes().find((d) => d.target_uuid === a.uuid)!.id], 8_000]]);
  });

  it("(F) a settle that throws never fails the press", async () => {
    settlePressedWrites.mockRejectedValue(new Error("the drain fell over"));
    const r = await book();
    expect(r.ok).toBe(true);
    const [c] = creates();
    expect(await takeBackBooking({ jobUuid: JOB, rowId: String(c.id) })).toMatchObject({ ok: true });
    const a = leftover();
    expect(
      await clearLeftoverBooking({ jobUuid: DONE_JOB, activityUuid: String(a.uuid), seen: { staffUuid: CASEY, start: String(a.start_date) }, pressId: randomUUID() })
    ).toMatchObject({ ok: true });
    c.status = "failed";
    c.taken_back_at = null;
    c.last_error = BOOKING_WORDS.row.refused;
    expect(await retryBooking({ jobUuid: JOB, rowId: String(c.id) })).toMatchObject({ ok: true });
  });
});

/* ── the queue's calm answers ── */

describe("an Undo or a Clear that meets one already on its way", () => {
  /** Book in, sent, then the job finished in the mirror with the booking
      listed: a leftover a Clear can take. */
  async function sentThenFinished(): Promise<Row> {
    const c = await sentBooking();
    (fake.db.sm8_jobs[0] as Row).status = "Completed";
    sm8.jobs.get(JOB)!.status = "Completed";
    mirrored({ uuid: c.remote_uuid, job_uuid: JOB, staff_uuid: ALEX, start_date: c.booking_start, end_date: c.booking_end });
    return c;
  }
  const clearOf = (c: Row) =>
    clearLeftoverBooking({
      jobUuid: JOB,
      activityUuid: String(c.remote_uuid),
      seen: { staffUuid: ALEX, start: String(c.booking_start) },
      pressId: randomUUID(),
    });
  /** Nothing the setting-up sent is counted, and nothing more goes. */
  const hold = () => {
    settlePressedWrites.mockReset().mockResolvedValue(undefined);
    deleteSm8Booking.mockClear();
  };

  it("(F) Undo pressed again while its take-back is on its way answers with its line, and queues nothing and asks ServiceM8 nothing", async () => {
    const c = await sentBooking();
    hold();
    await takeBackBooking({ jobUuid: JOB, rowId: String(c.id) });
    expect(deletes()).toHaveLength(1);
    settlePressedWrites.mockClear();
    expect(await takeBackBooking({ jobUuid: JOB, rowId: String(c.id) })).toEqual({
      ok: true,
      line: expect.objectContaining({ key: "line.takingOut" }),
    });
    expect(deletes()).toHaveLength(1);
    expect(settlePressedWrites.mock.calls.map((x) => x[1])).toEqual([[]]);
    expect(deleteSm8Booking).not.toHaveBeenCalled();
  });

  it("(F) Clear pressed again while it is on its way answers with its line, and queues nothing", async () => {
    const c = await sentThenFinished();
    hold();
    expect((await clearOf(c)).ok).toBe(true);
    settlePressedWrites.mockClear();
    expect(await clearOf(c)).toEqual({ ok: true, line: expect.objectContaining({ key: "line.clearing" }) });
    expect(deletes()).toHaveLength(1);
    expect(settlePressedWrites.mock.calls.map((x) => x[1])).toEqual([[]]);
    expect(deleteSm8Booking).not.toHaveBeenCalled();
  });

  it("(F) Undo that meets a Clear of its booking on its way says it's still being taken out, and changes nothing", async () => {
    const c = await sentThenFinished();
    hold();
    expect((await clearOf(c)).ok).toBe(true);
    settlePressedWrites.mockClear();
    expect(await takeBackBooking({ jobUuid: JOB, rowId: String(c.id) })).toMatchObject({ ok: false, error: BOOKING_WORDS.press.takingOut });
    expect(c.taken_back_at).toBeNull();
    expect(deletes()).toHaveLength(1);
    expect(settlePressedWrites).not.toHaveBeenCalled();
    expect(deleteSm8Booking).not.toHaveBeenCalled();
  });

  it("(F) Clear that meets our take-back of its booking on its way says it's still being taken out, and changes nothing", async () => {
    const c = await sentThenFinished();
    hold();
    await takeBackBooking({ jobUuid: JOB, rowId: String(c.id) });
    expect(deletes()).toHaveLength(1);
    settlePressedWrites.mockClear();
    expect(await clearOf(c)).toEqual({ ok: false, error: BOOKING_WORDS.press.takingOut });
    expect(deletes()).toHaveLength(1);
    expect(settlePressedWrites).not.toHaveBeenCalled();
    expect(deleteSm8Booking).not.toHaveBeenCalled();
  });
});
