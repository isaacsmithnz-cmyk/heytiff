/**
 * @jest-environment node
 */

/* Changing the day from the phone's Schedule (lib/mobile/schedule-change),
   end to end: the queue's own helpers and the sender, against the engine
   tests' in-memory database (fixtures/sm8-fake-db, the bookings
   migration's rules) and their fake ServiceM8 (fixtures/sm8-live-bookings,
   as the live account behaves). A move is a booking on the new job and the
   old one taken off; Undo puts it back; a refusal leaves the day as it
   was; and the person moved hears it. */

import { makeFakeDb } from "@/lib/integrations/__tests__/fixtures/sm8-fake-db";
import { makeSm8Bookings, type Sm8Bookings } from "@/lib/integrations/__tests__/fixtures/sm8-live-bookings";

type Row = Record<string, unknown>;

const fake = makeFakeDb();
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (t: string) => fake.from(t),
    rpc: (n: string, a: Record<string, unknown>) => fake.rpc(n, a),
  },
}));

const sm8AccessResult = jest.fn();
jest.mock("@/lib/integrations/sm8-store", () => ({
  sm8AccessResult: (...a: unknown[]) => sm8AccessResult(...a),
  renewSm8Access: jest.fn(),
  markSm8NeedsReauth: jest.fn(async () => true),
}));

const postSm8Booking = jest.fn();
const postSm8JobStatus = jest.fn();
const deleteSm8Booking = jest.fn();
const readSm8Booking = jest.fn();
const readSm8Job = jest.fn();
const readSm8JobBookings = jest.fn();
jest.mock("@/lib/integrations/sm8-write", () => ({
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

const getSession = jest.fn();
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: (...a: unknown[]) => getSession(...a) } }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => "staff-sam") }));
jest.mock("next/server", () => ({ after: () => {} }));
jest.mock("@/lib/workboard/job-notes-query", () => ({
  staffDisplayNames: jest.fn(async () => new Map([["staff-sam", "Sam Tester"]])),
}));
jest.mock("@/lib/integrations/links", () => ({
  listSm8StaffLinks: jest.fn(async () => [
    { remoteId: "5a0e5a0e-0000-4000-8000-00000000a001", staffProfileId: "staff-sam" },
    { remoteId: "a1e0a1e0-0000-4000-8000-00000000a002", staffProfileId: "staff-alex" },
  ]),
  sm8DeniedLinks: jest.fn(async () => new Set()),
}));
/* the press's settle, on the tests' clock: the run the action would start */
const mockSettle = jest.fn();
jest.mock("@/lib/integrations/sm8-drain", () => ({
  settlePressedWrites: (...a: unknown[]) => mockSettle(...a),
}));

import { sm8PressFromSession } from "@/lib/integrations/sm8-press";
import { runSm8Writes } from "@/lib/integrations/sm8-writes";
import { BOOKING_WORDS, localNow } from "@/lib/integrations/sm8-booking-plan";
import { changeSchedule, type ScheduleChange } from "../schedule-change";
import { crewNotBooked } from "../schedule-crew";
import type { MobileCtx } from "../auth";
import type { PushMessage } from "../push";

const ORG = "org-1";
const TENANT = "vendor-1";
const ZONE = "Australia/Sydney";
const JOB = "0b1e0b1e-0000-4000-8000-000000009001";
const OTHER_JOB = "0b1e0b1e-0000-4000-8000-000000009002";
const SAM_SM8 = "5a0e5a0e-0000-4000-8000-00000000a001";
const ALEX_SM8 = "a1e0a1e0-0000-4000-8000-00000000a002";
const ALEX_ON_JOB = "ac7ac7ac-0000-4000-8000-0000000b0001";
const SAM_ON_OTHER = "ac7ac7ac-0000-4000-8000-0000000b0002";
const ACCESS = { accessToken: "token-1", tenantId: TENANT, grant: "g1", meter: TENANT };

const day = (days: number) => localNow(ZONE, Date.now() + days * 86_400_000)!.slice(0, 10);
const TOMORROW = day(1);
const at = (d: string, hhmm: string) => `${d} ${hhmm}:00`;

const writes = () => fake.db.sm8_writes as Row[];
const creates = () => writes().filter((w) => w.op === "create");
const deletes = () => writes().filter((w) => w.op === "delete");

let skew = 0;
const clock = () => Date.now() + skew;
const sleep = async (ms: number) => {
  skew += ms;
};

let sm8: Sm8Bookings;

const ctx = (over: Partial<MobileCtx> = {}): MobileCtx => ({
  userId: "auth0|sam",
  orgId: ORG,
  role: "owner",
  caps: new Set(["workboard", "workboard_manage"]) as MobileCtx["caps"],
  orgIds: [ORG],
  ...over,
});

const push = jest.fn(async (_orgId: string, _staffIds: readonly string[], _message: PushMessage) => 1);
async function change(c: ScheduleChange, opts: { tell?: boolean; who?: Partial<MobileCtx> } = {}) {
  getSession.mockResolvedValue({ orgId: ORG, user: { sub: "auth0|sam" } });
  const press = await sm8PressFromSession();
  return changeSchedule(ctx(opts.who), press, { change: c, tell: opts.tell ?? true }, { push });
}

/** A booking made in ServiceM8, and in the mirror. */
function booked(uuid: string, jobUuid: string, staffUuid: string, start: string, end: string) {
  sm8.put({ uuid, jobUuid, staffUuid, start, end });
  const a = sm8.get(uuid)!;
  fake.db.sm8_job_activities = [
    ...(fake.db.sm8_job_activities as Row[]).filter((r) => r.uuid !== uuid),
    { org_id: ORG, uuid, job_uuid: jobUuid, staff_uuid: staffUuid, start_date: start, end_date: end, activity_was_scheduled: 1, active: 1, edit_date: a.editDate },
  ];
}

/** The mirror catches up with ServiceM8. */
function sync() {
  fake.db.sm8_job_activities = [...sm8.activities.values()].map((a) => ({ org_id: ORG, uuid: a.uuid, job_uuid: a.jobUuid, staff_uuid: a.staffUuid, start_date: a.start, end_date: a.end, activity_was_scheduled: a.scheduled, active: a.active, edit_date: a.editDate }));
}

beforeEach(() => {
  fake.reset();
  skew = 0;
  sm8 = makeSm8Bookings();
  sm8.knobs.clock = clock;
  sm8.job(JOB, { status: "Work Order", kept: { generated_job_id: "9001" } as never });
  sm8.job(OTHER_JOB, { status: "Work Order", kept: { generated_job_id: "9002" } as never });
  readSm8Booking.mockReset().mockImplementation(sm8.readBooking);
  readSm8Job.mockReset().mockImplementation(sm8.readJob);
  readSm8JobBookings.mockReset().mockImplementation(sm8.readJobBookings);
  postSm8Booking.mockReset().mockImplementation(sm8.postBooking);
  postSm8JobStatus.mockReset().mockImplementation(sm8.postJobStatus);
  deleteSm8Booking.mockReset().mockImplementation(sm8.deleteBooking);
  sm8AccessResult.mockReset().mockResolvedValue({ ok: true, access: ACCESS });
  mockSettle.mockReset().mockImplementation(async (orgId: string, ids: string[]) => {
    await runSm8Writes(orgId, "send", { ids, clock, sleep });
  });
  push.mockClear();
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
  fake.db.sm8_vendor = [{ org_id: ORG, uuid: TENANT, name: "Acme Air", timezone_name: ZONE }];
  fake.db.sm8_staff = [
    { org_id: ORG, uuid: SAM_SM8, first: "Sam", last: "Tester", active: 1 },
    { org_id: ORG, uuid: ALEX_SM8, first: "Alex", last: "Sample", active: 1 },
  ];
  fake.db.sm8_jobs = [
    { org_id: ORG, uuid: JOB, active: 1, status: "Work Order", generated_job_id: "9001", job_address: "2 Spring St\nWaverton NSW 2060", geo_city: "Waverton" },
    { org_id: ORG, uuid: OTHER_JOB, active: 1, status: "Work Order", generated_job_id: "9002", job_address: "88 Kirribilli Ave,\nKirribilli NSW 2061", geo_city: "Kirribilli" },
  ];
  fake.db.sm8_job_activities = [];
  fake.db.sm8_writes = [];
  process.env.SM8_WRITES = "attachment,note,booking";
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  delete process.env.SM8_WRITES;
});

describe("a move", () => {
  it("books the person on the new job at the same times and takes the old booking off: in ServiceM8, with a push, and an Undo", async () => {
    booked(ALEX_ON_JOB, JOB, ALEX_SM8, at(TOMORROW, "07:00"), at(TOMORROW, "15:00"));
    const answer = await change({ do: "move", activity: ALEX_ON_JOB, to: OTHER_JOB });
    expect(answer).toMatchObject({ ok: true, state: "sent", said: "Alex is on 9002 now" });

    const [c] = creates();
    expect(c).toMatchObject({ sm8_job_uuid: OTHER_JOB, booking_staff_uuid: ALEX_SM8, booking_start: at(TOMORROW, "07:00"), booking_end: at(TOMORROW, "15:00"), status: "sent" });
    const [d] = deletes();
    expect(d).toMatchObject({ target_uuid: ALEX_ON_JOB, payload: { name: BOOKING_WORDS.label.off, off: true }, status: "sent" });
    expect(sm8.active(c.remote_uuid as string)).toBe(true);
    expect(sm8.active(ALEX_ON_JOB)).toBe(false);

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(ORG, ["staff-alex"], {
      title: "Sam Tester moved you to 9002",
      body: "88 Kirribilli Ave, Kirribilli · 7:00 to 3:00",
      path: `/job?id=${OTHER_JOB}`,
    });
    expect(answer.ok && answer.undo).toEqual({ do: "move", activity: c.remote_uuid, to: JOB, start: at(TOMORROW, "07:00"), end: at(TOMORROW, "15:00") });
  });

  it("Undo puts the person back: the new booking comes off by its own Undo, and the old job is booked again", async () => {
    booked(ALEX_ON_JOB, JOB, ALEX_SM8, at(TOMORROW, "07:00"), at(TOMORROW, "15:00"));
    const moved = await change({ do: "move", activity: ALEX_ON_JOB, to: OTHER_JOB });
    if (!moved.ok || !moved.undo) throw new Error("no undo");
    const newUuid = creates()[0]!.remote_uuid as string;
    /* not mirrored yet: the Undo finds it as ours */
    const back = await change(moved.undo, { tell: false });
    expect(back).toMatchObject({ ok: true, state: "sent", said: "Alex is on 9001 now" });
    expect(sm8.active(newUuid)).toBe(false);
    expect(deletes().find((d) => d.depends_on === creates()[0]!.id)).toMatchObject({ status: "sent" });
    const again = creates().find((r) => r.sm8_job_uuid === JOB)!;
    expect(sm8.get(again.remote_uuid as string)).toMatchObject({ jobUuid: JOB, staffUuid: ALEX_SM8, start: at(TOMORROW, "07:00"), end: at(TOMORROW, "15:00"), active: 1 });
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("the new booking goes first: ServiceM8 refusing it leaves the old one where it was, and nothing comes off", async () => {
    booked(ALEX_ON_JOB, JOB, ALEX_SM8, at(TOMORROW, "07:00"), at(TOMORROW, "15:00"));
    postSm8Booking.mockResolvedValueOnce({ status: 422, outcome: { kind: "rejected", status: 422 }, remote: null, recordUuid: null });
    const answer = await change({ do: "move", activity: ALEX_ON_JOB, to: OTHER_JOB });
    expect(answer).toMatchObject({ ok: false, error: BOOKING_WORDS.row.refused });
    expect(deletes()).toHaveLength(0);
    expect(sm8.active(ALEX_ON_JOB)).toBe(true);
    expect(push).not.toHaveBeenCalled();
  });

  it("a job gone from under the booking is refused before anything is queued", async () => {
    booked(ALEX_ON_JOB, JOB, ALEX_SM8, at(TOMORROW, "07:00"), at(TOMORROW, "15:00"));
    fake.db.sm8_jobs[0].active = 0;
    expect(await change({ do: "move", activity: ALEX_ON_JOB, to: OTHER_JOB })).toMatchObject({ ok: false, error: BOOKING_WORDS.press.changed });
    expect(writes()).toHaveLength(0);
    expect(postSm8Booking).not.toHaveBeenCalled();
  });

  it("has ServiceM8's freedom: a booking under way or on a day gone moves, its person checked in or not — and their recorded time stays", async () => {
    const YESTERDAY = day(-1);
    booked(ALEX_ON_JOB, JOB, ALEX_SM8, at(YESTERDAY, "07:00"), at(YESTERDAY, "15:00"));
    const CHECK_IN = "ac7ac7ac-0000-4000-8000-0000000b0009";
    sm8.put({ uuid: CHECK_IN, jobUuid: JOB, staffUuid: ALEX_SM8, start: at(YESTERDAY, "07:05"), end: at(YESTERDAY, "15:02"), scheduled: 0, recorded: 1 });
    const answer = await change({ do: "move", activity: ALEX_ON_JOB, to: OTHER_JOB, start: at(YESTERDAY, "09:30"), end: at(YESTERDAY, "15:00") });
    expect(answer).toMatchObject({ ok: true, state: "sent", said: "Alex is on 9002 now" });
    expect(sm8.active(ALEX_ON_JOB)).toBe(false);
    expect(sm8.active(CHECK_IN)).toBe(true);
    const [c] = creates();
    expect(sm8.get(c!.remote_uuid as string)).toMatchObject({ jobUuid: OTHER_JOB, start: at(YESTERDAY, "09:30"), end: at(YESTERDAY, "15:00"), active: 1 });
    expect(c!.payload).toEqual({ name: BOOKING_WORDS.label.create, anyTime: true });
    expect(deletes()[0]!.payload).toEqual({ name: BOOKING_WORDS.label.off, off: true, anyTime: true });
    /* and its Undo, the new booking under way, puts it back */
    if (!answer.ok || !answer.undo) throw new Error("no undo");
    expect(await change(answer.undo, { tell: false })).toMatchObject({ ok: true, state: "sent" });
    expect(sm8.active(c!.remote_uuid as string)).toBe(false);
  });

  it("refuses a job that can't be booked, and the same job — before anything is queued", async () => {
    booked(ALEX_ON_JOB, JOB, ALEX_SM8, at(TOMORROW, "07:00"), at(TOMORROW, "15:00"));
    fake.db.sm8_jobs[1].status = "Completed";
    expect(await change({ do: "move", activity: ALEX_ON_JOB, to: OTHER_JOB })).toMatchObject({ ok: false, error: "This job is Completed in ServiceM8, so it can't be booked." });
    expect(await change({ do: "move", activity: ALEX_ON_JOB, to: JOB })).toMatchObject({ ok: false });
    expect(writes()).toHaveLength(0);
  });
});

describe("a swap, a time, a take off and a booking", () => {
  it("a swap gives each the other's job and hours, and tells both", async () => {
    booked(ALEX_ON_JOB, JOB, ALEX_SM8, at(TOMORROW, "07:00"), at(TOMORROW, "15:00"));
    booked(SAM_ON_OTHER, OTHER_JOB, SAM_SM8, at(TOMORROW, "08:00"), at(TOMORROW, "12:00"));
    const answer = await change({ do: "swap", activity: ALEX_ON_JOB, with: SAM_ON_OTHER });
    expect(answer).toMatchObject({ ok: true, state: "sent", said: "Alex is on 9002 and Sam on 9001 now" });
    const live = [...sm8.activities.values()].filter((a) => a.active === 1);
    expect(live.map((a) => [a.staffUuid, a.jobUuid, a.start, a.end]).sort()).toEqual(
      [
        [ALEX_SM8, OTHER_JOB, at(TOMORROW, "08:00"), at(TOMORROW, "12:00")],
        [SAM_SM8, JOB, at(TOMORROW, "07:00"), at(TOMORROW, "15:00")],
      ].sort()
    );
    /* Sam pressed it: only Alex hears */
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]).toEqual([ORG, ["staff-alex"], expect.objectContaining({ title: "Sam Tester moved you to 9002" })]);
  });

  it("a new time is a booking at it and the old one off, the same start too", async () => {
    booked(ALEX_ON_JOB, JOB, ALEX_SM8, at(TOMORROW, "07:00"), at(TOMORROW, "15:00"));
    expect(await change({ do: "time", activity: ALEX_ON_JOB, start: at(TOMORROW, "07:00"), end: at(TOMORROW, "15:00") })).toMatchObject({ ok: false });
    /* the same start takes the old one's place: it comes off first */
    expect(await change({ do: "time", activity: ALEX_ON_JOB, start: at(TOMORROW, "07:00"), end: at(TOMORROW, "12:00") }, { tell: false })).toMatchObject({ ok: true, state: "sent" });
    expect(sm8.active(ALEX_ON_JOB)).toBe(false);
    sync();
    const shorter = creates()[0]!.remote_uuid as string;
    const answer = await change({ do: "time", activity: shorter, start: at(TOMORROW, "09:00"), end: at(TOMORROW, "15:00") });
    expect(answer).toMatchObject({ ok: true, state: "sent", said: "Alex is on 9001 9:00 to 3:00 now" });
    expect(sm8.active(shorter)).toBe(false);
    expect(push.mock.calls[0]![2]).toMatchObject({ title: "Sam Tester changed your time on 9001" });
  });

  it("take off, and its Undo books them back", async () => {
    booked(ALEX_ON_JOB, JOB, ALEX_SM8, at(TOMORROW, "07:00"), at(TOMORROW, "15:00"));
    const off = await change({ do: "off", activity: ALEX_ON_JOB });
    expect(off).toMatchObject({ ok: true, state: "sent", said: "Alex is off 9001", undo: { do: "book", staff: ALEX_SM8, job: JOB, start: at(TOMORROW, "07:00"), end: at(TOMORROW, "15:00") } });
    expect(sm8.active(ALEX_ON_JOB)).toBe(false);
    expect(push.mock.calls[0]![2]).toEqual({ title: "Sam Tester took you off 9001", body: "7:00 to 3:00", path: "/schedule" });
    sync();
    if (!off.ok || !off.undo) throw new Error("no undo");
    expect(await change(off.undo)).toMatchObject({ ok: true, state: "sent", said: "Alex is on 9001 now" });
    expect([...sm8.activities.values()].filter((a) => a.active === 1 && a.staffUuid === ALEX_SM8 && a.jobUuid === JOB)).toHaveLength(1);
  });

  it("book someone with nothing; its Undo takes the booking back", async () => {
    const answer = await change({ do: "book", staff: ALEX_SM8, job: OTHER_JOB, start: at(TOMORROW, "07:00"), end: at(TOMORROW, "15:00") });
    expect(answer).toMatchObject({ ok: true, state: "sent", said: "Alex is on 9002 now" });
    const uuid = creates()[0]!.remote_uuid as string;
    expect(answer.ok && answer.undo).toEqual({ do: "off", activity: uuid });
    expect(push.mock.calls[0]![2]).toMatchObject({ title: "Sam Tester booked you on 9002", path: `/job?id=${OTHER_JOB}` });
    if (!answer.ok || !answer.undo) throw new Error("no undo");
    expect(await change(answer.undo, { tell: false })).toMatchObject({ ok: true, said: "Alex is off 9002" });
    expect(sm8.active(uuid)).toBe(false);
  });
});

describe("who may", () => {
  it("only an owner while bookings are the owner's, and only with their own press", async () => {
    booked(ALEX_ON_JOB, JOB, ALEX_SM8, at(TOMORROW, "07:00"), at(TOMORROW, "15:00"));
    expect(await change({ do: "off", activity: ALEX_ON_JOB }, { who: { role: "staff" } })).toMatchObject({ ok: false, status: 403, error: BOOKING_WORDS.press.ownerOnly });
    expect(await change({ do: "off", activity: ALEX_ON_JOB }, { who: { caps: new Set(["workboard"]) as MobileCtx["caps"] } })).toMatchObject({ ok: false, status: 403 });
    expect(await change({ do: "off", activity: ALEX_ON_JOB }, { who: { userId: "auth0|alex" } })).toMatchObject({ ok: false, status: 401 });
    process.env.SM8_WRITES = "attachment,note";
    expect(await change({ do: "off", activity: ALEX_ON_JOB })).toMatchObject({ ok: false, error: BOOKING_WORDS.press.unavailable });
    expect(writes()).toHaveLength(0);
  });
});

describe("who isn't booked", () => {
  const LEO = "1e01e01e-0000-4000-8000-00000000a003";
  const PENDING = "9e9e9e9e-0000-4000-8000-00000000a009";
  it("is the capacity crew with nothing that day: free, off with when it ends, or free after a part of it — never the office or a placeholder", async () => {
    const DAVID = "da0da0da-0000-4000-8000-00000000a004";
    fake.db.sm8_staff = [
      ...(fake.db.sm8_staff as Row[]),
      { org_id: ORG, uuid: LEO, first: "Leo", last: "Watanangura", active: 1 },
      { org_id: ORG, uuid: PENDING, first: "Pending", last: "Jobs", active: 1 },
      { org_id: ORG, uuid: DAVID, first: "David", last: "Hann", active: 1 },
    ];
    fake.db.schedule_capacity_staff = [
      { org_id: ORG, sm8_staff_uuid: SAM_SM8, included: true, daily_minutes: 480 },
      { org_id: ORG, sm8_staff_uuid: ALEX_SM8, included: true, daily_minutes: 480 },
      { org_id: ORG, sm8_staff_uuid: LEO, included: true, daily_minutes: 480 },
      { org_id: ORG, sm8_staff_uuid: DAVID, included: true, daily_minutes: 480 },
      { org_id: ORG, sm8_staff_uuid: PENDING, included: false, daily_minutes: 480 },
    ];
    fake.db.staff_profiles = [{ org_id: ORG, id: "staff-sam", job_title: "Apprentice" }];
    const d = TOMORROW;
    const crew = await crewNotBooked(
      ORG,
      {
        dayISO: d,
        activities: [
          /* a whole day, with half an hour over: no room */
          { uuid: ALEX_ON_JOB, jobUuid: JOB, staffUuid: ALEX_SM8, start: at(d, "07:30"), end: at(d, "15:00"), wasScheduled: 1 },
          /* two service calls, overlapping a little: room after the last */
          { uuid: "ac7ac7ac-0000-4000-8000-0000000c0001", jobUuid: JOB, staffUuid: DAVID, start: at(d, "07:30"), end: at(d, "09:00"), wasScheduled: 1 },
          { uuid: "ac7ac7ac-0000-4000-8000-0000000c0002", jobUuid: OTHER_JOB, staffUuid: DAVID, start: at(d, "08:45"), end: at(d, "11:30"), wasScheduled: 1 },
        ],
        staff: [],
        jobs: [],
        onSite: [],
        addresses: {},
        away: [{ uuid: "av-1", staffUuid: LEO, name: "Annual Leave", start: `${day(0)} 00:00:00`, end: `${day(4)} 00:00:00` }],
        closed: [],
      },
      async () => TENANT
    );
    expect(crew).toEqual({
      free: [{ uuid: SAM_SM8, name: "Sam Tester", title: "Apprentice" }],
      off: [{ uuid: LEO, name: "Leo Watanangura", title: null, word: "Annual Leave", until: day(3), from: null, to: null }],
      later: [{ uuid: DAVID, name: "David Hann", title: null, after: at(d, "11:30") }],
    });
  });
});
