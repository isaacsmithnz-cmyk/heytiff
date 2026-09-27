/**
 * @jest-environment node
 */

/* Reading for a booking (two-way phase 3, PR C).

   THE LIVE READS BEFORE A PRESS (C-1, C-2): the panel's three calls go
   through the one door (sm8Request, behind fetchSm8Page) on lane `read`,
   with the spec's filters, rows shaped as the mirror shapes them; a failure
   says sm8-read's words, and a day that couldn't be read is advice only.
   ServiceM8 is replaced at fetch, and the account's counter at its turn,
   so the door itself runs.

   THE ZONE (C-3): the account's own, and no Sydney fallback.

   WHAT OUR ROWS SAY (C-11's lines): every press on a job as one verb, the
   status change said once, the line on a standing booking by its uuid, and
   every door the presser's alone — against the in-memory database that
   keeps the bookings migration's rules. */

import { makeFakeDb } from "./fixtures/sm8-fake-db";

const fake = makeFakeDb();
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (t: string) => fake.from(t),
    rpc: (n: string, a: Record<string, unknown>) => fake.rpc(n, a),
  },
}));

jest.mock("@/lib/auth0", () => ({ auth0: { getSession: jest.fn(async () => null) } }));

const sm8AccessResult = jest.fn();
const renewSm8Access = jest.fn();
const markSm8NeedsReauth = jest.fn();
jest.mock("../sm8-store", () => ({
  sm8AccessResult: (...a: unknown[]) => sm8AccessResult(...a),
  renewSm8Access: (...a: unknown[]) => renewSm8Access(...a),
  markSm8NeedsReauth: (...a: unknown[]) => markSm8NeedsReauth(...a),
}));

/* the account's counter: always a turn unless a test says otherwise, and
   each turn's lane is kept */
const takeTurn = jest.fn();
jest.mock("../sm8-meter", () => {
  const actual = jest.requireActual("../sm8-meter");
  return { ...actual, takeSm8Call: (...a: unknown[]) => takeTurn(...a), noteSm8Throttle: jest.fn(async () => {}) };
});

import { BUSY, BUSY_DAY, NOT_CONNECTED, REAUTH, UNAVAILABLE } from "../sm8-read";
import { bookingZone, readBookingContext, readBookingLines } from "../sm8-booking-read";
import { readSm8WriteState } from "../sm8-writes";
import { BOOKING_WORDS, localNow } from "../sm8-booking-plan";
import { SM8_OBJECTS } from "../sm8-sync-plan";

type Row = Record<string, unknown>;

const ORG = "org-1";
const TENANT = "vendor-1";
const ZONE = "Australia/Sydney";
/* made up: no real job, person or customer */
const JOB = "7c3a9e10-0000-4000-8000-000000009001";
const OTHER_JOB = "7c3a9e10-0000-4000-8000-000000009002";
const ALEX = "5b0c1d2e-0000-4000-8000-00000000a1e1";
const CASEY = "5b0c1d2e-0000-4000-8000-00000000c5e1";
const ACCESS = { accessToken: "tok-1", tenantId: TENANT, grant: "g1", meter: TENANT };
const RENEWED = { accessToken: "tok-2", tenantId: TENANT, grant: "g2", meter: TENANT };
const DAY = "2026-10-06";

const rawJob = (over: Row = {}): Row => ({
  uuid: JOB,
  status: "Quote",
  active: 1,
  edit_date: "2026-09-27 16:00:00",
  company_uuid: "c0ffee00-0000-4000-8000-000000000001",
  job_address: "",
  job_description: "A test job",
  category_uuid: "",
  purchase_order_number: "",
  generated_job_id: "9001",
  work_order_date: "0000-00-00 00:00:00",
  total_invoice_amount: "0.0000",
  work_done_description: "",
  queue_uuid: "",
  ...over,
});

let actSeq = 0;
const rawActivity = (over: Row = {}): Row => ({
  uuid: `a0000000-0000-4000-8000-${String(++actSeq).padStart(12, "0")}`,
  job_uuid: JOB,
  staff_uuid: ALEX,
  start_date: `${DAY} 09:00:00`,
  end_date: `${DAY} 11:00:00`,
  activity_was_scheduled: "1",
  activity_was_recorded: "0",
  active: 1,
  edit_date: "2026-09-27 16:05:00",
  ...over,
});

/* a served answer, shaped like the four things the door and the reader
   touch (sm8-read.test's fakes) */
const answer = (body: unknown, init: { status?: number; nextCursor?: string } = {}): Record<string, unknown> => {
  const status = init.status ?? 200;
  return {
    clone: () => answer(body, init),
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { get: (k: string) => (k === "x-next-cursor" ? (init.nextCursor ?? null) : null) },
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
};

/** ServiceM8, by what each request asks for. */
let served: { job: unknown; jobActs: unknown; day: Record<string, unknown> };
const realFetch = global.fetch;
const fetchMock = jest.fn();
const route = async (url: string) => {
  const u = new URL(url);
  const filter = u.searchParams.get("$filter") ?? "";
  const pick = (v: unknown) => (typeof v === "function" ? (v as (u: URL) => unknown)(u) : answer(v));
  if (u.pathname.endsWith("/job.json")) return pick(served.job);
  if (filter.startsWith("job_uuid eq")) return pick(served.jobActs);
  const day = /end_date gt '(\d{4}-\d{2}-\d{2}) 00:00:00'/.exec(filter)?.[1] ?? "";
  return pick(served.day[day] ?? []);
};
const urls = () => fetchMock.mock.calls.map((c) => new URL(c[0] as string));

beforeEach(() => {
  fake.reset();
  actSeq = 0;
  served = { job: [rawJob()], jobActs: [], day: {} };
  fetchMock.mockReset().mockImplementation(route);
  global.fetch = fetchMock as unknown as typeof fetch;
  takeTurn.mockReset().mockResolvedValue({ ok: true });
  sm8AccessResult.mockReset().mockResolvedValue({ ok: true, access: ACCESS });
  renewSm8Access.mockReset().mockResolvedValue({ ok: true, access: RENEWED });
  markSm8NeedsReauth.mockReset().mockResolvedValue(true);
  process.env.SM8_WRITES = "attachment,note,booking";
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  global.fetch = realFetch;
  delete process.env.SM8_WRITES;
});

/* ── the live reads before a press ── */

describe("the panel's live reads (C-1)", () => {
  it("(F) are exactly three calls, each through the one door on lane read, with the spec's filters and quotes", async () => {
    const r = await readBookingContext(ORG, JOB, [DAY]);
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // every call took its turn from the account's counter, as a read
    expect(takeTurn.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      [TENANT, "read"],
      [TENANT, "read"],
      [TENANT, "read"],
    ]);
    expect(urls().map((u) => u.origin + u.pathname)).toEqual([
      "https://api.servicem8.com/api_1.0/job.json",
      "https://api.servicem8.com/api_1.0/jobactivity.json",
      "https://api.servicem8.com/api_1.0/jobactivity.json",
    ]);
    expect(urls().map((u) => u.searchParams.get("$filter"))).toEqual([
      `uuid eq '${JOB}'`,
      `job_uuid eq '${JOB}' and active eq 1`,
      `active eq 1 and start_date lt '2026-10-07 00:00:00' and end_date gt '2026-10-06 00:00:00'`,
    ]);
    expect(urls().every((u) => u.searchParams.get("cursor") === "-1")).toBe(true);
  });

  it("(F) each more day is one more call; the next day is counted on the calendar, across a month and a year", async () => {
    await readBookingContext(ORG, JOB, ["2026-10-31", "2026-12-31", "2026-10-31", "2026-02-30", "not a day"]);
    // the job, its bookings, and the two real days, each once
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(urls().slice(2).map((u) => u.searchParams.get("$filter"))).toEqual([
      `active eq 1 and start_date lt '2026-11-01 00:00:00' and end_date gt '2026-10-31 00:00:00'`,
      `active eq 1 and start_date lt '2027-01-01 00:00:00' and end_date gt '2026-12-31 00:00:00'`,
    ]);
  });

  it("reads at most eight days", async () => {
    const days = Array.from({ length: 10 }, (_, i) => `2026-10-${String(10 + i).padStart(2, "0")}`);
    const r = await readBookingContext(ORG, JOB, days);
    expect(fetchMock).toHaveBeenCalledTimes(2 + 8);
    expect(r.ok && Object.keys(r.data.days)).toEqual(days.slice(0, 8));
  });

  it("(F) shapes every row as the mirror shapes one, and leaves out a row with no length", async () => {
    const odd = rawActivity({
      staff_uuid: "",
      end_date: "0000-00-00 00:00:00",
      edit_date: "0000-00-00",
      activity_was_scheduled: "0",
      activity_was_recorded: "1",
    });
    const plain = rawActivity();
    /* what clearing recorded time in ServiceM8 leaves behind (P4) */
    const cleared = rawActivity({ start_date: `${DAY} 10:00:00`, end_date: `${DAY} 10:00:00`, activity_was_scheduled: "0" });
    served.jobActs = [odd, plain, cleared];
    served.day[DAY] = [plain, cleared];
    const r = await readBookingContext(ORG, JOB, [DAY]);
    if (!r.ok) throw new Error(r.error);

    const mirror = SM8_OBJECTS.find((o) => o.object === "job_activities")!.shape;
    for (const raw of [odd, plain]) {
      const m = mirror(raw)!;
      const live = r.data.bookings.find((a) => a.uuid === raw.uuid)!;
      expect(live).toEqual({
        uuid: m.uuid,
        jobUuid: m.job_uuid,
        staffUuid: m.staff_uuid,
        start: m.start_date,
        end: m.end_date,
        scheduled: m.activity_was_scheduled,
        recorded: raw === odd ? 1 : 0,
        active: m.active,
        editDate: m.edit_date,
      });
    }
    expect(r.data.bookings.map((a) => a.uuid)).toEqual([odd.uuid, plain.uuid]);
    expect(r.data.days[DAY]!.map((a) => a.uuid)).toEqual([plain.uuid]);
  });

  it("reads the job alone when ServiceM8 hasn't got it, or it can't be booked", async () => {
    served.job = [];
    let r = await readBookingContext(ORG, JOB, [DAY]);
    expect(r).toMatchObject({ ok: true, data: { job: null, bookings: [], days: {} } });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    served.job = [rawJob({ status: "Completed" })];
    r = await readBookingContext(ORG, JOB, [DAY]);
    expect(r).toMatchObject({ ok: true, data: { job: { status: "Completed" }, bookings: [], days: {} } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("a read that fails (C-2)", () => {
  it("(F) the counter with no room for the job's read says sm8-read's busy words, for now or for the day — and nothing is fetched", async () => {
    takeTurn.mockResolvedValue({ ok: false, waitMs: 60_000, why: "cooldown_minute" });
    expect(await readBookingContext(ORG, JOB, [DAY])).toEqual({ ok: false, error: BUSY });
    takeTurn.mockResolvedValue({ ok: false, waitMs: 3_600_000, why: "day" });
    expect(await readBookingContext(ORG, JOB, [DAY])).toEqual({ ok: false, error: BUSY_DAY });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("(F) a job read or a bookings read that fails says ServiceM8 couldn't be reached — never ServiceM8's own words", async () => {
    served.job = () => answer("upstream exploded: internal detail", { status: 500 });
    expect(await readBookingContext(ORG, JOB, [DAY])).toEqual({ ok: false, error: UNAVAILABLE });

    served.job = [rawJob()];
    served.jobActs = () => answer("nope", { status: 503 });
    expect(await readBookingContext(ORG, JOB, [DAY])).toEqual({ ok: false, error: UNAVAILABLE });

    /* ServiceM8's 429 is the busy words too */
    served.jobActs = () => answer("Number of allowed API requests per minute exceeded", { status: 429 });
    expect(await readBookingContext(ORG, JOB, [DAY])).toEqual({ ok: false, error: BUSY });
  });

  it("a job's bookings past three pages is a read that failed, never a list cut short", async () => {
    served.jobActs = () => answer([rawActivity()], { nextCursor: "next" });
    expect(await readBookingContext(ORG, JOB, [DAY])).toEqual({ ok: false, error: UNAVAILABLE });
  });

  it("(F) a day that couldn't be read is null, and the read is still good; so is one past three pages", async () => {
    served.jobActs = [rawActivity()];
    served.day[DAY] = () => answer("nope", { status: 500 });
    served.day["2026-10-07"] = () => answer([rawActivity()], { nextCursor: "more" });
    served.day["2026-10-08"] = [rawActivity({ start_date: "2026-10-08 07:00:00", end_date: "2026-10-08 08:00:00" })];
    const r = await readBookingContext(ORG, JOB, [DAY, "2026-10-07", "2026-10-08"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.bookings).toHaveLength(1);
    expect(r.data.days[DAY]).toBeNull();
    expect(r.data.days["2026-10-07"]).toBeNull();
    expect(r.data.days["2026-10-08"]).toHaveLength(1);
  });

  it("(F) a 401 is renewed once, and the read goes on under the renewed token", async () => {
    let first = true;
    served.job = () => {
      if (first) {
        first = false;
        return answer("expired", { status: 401 });
      }
      return answer([rawJob()]);
    };
    const r = await readBookingContext(ORG, JOB, [DAY]);
    expect(r.ok).toBe(true);
    expect(renewSm8Access).toHaveBeenCalledTimes(1);
    const tokens = fetchMock.mock.calls.map((c) => ((c[1] as RequestInit).headers as Record<string, string>).Authorization);
    expect(tokens).toEqual(["Bearer tok-1", "Bearer tok-2", "Bearer tok-2", "Bearer tok-2"]);
  });

  it("a grant that can't be used says why, in sm8-read's words", async () => {
    sm8AccessResult.mockResolvedValue({ ok: false, reason: "reauth" });
    expect(await readBookingContext(ORG, JOB, [DAY])).toEqual({ ok: false, error: REAUTH });
    sm8AccessResult.mockResolvedValue({ ok: false, reason: "not_connected" });
    expect(await readBookingContext(ORG, JOB, [DAY])).toEqual({ ok: false, error: NOT_CONNECTED });
    sm8AccessResult.mockResolvedValue({ ok: false, reason: "unreachable" });
    expect(await readBookingContext(ORG, JOB, [DAY])).toEqual({ ok: false, error: UNAVAILABLE });
    /* refused twice, a token apart: the grant is dead */
    sm8AccessResult.mockResolvedValue({ ok: true, access: ACCESS });
    served.job = () => answer("no", { status: 401 });
    expect(await readBookingContext(ORG, JOB, [DAY])).toEqual({ ok: false, error: REAUTH });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

/* ── the zone ── */

describe("the account's zone (C-3)", () => {
  it("(F) is the account's own: none synced is unknown, one Intl doesn't know is invalid, and there is no Sydney fallback", async () => {
    fake.db.sm8_vendor = [];
    expect(await bookingZone(ORG)).toEqual({ zone: null, why: "unknown" });
    fake.db.sm8_vendor = [{ org_id: ORG, uuid: TENANT, timezone_name: null }];
    expect(await bookingZone(ORG)).toEqual({ zone: null, why: "unknown" });
    fake.db.sm8_vendor = [{ org_id: ORG, uuid: TENANT, timezone_name: "Mars/Base" }];
    expect(await bookingZone(ORG)).toEqual({ zone: null, why: "invalid" });
    fake.db.sm8_vendor = [{ org_id: ORG, uuid: TENANT, timezone_name: "Australia/Perth" }];
    expect(await bookingZone(ORG)).toEqual({ zone: "Australia/Perth" });
    fake.failing.add("sm8_vendor");
    expect(await bookingZone(ORG)).toEqual({ zone: null, why: "unread" });
  });
});

/* ── what our rows say ── */

const OWNER = "auth0|owner-test";
const OTHER = "auth0|manager-test";

/** A day on the account's wall clock, `days` from today. */
const dayFrom = (days: number) => localNow(ZONE, Date.now() + days * 86_400_000)!.slice(0, 10);
const LATER = dayFrom(3);
const at = (hhmm: string, d = LATER) => `${d} ${hhmm}:00`;

let rowSeq = 0;
const rid = () => `b0000000-0000-4000-8000-${String(++rowSeq).padStart(12, "0")}`;
const uid = () => `e0000000-0000-4000-8000-${String(++rowSeq).padStart(12, "0")}`;
const minute = (n: number) => new Date(Date.parse("2026-09-27T00:00:00Z") + n * 60_000).toISOString();

function bookingRow(over: Row): Row {
  const row: Row = {
    id: rid(),
    org_id: ORG,
    tenant_id: TENANT,
    kind: "booking",
    op: "create",
    status: "queued",
    subject: `row:${rowSeq}`,
    sm8_job_uuid: JOB,
    remote_uuid: uid(),
    replaced_uuids: [],
    maybe_landed: false,
    verify_uuids: [],
    taken_back_at: null,
    last_error: null,
    attempts: 0,
    depends_on: null,
    target_uuid: null,
    verb_id: null,
    booking_staff_uuid: null,
    booking_start: null,
    booking_end: null,
    booking_zone: null,
    landed_edit_date: null,
    seen_edit_date: null,
    requested_by: "staff-owner",
    requested_by_user: OWNER,
    lease_until: null,
    next_attempt_at: minute(0),
    created_at: minute(rowSeq),
    ...over,
  };
  (fake.db.sm8_writes ??= []).push(row);
  return row;
}

const statusRow = (verb: string, over: Row = {}) =>
  bookingRow({ op: "update", status: "sent", verb_id: verb, target_uuid: JOB, seen_edit_date: "2026-09-27 16:00:00", ...over });
const create = (verb: string, over: Row = {}) =>
  bookingRow({
    op: "create",
    verb_id: verb,
    booking_staff_uuid: ALEX,
    booking_start: at("20:00"),
    booking_end: at("21:00"),
    booking_zone: ZONE,
    ...over,
  });
const clear = (verb: string, target: string, over: Row = {}) =>
  bookingRow({
    op: "delete",
    verb_id: verb,
    target_uuid: target,
    booking_staff_uuid: CASEY,
    booking_start: at("07:00"),
    booking_end: at("09:00"),
    ...over,
  });
/** The mirror's copy of a booking, as the sync wrote it. */
const mirrored = (c: Row, over: Row = {}) =>
  fake.db.sm8_job_activities.push({
    org_id: ORG,
    uuid: c.remote_uuid,
    job_uuid: c.sm8_job_uuid,
    staff_uuid: c.booking_staff_uuid,
    start_date: c.booking_start,
    end_date: c.booking_end,
    activity_was_scheduled: 1,
    active: 1,
    edit_date: "2026-09-27 17:00:00",
    ...over,
  });

describe("what our rows say (C-11's lines)", () => {
  /* two presses of Book in */
  const V1 = "f0000000-0000-4000-8000-0000000000a1";
  const V2 = "f0000000-0000-4000-8000-0000000000b2";

  beforeEach(() => {
    rowSeq = 0;
    fake.db.integration_connections = [
      {
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
      },
    ];
    fake.db.sm8_vendor = [{ org_id: ORG, uuid: TENANT, timezone_name: ZONE }];
    fake.db.sm8_staff = [
      { org_id: ORG, uuid: ALEX, first: "Alex", last: "Tester", active: 1 },
      { org_id: ORG, uuid: CASEY, first: "Casey", last: "Tester", active: 1 },
    ];
    fake.db.sm8_jobs = [
      { org_id: ORG, uuid: JOB, active: 1, status: "Work Order", generated_job_id: "9001" },
      { org_id: ORG, uuid: OTHER_JOB, active: 1, status: "Completed", generated_job_id: "9002" },
    ];
    fake.db.sm8_job_activities = [];
    fake.db.sm8_writes = [];
  });

  const read = async (viewer = OWNER) => readBookingLines(ORG, await readSm8WriteState(ORG), JOB, viewer);

  it("(F) gives every door to the presser alone, but Open in ServiceM8; a standing booking's line is by its uuid, lower case", async () => {
    const s = statusRow(V1);
    const went = create(V1, { status: "sent", depends_on: s.id, landed_edit_date: "2026-09-27 17:00:00" });
    const waiting = create(V1, { depends_on: s.id, booking_start: at("21:00"), booking_end: at("22:00") });
    /* ServiceM8's mirror spells the uuid in capitals */
    mirrored(went, { uuid: String(went.remote_uuid).toUpperCase() });

    const mine = await read(OWNER);
    const key = String(went.remote_uuid).toLowerCase();
    expect(mine.lines[key]).toMatchObject({ key: "line.sent", text: BOOKING_WORDS.line.sent, acts: ["undo", "open_in_sm8"] });
    expect(mine.verbs).toHaveLength(1);
    expect(mine.verbs[0]).toMatchObject({ verbId: V1, presses: [V1], status: { rowId: s.id, state: { key: "line.statusSent" } } });
    expect(mine.verbs[0].bookings.map((b) => [b.rowId, b.name, b.standing, b.state.acts])).toEqual([
      [went.id, "Alex Tester", true, ["undo", "open_in_sm8"]],
      [waiting.id, "Alex Tester", false, ["cancel"]],
    ]);

    const theirs = await read(OTHER);
    expect(theirs.lines[key].acts).toEqual(["open_in_sm8"]);
    expect(theirs.verbs[0].bookings.map((b) => b.state.acts)).toEqual([["open_in_sm8"], []]);
  });

  it("(F) says a status change two presses share once, above both presses' bookings", async () => {
    const s = statusRow(V1, { status: "queued" });
    create(V1, { depends_on: s.id });
    create(V2, { depends_on: s.id, booking_staff_uuid: CASEY });
    const { verbs } = await read();
    expect(verbs).toHaveLength(1);
    expect(verbs[0].presses.sort()).toEqual([V1, V2].sort());
    expect(verbs[0].status?.state.key).toBe("line.statusSending");
    expect(verbs[0].bookings.map((b) => b.name)).toEqual(["Alex Tester", "Casey Tester"]);
  });

  it("(F) hands the poll the queued bookings behind a status change that went — only while every one is untried", async () => {
    const s = statusRow(V1);
    const a = create(V1, { depends_on: s.id });
    const b = create(V1, { depends_on: s.id, booking_staff_uuid: CASEY });
    /* one sent already, and one taken back: neither waits */
    create(V1, { depends_on: s.id, status: "sent", booking_start: at("06:00"), booking_end: at("07:00") });
    create(V1, { depends_on: s.id, taken_back_at: minute(5), booking_start: at("05:00"), booking_end: at("06:00") });
    expect((await read()).untried.sort()).toEqual([a.id, b.id].sort());

    /* one met an unreachable ServiceM8: the verb waits for its retry time */
    b.attempts = 1;
    expect((await read()).untried).toEqual([]);

    /* a status change that hasn't gone brings nothing */
    b.attempts = 0;
    s.status = "queued";
    expect((await read()).untried).toEqual([]);
  });

  it("(F) counts gone only this job's bookings we removed", async () => {
    const undone = create(V1, { status: "sent", taken_back_at: minute(9), replaced_uuids: ["e0000000-0000-4000-8000-00000000dead"] });
    bookingRow({ op: "delete", status: "sent", depends_on: undone.id, verb_id: V1 });
    const cleared = "e0000000-0000-4000-8000-0000000c1ea4";
    clear(V2, cleared, { status: "sent" });
    /* another job's Clear is its own */
    clear(V2, "e0000000-0000-4000-8000-0000000e15e0", { status: "sent", sm8_job_uuid: OTHER_JOB });
    const { gone } = await read();
    expect(gone).toEqual([String(undone.remote_uuid), "e0000000-0000-4000-8000-00000000dead", cleared].map((u) => u.toLowerCase()).sort());
  });

  it("(F) gives a Clear's doors to its presser alone, and says nothing once it went", async () => {
    const target = "e0000000-0000-4000-8000-0000000c1ea5";
    const c = clear(V2, target, { status: "failed", last_error: BOOKING_WORDS.row.removeRefused });
    let mine = (await read(OWNER)).verbs[0].bookings[0];
    expect(mine).toMatchObject({ rowId: c.id, op: "clear", uuid: target, name: "Casey Tester", standing: false });
    expect(mine.state).toMatchObject({ key: "line.notCleared", acts: ["try_again"] });
    expect((await read(OTHER)).verbs[0].bookings[0].state.acts).toEqual([]);
    c.status = "sent";
    mine = (await read(OWNER)).verbs[0]?.bookings[0];
    expect(mine).toBeUndefined();
  });

  it("reads nothing where the deployment books nothing", async () => {
    create(V1);
    process.env.SM8_WRITES = "attachment,note";
    fake.log.length = 0;
    expect(await read()).toEqual({ verbs: [], lines: {}, gone: [], untried: [] });
    expect(fake.on("sm8_writes")).toEqual([]);
  });
});
