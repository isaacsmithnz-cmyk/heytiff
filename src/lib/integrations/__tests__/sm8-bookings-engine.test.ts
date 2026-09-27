/**
 * @jest-environment node
 */

/* Bookings to ServiceM8 — the engine, end to end (two-way phase 3, PR B).

   The queue helpers (app/actions/sm8-booking-queue) and the sender
   (sm8-writes' run, sm8-booking-send) against an in-memory database that
   keeps the bookings migration's own rules — its shape check included
   (fixtures/sm8-fake-db) — with ServiceM8 replaced at the request
   functions by a fake that behaves as the live account did
   (fixtures/sm8-live-bookings): times as wall-clock text, a move keeping
   its uuid, and A DELETE ON A BOOKING ALREADY REMOVED PUTTING IT BACK.

   The spec's B-1 to B-23c, each named where it is held. */

import { randomUUID } from "node:crypto";
import { makeFakeDb, sm8WriteShapeOk } from "./fixtures/sm8-fake-db";
import { makeSm8Bookings, type Sm8Bookings } from "./fixtures/sm8-live-bookings";

type Row = Record<string, unknown>;

const fake = makeFakeDb();
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (t: string) => fake.from(t),
    rpc: (n: string, a: Record<string, unknown>) => fake.rpc(n, a),
    storage: {
      from: () => ({
        download: async () => ({ data: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])]), error: null }),
      }),
    },
  },
}));

const sm8AccessResult = jest.fn();
const renewSm8Access = jest.fn();
const markSm8NeedsReauth = jest.fn();
jest.mock("../sm8-store", () => ({
  sm8AccessResult: (...a: unknown[]) => sm8AccessResult(...a),
  renewSm8Access: (...a: unknown[]) => renewSm8Access(...a),
  markSm8NeedsReauth: (...a: unknown[]) => markSm8NeedsReauth(...a),
}));

const postSm8Attachment = jest.fn();
const readSm8Attachment = jest.fn();
const postSm8Note = jest.fn();
const updateSm8NoteCompleter = jest.fn();
const deleteSm8Note = jest.fn();
const readSm8Note = jest.fn();
const postSm8Booking = jest.fn();
const postSm8JobStatus = jest.fn();
const deleteSm8Booking = jest.fn();
const readSm8Booking = jest.fn();
const readSm8Job = jest.fn();
const readSm8JobBookings = jest.fn();
jest.mock("../sm8-write", () => ({
  postSm8Attachment: (...a: unknown[]) => postSm8Attachment(...a),
  readSm8Attachment: (...a: unknown[]) => readSm8Attachment(...a),
  postSm8Note: (...a: unknown[]) => postSm8Note(...a),
  updateSm8NoteCompleter: (...a: unknown[]) => updateSm8NoteCompleter(...a),
  deleteSm8Note: (...a: unknown[]) => deleteSm8Note(...a),
  readSm8Note: (...a: unknown[]) => readSm8Note(...a),
  postSm8Booking: (...a: unknown[]) => postSm8Booking(...a),
  postSm8JobStatus: (...a: unknown[]) => postSm8JobStatus(...a),
  deleteSm8Booking: (...a: unknown[]) => deleteSm8Booking(...a),
  readSm8Booking: (...a: unknown[]) => readSm8Booking(...a),
  readSm8Job: (...a: unknown[]) => readSm8Job(...a),
  readSm8JobBookings: (...a: unknown[]) => readSm8JobBookings(...a),
}));

const getSession = jest.fn();
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: (...a: unknown[]) => getSession(...a) } }));
let whoIsSignedIn: { user: string; staff: string | null } = { user: "auth0|sam", staff: "staff-sam" };
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => whoIsSignedIn.staff) }));
jest.mock("next/server", () => ({ after: () => {} }));
jest.mock("@/lib/workboard/job-notes-query", () => ({
  staffDisplayNames: jest.fn(async () => new Map([["staff-sam", "Sam Tester"]])),
}));

import { sm8PressFromSession, type Sm8Press } from "../sm8-press";
import { enqueueSm8Writes, readSm8WriteState, runSm8Writes } from "../sm8-writes";
import { BOOKING_WORDS, bookingLine, localNow, statusLine, type BookingMirrorIn } from "../sm8-booking-plan";
import { NOTE_WORDS } from "../sm8-note-words";
import { WRITE_WORDS, offersSend, sendHold } from "../sm8-write-plan";
import { queueBookIn, queueBookingRetry, queueBookingTakeBack, queueClear } from "@/app/actions/sm8-booking-queue";
import { readBookingOverlay } from "../sm8-booking-overlay";

const ORG = "org-1";
const TENANT = "vendor-1";
const ZONE = "Australia/Sydney";
const JOB = "0b1e0b1e-0000-4000-8000-000000009001";
const OTHER_JOB = "0b1e0b1e-0000-4000-8000-000000009002";
const SAM_SM8 = "5a0e5a0e-0000-4000-8000-00000000a001";
const ALEX_SM8 = "a1e0a1e0-0000-4000-8000-00000000a002";
const ACCESS = { accessToken: "token-1", tenantId: TENANT, grant: "g1", meter: TENANT };
const RENEWED = { accessToken: "token-2", tenantId: TENANT, grant: "g2", meter: TENANT };

/** A day on the account's wall clock, `days` from today. */
const day = (days: number) => localNow(ZONE, Date.now() + days * 86_400_000)!.slice(0, 10);
const TOMORROW = day(1);
const at = (d: string, hhmm: string) => `${d} ${hhmm}:00`;
const slot = (staffUuid = SAM_SM8, start = "20:00", end = "21:00", d = TOMORROW) => ({
  staffUuid,
  start: at(d, start),
  end: at(d, end),
});

const writes = () => fake.db.sm8_writes as Row[];
const byId = (id: unknown) => writes().find((w) => w.id === id)!;
const creates = () => writes().filter((w) => w.kind === "booking" && w.op === "create");
const statusRows = () => writes().filter((w) => w.kind === "booking" && w.op === "update");
const deletesOf = () => writes().filter((w) => w.kind === "booking" && w.op === "delete");
const takeBackOf = (createId: unknown) => deletesOf().find((w) => w.depends_on === createId);

async function pressAs(who: "sam" | "alex" | "nocard" = "sam"): Promise<Sm8Press> {
  whoIsSignedIn =
    who === "sam"
      ? { user: "auth0|sam", staff: "staff-sam" }
      : who === "alex"
        ? { user: "auth0|alex", staff: "staff-alex" }
        : { user: "auth0|owner", staff: null };
  getSession.mockResolvedValue({ orgId: ORG, user: { sub: whoIsSignedIn.user } });
  return (await sm8PressFromSession())!;
}

const state = () => readSm8WriteState(ORG);

/** Book in on JOB: the slots, after a status change when `seen` is given. */
async function bookIn(
  slots: { staffUuid: string; start: string; end: string }[] = [slot()],
  opts: { seen?: string | null; who?: "sam" | "alex"; verbId?: string } = {}
) {
  const press = await pressAs(opts.who ?? "sam");
  return queueBookIn(press, await state(), {
    jobUuid: JOB,
    verbId: opts.verbId ?? randomUUID(),
    zone: ZONE,
    status: opts.seen ? { seenEditDate: opts.seen } : null,
    slots,
  });
}

/* the run, on a clock the second read-back moves instead of sleeping */
let skew = 0;
const sleeps: number[] = [];
const clock = () => Date.now() + skew;
const sleep = async (ms: number) => {
  sleeps.push(ms);
  skew += ms;
};
const run = (opts: { ids?: string[]; clock?: () => number } = {}) => runSm8Writes(ORG, "send", { clock, sleep, ...opts });

const due = (r: Row) => {
  r.next_attempt_at = new Date(Date.now() - 1000).toISOString();
};

/** The line a create reads, as its presser sees it, with the mirror's copy. */
async function lineOf(create: Row, opts: { viewer?: boolean; mirror?: BookingMirrorIn | null } = {}) {
  const s = await state();
  const statusRow = create.depends_on ? (byId(create.depends_on) as never) : null;
  return bookingLine({
    create: create as never,
    statusRow,
    takeBack: (takeBackOf(create.id) as never) ?? null,
    hold: sendHold(s, "booking"),
    offered: offersSend(s, "booking"),
    trial: s.mode === "trial",
    viewerIsPresser: opts.viewer ?? true,
    mirror: opts.mirror ?? null,
    now: Date.now(),
    zone: ZONE,
  });
}

/** ServiceM8's copy of our bookings and jobs, as the live account behaves. */
let sm8: Sm8Bookings;

function wireServiceM8(): void {
  readSm8Booking.mockImplementation(sm8.readBooking);
  readSm8Job.mockImplementation(sm8.readJob);
  readSm8JobBookings.mockImplementation(sm8.readJobBookings);
  postSm8Booking.mockImplementation(sm8.postBooking);
  postSm8JobStatus.mockImplementation(sm8.postJobStatus);
  deleteSm8Booking.mockImplementation(sm8.deleteBooking);
}

function connection(over: Row = {}): Row {
  return {
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
    ...over,
  };
}

beforeEach(() => {
  fake.reset();
  skew = 0;
  sleeps.length = 0;
  sm8 = makeSm8Bookings();
  sm8.knobs.clock = clock;
  sm8.job(JOB);
  sm8.job(OTHER_JOB, { kept: { generated_job_id: "9002" } as never });
  fake.db.integration_connections = [connection()];
  fake.db.sm8_vendor = [{ org_id: ORG, uuid: TENANT, name: "Acme Air", timezone_name: ZONE }];
  fake.db.sm8_staff = [
    { org_id: ORG, uuid: SAM_SM8, first: "Sam", last: "Tester", active: 1 },
    { org_id: ORG, uuid: ALEX_SM8, first: "Alex", last: "Sample", active: 1 },
  ];
  fake.db.sm8_jobs = [
    { org_id: ORG, uuid: JOB, active: 1, status: "Quote", generated_job_id: "9001" },
    { org_id: ORG, uuid: OTHER_JOB, active: 1, status: "Completed", generated_job_id: "9002" },
  ];
  fake.db.sm8_job_activities = [];
  fake.db.sm8_writes = [];
  fake.db.workboard_notes = [];
  fake.db.documents = [];
  process.env.SM8_WRITES = "attachment,note,booking";
  sm8AccessResult.mockReset().mockResolvedValue({ ok: true, access: ACCESS });
  renewSm8Access.mockReset().mockResolvedValue({ ok: true, access: RENEWED });
  markSm8NeedsReauth.mockReset().mockResolvedValue(true);
  for (const m of [postSm8Attachment, readSm8Attachment, postSm8Note, updateSm8NoteCompleter, deleteSm8Note, readSm8Note]) m.mockReset();
  for (const m of [postSm8Booking, postSm8JobStatus, deleteSm8Booking, readSm8Booking, readSm8Job, readSm8JobBookings]) m.mockReset();
  wireServiceM8();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  delete process.env.SM8_WRITES;
});

/* ── one booking, as the app ── */

describe("a booking goes, as the app, and is read back", () => {
  it("(F, B-5) is queued, sent with exactly its six fields, read back as booked, and reads Booked", async () => {
    const q = await bookIn();
    expect(q).toMatchObject({ ok: true, statusRowId: null, already: [] });
    const [c] = creates();
    expect(c).toMatchObject({
      kind: "booking",
      op: "create",
      sm8_job_uuid: JOB,
      subject: `slot:${SAM_SM8}:${TOMORROW}T20:00`,
      payload: { name: BOOKING_WORDS.label.create },
      booking_staff_uuid: SAM_SM8,
      booking_start: at(TOMORROW, "20:00"),
      booking_end: at(TOMORROW, "21:00"),
      booking_zone: ZONE,
      depends_on: null,
      status: "queued",
      requested_by: "staff-sam",
      requested_by_user: "auth0|sam",
    });
    await run();
    expect(postSm8Booking).toHaveBeenCalledTimes(1);
    expect(postSm8Booking.mock.calls[0][1]).toEqual({
      uuid: c.remote_uuid,
      jobUuid: JOB,
      staffUuid: SAM_SM8,
      start: at(TOMORROW, "20:00"),
      end: at(TOMORROW, "21:00"),
    });
    expect(c).toMatchObject({ status: "sent", maybe_landed: false, http_status: 200, last_error: null });
    expect(c.landed_edit_date).toBe(sm8.get(c.remote_uuid as string)!.editDate);
    expect(sm8.active(c.remote_uuid as string)).toBe(true);
    expect(await lineOf(c)).toMatchObject({ key: "line.sent", tone: "ok", acts: ["undo", "open_in_sm8"] });
  });
});

const LOST = { status: null, outcome: { kind: "unavailable", status: null }, remote: null, recordUuid: null };
const OLD = "7e7e7e7e-0000-4000-8000-00000000a0a0";

/* ── a lost answer ── */

describe("a lost answer is read back before anything goes again (B-1, B-2, B-22)", () => {
  it("(F, B-1) stays queued and may have landed; the next run reads it back, finds it as booked, and posts nothing", async () => {
    await bookIn();
    const [c] = creates();
    /* it lands, and the answer never comes */
    postSm8Booking.mockImplementationOnce(async (call: unknown, b: never) => {
      await sm8.postBooking(call, b);
      return LOST;
    });
    await run();
    expect(c).toMatchObject({ status: "queued", maybe_landed: true, attempts: 1 });
    expect((await lineOf(c)).key).toBe("line.waitingWhy");
    due(c);
    await run();
    expect(postSm8Booking).toHaveBeenCalledTimes(1);
    expect(readSm8Booking.mock.calls[0][1]).toBe(c.remote_uuid);
    expect(c).toMatchObject({ status: "sent", maybe_landed: false, verify_uuids: [] });
    expect(sm8.posts).toHaveLength(1);
  });

  it("(F, B-2) our own uuid not found: can't tell, so nothing is posted — unsure, and not a guard", async () => {
    await bookIn();
    const [c] = creates();
    c.maybe_landed = true;
    await run();
    expect(postSm8Booking).not.toHaveBeenCalled();
    expect(c).toMatchObject({ status: "failed", last_error: BOOKING_WORDS.row.bookingUnsure, maybe_landed: true });
    expect(await lineOf(c)).toMatchObject({ key: "line.unsure", acts: ["open_in_sm8", "book_again", "cancel"] });
    /* only a 2xx two reads can't find trips the guard (call 15) */
    expect(fake.db.integration_connections[0].write_kinds).toContain("booking");
  });

  it("(F, B-2) our own uuid found INACTIVE: somebody removed it — cancelled, never posted, and a later press books the slot fresh under a new uuid", async () => {
    await bookIn();
    const [c] = creates();
    const old = c.remote_uuid as string;
    c.maybe_landed = true;
    sm8.put({ uuid: old, jobUuid: JOB, staffUuid: SAM_SM8, start: at(TOMORROW, "20:00"), end: at(TOMORROW, "21:00"), active: 0 });
    await run();
    expect(c).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.bookingGone });
    expect(postSm8Booking).not.toHaveBeenCalled();
    expect((await lineOf(c)).key).toBe("line.removedThere");
    /* pressed again: the old row gives its slot back, and never goes again */
    const again = await bookIn();
    expect(again.ok).toBe(true);
    expect(c.subject).toBe(`slot:${SAM_SM8}:${TOMORROW}T20:00:was:${c.id}`);
    expect(c.status).toBe("cancelled");
    const fresh = creates().find((x) => x.id !== c.id)!;
    expect(fresh.remote_uuid).not.toBe(old);
    await run();
    expect(postSm8Booking.mock.calls.map((x) => x[1].uuid)).toEqual([fresh.remote_uuid]);
    expect(sm8.active(old)).toBe(false);
  });

  it("(F, B-2) a verify uuid found inactive is dropped, and the POST goes under the row's own uuid", async () => {
    await bookIn();
    const [c] = creates();
    c.verify_uuids = [OLD];
    sm8.put({ uuid: OLD, jobUuid: JOB, staffUuid: SAM_SM8, start: at(TOMORROW, "20:00"), end: at(TOMORROW, "21:00"), active: 0 });
    await run();
    expect(postSm8Booking.mock.calls.map((x) => x[1].uuid)).toEqual([c.remote_uuid]);
    expect(c).toMatchObject({ status: "sent", verify_uuids: [] });
  });

  it("(F, B-22) a verify uuid found active on this job at another end (the length before a re-press) is sent with the changed-there marker, no POST, and no Undo", async () => {
    await bookIn([slot(SAM_SM8, "20:00", "22:00")]);
    const [c] = creates();
    c.verify_uuids = [OLD];
    sm8.put({ uuid: OLD, jobUuid: JOB, staffUuid: SAM_SM8, start: at(TOMORROW, "20:00"), end: at(TOMORROW, "21:00") });
    await run();
    expect(postSm8Booking).not.toHaveBeenCalled();
    expect(c).toMatchObject({ status: "sent", remote_uuid: OLD, last_error: BOOKING_WORDS.row.movedThere, verify_uuids: [] });
    /* the line reads changed there from the row alone, before any sync */
    expect(await lineOf(c)).toMatchObject({ key: "line.changedThere", acts: [] });
    expect(fake.db.integration_connections[0].write_kinds).toContain("booking");
  });

  it("(F, B-22) our own uuid found with another person after a lost answer is sent with the marker — someone may have moved it — and no guard", async () => {
    await bookIn();
    const [c] = creates();
    c.maybe_landed = true;
    sm8.put({ uuid: c.remote_uuid as string, jobUuid: JOB, staffUuid: ALEX_SM8, start: at(TOMORROW, "20:00"), end: at(TOMORROW, "21:00") });
    await run();
    expect(postSm8Booking).not.toHaveBeenCalled();
    expect(c).toMatchObject({ status: "sent", last_error: BOOKING_WORDS.row.movedThere });
    expect((await lineOf(c)).key).toBe("line.changedThere");
    expect(fake.db.integration_connections[0].write_kinds).toContain("booking");
  });

  it("(F) our own uuid found on another job is marked changed there, and never posted again under a fresh uuid", async () => {
    await bookIn();
    const [c] = creates();
    const own = c.remote_uuid as string;
    c.maybe_landed = true;
    sm8.put({ uuid: own, jobUuid: OTHER_JOB, staffUuid: SAM_SM8, start: at(TOMORROW, "20:00"), end: at(TOMORROW, "21:00") });
    await run();
    expect(postSm8Booking).not.toHaveBeenCalled();
    expect(c).toMatchObject({ status: "sent", remote_uuid: own, last_error: BOOKING_WORDS.row.movedThere });
    expect(c.replaced_uuids).toEqual([]);
  });

  it("a read-back that fails posts nothing and keeps the list, and goes back to the queue by the verdict rules", async () => {
    await bookIn();
    const [c] = creates();
    c.verify_uuids = [OLD];
    readSm8Booking.mockResolvedValueOnce({ ok: false });
    await run();
    expect(postSm8Booking).not.toHaveBeenCalled();
    expect(c).toMatchObject({ status: "queued", verify_uuids: [OLD], attempts: 1, last_error: WRITE_WORDS.unreachable });
  });
});

/* ── the pre-checks ── */

describe("the checks before a booking goes (B-6)", () => {
  it("(F) a live booking of the same person at the same start cancels it slotTaken, with their name, and posts nothing", async () => {
    await bookIn();
    const [c] = creates();
    sm8.put({ uuid: "acac0135-0000-4000-8000-00000000ac35", jobUuid: JOB, staffUuid: SAM_SM8, start: at(TOMORROW, "20:00"), end: at(TOMORROW, "20:30") });
    await run();
    expect(postSm8Booking).not.toHaveBeenCalled();
    expect(c).toMatchObject({ status: "cancelled", last_error: "Sam Tester is already booked on this job at that time in ServiceM8." });
    expect(await lineOf(c)).toMatchObject({ key: "line.notSent", acts: ["look_again"] });
  });

  it("(F) a job gone Completed since the press cancels it jobNotBookable; one gone from ServiceM8, jobGone", async () => {
    await bookIn();
    const [c] = creates();
    sm8.jobs.get(JOB)!.status = "Completed";
    await run();
    expect(c).toMatchObject({ status: "cancelled", last_error: "The job is Completed in ServiceM8 now. Look again." });
    expect(postSm8Booking).not.toHaveBeenCalled();
    const again = await bookIn([slot(SAM_SM8, "18:00", "19:00")]);
    expect(again.ok).toBe(true);
    sm8.jobs.get(JOB)!.active = 0;
    await run();
    expect(creates().find((x) => x.id !== c.id)).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.jobGone });
  });

  it("(F) a start that has passed cancels it past, with no read; a person made inactive, techInactive with their name", async () => {
    await bookIn();
    const [c] = creates();
    Object.assign(c, { booking_start: at(day(-1), "20:00"), booking_end: at(day(-1), "21:00") });
    await run();
    expect(c).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.past });
    expect(readSm8Job).not.toHaveBeenCalled();
    await bookIn([slot(ALEX_SM8)]);
    fake.db.sm8_staff[1].active = 0;
    await run();
    expect(creates().find((x) => x.booking_staff_uuid === ALEX_SM8)).toMatchObject({
      status: "cancelled",
      last_error: "Alex Sample isn't active in ServiceM8.",
    });
    expect(postSm8Booking).not.toHaveBeenCalled();
  });

  it("(F) a press older than a day fails stale — after the read-back, so one found landed is sent", async () => {
    await bookIn();
    const [c] = creates();
    c.pressed_at = new Date(Date.now() - 86_400_000 - 60_000).toISOString();
    await run();
    expect(c).toMatchObject({ status: "failed", last_error: BOOKING_WORDS.row.stale });
    expect(postSm8Booking).not.toHaveBeenCalled();
    expect(await lineOf(c)).toMatchObject({ key: "line.notSent", acts: ["book_again"] });

    await bookIn([slot(SAM_SM8, "18:00", "19:00")]);
    const landed = creates().find((x) => x.id !== c.id)!;
    Object.assign(landed, { maybe_landed: true, pressed_at: new Date(Date.now() - 2 * 86_400_000).toISOString() });
    sm8.put({ uuid: landed.remote_uuid as string, jobUuid: JOB, staffUuid: SAM_SM8, start: at(TOMORROW, "18:00"), end: at(TOMORROW, "19:00") });
    await run();
    expect(landed.status).toBe("sent");
  });

  it("(F) a zone that changed since the press cancels it zoneChanged; one HeyTiff doesn't know waits ten minutes, handed back", async () => {
    await bookIn();
    const [c] = creates();
    fake.db.sm8_vendor[0].timezone_name = "Australia/Perth";
    await run();
    expect(c).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.zoneChanged });
    await bookIn([slot(SAM_SM8, "18:00", "19:00")]);
    const other = creates().find((x) => x.id !== c.id)!;
    fake.db.sm8_vendor[0].timezone_name = null;
    await run();
    expect(other).toMatchObject({ status: "queued", attempts: 0, last_error: BOOKING_WORDS.row.zoneUnknown });
    expect(Date.parse(other.next_attempt_at as string)).toBeGreaterThan(Date.now() + 9 * 60_000);
    fake.db.sm8_vendor[0].timezone_name = "Mars/Base";
    due(other);
    await run();
    expect(other).toMatchObject({ status: "queued", last_error: BOOKING_WORDS.row.zoneUnknown });
    expect(postSm8Booking).not.toHaveBeenCalled();
  });
});

/** An hour later on the wall clock, as text. */
const hourOn = (stamp: string) => `${stamp.slice(0, 11)}${String(Number(stamp.slice(11, 13)) + 1).padStart(2, "0")}${stamp.slice(13)}`;
const bookingsOn = () => (fake.db.integration_connections[0].write_kinds as string[]).includes("booking");
const GUARD_9001 = "HeyTiff switched bookings off after ServiceM8 kept something different on job 9001.";

/** A mirror row (sm8_job_activities) for one of ServiceM8's bookings, as a
    sync would bring it. */
function mirrored(uuid: string, over: Row = {}): Row {
  const a = sm8.get(uuid)!;
  const row = {
    org_id: ORG,
    uuid,
    job_uuid: a.jobUuid,
    staff_uuid: a.staffUuid,
    start_date: a.start,
    end_date: a.end,
    activity_was_scheduled: a.scheduled,
    active: a.active,
    edit_date: a.editDate,
    ...over,
  };
  fake.db.sm8_job_activities = [...(fake.db.sm8_job_activities as Row[]).filter((r) => r.uuid !== uuid), row];
  return row;
}
const mirrorOf = (r: Row): BookingMirrorIn => ({
  active: r.active as number,
  jobUuid: r.job_uuid as string,
  staffUuid: r.staff_uuid as string,
  start: r.start_date as string,
  end: r.end_date as string,
  editDate: r.edit_date as string,
});

/* ── the booking guards ── */

describe("a booking ServiceM8 kept differently trips a guard (B-7)", () => {
  it("(F) a start an hour off, read twice, is SENT under our uuid with timeNotKept; the run stops, Bookings goes off, and what was waiting is cancelled in the guard's words — files and notes left as they were", async () => {
    sm8.knobs.keeps = (b) => (b.staffUuid === SAM_SM8 ? { start: hourOn(b.start), end: hourOn(b.end) } : {});
    await bookIn([slot(SAM_SM8, "18:00", "19:00"), slot(ALEX_SM8, "18:00", "19:00")]);
    const [sam, alex] = creates();
    fake.db.sm8_writes.push({
      id: "file-1",
      org_id: ORG,
      tenant_id: TENANT,
      kind: "attachment",
      op: "create",
      sm8_job_uuid: JOB,
      subject: "document:d1",
      payload: { documentId: "d1", name: "Quote.pdf" },
      remote_uuid: "5a1b2c3d-0000-4000-8000-00000000f11e",
      status: "queued",
      attempts: 0,
      next_attempt_at: new Date(Date.now() - 1000).toISOString(),
      created_at: new Date(Date.now() + 1000).toISOString(),
      lease_until: null,
      last_error: null,
      maybe_landed: false,
      verify_uuids: [],
      replaced_uuids: [],
    });
    const r = await run();
    expect(postSm8Booking).toHaveBeenCalledTimes(1);
    /* read, then read again about 2 s later (U23) */
    expect(readSm8Booking.mock.calls.map((x) => x[1])).toEqual([sam.remote_uuid, sam.remote_uuid]);
    expect(sleeps).toEqual([2_000]);
    expect(sam).toMatchObject({ status: "sent", last_error: BOOKING_WORDS.row.timeNotKept, remote_uuid: sam.remote_uuid });
    expect(sam.landed_edit_date).toBe(sm8.get(sam.remote_uuid as string)!.editDate);
    expect(r.stopped).toBe(BOOKING_WORDS.row.timeNotKept);
    expect(bookingsOn()).toBe(false);
    expect(alex).toMatchObject({ status: "cancelled", last_error: GUARD_9001 });
    expect(byId("file-1")).toMatchObject({ status: "queued", last_error: null });
    /* case 13: it exists, so it can be taken back */
    expect(await lineOf(sam)).toMatchObject({ key: "line.keptOther", tone: "bad", acts: ["undo", "open_in_sm8"] });
  });

  it("(F) Undo removes the mistimed booking, comparing its job and its edit time — and once someone corrects it in ServiceM8, Undo is refused and the line is Changed", async () => {
    sm8.knobs.keeps = (b) => ({ start: hourOn(b.start), end: hourOn(b.end) });
    await bookIn([slot(SAM_SM8, "18:00", "19:00")]);
    await run();
    const [c] = creates();
    expect(c.last_error).toBe(BOOKING_WORDS.row.timeNotKept);
    sm8.knobs.keeps = null;
    /* the owner looks, and switches Bookings back on */
    fake.db.integration_connections[0].write_kinds = ["attachment", "note", "booking"];
    /* the booked person opening it would move its edit time too (U21); unchanged, it is taken out */
    expect(await queueBookingTakeBack(await pressAs(), await state(), { createRowId: c.id as string })).toMatchObject({ ok: true, plan: "deleting" });
    await run();
    expect(sm8.deletes).toEqual([c.remote_uuid]);
    expect(sm8.active(c.remote_uuid as string)).toBe(false);
    expect(takeBackOf(c.id)).toMatchObject({ status: "sent", target_uuid: c.remote_uuid, http_status: 200 });

    /* another, corrected in ServiceM8 by a person: its edit time moved */
    sm8.knobs.keeps = (b) => ({ start: hourOn(b.start), end: hourOn(b.end) });
    await bookIn([slot(SAM_SM8, "15:00", "16:00")]);
    await run();
    const d = creates().find((x) => x.id !== c.id)!;
    fake.db.integration_connections[0].write_kinds = ["attachment", "note", "booking"];
    sm8.moveThere(d.remote_uuid as string, { start: at(TOMORROW, "15:00"), end: at(TOMORROW, "16:00") });
    /* before the sync: the take-back goes, and its sender refuses it */
    await queueBookingTakeBack(await pressAs(), await state(), { createRowId: d.id as string });
    await run();
    expect(sm8.deletes).toEqual([c.remote_uuid]);
    expect(takeBackOf(d.id)).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.changedNoTakeBack });
    expect(await lineOf(d)).toMatchObject({ key: "line.stillIn", tone: null, acts: [] });
    /* after it: refused at the press, and the line is case 15 */
    const e = await bookIn([slot(SAM_SM8, "11:00", "12:00")]);
    fake.db.integration_connections[0].write_kinds = ["attachment", "note", "booking"];
    expect(e.ok).toBe(true);
    await run();
    const f = creates().find((x) => x.booking_start === at(TOMORROW, "11:00"))!;
    fake.db.integration_connections[0].write_kinds = ["attachment", "note", "booking"];
    sm8.moveThere(f.remote_uuid as string, { start: at(TOMORROW, "11:00"), end: at(TOMORROW, "12:00") });
    const m = mirrored(f.remote_uuid as string);
    expect(await queueBookingTakeBack(await pressAs(), await state(), { createRowId: f.id as string })).toEqual({ ok: false, refusal: "changed" });
    expect(takeBackOf(f.id)).toBeUndefined();
    expect(await lineOf(f, { mirror: mirrorOf(m) })).toMatchObject({ key: "line.changedThere", acts: [] });
  });

  it("(F) another person, or none, right after our own POST, read twice: SENT with personNotKept, Bookings off, and Undo removes it", async () => {
    sm8.knobs.keeps = () => ({ staffUuid: ALEX_SM8 });
    await bookIn();
    const [c] = creates();
    await run();
    expect(c).toMatchObject({ status: "sent", last_error: BOOKING_WORDS.row.personNotKept });
    expect(bookingsOn()).toBe(false);
    expect(await lineOf(c)).toMatchObject({ key: "line.keptOtherPerson", acts: ["undo", "open_in_sm8"] });
    fake.db.integration_connections[0].write_kinds = ["attachment", "note", "booking"];
    sm8.knobs.keeps = null;
    await queueBookingTakeBack(await pressAs(), await state(), { createRowId: c.id as string });
    await run();
    expect(sm8.active(c.remote_uuid as string)).toBe(false);
    expect(takeBackOf(c.id)?.status).toBe("sent");

    /* nobody at all: the same guard */
    sm8.knobs.keeps = () => ({ staffUuid: null });
    await bookIn([slot(SAM_SM8, "15:00", "16:00")]);
    await run();
    expect(creates().find((x) => x.id !== c.id)).toMatchObject({ status: "sent", last_error: BOOKING_WORDS.row.personNotKept });
  });

  it("(F) the same answer on a 409's read-back is the same guard", async () => {
    await bookIn();
    const [c] = creates();
    postSm8Booking.mockImplementationOnce(async (call: unknown, b: { uuid: string; jobUuid: string; start: string; end: string }) => {
      await sm8.postBooking(call, { ...b, staffUuid: ALEX_SM8 });
      return { status: 409, outcome: { kind: "exists" }, remote: null, recordUuid: null };
    });
    await run();
    expect(c).toMatchObject({ status: "sent", last_error: BOOKING_WORDS.row.personNotKept, http_status: 409 });
    expect(bookingsOn()).toBe(false);
  });

  it("(F) after a lost answer, our own uuid read back with our person at another time is the time guard, never a way round it", async () => {
    await bookIn();
    const [c] = creates();
    c.maybe_landed = true;
    sm8.put({ uuid: c.remote_uuid as string, jobUuid: JOB, staffUuid: SAM_SM8, start: at(TOMORROW, "21:00"), end: at(TOMORROW, "22:00") });
    await run();
    expect(postSm8Booking).not.toHaveBeenCalled();
    expect(c).toMatchObject({ status: "sent", last_error: BOOKING_WORDS.row.timeNotKept });
    expect(bookingsOn()).toBe(false);
  });

  it("(F) a start off on the first read only, and right on the second, is sent as booked (U23)", async () => {
    await bookIn();
    const [c] = creates();
    readSm8Booking.mockImplementationOnce(async (call: unknown, uuid: string) => {
      const r = await sm8.readBooking(call, uuid);
      return r.found ? { ...r, activity: { ...r.activity, start: hourOn(r.activity.start!) } } : r;
    });
    await run();
    expect(c).toMatchObject({ status: "sent", last_error: null });
    expect(readSm8Booking).toHaveBeenCalledTimes(2);
    expect(bookingsOn()).toBe(true);
  });
});

/* ── what a booking's read-back decides (review) ── */

describe("a booking's read-back, after its POST and before it (review: S4, R2-7, R2-10, N1, B-7)", () => {
  it("(F, S4) found INACTIVE right after our own 2xx: read again, and still inactive it is the guard — sent, Bookings off", async () => {
    await bookIn();
    const [c] = creates();
    postSm8Booking.mockImplementationOnce(async (call: unknown, b: { uuid: string }) => {
      const res = await sm8.postBooking(call, b as never);
      sm8.removeThere(b.uuid);
      return res;
    });
    const r = await run();
    expect(readSm8Booking.mock.calls.map((x) => x[1])).toEqual([c.remote_uuid, c.remote_uuid]);
    expect(c).toMatchObject({ status: "sent", last_error: BOOKING_WORDS.row.timeNotKept, remote_uuid: c.remote_uuid });
    expect(c.landed_edit_date).toBe(sm8.get(c.remote_uuid as string)!.editDate);
    expect(r.stopped).toBe(BOOKING_WORDS.row.timeNotKept);
    expect(bookingsOn()).toBe(false);
  });

  it("(F, R2-7) ...decided on two reads: inactive on the first only, and as booked on the second, it is sent as booked", async () => {
    await bookIn();
    const [c] = creates();
    readSm8Booking.mockImplementationOnce(async (call: unknown, uuid: string) => {
      const got = await sm8.readBooking(call, uuid);
      return got.found ? { ...got, activity: { ...got.activity, active: 0 } } : got;
    });
    await run();
    expect(readSm8Booking).toHaveBeenCalledTimes(2);
    expect(c).toMatchObject({ status: "sent", last_error: null });
    expect(bookingsOn()).toBe(true);
  });

  it("(F, B-7) a 400 whose read-back finds ours landed at another time trips the guard too", async () => {
    await bookIn();
    const [c] = creates();
    postSm8Booking.mockImplementationOnce(async (call: unknown, b: { start: string; end: string }) => {
      await sm8.postBooking(call, { ...b, start: hourOn(b.start), end: hourOn(b.end) } as never);
      return { status: 400, outcome: { kind: "rejected", status: 400 }, remote: null, recordUuid: null };
    });
    const r = await run();
    expect(c).toMatchObject({ status: "sent", last_error: BOOKING_WORDS.row.timeNotKept, http_status: 400, remote_uuid: c.remote_uuid });
    expect(r.stopped).toBe(BOOKING_WORDS.row.timeNotKept);
    expect(bookingsOn()).toBe(false);
  });

  it("(F, R2-10) our own uuid unsure and an older attempt's found as booked: sent under the older, and ours stays among the uuids it spent", async () => {
    await bookIn();
    const [c] = creates();
    const own = c.remote_uuid as string;
    Object.assign(c, { maybe_landed: true, verify_uuids: [OLD] });
    sm8.put({ uuid: OLD, jobUuid: JOB, staffUuid: SAM_SM8, start: at(TOMORROW, "20:00"), end: at(TOMORROW, "21:00") });
    await run();
    expect(postSm8Booking).not.toHaveBeenCalled();
    expect(c).toMatchObject({ status: "sent", remote_uuid: OLD, verify_uuids: [] });
    expect(c.replaced_uuids).toEqual([own]);
  });

  it("(F, N1) a send that throws before its POST is a plain retry; one that throws after it keeps its uuid marked as maybe landed", async () => {
    await bookIn();
    const [c] = creates();
    readSm8JobBookings.mockRejectedValueOnce(new Error("the list read fell over"));
    await run();
    expect(postSm8Booking).not.toHaveBeenCalled();
    expect(c).toMatchObject({ status: "queued", last_error: BOOKING_WORDS.row.threw, maybe_landed: false });
    due(c);
    readSm8Booking.mockRejectedValueOnce(new Error("the read-back fell over"));
    await run();
    expect(postSm8Booking).toHaveBeenCalledTimes(1);
    expect(c).toMatchObject({ status: "queued", last_error: BOOKING_WORDS.row.threw, maybe_landed: true });
  });
});

/* ── a 2xx the read-back can't find ── */

describe("a booking answered OK that the read-back can't find (B-23, B-23b, B-23c)", () => {
  const okNotKept = async (_call: unknown, b: { uuid: string }) => ({
    status: 200,
    outcome: { kind: "created", remoteUuid: b.uuid },
    remote: null,
    recordUuid: b.uuid,
  });

  it("(F, B-23) not found on a read and again 2 s later: failed unsure, the mark kept — and Bookings off (call 15)", async () => {
    await bookIn([slot(SAM_SM8, "18:00", "19:00"), slot(ALEX_SM8, "18:00", "19:00")]);
    const [c, other] = creates();
    postSm8Booking.mockImplementationOnce(okNotKept);
    const r = await run();
    expect(readSm8Booking.mock.calls.map((x) => x[1])).toEqual([c.remote_uuid, c.remote_uuid]);
    expect(c).toMatchObject({ status: "failed", last_error: BOOKING_WORDS.row.bookingUnsure, maybe_landed: true });
    expect(r.stopped).toBe(BOOKING_WORDS.row.bookingUnsure);
    expect(bookingsOn()).toBe(false);
    expect(other).toMatchObject({ status: "cancelled", last_error: GUARD_9001 });
    expect((await lineOf(c)).key).toBe("line.unsure");
  });

  it("(F, B-23) a read-back that failed is sent: the 2xx stands, with no edit time", async () => {
    await bookIn();
    const [c] = creates();
    readSm8Booking.mockResolvedValueOnce({ ok: false });
    await run();
    expect(c).toMatchObject({ status: "sent", landed_edit_date: null, last_error: null });
    expect(bookingsOn()).toBe(true);
  });

  it("(F, B-23b) ours not found and the answer's own uuid found as booked: sent under ServiceM8's uuid, ours replaced — and Undo takes ITS uuid out", async () => {
    sm8.knobs.keepsOurUuid = false;
    await bookIn();
    const [c] = creates();
    const ours = c.remote_uuid as string;
    await run();
    const theirs = sm8.posts.length > 0 ? [...sm8.activities.values()][0].uuid : "";
    expect(theirs).not.toBe(ours);
    expect(c).toMatchObject({ status: "sent", remote_uuid: theirs });
    expect(c.replaced_uuids).toContain(ours);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("kept under ServiceM8's own uuid"));
    await queueBookingTakeBack(await pressAs(), await state(), { createRowId: c.id as string });
    await run();
    expect(sm8.deletes).toEqual([theirs]);
    expect(sm8.active(theirs)).toBe(false);
  });

  it("(F, B-23b) found under neither uuid: failed unsure with the answer's uuid waiting for its check, and a take-back deletes it", async () => {
    await bookIn();
    const [c] = creates();
    const THEIRS = "acac01ff-0000-4000-8000-00000000acff";
    postSm8Booking.mockImplementationOnce(async () => ({ status: 200, outcome: { kind: "created", remoteUuid: THEIRS }, remote: null, recordUuid: THEIRS }));
    await run();
    expect(c).toMatchObject({ status: "failed", last_error: BOOKING_WORDS.row.bookingUnsure, maybe_landed: true, verify_uuids: [THEIRS] });
    expect(readSm8Booking.mock.calls.map((x) => x[1])).toEqual([c.remote_uuid, c.remote_uuid, THEIRS, THEIRS]);
    /* it turns up there after all; the presser takes it back */
    sm8.put({ uuid: THEIRS, jobUuid: JOB, staffUuid: SAM_SM8, start: at(TOMORROW, "20:00"), end: at(TOMORROW, "21:00") });
    fake.db.integration_connections[0].write_kinds = ["attachment", "note", "booking"];
    expect(await queueBookingTakeBack(await pressAs(), await state(), { createRowId: c.id as string })).toMatchObject({ ok: true, plan: "deleting" });
    await run();
    expect(sm8.deletes).toEqual([THEIRS]);
    expect(sm8.active(THEIRS)).toBe(false);
  });

  it("(F, B-23b) found under ServiceM8's uuid at another time: the time guard, as B-7", async () => {
    sm8.knobs.keepsOurUuid = false;
    sm8.knobs.keeps = (b) => ({ start: hourOn(b.start), end: hourOn(b.end) });
    await bookIn();
    const [c] = creates();
    await run();
    expect(c).toMatchObject({ status: "sent", last_error: BOOKING_WORDS.row.timeNotKept });
    expect(c.remote_uuid).not.toBe(c.replaced_uuids && (c.replaced_uuids as string[])[0]);
    expect(bookingsOn()).toBe(false);
  });

  it("(F, B-23c) the claim's time runs out after the POST: never let go, never posted again unread — sent under the answer's uuid, or ours with no edit time", async () => {
    await bookIn();
    const [c] = creates();
    const THEIRS = "acac01ee-0000-4000-8000-00000000acee";
    postSm8Booking.mockImplementationOnce(async (call: unknown, b: never) => {
      await sm8.postBooking(call, b);
      skew += 96_000; // the POST outlived the reads' time
      return { status: 200, outcome: { kind: "created", remoteUuid: THEIRS }, remote: null, recordUuid: THEIRS };
    });
    await run();
    expect(readSm8Booking).not.toHaveBeenCalled();
    expect(c).toMatchObject({ status: "sent", remote_uuid: THEIRS, landed_edit_date: null });
    expect(c.replaced_uuids).toContain(sm8.posts[0].uuid);

    skew = 0;
    await bookIn([slot(SAM_SM8, "15:00", "16:00")]);
    const d = creates().find((x) => x.id !== c.id)!;
    postSm8Booking.mockImplementationOnce(async (call: unknown, b: never) => {
      const res = await sm8.postBooking(call, b);
      skew += 96_000;
      return res;
    });
    await run();
    expect(d).toMatchObject({ status: "sent", remote_uuid: d.remote_uuid, landed_edit_date: null });
    expect(sm8.posts).toHaveLength(2);
  });

  it("(F, B-23c) a 409 whose read-back no longer fits the claim is never let go: it goes back as a lost answer, the mark kept, a minute on", async () => {
    await bookIn();
    const [c] = creates();
    postSm8Booking.mockImplementationOnce(async () => {
      skew += 96_000;
      return { status: 409, outcome: { kind: "exists" }, remote: null, recordUuid: null };
    });
    await run();
    expect(readSm8Booking).not.toHaveBeenCalled();
    expect(c).toMatchObject({ status: "queued", maybe_landed: true, last_error: WRITE_WORDS.unreachable, attempts: 1 });
    expect(Date.parse(c.next_attempt_at as string) - clock()).toBeGreaterThanOrEqual(59_000);
  });

  it("(F, B-23c) a second read that couldn't be made never turns into not found, and a difference on the only read made is never a failed read", async () => {
    /* not found on the first read, and no time for the second: sent, the 2xx stands */
    await bookIn();
    const [c] = creates();
    postSm8Booking.mockImplementationOnce(async (_call: unknown, b: { uuid: string }) => {
      skew += 93_500; // room for one read, not for the second
      return okNotKept(_call, b);
    });
    await run();
    expect(readSm8Booking).toHaveBeenCalledTimes(1);
    expect(c).toMatchObject({ status: "sent", landed_edit_date: null, last_error: null });
    expect(bookingsOn()).toBe(true);

    /* a booking at another time on the only read: its guard */
    skew = 0;
    sm8.knobs.keeps = (b) => ({ start: hourOn(b.start), end: hourOn(b.end) });
    await bookIn([slot(SAM_SM8, "15:00", "16:00")]);
    const d = creates().find((x) => x.id !== c.id)!;
    postSm8Booking.mockImplementationOnce(async (call: unknown, b: never) => {
      const res = await sm8.postBooking(call, b);
      skew += 93_500;
      return res;
    });
    await run();
    expect(d).toMatchObject({ status: "sent", last_error: BOOKING_WORDS.row.timeNotKept });
    expect(bookingsOn()).toBe(false);
  });
});

/* ── a Quote made a Work Order ── */

/** The job's edit time the panel read. */
const SEEN = "2026-09-27 16:00:00";
const future = () => new Date(Date.now() + 3_600_000).toISOString();
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

/** A booking `min` minutes from now on the account's wall clock, a minute
    long, on one day. */
function soon(min: number): { start: string; end: string } {
  let start = `${localNow(ZONE, Date.now() + min * 60_000)!.slice(0, 16)}:00`;
  if (start.slice(11, 16) === "23:59") start = `${start.slice(0, 11)}23:58:00`;
  const [h, m] = [Number(start.slice(11, 13)), Number(start.slice(14, 16))];
  const to = h * 60 + m + 1;
  return { start, end: `${start.slice(0, 11)}${String(Math.floor(to / 60)).padStart(2, "0")}:${String(to % 60).padStart(2, "0")}:00` };
}

/** Rows already pressed this hour for the account, towards the hourly cap. */
function pressedThisHour(n: number): void {
  for (let i = 0; i < n; i++) {
    fake.db.sm8_writes.push({
      id: randomUUID(),
      org_id: ORG,
      tenant_id: TENANT,
      kind: "attachment",
      op: "create",
      sm8_job_uuid: JOB,
      subject: `document:cap-${i}`,
      payload: {},
      remote_uuid: randomUUID(),
      status: "sent",
      attempts: 1,
      pressed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });
  }
}

const statusLineOf = async (s: Row) => {
  const st = await state();
  const behind = creates().filter((c) => c.depends_on === s.id);
  return statusLine(s as never, behind.map((c) => ({ create: c as never, takeBack: (takeBackOf(c.id) as never) ?? null })), sendHold(st, "booking"));
};

describe("a status change goes first, and the verb is one (B-3)", () => {
  it("(F) a booking whose status row is still waiting waits, handed back, and posts nothing", async () => {
    const q = await bookIn([slot()], { seen: SEEN });
    expect(q).toMatchObject({ ok: true });
    const s = byId(q.ok && q.statusRowId);
    expect(s).toMatchObject({ op: "update", target_uuid: JOB, job_status_from: "Quote", job_status_to: "Work Order", seen_edit_date: SEEN });
    s.next_attempt_at = future();
    await run();
    const [c] = creates();
    expect(c.depends_on).toBe(s.id);
    expect(postSm8JobStatus).not.toHaveBeenCalled();
    expect(postSm8Booking).not.toHaveBeenCalled();
    expect(c).toMatchObject({ status: "queued", attempts: 0 });
    expect(Date.parse(c.next_attempt_at as string)).toBeGreaterThanOrEqual(Date.now() + 29_000);
    expect(await lineOf(c)).toMatchObject({ key: "line.waitingWhy", text: `Not booked yet. ${BOOKING_WORDS.why.waitingOnStatus}` });
  });

  it("(F) one whose status row failed is cancelled statusFirst; one whose failed status row may have landed, statusUnsure with Look again", async () => {
    const q = await bookIn([slot()], { seen: SEEN });
    const s = byId(q.ok && q.statusRowId);
    Object.assign(s, { status: "failed", last_error: BOOKING_WORDS.row.statusRefused });
    await run();
    const [c] = creates();
    expect(c).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.statusFirst });
    expect(await lineOf(c)).toMatchObject({ key: "line.notSent", tone: "bad", acts: ["try_again"] });
    expect(postSm8Booking).not.toHaveBeenCalled();

    const r = await bookIn([slot(SAM_SM8, "15:00", "16:00")], { seen: "2026-09-27 16:00:01" });
    const s2 = byId(r.ok && r.statusRowId);
    Object.assign(s2, { status: "failed", last_error: WRITE_WORDS.gaveUp, maybe_landed: true });
    await run();
    const c2 = creates().find((x) => x.depends_on === s2.id)!;
    expect(c2).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.statusUnsure });
    expect(await lineOf(c2)).toMatchObject({ key: "line.notSent", acts: ["look_again"] });
    expect(await statusLineOf(s2)).toMatchObject({ key: "line.statusUnsure" });
  });

  it("(F) in one run the status row goes first and its booking right behind it — a re-pressed booking older than its status row included", async () => {
    await bookIn([slot()]);
    const [c] = creates();
    Object.assign(c, { status: "failed", last_error: BOOKING_WORDS.row.refused });
    const q = await bookIn([slot()], { seen: SEEN });
    const s = byId(q.ok && q.statusRowId);
    expect(c).toMatchObject({ status: "queued", depends_on: s.id });
    expect(String(c.created_at) <= String(s.created_at)).toBe(true);
    await run();
    expect(postSm8JobStatus).toHaveBeenCalledTimes(1);
    expect(postSm8JobStatus.mock.calls[0].slice(1)).toEqual([JOB, "Work Order"]);
    expect(postSm8Booking).toHaveBeenCalledTimes(1);
    expect(postSm8JobStatus.mock.invocationCallOrder[0]).toBeLessThan(postSm8Booking.mock.invocationCallOrder[0]);
    expect(s).toMatchObject({ status: "sent", landed_edit_date: sm8.statusPosts.length ? expect.any(String) : null });
    expect(c.status).toBe("sent");
    expect(sm8.jobs.get(JOB)!.status).toBe("Work Order");
    expect(await statusLineOf(s)).toMatchObject({ key: "line.statusSent", tone: "ok" });
  });

  it("(F) a verb is tried as one: a status row that ended a trial makes its booking a trial too, even claimed once sending is On", async () => {
    fake.db.integration_connections[0].write_mode = "trial";
    const q = await bookIn([slot()], { seen: SEEN });
    const s = byId(q.ok && q.statusRowId);
    const [c] = creates();
    c.next_attempt_at = future();
    await run();
    expect(s.status).toBe("trial");
    fake.db.integration_connections[0].write_mode = "live";
    due(c);
    await run();
    expect(c.status).toBe("trial");
    expect(postSm8JobStatus).not.toHaveBeenCalled();
    expect(postSm8Booking).not.toHaveBeenCalled();
    expect(readSm8Job).not.toHaveBeenCalled();
    expect(await lineOf(c)).toMatchObject({ key: "line.trial", acts: ["book_again", "cancel"] });
    expect(await statusLineOf(s)).toBeNull();
  });
});

describe("the hourly cap never splits a verb (B-3b)", () => {
  it("(F) the bookings' queueing capped: the status row this press made is taken back and cancelled, and nothing is left alone", async () => {
    pressedThisHour(59);
    const q = await bookIn([slot()], { seen: SEEN });
    expect(q).toEqual({ ok: false, refusal: "capped" });
    const [s] = statusRows();
    expect(s).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.takenBackBeforeSent });
    expect(s.taken_back_at).toBeTruthy();
    expect(creates()).toHaveLength(0);
    expect(await statusLineOf(s)).toBeNull();
  });

  it("(F) ...but a status row another press's booking already depends on stays", async () => {
    const a = await bookIn([slot(ALEX_SM8)], { seen: SEEN });
    const s = byId(a.ok && a.statusRowId);
    s.next_attempt_at = future();
    pressedThisHour(58);
    const b = await bookIn([slot(SAM_SM8)], { seen: SEEN });
    expect(b).toEqual({ ok: false, refusal: "capped" });
    expect(s).toMatchObject({ status: "queued", taken_back_at: null });
    /* and its verb stays its first press's */
    expect(s.verb_id).toBe(creates()[0].verb_id);
  });

  it("(F) the status row's own queueing capped, failed, or its id unreadable: no booking is queued", async () => {
    pressedThisHour(60);
    expect(await bookIn([slot()], { seen: SEEN })).toEqual({ ok: false, refusal: "capped" });
    expect(writes().filter((w) => w.kind === "booking")).toHaveLength(0);

    fake.db.integration_connections = [connection()];
    fake.db.sm8_writes = [];
    fake.before.sm8_writes = (st) => {
      if (st.op === "upsert") fake.failing.add("sm8_writes");
    };
    expect(await bookIn([slot()], { seen: SEEN })).toEqual({ ok: false, refusal: "unqueued" });
    fake.failing.delete("sm8_writes");
    expect(creates()).toHaveLength(0);

    let upserted = false;
    fake.before.sm8_writes = (st) => {
      if (st.op === "upsert") upserted = true;
      else if (upserted && st.op === "select") fake.failing.add("sm8_writes");
    };
    expect(await bookIn([slot()], { seen: SEEN })).toEqual({ ok: false, refusal: "unqueued" });
    fake.failing.delete("sm8_writes");
    fake.before.sm8_writes = undefined;
    expect(creates()).toHaveLength(0);
  });

  it("(F) a press whose slots are all already on their way, booked, or being taken out queues no status row", async () => {
    await bookIn([slot()]);
    const again = await bookIn([slot()], { seen: SEEN });
    expect(again).toEqual({ ok: true, rowIds: [], statusRowId: null, already: [`slot:${SAM_SM8}:${TOMORROW}T20:00`] });
    expect(statusRows()).toHaveLength(0);
    await run();
    expect(await bookIn([slot()], { seen: SEEN })).toMatchObject({ ok: false, refusal: "already_booked" });
    await queueBookingTakeBack(await pressAs(), await state(), { createRowId: creates()[0].id as string });
    deletesOf()[0].next_attempt_at = future();
    expect(await bookIn([slot()], { seen: SEEN })).toMatchObject({ ok: false, refusal: "taking_out" });
    expect(statusRows()).toHaveLength(0);
  });
});

describe("the status change itself (B-4)", () => {
  it("(F) an edit time that moved cancels it changed with no POST; its booking can't go behind it", async () => {
    const q = await bookIn([slot()], { seen: SEEN });
    sm8.jobs.get(JOB)!.editDate = "2026-09-27 16:30:00";
    await run();
    const s = byId(q.ok && q.statusRowId);
    expect(s).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.changed });
    expect(postSm8JobStatus).not.toHaveBeenCalled();
    const [c] = creates();
    expect(c).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.statusFirst });
    expect(await lineOf(c)).toMatchObject({ acts: ["look_again"] });
  });

  it("(F) a job already a Work Order is sent with no POST, and its booking goes", async () => {
    const q = await bookIn([slot()], { seen: SEEN });
    Object.assign(sm8.jobs.get(JOB)!, { status: "Work Order", editDate: "2026-09-27 16:40:00" });
    await run();
    expect(byId(q.ok && q.statusRowId)).toMatchObject({ status: "sent", landed_edit_date: "2026-09-27 16:40:00" });
    expect(postSm8JobStatus).not.toHaveBeenCalled();
    expect(creates()[0].status).toBe("sent");
  });

  it("(F) a job gone Completed cancels it jobNotBookable, in the live status's words", async () => {
    const q = await bookIn([slot()], { seen: SEEN });
    sm8.jobs.get(JOB)!.status = "Completed";
    await run();
    expect(byId(q.ok && q.statusRowId)).toMatchObject({ status: "cancelled", last_error: "The job is Completed in ServiceM8 now. Look again." });
    expect(postSm8JobStatus).not.toHaveBeenCalled();
  });

  it("a 404 on the POST cancels it jobGone, a Finish built by the sender", async () => {
    const q = await bookIn([slot()], { seen: SEEN });
    postSm8JobStatus.mockResolvedValueOnce({ status: 404, outcome: { kind: "rejected", status: 404 }, remote: null, recordUuid: null });
    await run();
    expect(byId(q.ok && q.statusRowId)).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.jobGone, http_status: 404 });
  });

  it("(F) ServiceM8 took the change but kept a Quote, on two reads: failed statusNotKept", async () => {
    const q = await bookIn([slot()], { seen: SEEN });
    postSm8JobStatus.mockResolvedValueOnce({ status: 200, outcome: { kind: "created", remoteUuid: null }, remote: null, recordUuid: null });
    await run();
    expect(byId(q.ok && q.statusRowId)).toMatchObject({ status: "failed", last_error: BOOKING_WORDS.row.statusNotKept, maybe_landed: false });
    expect(readSm8Job).toHaveBeenCalledTimes(3);
  });
});

describe("the fields guard (B-9)", () => {
  it("(F) a changed job_address, read twice, finishes the status change SENT with fieldsNotKept; Bookings off, and its booking cancelled in the guard's words", async () => {
    sm8.knobs.statusAlsoSets = { job_address: "1 Somewhere St" };
    const q = await bookIn([slot()], { seen: SEEN });
    const r = await run();
    const s = byId(q.ok && q.statusRowId);
    expect(s).toMatchObject({ status: "sent", last_error: BOOKING_WORDS.row.fieldsNotKept });
    expect(s.landed_edit_date).toBe(sm8.jobs.get(JOB)!.editDate);
    expect(r.stopped).toBe(BOOKING_WORDS.row.fieldsNotKept);
    expect(bookingsOn()).toBe(false);
    expect(creates()[0]).toMatchObject({ status: "cancelled", last_error: GUARD_9001 });
    expect(postSm8Booking).not.toHaveBeenCalled();
    expect(await statusLineOf(s)).toMatchObject({
      key: "line.statusSent",
      text: `${BOOKING_WORDS.line.statusSent}. ${BOOKING_WORDS.row.fieldsNotKept}`,
      tone: "bad",
    });
  });

  it("(F, S1) a booking the guard stopped offers Look again, never a Try again that meets the guard again; booked afresh on the Work Order, it goes", async () => {
    sm8.knobs.statusAlsoSets = { job_address: "1 Somewhere St" };
    await bookIn([slot()], { seen: SEEN });
    await run();
    const [c] = creates();
    expect(c).toMatchObject({ status: "cancelled", last_error: GUARD_9001 });
    expect(await lineOf(c)).toMatchObject({ key: "line.notSent", acts: ["look_again"] });
    /* the owner looks, and switches Bookings back on */
    fake.db.integration_connections[0].write_kinds = ["attachment", "note", "booking"];
    expect(await queueBookingRetry(await pressAs(), await state(), { rowId: c.id as string })).toEqual({ ok: false, refusal: "changed", lookAgain: true });
    /* Look again: the job is a Work Order now, so the panel books with no status change */
    sm8.knobs.statusAlsoSets = null;
    expect(await bookIn([slot()])).toMatchObject({ ok: true });
    expect(c).toMatchObject({ status: "queued", depends_on: null });
    await run();
    expect(c.status).toBe("sent");
  });

  it("(F) a changed total_invoice_amount alone is logged, never guarded", async () => {
    postSm8JobStatus.mockImplementationOnce(async (call: unknown, j: string, st: string) => {
      const res = await sm8.postJobStatus(call, j, st);
      sm8.jobs.get(JOB)!.logged.total_invoice_amount = "450.0000";
      return res;
    });
    const q = await bookIn([slot()], { seen: SEEN });
    await run();
    expect(byId(q.ok && q.statusRowId)).toMatchObject({ status: "sent", last_error: null });
    expect(bookingsOn()).toBe(true);
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("total_invoice_amount"));
    expect(creates()[0].status).toBe("sent");
  });

  it("(F, B-23c) a field difference on the only read that could be made is the fields guard; a Quote on it goes back as a lost answer", async () => {
    sm8.knobs.statusAlsoSets = { purchase_order_number: "PO-9" };
    postSm8JobStatus.mockImplementationOnce(async (call: unknown, j: string, st: string) => {
      const res = await sm8.postJobStatus(call, j, st);
      skew += 93_500;
      return res;
    });
    const q = await bookIn([slot()], { seen: SEEN });
    await run();
    expect(byId(q.ok && q.statusRowId)).toMatchObject({ status: "sent", last_error: BOOKING_WORDS.row.fieldsNotKept });
    expect(bookingsOn()).toBe(false);

    skew = 0;
    sm8.knobs.statusAlsoSets = null;
    fake.db.integration_connections = [connection()];
    sm8.job(OTHER_JOB, { status: "Quote" });
    fake.db.sm8_jobs[1].status = "Quote";
    const press = await pressAs();
    const r = await queueBookIn(press, await state(), {
      jobUuid: OTHER_JOB,
      verbId: randomUUID(),
      zone: ZONE,
      status: { seenEditDate: SEEN },
      slots: [slot()],
    });
    postSm8JobStatus.mockImplementationOnce(async () => {
      skew += 93_500;
      return { status: 200, outcome: { kind: "created", remoteUuid: null }, remote: null, recordUuid: null };
    });
    await run();
    const s2 = byId(r.ok && r.statusRowId);
    expect(s2).toMatchObject({ status: "queued", maybe_landed: true, last_error: WRITE_WORDS.unreachable });
  });
});

/* ── a status change never goes alone ── */

/** A verb on JOB with a status row: its rows, the status row pressed `ago`
    minutes ago (more than the two-minute wait unless said). */
async function verb(opts: { seen?: string; slots?: { staffUuid: string; start: string; end: string }[]; ago?: number } = {}) {
  const q = await bookIn(opts.slots ?? [slot()], { seen: opts.seen ?? SEEN });
  if (!q.ok || !q.statusRowId) throw new Error(`no verb: ${JSON.stringify(q)}`);
  const s = byId(q.statusRowId);
  s.pressed_at = minutesAgo(opts.ago ?? 5);
  return { s, cs: creates().filter((c) => c.depends_on === s.id) };
}
const noRequest = () => {
  expect(postSm8JobStatus).not.toHaveBeenCalled();
  expect(postSm8Booking).not.toHaveBeenCalled();
};

describe("a status change never goes alone (B-4b)", () => {
  it("(F) one pressed two days ago fails stale with no read, and its booking can't go behind it (Look again)", async () => {
    const { s, cs } = await verb({ ago: 2 * 24 * 60 });
    await run();
    expect(s).toMatchObject({ status: "failed", last_error: BOOKING_WORDS.row.stale });
    expect(readSm8Job).not.toHaveBeenCalled();
    expect(cs[0]).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.statusFirst });
    expect(await lineOf(cs[0])).toMatchObject({ acts: ["look_again"] });
    noRequest();
  });

  it("(F) one whose bookings were all taken back or failed is cancelled statusAlone, with no request — and reads Still a Quote", async () => {
    const a = await verb();
    Object.assign(a.cs[0], { status: "failed", last_error: BOOKING_WORDS.row.refused });
    const b = await verb({ seen: "2026-09-27 16:00:01", slots: [slot(ALEX_SM8)] });
    Object.assign(b.cs[0], { status: "cancelled", taken_back_at: new Date().toISOString(), last_error: NOTE_WORDS.row.takenBackBeforeSent });
    await run();
    for (const s of [a.s, b.s]) expect(s).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.statusAlone });
    expect(readSm8Job).not.toHaveBeenCalled();
    noRequest();
    expect(await statusLineOf(a.s)).toMatchObject({ key: "line.statusStays", text: BOOKING_WORDS.line.statusStays });
  });

  it("(F) a doomed booking never holds it open: its start passed while ServiceM8 couldn't be reached", async () => {
    const { s, cs } = await verb({ slots: [{ staffUuid: SAM_SM8, ...soon(25) }] });
    /* the job read before the POST can't be made: back to the queue for a minute, the run stopped */
    readSm8Job.mockResolvedValueOnce({ ok: false });
    const first = await run();
    expect(first.stopped).toBe(WRITE_WORDS.unreachable);
    expect(s).toMatchObject({ status: "queued", attempts: 1, maybe_landed: false });
    /* the 1, 5 and 30 minute retries pass, and so does the booking's lead */
    skew += 20 * 60_000;
    due(s);
    await run();
    expect(s).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.statusAlone });
    expect(cs[0]).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.statusFirst });
    noRequest();
  });

  it("(F) a doomed booking never holds it open: under 10 minutes off, booked in another zone, its person made inactive, or near its own day-old limit", async () => {
    const eight = soon(8);
    const doomed: [string, (c: Row) => void][] = [
      ["under 10 minutes off", (c) => Object.assign(c, { booking_start: eight.start, booking_end: eight.end })],
      ["booked in another zone", (c) => (c.booking_zone = "Australia/Perth")],
      ["its person made inactive", () => (fake.db.sm8_staff[1].active = 0)],
      ["within 10 minutes of its own day-old limit", (c) => (c.pressed_at = new Date(Date.now() - 86_400_000 + 5 * 60_000).toISOString())],
    ];
    for (const [i, [why, doom]] of doomed.entries()) {
      const { s, cs } = await verb({ seen: `2026-09-27 16:00:1${i}`, slots: [slot(ALEX_SM8, `1${i}:00`, `1${i}:30`)] });
      doom(cs[0]);
      await run();
      expect([why, s.status, s.last_error]).toEqual([why, "cancelled", BOOKING_WORDS.row.statusAlone]);
      fake.db.sm8_staff[1].active = 1;
    }
    noRequest();
  });

  it("(F) a zone HeyTiff doesn't know makes it wait, never statusAlone", async () => {
    const { s } = await verb();
    fake.db.sm8_vendor[0].timezone_name = null;
    await run();
    expect(s).toMatchObject({ status: "queued", attempts: 0, last_error: BOOKING_WORDS.row.zoneUnknown });
    noRequest();
  });

  it("(F) a Cancel booking that lands while the status row is claimed: the check inside the attempt cancels it statusAlone, and nothing is posted", async () => {
    const { s, cs } = await verb();
    fake.before.sm8_writes = (st) => {
      if (st.op === "select" && st.columns === "taken_back_at" && st.filters.includes(`id=${s.id}`)) {
        Object.assign(cs[0], { status: "cancelled", taken_back_at: new Date().toISOString(), last_error: NOTE_WORDS.row.takenBackBeforeSent });
      }
    };
    await run();
    fake.before.sm8_writes = undefined;
    expect(s).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.statusAlone });
    expect(readSm8Job).toHaveBeenCalledTimes(1);
    noRequest();
  });

  it("(F) claimed before its bookings are queued (between queueBookIn's two calls): it waits, handed back, then goes with them", async () => {
    const press = await pressAs();
    const verbId = randomUUID();
    const subject = `status:wo:${SEEN.replace(" ", "T")}`;
    await enqueueSm8Writes(press, await state(), [
      {
        kind: "booking",
        op: "update",
        jobUuid: JOB,
        subject,
        payload: { name: BOOKING_WORDS.label.status },
        ref: subject,
        targetUuid: JOB,
        statusFrom: "Quote",
        statusTo: "Work Order",
        seenEditDate: SEEN,
        verbId,
      },
    ]);
    const [s] = statusRows();
    await run();
    expect(s).toMatchObject({ status: "queued", attempts: 0 });
    expect(Date.parse(s.next_attempt_at as string)).toBeGreaterThanOrEqual(Date.now() + 29_000);
    noRequest();
    /* the press's second call: its booking, behind the same status row */
    const q = await bookIn([slot()], { seen: SEEN, verbId });
    expect(q).toMatchObject({ ok: true, statusRowId: s.id });
    await run();
    expect(s.status).toBe("sent");
    expect(creates()[0].status).toBe("sent");
  });

  it("(F) ...and with none able to go once the two minutes are up, it is cancelled statusAlone; a doomed booking's status row waits first, the same", async () => {
    const { s, cs } = await verb({ ago: 0, slots: [{ staffUuid: SAM_SM8, ...soon(8) }] });
    await run();
    expect(s).toMatchObject({ status: "queued", attempts: 0 });
    expect(cs[0].status).toBe("queued");
    noRequest();
    skew += 3 * 60_000;
    due(s);
    await run();
    expect(s).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.statusAlone });
    noRequest();
  });

  it("(F) a second press that joins a queued status row renews its press, so it waits for that press's bookings rather than being cancelled", async () => {
    const a = await verb({ ago: 10 });
    Object.assign(a.cs[0], { status: "failed", last_error: BOOKING_WORDS.row.refused });
    const b = await bookIn([slot(ALEX_SM8)], { seen: SEEN });
    expect(b).toMatchObject({ ok: true, statusRowId: a.s.id });
    expect(Date.parse(a.s.pressed_at as string)).toBeGreaterThan(Date.now() - 5_000);
    await run();
    expect(a.s.status).toBe("sent");
    expect(creates().find((c) => c.booking_staff_uuid === ALEX_SM8)!.status).toBe("sent");
  });

  it("(F) a database read that fails — the bookings behind it, the people, or the check inside the POST attempt — goes back to the queue, handed back, and posts nothing", async () => {
    const { s } = await verb();
    fake.before.sm8_writes = (st) =>
      st.op === "select" && st.filters.includes(`depends_on=${s.id}`) && st.columns?.includes("booking_zone") ? "fail" : undefined;
    await run();
    fake.before.sm8_writes = undefined;
    expect(s).toMatchObject({ status: "queued", attempts: 0, last_error: BOOKING_WORDS.row.threw });

    due(s);
    fake.before.sm8_staff = () => "fail";
    await run();
    fake.before.sm8_staff = undefined;
    expect(s).toMatchObject({ status: "queued", attempts: 0, last_error: BOOKING_WORDS.row.threw });

    due(s);
    fake.before.sm8_writes = (st) =>
      st.op === "select" && st.columns === "taken_back_at" && st.filters.includes(`id=${s.id}`) ? "fail" : undefined;
    await run();
    fake.before.sm8_writes = undefined;
    expect(s).toMatchObject({ status: "queued", attempts: 0, last_error: BOOKING_WORDS.row.threw });
    expect(readSm8Job).toHaveBeenCalledTimes(1);
    noRequest();
  });
});

describe("a status change whose answer was lost is read before anything ends it (B-4b)", () => {
  const lostStatus = (landed: boolean) =>
    postSm8JobStatus.mockImplementationOnce(async (call: unknown, j: string, st: string) => {
      if (landed) await sm8.postJobStatus(call, j, st);
      return LOST;
    });

  it("(F) no answer keeps the mark; its booking then can't go (its start passes): the job read first says Work Order — sent, no request, and half done is said", async () => {
    const { s, cs } = await verb();
    lostStatus(true);
    await run();
    expect(s).toMatchObject({ status: "queued", maybe_landed: true, attempts: 1 });
    Object.assign(cs[0], { booking_start: at(day(-1), "20:00"), booking_end: at(day(-1), "21:00") });
    due(s);
    await run();
    expect(postSm8JobStatus).toHaveBeenCalledTimes(1);
    expect(s).toMatchObject({ status: "sent", maybe_landed: false });
    expect(s.landed_edit_date).toBe(sm8.jobs.get(JOB)!.editDate);
    expect(cs[0]).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.past });
    /* half done: the status change went, the booking didn't */
    expect(await statusLineOf(s)).toMatchObject({ key: "line.statusSent" });
    expect(await lineOf(cs[0])).toMatchObject({ key: "line.notSent", acts: ["look_again"] });
  });

  it("(F) ...Cancel booking pressed meanwhile: the take-back leaves it alone, the read finds a Work Order, and the line says Taken back — the job stays a Work Order", async () => {
    const { s, cs } = await verb();
    lostStatus(true);
    await run();
    expect(await queueBookingTakeBack(await pressAs(), await state(), { createRowId: cs[0].id as string })).toMatchObject({
      ok: true,
      plan: "cancelled",
    });
    expect(s).toMatchObject({ status: "queued", taken_back_at: null, maybe_landed: true });
    due(s);
    await run();
    expect(s).toMatchObject({ status: "sent" });
    expect(postSm8JobStatus).toHaveBeenCalledTimes(1);
    expect(await statusLineOf(s)).toMatchObject({ key: "line.takenBack", text: BOOKING_WORDS.line.takenBack });
  });

  it("(F) ...a day passes: the read comes first, so a Work Order is sent, never stale; a Quote clears the mark, and then the day-old rule ends it", async () => {
    const { s } = await verb();
    lostStatus(true);
    await run();
    s.pressed_at = minutesAgo(2 * 24 * 60);
    due(s);
    await run();
    expect(s).toMatchObject({ status: "sent", maybe_landed: false });

    const b = await verb({ seen: "2026-09-27 16:00:01", slots: [slot(ALEX_SM8)] });
    b.s.maybe_landed = true;
    sm8.jobs.get(JOB)!.status = "Quote";
    b.s.pressed_at = minutesAgo(2 * 24 * 60);
    await run();
    expect(readSm8Job).toHaveBeenCalled();
    expect(b.s).toMatchObject({ status: "failed", last_error: BOOKING_WORDS.row.stale, maybe_landed: false, verify_uuids: [] });
    expect(await statusLineOf(b.s)).toMatchObject({ key: "line.statusNotSent" });
  });

  it("(F) a lost answer that never landed: the read finds a Quote, the mark goes, and it goes as today", async () => {
    const { s, cs } = await verb();
    lostStatus(false);
    await run();
    expect(s).toMatchObject({ status: "queued", maybe_landed: true });
    due(s);
    await run();
    expect(postSm8JobStatus).toHaveBeenCalledTimes(2);
    expect(s).toMatchObject({ status: "sent", maybe_landed: false });
    expect(cs[0].status).toBe("sent");
  });

  it("(F) Bookings Off cancels it unread: its line says it may have been made a Work Order, and its bookings Try again — which re-presses it with its mark, so the job is read first", async () => {
    const { s, cs } = await verb();
    lostStatus(true);
    await run();
    const { setSm8WriteKind } = await import("../sm8-writes");
    await setSm8WriteKind(ORG, "booking", false);
    expect(s).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.switchedOff, maybe_landed: true });
    expect(await statusLineOf(s)).toMatchObject({ key: "line.statusUnsure", text: BOOKING_WORDS.line.statusUnsure });
    expect(cs[0]).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.switchedOff });
    await setSm8WriteKind(ORG, "booking", true);
    expect(await lineOf(cs[0])).toMatchObject({ key: "line.notSent", acts: ["try_again"] });
    const again = await queueBookingRetry(await pressAs(), await state(), { rowId: cs[0].id as string });
    expect(again).toMatchObject({ ok: true });
    expect(s).toMatchObject({ status: "queued", maybe_landed: false });
    expect(s.verify_uuids).toHaveLength(1);
    readSm8Job.mockClear();
    await run();
    expect(readSm8Job).toHaveBeenCalled();
    expect(postSm8JobStatus).toHaveBeenCalledTimes(1);
    expect(s).toMatchObject({ status: "sent", verify_uuids: [] });
    expect(cs[0].status).toBe("sent");
  });

  it("(F) its read failing every time counts and waits 1, 5, 30 minutes and on, stopping the run each time, then fails gaveUp with the mark kept: unsure, and its booking Look again", async () => {
    const { s, cs } = await verb();
    s.maybe_landed = true;
    readSm8Job.mockResolvedValue({ ok: false });
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) {
      due(s);
      const before = Date.now() + skew;
      const r = await run();
      expect(r.stopped).not.toBeNull();
      if (s.status === "queued") waits.push(Math.round((Date.parse(s.next_attempt_at as string) - before) / 60_000));
    }
    expect(waits).toEqual([1, 5, 30, 120, 720]);
    expect(s).toMatchObject({ status: "failed", last_error: WRITE_WORDS.gaveUp, maybe_landed: true, attempts: 6 });
    expect(await statusLineOf(s)).toMatchObject({ key: "line.statusUnsure" });
    readSm8Job.mockImplementation(sm8.readJob);
    due(cs[0]);
    await run();
    expect(cs[0]).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.statusUnsure });
    expect(await lineOf(cs[0])).toMatchObject({ acts: ["look_again"] });
    noRequest();
  });

  it("(F) a re-press moves the mark into verify_uuids: the job is still read first, and no press's cap stop closes it", async () => {
    const { s, cs } = await verb();
    Object.assign(s, { status: "failed", last_error: WRITE_WORDS.gaveUp, maybe_landed: true });
    /* its own booking taken back, so no other press's booking holds it */
    Object.assign(cs[0], { status: "cancelled", last_error: BOOKING_WORDS.row.statusUnsure, taken_back_at: new Date().toISOString() });
    /* pressed again, a new booking with it, the hour full at the bookings:
       the status row goes again, and the cap stop leaves it — it may have
       landed */
    pressedThisHour(59);
    const q = await bookIn([slot(), slot(ALEX_SM8, "15:00", "16:00")], { seen: SEEN });
    expect(q).toEqual({ ok: false, refusal: "capped" });
    expect(s).toMatchObject({ status: "queued", taken_back_at: null, maybe_landed: false });
    expect(s.verify_uuids).toHaveLength(1);
    fake.db.integration_connections = [connection()];
    fake.db.sm8_writes = writes().filter((w) => w.kind === "booking");
    Object.assign(sm8.jobs.get(JOB)!, { status: "Work Order" });
    await run();
    expect(readSm8Job).toHaveBeenCalled();
    expect(postSm8JobStatus).not.toHaveBeenCalled();
    expect(s).toMatchObject({ status: "sent", verify_uuids: [], maybe_landed: false });
  });
});

/* ── Undo ── */

/** One of Sam's bookings, sent, in ServiceM8. */
async function sentBooking(s = slot()): Promise<Row> {
  await bookIn([s]);
  const c = creates().find((x) => x.booking_start === s.start && x.booking_staff_uuid === s.staffUuid)!;
  await run();
  expect(c.status).toBe("sent");
  return c;
}
const undo = async (c: Row, who: "sam" | "alex" = "sam") =>
  queueBookingTakeBack(await pressAs(who), await state(), { createRowId: c.id as string });

describe("Undo takes a booking back (B-8)", () => {
  it("(F) a booking not yet sent is stopped with no request; a sent one is read, DELETEd once, read back, and its line goes", async () => {
    await bookIn();
    const [q] = creates();
    expect(await undo(q)).toEqual({ ok: true, plan: "cancelled", rowIds: [] });
    expect(q).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.takenBackBeforeSent });
    expect(q.taken_back_at).toBeTruthy();
    expect(deletesOf()).toHaveLength(0);
    expect(await lineOf(q)).toMatchObject({ key: null });

    const c = await sentBooking(slot(SAM_SM8, "15:00", "16:00"));
    const t = await undo(c);
    expect(t).toMatchObject({ ok: true, plan: "deleting" });
    const d = takeBackOf(c.id)!;
    expect(d).toMatchObject({
      kind: "booking",
      op: "delete",
      subject: `undo:${c.id}`,
      depends_on: c.id,
      verb_id: c.verb_id,
      sm8_job_uuid: JOB,
      payload: { name: BOOKING_WORDS.label.undo },
      booking_staff_uuid: null,
    });
    await run();
    expect(sm8.deletes).toEqual([c.remote_uuid]);
    expect(readSm8Booking.mock.calls.filter((x) => x[1] === c.remote_uuid).length).toBeGreaterThanOrEqual(3);
    /* it keeps what it took out: the overlay's gone */
    expect(d).toMatchObject({ status: "sent", target_uuid: c.remote_uuid, http_status: 200, verify_uuids: [c.remote_uuid] });
    /* the read-back's inactive record is the evidence L4 reads for U10 */
    expect(d.landed_edit_date).toBe(sm8.get(c.remote_uuid as string)!.editDate);
    expect(sm8.active(c.remote_uuid as string)).toBe(false);
    expect((await lineOf(c)).key).toBeNull();
  });

  it("(F, R2-4) someone cancels it between the take-back's read and its DELETE: the job's bookings, read last, don't hold it — no DELETE, and it stays out", async () => {
    const c = await sentBooking();
    const uuid = c.remote_uuid as string;
    /* the read finds it; the owner removes it inside ServiceM8 in the moment after */
    readSm8Booking.mockImplementationOnce(async (call: unknown, u: string) => {
      const seen = await sm8.readBooking(call, u);
      sm8.removeThere(u);
      return seen;
    });
    await undo(c);
    await run();
    expect(deleteSm8Booking).not.toHaveBeenCalled();
    expect(sm8.active(uuid)).toBe(false);
    /* out, though it never read it inactive itself: nothing to hide it by */
    expect(takeBackOf(c.id)).toMatchObject({ status: "sent", http_status: null, verify_uuids: [] });
  });

  it("(F, R2-4) moved between the take-back's read and the job's bookings read: checked again on the newer copy, and refused with no DELETE; only opened, it goes", async () => {
    const c = await sentBooking();
    readSm8Booking.mockImplementationOnce(async (call: unknown, u: string) => {
      const seen = await sm8.readBooking(call, u);
      sm8.moveThere(u, { start: at(TOMORROW, "20:30"), end: at(TOMORROW, "21:30") });
      return seen;
    });
    await undo(c);
    await run();
    expect(deleteSm8Booking).not.toHaveBeenCalled();
    expect(takeBackOf(c.id)).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.changedNoTakeBack });

    const e = await sentBooking(slot(SAM_SM8, "15:00", "16:00"));
    readSm8Booking.mockImplementationOnce(async (call: unknown, u: string) => {
      const seen = await sm8.readBooking(call, u);
      sm8.openThere(u);
      return seen;
    });
    await undo(e);
    await run();
    expect(sm8.deletes).toEqual([e.remote_uuid]);
    expect(takeBackOf(e.id)?.status).toBe("sent");
  });

  it("(F) the live walk, for bookings: removed inside ServiceM8, then Undo — read first, no DELETE, never put back, and it ends taken out", async () => {
    const c = await sentBooking();
    sm8.removeThere(c.remote_uuid as string);
    await undo(c);
    await run();
    expect(sm8.deletes).toEqual([]);
    expect(sm8.active(c.remote_uuid as string)).toBe(false);
    expect(takeBackOf(c.id)).toMatchObject({ status: "sent", http_status: null });
  });

  it("(F) the mirror already shows it removed: the take-back settles, and no DELETE is even queued", async () => {
    const c = await sentBooking();
    sm8.removeThere(c.remote_uuid as string);
    mirrored(c.remote_uuid as string);
    expect(await undo(c)).toEqual({ ok: true, plan: "nothing", rowIds: [] });
    expect(takeBackOf(c.id)).toBeUndefined();
    expect(c.taken_back_at).toBeTruthy();
    expect(await lineOf(c, { mirror: mirrorOf(fake.db.sm8_job_activities[0] as Row) })).toMatchObject({ key: null });
  });

  it("(F) a DELETE answered 2xx whose booking still reads active twice fails removeNotKept, gets no second DELETE by itself, and Try again reads first, a minute on", async () => {
    const c = await sentBooking();
    const uuid = c.remote_uuid as string;
    /* ServiceM8 answers the DELETE and keeps the booking */
    deleteSm8Booking.mockResolvedValueOnce({ status: 200, outcome: { kind: "created", remoteUuid: null }, remote: null, recordUuid: null });
    await undo(c);
    await run();
    const d = takeBackOf(c.id)!;
    expect(deleteSm8Booking).toHaveBeenCalledTimes(1);
    expect(sm8.active(uuid)).toBe(true);
    expect(d).toMatchObject({ status: "failed", last_error: BOOKING_WORDS.row.removeNotKept, http_status: 200, target_uuid: uuid });
    expect(await lineOf(c)).toMatchObject({ key: "line.stillIn", acts: ["take_out_again"] });
    const triedAt = Date.parse(d.updated_at as string);
    await run();
    expect(deleteSm8Booking).toHaveBeenCalledTimes(1);
    /* a person looks, and presses Try again: it waits a minute from the last try, then reads first — there and active, taken out */
    expect(await queueBookingRetry(await pressAs(), await state(), { rowId: d.id as string })).toMatchObject({ ok: true });
    expect(d).toMatchObject({ status: "queued", verify_uuids: [] });
    expect(Date.parse(d.next_attempt_at as string)).toBe(triedAt + 60_000);
    await run();
    expect(deleteSm8Booking).toHaveBeenCalledTimes(1);
    due(d);
    await run();
    expect(deleteSm8Booking).toHaveBeenCalledTimes(2);
    expect(sm8.active(uuid)).toBe(false);
    expect(d.status).toBe("sent");
  });

  it("(F) a target this take-back's DELETE already reached is never sent a second DELETE by itself — even when a read lags and shows it still there (U23)", async () => {
    /* a create that may have landed under two uuids: its own, and an older attempt's */
    await bookIn();
    const [c] = creates();
    const own = c.remote_uuid as string;
    Object.assign(c, { status: "failed", last_error: BOOKING_WORDS.row.bookingUnsure, maybe_landed: true, verify_uuids: [OLD] });
    for (const u of [own, OLD]) sm8.put({ uuid: u, jobUuid: JOB, staffUuid: SAM_SM8, start: at(TOMORROW, "20:00"), end: at(TOMORROW, "21:00") });
    await undo(c);
    const d = takeBackOf(c.id)!;
    /* the first DELETE lands, its read-back can't be made, and the claim runs
       out before the second target; the next two reads of it still show it
       as it was (U23) */
    sm8.knobs.lagNextWrite = 2;
    deleteSm8Booking.mockImplementationOnce(async (call: unknown, u: string) => {
      const res = await sm8.deleteBooking(call, u);
      skew += 96_000;
      return res;
    });
    await run();
    expect(sm8.deletes).toEqual([own]);
    expect(d).toMatchObject({ status: "queued", attempts: 0, verify_uuids: [own] });
    expect(Date.parse(d.next_attempt_at as string) - clock()).toBeGreaterThanOrEqual(1_000);
    /* next go: the own uuid still READS active (the lag), but its DELETE went — no second one */
    skew = 0;
    due(d);
    await run();
    expect(sm8.deletes).toEqual([own]);
    expect(sm8.active(own)).toBe(false);
    expect(d).toMatchObject({ status: "failed", last_error: BOOKING_WORDS.row.removeNotKept, target_uuid: own });
    /* once the reads catch up, a person's Try again — a minute on from its
       last try — reads it gone and takes out the other */
    await queueBookingRetry(await pressAs(), await state(), { rowId: d.id as string });
    due(d);
    await run();
    expect(sm8.deletes).toEqual([own, OLD]);
    expect([sm8.active(own), sm8.active(OLD)]).toEqual([false, false]);
    expect(d.status).toBe("sent");
  });

  it("(F) two targets and no time left after the first DELETE: it lets go, and the next go reads both again and deletes only the second; a failed live read is never gone", async () => {
    await bookIn();
    const [c] = creates();
    const own = c.remote_uuid as string;
    Object.assign(c, { status: "cancelled", last_error: BOOKING_WORDS.row.bookingUnsure, maybe_landed: true, verify_uuids: [OLD] });
    for (const u of [own, OLD]) sm8.put({ uuid: u, jobUuid: JOB, staffUuid: SAM_SM8, start: at(TOMORROW, "20:00"), end: at(TOMORROW, "21:00") });
    await undo(c);
    const d = takeBackOf(c.id)!;
    /* the first DELETE takes long enough that the second can't start in the claim */
    deleteSm8Booking.mockImplementationOnce(async (call: unknown, u: string) => {
      const res = await sm8.deleteBooking(call, u);
      skew += 80_000;
      return res;
    });
    await run();
    expect(sm8.deletes).toEqual([own]);
    expect(d).toMatchObject({ status: "queued", attempts: 0, verify_uuids: [own] });
    skew = 0;
    due(d);
    /* the second target's live read fails: back to the queue, never gone */
    readSm8Booking.mockImplementation(async (call: unknown, u: string) => (u === OLD ? { ok: false } : sm8.readBooking(call, u)));
    await run();
    expect(d).toMatchObject({ status: "queued", last_error: WRITE_WORDS.unreachable });
    expect(sm8.deletes).toEqual([own]);
    readSm8Booking.mockImplementation(sm8.readBooking);
    due(d);
    await run();
    expect(sm8.deletes).toEqual([own, OLD]);
    expect(d).toMatchObject({ status: "sent", target_uuid: own });
  });

  it("(F) its targets are one each whatever their case: one record, one DELETE", async () => {
    await bookIn();
    const [c] = creates();
    const own = c.remote_uuid as string;
    Object.assign(c, { status: "failed", last_error: BOOKING_WORDS.row.bookingUnsure, maybe_landed: true, verify_uuids: [own.toUpperCase()] });
    sm8.put({ uuid: own, jobUuid: JOB, staffUuid: SAM_SM8, start: at(TOMORROW, "20:00"), end: at(TOMORROW, "21:00") });
    await undo(c);
    readSm8Booking.mockClear();
    await run();
    expect(sm8.deletes).toEqual([own]);
    expect(sm8.active(own)).toBe(false);
    expect(takeBackOf(c.id)?.status).toBe("sent");
    /* one record is one target: read before its DELETE and after, and no more */
    expect(readSm8Booking.mock.calls.map((x) => String(x[1]).toLowerCase())).toEqual([own, own]);
  });

  it("(F) a lost DELETE answer reads before it goes again, a minute on: landed, no second DELETE; not landed, it goes once more", async () => {
    const c = await sentBooking();
    const uuid = c.remote_uuid as string;
    deleteSm8Booking.mockImplementationOnce(async (call: unknown, u: string) => {
      await sm8.deleteBooking(call, u);
      return LOST;
    });
    await undo(c);
    await run();
    const d = takeBackOf(c.id)!;
    expect(d).toMatchObject({ status: "queued", attempts: 1 });
    expect(Date.parse(d.next_attempt_at as string) - clock()).toBeGreaterThanOrEqual(59_000);
    due(d);
    await run();
    expect(sm8.deletes).toEqual([uuid]);
    expect(d.status).toBe("sent");

    const e = await sentBooking(slot(SAM_SM8, "15:00", "16:00"));
    deleteSm8Booking.mockResolvedValueOnce({ status: 503, outcome: { kind: "unavailable", status: 503 }, remote: null, recordUuid: null });
    await undo(e);
    await run();
    const f = takeBackOf(e.id)!;
    expect(f).toMatchObject({ status: "queued", http_status: 503 });
    due(f);
    await run();
    expect(sm8.deletes.filter((u) => u === e.remote_uuid)).toHaveLength(1);
    expect(sm8.active(e.remote_uuid as string)).toBe(false);
    expect(f).toMatchObject({ status: "sent", http_status: 200 });
  });

  it("(F) the DELETE's status is kept: a 404 read back out is gone; a 409 read back still there fails removeRefused", async () => {
    const c = await sentBooking();
    deleteSm8Booking.mockImplementationOnce(async (_call: unknown, u: string) => {
      sm8.removeThere(u);
      return { status: 404, outcome: { kind: "rejected", status: 404 }, remote: null, recordUuid: null };
    });
    await undo(c);
    await run();
    expect(takeBackOf(c.id)).toMatchObject({ status: "sent", http_status: 404 });

    const e = await sentBooking(slot(SAM_SM8, "15:00", "16:00"));
    deleteSm8Booking.mockResolvedValueOnce({ status: 409, outcome: { kind: "exists" }, remote: null, recordUuid: null });
    await undo(e);
    await run();
    expect(sm8.active(e.remote_uuid as string)).toBe(true);
    expect(takeBackOf(e.id)).toMatchObject({ status: "failed", last_error: BOOKING_WORDS.row.removeRefused, http_status: 409 });
  });

  it("(F) the DELETE after a token renewal reads again first: a booking out meanwhile gets no second DELETE", async () => {
    const c = await sentBooking();
    const uuid = c.remote_uuid as string;
    await undo(c);
    deleteSm8Booking.mockResolvedValueOnce({ status: 401, outcome: { kind: "unauthorized" }, remote: null, recordUuid: null });
    renewSm8Access.mockImplementation(async () => {
      sm8.removeThere(uuid);
      return { ok: true, access: RENEWED };
    });
    await run();
    expect(renewSm8Access).toHaveBeenCalledTimes(1);
    expect(sm8.deletes).toEqual([]);
    expect(sm8.active(uuid)).toBe(false);
    expect(takeBackOf(c.id)?.status).toBe("sent");
  });

  it("(F) a booking moved in ServiceM8 (another start or person) is refused changedNoTakeBack with no DELETE; one only opened (its edit time) is taken out", async () => {
    const c = await sentBooking();
    sm8.moveThere(c.remote_uuid as string, { start: at(TOMORROW, "20:30"), end: at(TOMORROW, "21:30") });
    await undo(c);
    await run();
    expect(sm8.deletes).toEqual([]);
    expect(takeBackOf(c.id)).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.changedNoTakeBack });
    expect(await lineOf(c)).toMatchObject({ key: "line.stillIn", tone: null, acts: [] });

    const e = await sentBooking(slot(SAM_SM8, "15:00", "16:00"));
    sm8.moveThere(e.remote_uuid as string, { staffUuid: ALEX_SM8 });
    await undo(e);
    await run();
    expect(takeBackOf(e.id)).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.changedNoTakeBack });

    const f = await sentBooking(slot(SAM_SM8, "11:00", "12:00"));
    sm8.openThere(f.remote_uuid as string);
    await undo(f);
    await run();
    expect(sm8.deletes).toEqual([f.remote_uuid]);
    expect(takeBackOf(f.id)?.status).toBe("sent");
  });

  it("(F) a check-in by its person in its window is never taken out; for a booking ServiceM8 put on someone else, that person's check-in counts; a zero-length row is nothing", async () => {
    const c = await sentBooking();
    sm8.put({ uuid: "acac0185-0000-4000-8000-00000000ac85", jobUuid: JOB, staffUuid: SAM_SM8, start: at(TOMORROW, "19:30"), end: null, scheduled: 0, recorded: 1 });
    await undo(c);
    await run();
    expect(sm8.deletes).toEqual([]);
    expect(takeBackOf(c.id)).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.checkIn });

    /* ServiceM8 put it on Alex; Alex is checked in */
    sm8.knobs.keeps = () => ({ staffUuid: ALEX_SM8 });
    await bookIn([slot(SAM_SM8, "15:00", "16:00")]);
    await run();
    const e = creates().find((x) => x.booking_start === at(TOMORROW, "15:00"))!;
    expect(e.last_error).toBe(BOOKING_WORDS.row.personNotKept);
    fake.db.integration_connections[0].write_kinds = ["attachment", "note", "booking"];
    sm8.put({ uuid: "acac0186-0000-4000-8000-00000000ac86", jobUuid: JOB, staffUuid: ALEX_SM8, start: at(TOMORROW, "15:05"), end: at(TOMORROW, "15:40"), scheduled: 0, recorded: 1 });
    await undo(e);
    await run();
    expect(sm8.deletes).toEqual([]);
    expect(takeBackOf(e.id)).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.checkIn });

    /* recorded time cleared in ServiceM8 leaves a zero-length row: it is nothing */
    sm8.knobs.keeps = null;
    const f = await sentBooking(slot(SAM_SM8, "11:00", "12:00"));
    sm8.put({ uuid: "acac0187-0000-4000-8000-00000000ac87", jobUuid: JOB, staffUuid: SAM_SM8, start: at(TOMORROW, "10:30"), end: at(TOMORROW, "10:30"), scheduled: 0 });
    await undo(f);
    await run();
    expect(sm8.deletes).toEqual([f.remote_uuid]);
  });

  it("(F) one that has started is refused at the press; a take-back already queued when it starts is cancelled notFuture with no DELETE; one that can't have landed is still stopped", async () => {
    const c = await sentBooking();
    Object.assign(c, { booking_start: at(day(-1), "20:00"), booking_end: at(day(-1), "21:00") });
    expect(await undo(c)).toEqual({ ok: false, refusal: "not_future" });
    expect(c.taken_back_at).toBeNull();

    const e = await sentBooking(slot(SAM_SM8, "15:00", "16:00"));
    await undo(e);
    /* it starts before the take-back goes: ServiceM8 holds it at a time now past */
    sm8.moveThere(e.remote_uuid as string, { start: at(day(-1), "15:00"), end: at(day(-1), "16:00") });
    Object.assign(e, { booking_start: at(day(-1), "15:00"), booking_end: at(day(-1), "16:00") });
    await run();
    expect(sm8.deletes).toEqual([]);
    expect(takeBackOf(e.id)).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.notFuture });
    expect(await lineOf(e)).toMatchObject({ key: "line.stillIn", acts: [] });

    await bookIn([slot(SAM_SM8, "11:00", "12:00")]);
    const q = creates().find((x) => x.booking_start === at(TOMORROW, "11:00"))!;
    Object.assign(q, { booking_start: at(day(-1), "11:00"), booking_end: at(day(-1), "12:00") });
    expect(await undo(q)).toMatchObject({ ok: true, plan: "cancelled" });
  });

  it("(F) one marked changed there is refused at the press, and by the sender with no DELETE", async () => {
    const c = await sentBooking();
    c.last_error = BOOKING_WORDS.row.movedThere;
    expect(await undo(c)).toEqual({ ok: false, refusal: "changed" });
    /* the row written by hand, as the press never would: the sender refuses too */
    fake.db.sm8_writes.push({
      id: randomUUID(),
      org_id: ORG,
      tenant_id: TENANT,
      kind: "booking",
      op: "delete",
      sm8_job_uuid: JOB,
      subject: `undo:${c.id}`,
      payload: { name: BOOKING_WORDS.label.undo },
      remote_uuid: randomUUID(),
      status: "queued",
      attempts: 0,
      next_attempt_at: new Date(Date.now() - 1000).toISOString(),
      created_at: new Date().toISOString(),
      depends_on: c.id,
      verb_id: c.verb_id,
      lease_until: null,
      maybe_landed: false,
      verify_uuids: [],
      replaced_uuids: [],
    });
    await run();
    expect(sm8.deletes).toEqual([]);
    expect(takeBackOf(c.id)).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.changedNoTakeBack });
  });

  it("(F) only whoever booked it takes it back: anyone else is refused, and nothing changes", async () => {
    const c = await sentBooking();
    const before = JSON.stringify(writes());
    expect(await undo(c, "alex")).toEqual({ ok: false, refusal: "not_yours", presser: "staff-sam" });
    expect(JSON.stringify(writes())).toBe(before);
  });

  it("(F) a booking whose create is being sent under a live claim waits, never going first", async () => {
    await bookIn();
    const [c] = creates();
    Object.assign(c, { status: "sending", lease_until: new Date(Date.now() + 90_000).toISOString(), maybe_landed: true, claim_id: "x" });
    expect(await undo(c)).toMatchObject({ ok: true, plan: "deleting" });
    await run();
    const d = takeBackOf(c.id)!;
    expect(sm8.deletes).toEqual([]);
    expect(d.status).toBe("queued");
    expect(Date.parse(d.next_attempt_at as string)).toBeGreaterThanOrEqual(Date.now() + 29_000);
    expect(await lineOf(c)).toMatchObject({ key: "line.takingOut" });
  });

  it("(F) taking back a verb's last booking closes its status row; one another press's booking depends on is left alone", async () => {
    const a = await verb();
    a.s.next_attempt_at = future();
    await undo(a.cs[0]);
    expect(a.s).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.takenBackBeforeSent });
    expect(a.s.taken_back_at).toBeTruthy();

    const b = await verb({ seen: "2026-09-27 16:00:01" });
    b.s.next_attempt_at = future();
    await bookIn([slot(ALEX_SM8, "15:00", "16:00")], { seen: "2026-09-27 16:00:01" });
    await undo(b.cs[0]);
    expect(b.s).toMatchObject({ status: "queued", taken_back_at: null });
  });
});

/* ── the account ── */

describe("every request checks its account (B-19)", () => {
  it("(F) a 401 whose renewal hands back another account's token makes no second request: a take-back meeting it is cancelled otherAccount, never counted gone", async () => {
    const c = await sentBooking();
    await undo(c);
    deleteSm8Booking.mockResolvedValueOnce({ status: 401, outcome: { kind: "unauthorized" }, remote: null, recordUuid: null });
    renewSm8Access.mockResolvedValue({ ok: true, access: { ...RENEWED, tenantId: "vendor-other" } });
    await run();
    expect(deleteSm8Booking).toHaveBeenCalledTimes(1);
    expect(takeBackOf(c.id)).toMatchObject({ status: "cancelled", last_error: WRITE_WORDS.otherAccount });
    expect(sm8.active(c.remote_uuid as string)).toBe(true);
    expect(await lineOf(c)).toMatchObject({ key: "line.stillIn", acts: ["take_out_again"] });
  });

  it("(F) ...and a booking meeting it is cancelled otherAccount with no second POST, and nothing landed", async () => {
    await bookIn();
    const [c] = creates();
    postSm8Booking.mockResolvedValueOnce({ status: 401, outcome: { kind: "unauthorized" }, remote: null, recordUuid: null });
    renewSm8Access.mockResolvedValue({ ok: true, access: { ...RENEWED, tenantId: "vendor-other" } });
    await run();
    expect(postSm8Booking).toHaveBeenCalledTimes(1);
    expect(c).toMatchObject({ status: "cancelled", last_error: WRITE_WORDS.otherAccount, maybe_landed: false });
  });

  it("(F) a take-back queued after an account switch is cancelled otherAccount, and never deletes", async () => {
    const c = await sentBooking();
    c.tenant_id = "vendor-old";
    await undo(c);
    await run();
    expect(sm8.deletes).toEqual([]);
    expect(takeBackOf(c.id)).toMatchObject({ status: "cancelled", last_error: WRITE_WORDS.otherAccount });
  });
});

/* ── Clear ── */

const LEFT = "acac0199-0000-4000-8000-00000000ac99";

/** A leftover: a booking tomorrow on job 9002, which is Completed. */
function leftover(over: Row = {}): void {
  sm8.job(OTHER_JOB, { status: "Completed", kept: { generated_job_id: "9002" } as never });
  sm8.put({ uuid: LEFT, jobUuid: OTHER_JOB, staffUuid: SAM_SM8, start: at(TOMORROW, "09:00"), end: at(TOMORROW, "11:00"), ...over });
  mirrored(LEFT);
}
const clear = async (seen: { staffUuid: string; start: string } = { staffUuid: SAM_SM8, start: at(TOMORROW, "09:00") }) =>
  queueClear(await pressAs(), await state(), { jobUuid: OTHER_JOB, activityUuid: LEFT, seen, verbId: randomUUID() });
const clearRow = () => deletesOf().find((d) => d.target_uuid === LEFT && !d.depends_on)!;

describe("Clear takes a leftover booking off a finished job (B-10)", () => {
  it("(F) is queued once with the mirror's copy, read live, DELETEd once, read back — and a double press is one row", async () => {
    leftover();
    expect(await clear()).toMatchObject({ ok: true });
    expect(await clear()).toMatchObject({ ok: true });
    expect(deletesOf()).toHaveLength(1);
    expect(clearRow()).toMatchObject({
      op: "delete",
      subject: `clear:${LEFT}`,
      target_uuid: LEFT,
      depends_on: null,
      sm8_job_uuid: OTHER_JOB,
      booking_staff_uuid: SAM_SM8,
      booking_start: at(TOMORROW, "09:00"),
      booking_end: at(TOMORROW, "11:00"),
      payload: { name: BOOKING_WORDS.label.clear },
    });
    await run();
    expect(sm8.deletes).toEqual([LEFT]);
    expect(sm8.active(LEFT)).toBe(false);
    expect(clearRow()).toMatchObject({ status: "sent", target_uuid: LEFT, http_status: 200 });
  });

  it("(F) the press refuses what isn't a leftover: a job not finished, recorded time, one started, or one not as the confirm showed it", async () => {
    leftover();
    fake.db.sm8_jobs[1].status = "Work Order";
    expect(await clear()).toEqual({ ok: false, refusal: "not_leftover" });
    fake.db.sm8_jobs[1].status = "Unsuccessful";
    expect(await clear({ staffUuid: ALEX_SM8, start: at(TOMORROW, "09:00") })).toEqual({ ok: false, refusal: "changed" });
    (fake.db.sm8_job_activities as Row[])[0].activity_was_scheduled = 0;
    expect(await clear()).toEqual({ ok: false, refusal: "check_in" });
    Object.assign((fake.db.sm8_job_activities as Row[])[0], { activity_was_scheduled: 1, start_date: at(day(-1), "09:00"), end_date: at(day(-1), "11:00") });
    expect(await clear({ staffUuid: SAM_SM8, start: at(day(-1), "09:00") })).toEqual({ ok: false, refusal: "not_future" });
    Object.assign((fake.db.sm8_job_activities as Row[])[0], { start_date: at(TOMORROW, "09:00"), end_date: null });
    expect(await clear()).toEqual({ ok: false, refusal: "not_leftover" });
    expect(deletesOf()).toHaveLength(0);
  });

  it("(F) the sender refuses a check-in, a start now past, and a job no longer finished — each with no DELETE", async () => {
    leftover();
    await clear();
    sm8.get(LEFT)!.recorded = 1;
    await run();
    expect(clearRow()).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.checkIn });

    fake.db.sm8_writes = [];
    leftover();
    await clear();
    sm8.moveThere(LEFT, { start: at(day(-1), "09:00"), end: at(day(-1), "11:00") });
    await run();
    expect(clearRow()).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.notFuture });

    fake.db.sm8_writes = [];
    leftover();
    await clear();
    sm8.jobs.get(OTHER_JOB)!.status = "Work Order";
    await run();
    expect(clearRow()).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.notLeftover });
    expect(sm8.deletes).toEqual([]);
  });

  it("(F) a 404 on its DELETE, read back out, is gone; still active on two reads, it fails removeNotKept", async () => {
    leftover();
    await clear();
    deleteSm8Booking.mockImplementationOnce(async (_call: unknown, u: string) => {
      sm8.removeThere(u);
      return { status: 404, outcome: { kind: "rejected", status: 404 }, remote: null, recordUuid: null };
    });
    await run();
    expect(clearRow()).toMatchObject({ status: "sent", http_status: 404 });

    fake.db.sm8_writes = [];
    leftover();
    await clear();
    deleteSm8Booking.mockResolvedValueOnce({ status: 200, outcome: { kind: "created", remoteUuid: null }, remote: null, recordUuid: null });
    await run();
    expect(clearRow()).toMatchObject({ status: "failed", last_error: BOOKING_WORDS.row.removeNotKept, http_status: 200 });
    expect(sm8.active(LEFT)).toBe(true);
  });

  it("(F) a Clear cancelled changed, pressed again once the move is in the mirror, goes with the mirror's new copy; so does a trial Clear pressed again for real", async () => {
    leftover();
    await clear();
    sm8.moveThere(LEFT, { start: at(TOMORROW, "09:30"), end: at(TOMORROW, "11:30") });
    await run();
    const row = clearRow();
    expect(row).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.changed });
    /* the sync brings the move; the person looks again and clears it */
    mirrored(LEFT);
    expect(await clear({ staffUuid: SAM_SM8, start: at(TOMORROW, "09:30") })).toMatchObject({ ok: true });
    expect(deletesOf()).toHaveLength(1);
    expect(row).toMatchObject({ status: "queued", booking_start: at(TOMORROW, "09:30"), booking_end: at(TOMORROW, "11:30") });
    /* it tried a moment ago: it goes a minute on from that try */
    due(row);
    await run();
    expect(row.status).toBe("sent");
    expect(sm8.active(LEFT)).toBe(false);

    fake.db.sm8_writes = [];
    sm8.deletes.length = 0;
    leftover();
    fake.db.integration_connections[0].write_mode = "trial";
    await clear();
    await run();
    expect(clearRow().status).toBe("trial");
    expect(sm8.deletes).toEqual([]);
    fake.db.integration_connections[0].write_mode = "live";
    await clear();
    await run();
    expect(clearRow().status).toBe("sent");
    expect(sm8.deletes).toEqual([LEFT]);
  });

  it("(F) a Clear's Try again goes again with the booking as the mirror has it, checked against the booking its last press saw", async () => {
    leftover();
    await clear();
    deleteSm8Booking.mockResolvedValueOnce({ status: 422, outcome: { kind: "rejected", status: 422 }, remote: null, recordUuid: null });
    await run();
    const row = clearRow();
    expect(row).toMatchObject({ status: "failed", last_error: BOOKING_WORDS.row.removeRefused });
    expect(await queueBookingRetry(await pressAs(), await state(), { rowId: row.id as string })).toMatchObject({ ok: true });
    due(row);
    await run();
    expect(row.status).toBe("sent");
    /* moved since that press: Try again is refused changed, and Look again shows it afresh */
    fake.db.sm8_writes = [];
    leftover();
    await clear();
    deleteSm8Booking.mockResolvedValueOnce({ status: 422, outcome: { kind: "rejected", status: 422 }, remote: null, recordUuid: null });
    await run();
    Object.assign((fake.db.sm8_job_activities as Row[])[0], { start_date: at(TOMORROW, "10:00"), end_date: at(TOMORROW, "12:00") });
    expect(await queueBookingRetry(await pressAs(), await state(), { rowId: clearRow().id as string })).toEqual({ ok: false, refusal: "changed" });
  });
});

/* ── one DELETE per booking ── */

describe("one DELETE per booking, and never one sooner (review: M2, R2-1, R2-2, R2-5, S2, R2-8)", () => {
  const R409 = { status: 409, outcome: { kind: "exists" }, remote: null, recordUuid: null };

  /** One of our bookings, on a job then finished: a leftover as well. */
  async function finishedBooking(s = slot()): Promise<Row> {
    const status = (to: string) => {
      sm8.jobs.get(JOB)!.status = to;
      fake.db.sm8_jobs[0].status = to;
    };
    status("Work Order");
    const c = await sentBooking(s);
    status("Completed");
    mirrored(c.remote_uuid as string);
    return c;
  }
  const clearOf = async (c: Row) =>
    queueClear(await pressAs(), await state(), {
      jobUuid: JOB,
      activityUuid: c.remote_uuid as string,
      seen: { staffUuid: c.booking_staff_uuid as string, start: c.booking_start as string },
      verbId: randomUUID(),
    });
  const clearOn = (c: Row) => deletesOf().find((d) => !d.depends_on && d.target_uuid === c.remote_uuid);

  it("(F, M2) a Clear pressed while an Undo of that booking is on its way is refused taking_out; an Undo pressed while a Clear of it is on its way likewise — and nothing changes", async () => {
    const c = await finishedBooking();
    expect(await undo(c)).toMatchObject({ ok: true, plan: "deleting" });
    expect(await clearOf(c)).toEqual({ ok: false, refusal: "taking_out" });
    expect(deletesOf()).toHaveLength(1);

    const e = await finishedBooking(slot(SAM_SM8, "15:00", "16:00"));
    expect(await clearOf(e)).toMatchObject({ ok: true });
    /* ServiceM8's copy spells its uuid the other way: the same booking */
    clearOn(e)!.target_uuid = String(e.remote_uuid).toUpperCase();
    const before = JSON.stringify(writes());
    expect(await undo(e)).toEqual({ ok: false, refusal: "taking_out" });
    expect(JSON.stringify(writes())).toBe(before);
    expect(e.taken_back_at).toBeNull();
  });

  it("(F, R2-1) a second Undo while its take-back is on its way, and a second Clear while it is, change nothing at all", async () => {
    const c = await sentBooking();
    await undo(c);
    const d = takeBackOf(c.id)!;
    d.next_attempt_at = new Date(Date.now() + 60_000).toISOString();
    const was = { ...d };
    expect(await undo(c)).toEqual({ ok: true, plan: "already", rowIds: [] });
    expect(d).toEqual(was);

    leftover();
    await clear();
    const row = clearRow();
    row.next_attempt_at = new Date(Date.now() + 60_000).toISOString();
    const rowWas = { ...row };
    expect(await clear()).toEqual({ ok: true, rowIds: [] });
    expect(row).toEqual(rowWas);
  });

  it("(F, R2-1) a take-back on its way, pressed again through the queue itself, never comes forward", async () => {
    const c = await sentBooking();
    await undo(c);
    const d = takeBackOf(c.id)!;
    const later = new Date(Date.now() + 60_000).toISOString();
    d.next_attempt_at = later;
    const again = await enqueueSm8Writes(await pressAs(), await state(), [
      { kind: "booking", op: "delete", jobUuid: JOB, subject: `undo:${c.id}`, payload: { name: BOOKING_WORDS.label.undo }, ref: String(c.id), dependsOn: String(c.id), verbId: String(c.verb_id) },
    ]);
    expect(again?.ids).toEqual([d.id]);
    expect(d.next_attempt_at).toBe(later);
  });

  it("(F, R2-1) an Undo's DELETE lands and its answer is lost: a double press, a stale tab and Home's Clear bring nothing forward — one DELETE, and it stays out", async () => {
    const c = await finishedBooking();
    const x = c.remote_uuid as string;
    /* it lands; the answer never comes; reads lag it a moment (U23) */
    sm8.knobs.lagNextWriteMs = 5_000;
    deleteSm8Booking.mockImplementationOnce(async (call: unknown, u: string) => {
      await sm8.deleteBooking(call, u);
      return LOST;
    });
    await undo(c);
    await run();
    const d = takeBackOf(c.id)!;
    expect(d).toMatchObject({ status: "queued", attempts: 1 });
    const due1 = d.next_attempt_at;
    expect(await undo(c)).toEqual({ ok: true, plan: "already", rowIds: [] });
    expect(await queueBookingTakeBack(await pressAs(), await state(), { createRowId: c.id as string })).toEqual({ ok: true, plan: "already", rowIds: [] });
    expect(await clearOf(c)).toEqual({ ok: false, refusal: "taking_out" });
    expect(d.next_attempt_at).toBe(due1);
    /* the presses' drain: nothing of it is due */
    await run();
    expect(sm8.deletes).toEqual([x]);
    /* a minute on, the read shows it out */
    skew += 61_000;
    await run();
    expect(sm8.deletes).toEqual([x]);
    expect(sm8.active(x)).toBe(false);
    expect(d).toMatchObject({ status: "sent", verify_uuids: [x] });
  });

  it("(F, R2-1) a DELETE that took, read back while reads lag, fails removeNotKept; Try again seconds later waits out the minute, then reads it out — one DELETE", async () => {
    const c = await sentBooking();
    const x = c.remote_uuid as string;
    sm8.knobs.lagNextWriteMs = 5_000;
    await undo(c);
    await run();
    const d = takeBackOf(c.id)!;
    expect(d).toMatchObject({ status: "failed", last_error: BOOKING_WORDS.row.removeNotKept, verify_uuids: [x] });
    expect(sm8.active(x)).toBe(false);
    expect(await queueBookingRetry(await pressAs(), await state(), { rowId: d.id as string })).toMatchObject({ ok: true });
    await run();
    expect(sm8.deletes).toEqual([x]);
    skew += 61_000;
    await run();
    expect(sm8.deletes).toEqual([x]);
    expect(sm8.active(x)).toBe(false);
    expect(d.status).toBe("sent");
  });

  it("(F, M2) an Undo and a Clear of one booking drained at once: the one claimed first DELETEs, the other waits for it and then finds it out — one DELETE", async () => {
    const c = await finishedBooking();
    const x = c.remote_uuid as string;
    await undo(c);
    const d = takeBackOf(c.id)!;
    /* a Clear pressed in the same moment, before either could see the other */
    fake.db.sm8_writes.push({
      id: randomUUID(),
      org_id: ORG,
      tenant_id: TENANT,
      kind: "booking",
      op: "delete",
      sm8_job_uuid: JOB,
      subject: `clear:${x}`,
      payload: { name: BOOKING_WORDS.label.clear },
      remote_uuid: randomUUID(),
      status: "queued",
      attempts: 0,
      next_attempt_at: new Date(Date.now() - 1000).toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      target_uuid: x,
      depends_on: null,
      verb_id: randomUUID(),
      booking_staff_uuid: SAM_SM8,
      booking_start: c.booking_start,
      booking_end: c.booking_end,
      lease_until: null,
      maybe_landed: false,
      verify_uuids: [],
      replaced_uuids: [],
    });
    const cl = clearOn(c)!;
    /* the Undo's run is held at its DELETE */
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    deleteSm8Booking.mockImplementationOnce(async (call: unknown, u: string) => {
      await gate;
      return sm8.deleteBooking(call, u);
    });
    const first = run({ ids: [d.id as string] });
    while (deleteSm8Booking.mock.calls.length === 0) await new Promise((r) => setImmediate(r));
    /* the Clear's run, claimed a moment later, reaches its DELETE while the Undo's is in flight */
    skew += 1_000;
    await run({ ids: [cl.id as string] });
    expect(cl).toMatchObject({ status: "queued", attempts: 0 });
    release();
    await first;
    expect(d).toMatchObject({ status: "sent", verify_uuids: [x] });
    skew += 150_000;
    await run();
    expect(sm8.deletes).toEqual([x]);
    expect(sm8.active(x)).toBe(false);
    expect(cl).toMatchObject({ status: "sent", verify_uuids: [x] });
  });

  it("(F, R2-2) a Clear whose read-back lags fails removeNotKept; an Undo then reading it active waits a minute from the Clear's try, and finds it out — one DELETE", async () => {
    const c = await finishedBooking();
    const x = c.remote_uuid as string;
    expect(await clearOf(c)).toMatchObject({ ok: true });
    sm8.knobs.lagNextWriteMs = 5_000;
    await run();
    const cl = clearOn(c)!;
    expect(cl).toMatchObject({ status: "failed", last_error: BOOKING_WORDS.row.removeNotKept });
    expect(await undo(c)).toMatchObject({ ok: true, plan: "deleting" });
    await run();
    const d = takeBackOf(c.id)!;
    expect(sm8.deletes).toEqual([x]);
    expect(d).toMatchObject({ status: "queued" });
    const settled = Date.parse(cl.updated_at as string) + 60_000;
    expect(Date.parse(d.next_attempt_at as string)).toBeGreaterThanOrEqual(settled);
    expect(Date.parse(d.next_attempt_at as string)).toBeLessThan(settled + 1_000);
    skew += 61_000;
    await run();
    expect(sm8.deletes).toEqual([x]);
    expect(sm8.active(x)).toBe(false);
    expect(d).toMatchObject({ status: "sent", verify_uuids: [x] });
  });

  it("(F, R2-2) a Clear that went and took it out, while reads still show it: the Undo counts it out, with no DELETE", async () => {
    const c = await finishedBooking();
    const x = c.remote_uuid as string;
    sm8.knobs.lagNextWriteMs = 5_000;
    await sm8.deleteBooking(null, x);
    fake.db.sm8_writes.push({
      id: randomUUID(),
      org_id: ORG,
      tenant_id: TENANT,
      kind: "booking",
      op: "delete",
      sm8_job_uuid: JOB,
      subject: `clear:${x}`,
      payload: { name: BOOKING_WORDS.label.clear },
      remote_uuid: randomUUID(),
      status: "sent",
      attempts: 1,
      next_attempt_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date(Date.now() - 120_000).toISOString(),
      target_uuid: x,
      depends_on: null,
      verb_id: randomUUID(),
      booking_staff_uuid: SAM_SM8,
      booking_start: c.booking_start,
      booking_end: c.booking_end,
      lease_until: null,
      maybe_landed: false,
      verify_uuids: [x],
      replaced_uuids: [],
    });
    expect(await undo(c)).toMatchObject({ ok: true, plan: "deleting" });
    await run();
    expect(sm8.deletes).toEqual([x]);
    expect(sm8.active(x)).toBe(false);
    expect(takeBackOf(c.id)).toMatchObject({ status: "sent", http_status: null, verify_uuids: [] });
  });

  it("(F, M2) the other take-backs and Clears of a booking that can't be read are never 'none': back to the queue, no DELETE", async () => {
    const c = await sentBooking();
    await undo(c);
    fake.before.sm8_writes = (s) => (s.op === "select" && s.filters.includes("depends_on is null") ? "fail" : undefined);
    await run();
    expect(deleteSm8Booking).not.toHaveBeenCalled();
    expect(takeBackOf(c.id)).toMatchObject({ status: "queued" });
  });

  it("(F, R2-5) a booking whose POST answer was lost, taken back at once: not there is read again for a minute — it lands, the overlay still shows it, the take-back is still on its way, and it goes out", async () => {
    await bookIn();
    const [c] = creates();
    const x = c.remote_uuid as string;
    postSm8Booking.mockResolvedValueOnce(LOST);
    await run();
    expect(c).toMatchObject({ status: "queued", maybe_landed: true });
    expect(await undo(c)).toMatchObject({ ok: true, plan: "deleting" });
    await run();
    const d = takeBackOf(c.id)!;
    expect(d).toMatchObject({ status: "queued", verify_uuids: [] });
    expect(deleteSm8Booking).not.toHaveBeenCalled();
    /* it lands after all */
    sm8.put({ uuid: x, jobUuid: JOB, staffUuid: SAM_SM8, start: at(TOMORROW, "20:00"), end: at(TOMORROW, "21:00") });
    mirrored(x);
    expect((await readBookingOverlay(ORG, await state(), { uuids: [x] })).gone.has(x)).toBe(false);
    expect(await lineOf(c)).toMatchObject({ key: "line.takingOut" });
    skew += 61_000;
    await run();
    expect(sm8.deletes).toEqual([x]);
    expect(sm8.active(x)).toBe(false);
    expect(d).toMatchObject({ status: "sent", verify_uuids: [x] });
    expect((await readBookingOverlay(ORG, await state(), { uuids: [x] })).gone.has(x)).toBe(true);
  });

  it("(F, R2-5) ...and one that never lands: a minute on, not there is out, and it hides nothing", async () => {
    await bookIn();
    const [c] = creates();
    const x = c.remote_uuid as string;
    postSm8Booking.mockResolvedValueOnce(LOST);
    await run();
    await undo(c);
    skew += 61_000;
    await run();
    expect(deleteSm8Booking).not.toHaveBeenCalled();
    expect(takeBackOf(c.id)).toMatchObject({ status: "sent", verify_uuids: [] });
    expect((await readBookingOverlay(ORG, await state(), { uuids: [x] })).gone.has(x)).toBe(false);
  });

  it("(F, S2, R2-3) a DELETE answered 409: read back out, it counts as out; its read-back failing, it goes back to the queue remembering it — never gone — and its next go only reads", async () => {
    const c = await sentBooking();
    const x = c.remote_uuid as string;
    deleteSm8Booking.mockImplementationOnce(async (_call: unknown, u: string) => {
      sm8.removeThere(u);
      return R409;
    });
    await undo(c);
    await run();
    expect(takeBackOf(c.id)).toMatchObject({ status: "sent", http_status: 409, verify_uuids: [x] });

    const e = await sentBooking(slot(SAM_SM8, "15:00", "16:00"));
    const y = e.remote_uuid as string;
    let deleted = false;
    deleteSm8Booking.mockImplementationOnce(async (_call: unknown, u: string) => {
      deleted = true;
      sm8.removeThere(u);
      return R409;
    });
    readSm8Booking.mockImplementation(async (call: unknown, u: string) => (deleted ? { ok: false } : sm8.readBooking(call, u)));
    await undo(e);
    await run();
    const f = takeBackOf(e.id)!;
    expect(f).toMatchObject({ status: "queued", http_status: 409, verify_uuids: [y] });
    readSm8Booking.mockImplementation(sm8.readBooking);
    skew += 150_000;
    await run();
    expect(deleteSm8Booking).toHaveBeenCalledTimes(2);
    expect(f).toMatchObject({ status: "sent", verify_uuids: [y] });
  });

  it("(F, R2-4) a Clear reads its job before its booking: one cancelled while its job is read gets no DELETE, even where the job's list lags", async () => {
    leftover();
    await clear();
    readSm8Job.mockImplementationOnce(async (call: unknown, u: string) => {
      sm8.removeThere(LEFT);
      return sm8.readJob(call, u);
    });
    /* the job's list of bookings still shows it */
    readSm8JobBookings.mockImplementationOnce(async () => ({ ok: true, activities: [{ ...sm8.get(LEFT)!, active: 1 }] }));
    await run();
    expect(deleteSm8Booking).not.toHaveBeenCalled();
    expect(sm8.active(LEFT)).toBe(false);
    expect(clearRow()).toMatchObject({ status: "sent", verify_uuids: [LEFT] });
  });

  it("(F, R2-8) a take-back on a job gone from the mirror still reads its booking, and takes it out", async () => {
    const c = await sentBooking();
    fake.db.sm8_jobs[0].active = 0;
    await undo(c);
    await run();
    expect(sm8.deletes).toEqual([c.remote_uuid]);
    expect(takeBackOf(c.id)).toMatchObject({ status: "sent" });
  });
});

describe("a press decides on the whole overlay, or queues nothing (review: S3)", () => {
  it("(F) what we took out, or what we sent, unreadable: Book in is unqueued, and nothing is queued", async () => {
    await sentBooking();
    for (const pick of [
      (f: string[]) => f.includes("status=sent") && f.includes("op=delete"),
      (f: string[]) => f.includes("status=sent") && f.includes("op=create"),
    ]) {
      fake.before.sm8_writes = (s) => (s.op === "select" && pick(s.filters) ? "fail" : undefined);
      const before = JSON.stringify(writes());
      expect(await bookIn([slot(SAM_SM8, "15:00", "16:00")])).toEqual({ ok: false, refusal: "unqueued" });
      expect(JSON.stringify(writes())).toBe(before);
    }
    delete fake.before.sm8_writes;
    expect(await bookIn([slot(SAM_SM8, "15:00", "16:00")])).toMatchObject({ ok: true });
  });
});

/* ── the queue's slot rules ── */

describe("one row per job, person and start; a slot comes back only once it no longer stands (B-11)", () => {
  const SUBJECT = `slot:${SAM_SM8}:${TOMORROW}T20:00`;

  it("(F) same-slot presses make one row, and a slot still standing answers already_booked — in the mirror, or sent and not mirrored yet", async () => {
    await bookIn();
    expect(await bookIn()).toMatchObject({ ok: true, rowIds: [], already: [SUBJECT] });
    expect(creates()).toHaveLength(1);
    await run();
    expect(await bookIn()).toEqual({ ok: false, refusal: "already_booked", slot: slot() });
    mirrored(creates()[0].remote_uuid as string);
    expect(await bookIn()).toEqual({ ok: false, refusal: "already_booked", slot: slot() });
    expect(creates()).toHaveLength(1);
  });

  it("(F) a sent slot the mirror shows moved, or removed, gives its slot back (:was:) and is booked fresh", async () => {
    const c = await sentBooking();
    sm8.moveThere(c.remote_uuid as string, { start: at(TOMORROW, "21:00"), end: at(TOMORROW, "22:00") });
    mirrored(c.remote_uuid as string);
    expect(await bookIn()).toMatchObject({ ok: true });
    expect(c.subject).toBe(`${SUBJECT}:was:${c.id}`);
    expect(creates().filter((x) => x.subject === SUBJECT)).toHaveLength(1);

    const e = await sentBooking(slot(SAM_SM8, "15:00", "16:00"));
    sm8.removeThere(e.remote_uuid as string);
    mirrored(e.remote_uuid as string);
    expect(await bookIn([slot(SAM_SM8, "15:00", "16:00")])).toMatchObject({ ok: true });
    expect(e.subject).toMatch(/:was:/);
  });

  it("(F) a slot whose take-back ended cancelled for good: the mirror decides — standing is already_booked, otherwise it is released", async () => {
    const c = await sentBooking();
    sm8.put({ uuid: "acac0185-0000-4000-8000-00000000ac85", jobUuid: JOB, staffUuid: SAM_SM8, start: at(TOMORROW, "19:30"), end: null, scheduled: 0, recorded: 1 });
    await undo(c);
    await run();
    expect(takeBackOf(c.id)).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.checkIn });
    mirrored(c.remote_uuid as string);
    expect(await bookIn()).toEqual({ ok: false, refusal: "already_booked", slot: slot() });

    sm8.moveThere(c.remote_uuid as string, { start: at(TOMORROW, "20:30"), end: at(TOMORROW, "21:30") });
    mirrored(c.remote_uuid as string);
    expect(await bookIn()).toMatchObject({ ok: true });
    expect(c.subject).toMatch(/:was:/);
  });

  it("(F) two presses giving the same slot back make one new row", async () => {
    const c = await sentBooking();
    sm8.removeThere(c.remote_uuid as string);
    mirrored(c.remote_uuid as string);
    const [a, b] = await Promise.all([bookIn(), bookIn()]);
    expect([a.ok, b.ok]).toContain(true);
    expect(creates().filter((x) => x.subject === SUBJECT)).toHaveLength(1);
    expect(creates().filter((x) => String(x.subject).startsWith(`${SUBJECT}:was:`))).toHaveLength(1);
  });

  it("(F) a re-press of a failed slot writes this press's length, press and status row; a Work Order re-press clears an old status row", async () => {
    const first = await verb();
    const [c] = first.cs;
    Object.assign(first.s, { status: "failed", last_error: BOOKING_WORDS.row.statusRefused });
    Object.assign(c, { status: "cancelled", last_error: BOOKING_WORDS.row.statusFirst });
    const verbId = randomUUID();
    await bookIn([slot(SAM_SM8, "20:00", "22:00")], { verbId });
    expect(c).toMatchObject({ status: "queued", booking_end: at(TOMORROW, "22:00"), verb_id: verbId, depends_on: null });
    expect(creates()).toHaveLength(1);
  });

  it("(F) a re-press racing an Undo misses on taken_back_at, and answers taking_out — never already", async () => {
    await bookIn();
    const [c] = creates();
    Object.assign(c, { status: "failed", last_error: BOOKING_WORDS.row.refused });
    fake.before.sm8_writes = (st) => {
      if (st.op === "update" && st.patch?.status === "queued" && st.filters.includes(`id=${c.id}`)) {
        c.taken_back_at = new Date().toISOString();
      }
    };
    const q = await bookIn();
    fake.before.sm8_writes = undefined;
    expect(q).toEqual({ ok: false, refusal: "taking_out", slot: slot() });
    expect(c.status).toBe("failed");
  });

  it("(F) a status row taken back by a trial's Cancel booking gives its key back, and a later Book in at the same edit time makes a fresh one that goes (L1, then L6)", async () => {
    fake.db.integration_connections[0].write_mode = "trial";
    const a = await verb();
    await run();
    expect(a.s.status).toBe("trial");
    expect(await undo(a.cs[0])).toMatchObject({ ok: true, plan: "cancelled" });
    expect(a.s.taken_back_at).toBeTruthy();
    fake.db.integration_connections[0].write_mode = "live";
    const again = await bookIn([slot()], { seen: SEEN });
    expect(again).toMatchObject({ ok: true });
    expect(a.s.subject).toMatch(/:was:/);
    const fresh = byId(again.ok && again.statusRowId);
    expect(fresh.id).not.toBe(a.s.id);
    await run();
    expect(fresh.status).toBe("sent");
    expect(sm8.jobs.get(JOB)!.status).toBe("Work Order");
    expect(creates().find((x) => x.depends_on === fresh.id)?.status).toBe("sent");
  });

  it("(F) a slot held by a booking kept at another time answers kept_other and queues nothing, until it is out of ServiceM8 — then it is booked fresh", async () => {
    sm8.knobs.keeps = (b) => ({ start: hourOn(b.start), end: hourOn(b.end) });
    const c = await sentBookingGuarded();
    fake.db.integration_connections[0].write_kinds = ["attachment", "note", "booking"];
    sm8.knobs.keeps = null;
    expect(await bookIn()).toEqual({ ok: false, refusal: "kept_other", slot: slot() });
    expect(creates()).toHaveLength(1);
    /* removed in ServiceM8, and the mirror shows it */
    sm8.removeThere(c.remote_uuid as string);
    mirrored(c.remote_uuid as string);
    expect(await bookIn()).toMatchObject({ ok: true });
    expect(creates().filter((x) => x.subject === SUBJECT)).toHaveLength(1);

    /* ...or taken back through Undo, before any sync: its uuid is gone */
    creates().find((x) => x.subject === SUBJECT)!.next_attempt_at = future();
    sm8.knobs.keeps = (b) => ({ start: hourOn(b.start), end: hourOn(b.end) });
    await bookIn([slot(SAM_SM8, "15:00", "16:00")]);
    await run();
    const e = creates().find((x) => x.booking_start === at(TOMORROW, "15:00"))!;
    fake.db.integration_connections[0].write_kinds = ["attachment", "note", "booking"];
    sm8.knobs.keeps = null;
    await undo(e);
    await run();
    expect(takeBackOf(e.id)?.status).toBe("sent");
    expect(await bookIn([slot(SAM_SM8, "15:00", "16:00")])).toMatchObject({ ok: true });
    expect(e.subject).toMatch(/:was:/);
  });

  it("(F, review gap) a slot held by a booking ServiceM8 put on someone else answers kept_other too", async () => {
    sm8.knobs.keeps = () => ({ staffUuid: ALEX_SM8 });
    await bookIn();
    await run();
    const [c] = creates();
    expect(c.last_error).toBe(BOOKING_WORDS.row.personNotKept);
    fake.db.integration_connections[0].write_kinds = ["attachment", "note", "booking"];
    sm8.knobs.keeps = null;
    expect(await bookIn()).toEqual({ ok: false, refusal: "kept_other", slot: slot() });
    expect(creates()).toHaveLength(1);
  });

  it("(F, B-11 gap) a re-press writes this press's status row on the booking: a new one, and then none", async () => {
    await bookIn();
    const [c] = creates();
    Object.assign(c, { status: "failed", last_error: BOOKING_WORDS.row.refused, attempts: 1 });
    expect(c.depends_on).toBeNull();
    expect(await bookIn([slot()], { seen: SEEN })).toMatchObject({ ok: true });
    const [s] = statusRows();
    expect(c).toMatchObject({ status: "queued", depends_on: s.id });
    Object.assign(c, { status: "failed", last_error: BOOKING_WORDS.row.refused, attempts: 1 });
    expect(await bookIn()).toMatchObject({ ok: true });
    expect(c).toMatchObject({ status: "queued", depends_on: null });
  });

  /** A booking the time guard recorded. */
  async function sentBookingGuarded(): Promise<Row> {
    await bookIn();
    await run();
    const c = creates()[0];
    expect(c.last_error).toBe(BOOKING_WORDS.row.timeNotKept);
    return c;
  }
});

describe("Try again goes through its one door (B-11)", () => {
  it("(F) a row given back is refused changed; so is one whose line offers no Try again", async () => {
    const c = await sentBooking();
    sm8.removeThere(c.remote_uuid as string);
    mirrored(c.remote_uuid as string);
    await bookIn();
    expect(c.subject).toMatch(/:was:/);
    expect(await queueBookingRetry(await pressAs(), await state(), { rowId: c.id as string })).toEqual({ ok: false, refusal: "changed" });

    const e = await sentBooking(slot(SAM_SM8, "15:00", "16:00"));
    expect(await queueBookingRetry(await pressAs(), await state(), { rowId: e.id as string })).toEqual({ ok: false, refusal: "changed" });

    /* a row given back is refused before its line is even read: a newer row
       holds its slot (this one written by hand, its line offering Try again) */
    await bookIn([slot(SAM_SM8, "11:00", "12:00")]);
    const f = creates().find((x) => x.booking_start === at(TOMORROW, "11:00"))!;
    Object.assign(f, { status: "failed", last_error: BOOKING_WORDS.row.refused, subject: `${f.subject}:was:${f.id}` });
    expect(await lineOf(f)).toMatchObject({ acts: ["try_again", "cancel"] });
    expect(await queueBookingRetry(await pressAs(), await state(), { rowId: f.id as string })).toEqual({ ok: false, refusal: "changed" });
    expect(f.status).toBe("failed");
  });

  it("(F) a booking whose status row failed goes again behind it: the status row first, then the booking", async () => {
    const { s, cs } = await verb();
    Object.assign(s, { status: "failed", last_error: BOOKING_WORDS.row.statusRefused });
    Object.assign(cs[0], { status: "cancelled", last_error: BOOKING_WORDS.row.statusFirst });
    expect(await queueBookingRetry(await pressAs(), await state(), { rowId: cs[0].id as string })).toMatchObject({ ok: true });
    expect(s).toMatchObject({ status: "queued" });
    expect(cs[0]).toMatchObject({ status: "queued", depends_on: s.id });
    await run();
    expect([s.status, cs[0].status]).toEqual(["sent", "sent"]);
  });

  it("(F) a booking whose status row was taken back is refused changed with Look again, and nothing is queued", async () => {
    const { s, cs } = await verb();
    Object.assign(s, { status: "cancelled", last_error: NOTE_WORDS.row.takenBackBeforeSent, taken_back_at: new Date().toISOString() });
    Object.assign(cs[0], { status: "cancelled", last_error: BOOKING_WORDS.row.statusFirst });
    const before = JSON.stringify(writes());
    expect(await queueBookingRetry(await pressAs(), await state(), { rowId: cs[0].id as string })).toEqual({
      ok: false,
      refusal: "changed",
      lookAgain: true,
    });
    expect(JSON.stringify(writes())).toBe(before);
  });

  it("(F) re-pressing a status row for a booking less than 12 minutes off answers tooSoon with Look again, and queues nothing", async () => {
    const { s, cs } = await verb();
    const eleven = soon(11);
    Object.assign(cs[0], { booking_start: eleven.start, booking_end: eleven.end, status: "cancelled", last_error: BOOKING_WORDS.row.statusFirst });
    Object.assign(s, { status: "failed", last_error: BOOKING_WORDS.row.statusRefused });
    expect(await queueBookingRetry(await pressAs(), await state(), { rowId: cs[0].id as string })).toEqual({
      ok: false,
      refusal: "too_soon",
      lookAgain: true,
    });
    expect(s.status).toBe("failed");
  });

  it("(F) a take-back's Try again is the take-back, with all its rules", async () => {
    const c = await sentBooking();
    await undo(c);
    deleteSm8Booking.mockResolvedValueOnce({ status: 422, outcome: { kind: "rejected", status: 422 }, remote: null, recordUuid: null });
    await run();
    const d = takeBackOf(c.id)!;
    expect(d).toMatchObject({ status: "failed", last_error: BOOKING_WORDS.row.removeRefused });
    expect(await queueBookingRetry(await pressAs("alex"), await state(), { rowId: d.id as string })).toEqual({ ok: false, refusal: "changed" });
    expect(await queueBookingRetry(await pressAs(), await state(), { rowId: d.id as string })).toMatchObject({ ok: true });
    due(d);
    await run();
    expect(d.status).toBe("sent");
    expect(sm8.active(c.remote_uuid as string)).toBe(false);
  });
});

/* ── a trial run, taken back, and refusals ── */

describe("a trial run checks everything and sends nothing, for every op (B-15)", () => {
  it("(F) a booking, a status change, a take-back and a Clear each end trial, with no ServiceM8 call", async () => {
    const c = await sentBooking(slot(SAM_SM8, "15:00", "16:00"));
    leftover();
    fake.db.integration_connections[0].write_mode = "trial";
    for (const m of [readSm8Booking, readSm8Job, readSm8JobBookings, postSm8Booking, postSm8JobStatus, deleteSm8Booking]) m.mockClear();
    const { s, cs } = await verb();
    await undo(c);
    await clear();
    await run();
    expect([s.status, cs[0].status, takeBackOf(c.id)?.status, clearRow().status]).toEqual(["trial", "trial", "trial", "trial"]);
    for (const m of [readSm8Booking, readSm8Job, readSm8JobBookings, postSm8Booking, postSm8JobStatus, deleteSm8Booking]) {
      expect(m).not.toHaveBeenCalled();
    }
    expect(sm8.active(c.remote_uuid as string)).toBe(true);
    expect(await lineOf(c)).toMatchObject({ key: "line.stillIn", text: `Still in ServiceM8. ${BOOKING_WORDS.why.trial}` });
  });

  it("(F) ...and still checks the zone, the job, the person and the time", async () => {
    fake.db.integration_connections[0].write_mode = "trial";
    await bookIn([slot(ALEX_SM8)]);
    fake.db.sm8_staff[1].active = 0;
    await bookIn([slot(SAM_SM8, "15:00", "16:00")]);
    const past = creates().find((x) => x.booking_start === at(TOMORROW, "15:00"))!;
    Object.assign(past, { booking_start: at(day(-1), "15:00"), booking_end: at(day(-1), "16:00") });
    await run();
    expect(creates().find((x) => x.booking_staff_uuid === ALEX_SM8)).toMatchObject({ status: "cancelled", last_error: "Alex Sample isn't active in ServiceM8." });
    expect(past).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.past });
    fake.db.sm8_jobs[0].active = 0;
    await bookIn([slot(SAM_SM8, "11:00", "12:00")]);
    await run();
    expect(creates().find((x) => x.booking_start === at(TOMORROW, "11:00"))).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.jobGone });
  });
});

describe("a row taken back never goes (B-16)", () => {
  it("(F) a booking or status row taken back is never claimed, and the run cancels it where it stands", async () => {
    const { s, cs } = await verb();
    const t = new Date().toISOString();
    s.taken_back_at = t;
    cs[0].taken_back_at = t;
    await run();
    for (const r of [s, cs[0]]) expect(r).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.takenBackBeforeSent, attempts: 0 });
    expect(readSm8Job).not.toHaveBeenCalled();
  });

  it("(F) an Undo landing between the claim and the POST stops the POST: the check is part of the attempt", async () => {
    await bookIn();
    const [c] = creates();
    fake.before.sm8_writes = (st) => {
      if (st.op === "select" && st.columns === "taken_back_at" && st.filters.includes(`id=${c.id}`)) c.taken_back_at = new Date().toISOString();
    };
    await run();
    fake.before.sm8_writes = undefined;
    expect(postSm8Booking).not.toHaveBeenCalled();
    expect(c).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.takenBackBeforeSent, maybe_landed: false });
  });

  it("(F) an Undo during a 401's renewal stops the second POST", async () => {
    await bookIn();
    const [c] = creates();
    postSm8Booking.mockResolvedValueOnce({ status: 401, outcome: { kind: "unauthorized" }, remote: null, recordUuid: null });
    renewSm8Access.mockImplementation(async () => {
      c.taken_back_at = new Date().toISOString();
      return { ok: true, access: RENEWED };
    });
    await run();
    expect(postSm8Booking).toHaveBeenCalledTimes(1);
    expect(c).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.takenBackBeforeSent, maybe_landed: false });
  });
});

describe("a booking's refusals (B-17)", () => {
  const refused = (scope: boolean) => ({
    status: 403,
    outcome: { kind: "forbidden", scope },
    remote: { code: null, message: scope ? 'insufficient_scope: "manage_schedule" scope required' : "no" },
    recordUuid: null,
  });

  it("(F) two booking 403s that name no scope stop the run; each fails its row", async () => {
    await bookIn([slot(SAM_SM8), slot(ALEX_SM8), slot(SAM_SM8, "15:00", "16:00")]);
    postSm8Booking.mockResolvedValue(refused(false));
    const r = await run();
    expect(r.stopped).toBe(WRITE_WORDS.forbidden);
    expect(creates().map((c) => c.status)).toEqual(["failed", "failed", "queued"]);
    expect(creates()[0].last_error).toBe(BOOKING_WORDS.row.forbidden);
  });

  it("(F) a 403 that names the scope holds bookings — recorded through the function — and a file after it still goes", async () => {
    fake.db.documents = [{ org_id: ORG, id: "doc-1", storage_ref: `org/${ORG}/doc-1.pdf`, mime_type: "application/pdf", uploaded_at: new Date().toISOString() }];
    await bookIn([slot(SAM_SM8), slot(ALEX_SM8)]);
    fake.db.sm8_writes.push({
      id: randomUUID(),
      org_id: ORG,
      tenant_id: TENANT,
      kind: "attachment",
      op: "create",
      sm8_job_uuid: JOB,
      subject: "document:doc-1",
      payload: { documentId: "doc-1", name: "Quote.pdf", mimeType: "application/pdf" },
      remote_uuid: randomUUID(),
      status: "queued",
      attempts: 0,
      next_attempt_at: new Date(Date.now() - 1000).toISOString(),
      created_at: new Date(Date.now() + 5000).toISOString(),
      lease_until: null,
      last_error: null,
      maybe_landed: false,
      verify_uuids: [],
      replaced_uuids: [],
    });
    postSm8Booking.mockResolvedValue(refused(true));
    postSm8Attachment.mockResolvedValue({ status: 200, outcome: { kind: "created", remoteUuid: null }, remote: null });
    await run();
    expect(creates()[0]).toMatchObject({ status: "queued", last_error: BOOKING_WORDS.row.scopeHeld, attempts: 0 });
    expect(creates()[1].status).toBe("queued");
    expect(postSm8Booking).toHaveBeenCalledTimes(1);
    expect(fake.db.integration_connections[0].write_scope_refused).toHaveProperty("booking");
    expect(fake.on("rpc:sm8_mark_kind_refused")).toHaveLength(1);
    expect(postSm8Attachment).toHaveBeenCalledTimes(1);
  });
});

describe("finish keys on the op, not the kind (B-18)", () => {
  it("(F) a status change's and a take-back's x-record-uuid never become their remote_uuid; a take-back records its target, a status change its edit time", async () => {
    const { s } = await verb();
    const statusUuid = s.remote_uuid;
    await run();
    expect(s).toMatchObject({ status: "sent", remote_uuid: statusUuid });
    expect(s.replaced_uuids).toEqual([]);
    /* the edit time the change left (its booking moved the job's on again, P1) */
    expect(s.landed_edit_date).toBe(sm8.jobs.get(JOB)!.logged.work_order_date);

    const c = creates()[0];
    await undo(c);
    const d = takeBackOf(c.id)!;
    const deleteUuid = d.remote_uuid;
    deleteSm8Booking.mockImplementationOnce(async (call: unknown, u: string) => ({
      ...(await sm8.deleteBooking(call, u)),
      recordUuid: "acac01aa-0000-4000-8000-00000000acaa",
    }));
    await run();
    expect(d).toMatchObject({ status: "sent", remote_uuid: deleteUuid, target_uuid: c.remote_uuid });
    expect(d.replaced_uuids).toEqual([]);
  });
});

/* ── every op's row inserts ── */

describe("every booking row inserts under the shape the database checks (B-20)", () => {
  it("(F) a status change, a booking, an Undo and a Clear each insert with exactly the columns their shape needs; a file with none of them", async () => {
    const { s, cs } = await verb();
    expect(s).toMatchObject({
      op: "update",
      depends_on: null,
      target_uuid: JOB,
      seen_edit_date: SEEN,
      verb_id: expect.any(String),
      booking_staff_uuid: null,
      booking_start: null,
      booking_end: null,
      booking_zone: null,
      job_status_from: "Quote",
      job_status_to: "Work Order",
    });
    /* a note's own columns are never written on a booking row */
    expect([s.note_id ?? null, s.flag_done ?? null, s.note_text ?? null]).toEqual([null, null, null]);
    expect(["note_id", "flag_done", "note_text", "seen_edit_by"].filter((k) => k in s)).toEqual([]);
    expect(cs[0]).toMatchObject({ op: "create", depends_on: s.id, target_uuid: null, seen_edit_date: null, job_status_from: null, booking_zone: ZONE });
    await run();
    await undo(cs[0]);
    expect(takeBackOf(cs[0].id)).toMatchObject({ op: "delete", depends_on: cs[0].id, target_uuid: null, verb_id: cs[0].verb_id, booking_start: null });
    leftover();
    await clear();
    expect(clearRow()).toMatchObject({ op: "delete", depends_on: null, target_uuid: LEFT, booking_zone: null, booking_start: at(TOMORROW, "09:00") });

    const { enqueueAttachments } = await import("../sm8-writes");
    const files = await enqueueAttachments(await pressAs(), await state(), [
      { jobUuid: JOB, documentId: "doc-2", name: "Quote.pdf", mimeType: "application/pdf", sizeBytes: 4, key: "k" },
    ]);
    expect(files?.ids).toHaveLength(1);
    const file = byId(files!.ids[0]);
    for (const col of ["verb_id", "booking_staff_uuid", "booking_start", "booking_end", "booking_zone", "job_status_from", "job_status_to", "depends_on", "target_uuid"]) {
      expect([col, file[col] ?? null]).toEqual([col, null]);
    }
  });

  it("the fake's shape check is the migration's: the spec's legal booking rows pass, and each illegal one is refused", () => {
    const base = { kind: "booking", sm8_job_uuid: JOB, verb_id: randomUUID(), note_id: null, flag_done: null, note_text: null };
    const create = { ...base, op: "create", booking_staff_uuid: SAM_SM8, booking_zone: ZONE, booking_start: "2026-10-06 20:00:00", booking_end: "2026-10-06 21:00:00" };
    const update = { ...base, op: "update", target_uuid: JOB, job_status_from: "Quote", job_status_to: "Work Order", seen_edit_date: SEEN };
    const undoRow = { ...base, op: "delete", depends_on: randomUUID() };
    const clearRowShape = { ...base, op: "delete", target_uuid: LEFT, booking_staff_uuid: SAM_SM8, booking_start: "2026-10-06 09:00:00", booking_end: "2026-10-06 11:00:00" };
    for (const legal of [create, update, undoRow, clearRowShape]) expect(sm8WriteShapeOk(legal)).toBe(true);
    const illegal: [string, Row][] = [
      ["a create with a T in its time", { ...create, booking_start: "2026-10-06T20:00:00" }],
      ["a create across midnight", { ...create, booking_start: "2026-10-06 23:00:00", booking_end: "2026-10-07 01:00:00" }],
      ["a create with no start", { ...create, booking_start: null }],
      ["a create with no end", { ...create, booking_end: null }],
      ["an update to Completed", { ...update, job_status_to: "Completed" }],
      ["an update with no from", { ...update, job_status_from: null }],
      ["a Clear with no start", { ...clearRowShape, booking_start: null }],
      ["an Undo that carries a start", { ...undoRow, booking_start: "2026-10-06 20:00:00" }],
      ["a booking row with no verb", { ...create, verb_id: null }],
      ["an attachment with a verb", { kind: "attachment", op: "create", verb_id: randomUUID() }],
      ["a take-back taken back", { ...undoRow, taken_back_at: new Date().toISOString() }],
    ];
    for (const [why, row] of illegal) expect([why, sm8WriteShapeOk(row)]).toEqual([why, false]);
  });

  it("(F) the fake database refuses a booking row the real one would, with 23514 — so the columns above are proven, not assumed", async () => {
    const press = await pressAs();
    const bad = await enqueueSm8Writes(press, await state(), [
      /* a status change with no op: it would go in as a create, and the shape refuses it */
      { kind: "booking", jobUuid: JOB, subject: "status:wo:x", payload: {}, ref: "x", targetUuid: JOB, statusFrom: "Quote", statusTo: "Work Order", seenEditDate: SEEN, verbId: randomUUID() },
    ]);
    expect(bad).toBeNull();
    expect(writes()).toHaveLength(0);
  });
});

/* ── the run's order ── */

describe("a status row goes ahead of its bookings, and brings them (B-21)", () => {
  it("(F) a booking that waited on a status row sent by another run isn't in this run's batch: the status row, once sent, makes it due and brings it in behind", async () => {
    const { s, cs } = await verb();
    /* it waited on the status row, and its retry time is still ahead */
    cs[0].next_attempt_at = future();
    const r = await run();
    expect(s.status).toBe("sent");
    expect(cs[0].status).toBe("sent");
    expect(r.sent).toBe(2);
    expect(postSm8JobStatus.mock.invocationCallOrder[0]).toBeLessThan(postSm8Booking.mock.invocationCallOrder[0]);
  });

  it("(F) a run the meter stops right after the status row leaves its booking untried; a run of that booking's id sends it once the hold is past", async () => {
    const { s, cs } = await verb();
    readSm8Booking.mockImplementation(async (call: unknown, u: string) => sm8.readBooking(call, u));
    readSm8Job.mockImplementation(sm8.readJob);
    readSm8JobBookings.mockImplementationOnce(async () => ({ ok: false, limited: { kind: "rate_limited", limit: "ours", waitMs: 60_000, day: false } }));
    const r = await run();
    expect(s.status).toBe("sent");
    expect(r.stopped).toBe(WRITE_WORDS.paced);
    expect(cs[0]).toMatchObject({ status: "queued", attempts: 0 });
    due(cs[0]);
    await runSm8Writes(ORG, "send", { ids: [cs[0].id as string], clock, sleep });
    expect(cs[0].status).toBe("sent");
  });
});

describe("the run, with bookings beside files and notes", () => {
  it("(F) Bookings Off landing before the run's first claim: the switch is read again before every booking, not only after a send", async () => {
    await bookIn();
    const [c] = creates();
    let reads = 0;
    fake.before.integration_connections = () => {
      /* the run's own read sees Bookings On; the one before the booking, Off */
      if (++reads === 2) fake.db.integration_connections[0].write_kinds = ["attachment", "note"];
    };
    await run();
    fake.before.integration_connections = undefined;
    expect(postSm8Booking).not.toHaveBeenCalled();
    expect(c).toMatchObject({ status: "queued", attempts: 0 });
  });

  it("(F) a booking behind a status change the fields guard recorded never goes, even with Bookings left on", async () => {
    const { s, cs } = await verb();
    Object.assign(s, { status: "sent", last_error: BOOKING_WORDS.row.fieldsNotKept, landed_edit_date: SEEN });
    await run();
    expect(postSm8Booking).not.toHaveBeenCalled();
    expect(cs[0]).toMatchObject({ status: "cancelled", last_error: GUARD_9001 });
  });

  it("(F) a take-back landing between the run's read and its claim: the claim misses, and the next run cancels it without claiming", async () => {
    await bookIn();
    const [c] = creates();
    fake.before.sm8_writes = (st) => {
      if (st.op === "update" && st.patch?.status === "sending") c.taken_back_at = new Date().toISOString();
    };
    await run();
    fake.before.sm8_writes = undefined;
    expect(postSm8Booking).not.toHaveBeenCalled();
    expect(c).toMatchObject({ status: "queued", attempts: 0, maybe_landed: false });
    await run();
    expect(c).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.takenBackBeforeSent, attempts: 0 });
  });

  it("(F) Try again behind a status row that was taken back never makes a fresh one — even when the booking's own line offers Try again", async () => {
    const { s, cs } = await verb();
    Object.assign(s, { status: "cancelled", last_error: NOTE_WORDS.row.takenBackBeforeSent, taken_back_at: new Date().toISOString() });
    Object.assign(cs[0], { status: "cancelled", last_error: BOOKING_WORDS.row.switchedOff });
    expect(await lineOf(cs[0])).toMatchObject({ acts: ["try_again"] });
    expect(await queueBookingRetry(await pressAs(), await state(), { rowId: cs[0].id as string })).toEqual({
      ok: false,
      refusal: "changed",
      lookAgain: true,
    });
    expect(statusRows()).toHaveLength(1);
    expect(s.subject).not.toMatch(/:was:/);
  });

  it("(F) Try again on a booking whose start has passed is refused past, and queues nothing", async () => {
    await bookIn();
    const [c] = creates();
    Object.assign(c, { status: "failed", last_error: BOOKING_WORDS.row.refused, booking_start: at(day(-1), "20:00"), booking_end: at(day(-1), "21:00") });
    expect(await queueBookingRetry(await pressAs(), await state(), { rowId: c.id as string })).toEqual({ ok: false, refusal: "past" });
    expect(c.status).toBe("failed");
  });

  it("(F) a booking send that throws goes back to the queue in bookings' words — before its POST, not marked as maybe landed (N1)", async () => {
    await bookIn();
    const [c] = creates();
    readSm8Job.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    await run();
    expect(c).toMatchObject({ status: "queued", last_error: BOOKING_WORDS.row.threw, maybe_landed: false });
  });

  it("(F) a booking is never posted again under a fresh uuid: an answer that asks for one fails the row instead", async () => {
    await bookIn();
    const [c] = creates();
    const own = c.remote_uuid;
    /* no answer here ever is a dead record; one that were would be failed, never re-posted */
    postSm8Booking.mockResolvedValueOnce({ status: 500, outcome: { kind: "dead_record" }, remote: null, recordUuid: null });
    await run();
    expect(postSm8Booking).toHaveBeenCalledTimes(1);
    expect(c.remote_uuid).toBe(own);
    expect(c.replaced_uuids).toEqual([]);
    expect(c).toMatchObject({ status: "failed", last_error: BOOKING_WORDS.row.refused });
  });
});
