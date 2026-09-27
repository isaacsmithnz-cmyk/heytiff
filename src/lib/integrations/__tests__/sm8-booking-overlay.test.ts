/**
 * @jest-environment node
 */

/* HeyTiff's booking rows over the mirror (two-way phase 3, PR B; the spec's
   B-24): what we removed stays gone for as long as its delete row stands,
   what we sent shows until the sync brings its twin, and all of it is the
   ServiceM8 account connected NOW — never the one a disconnect or a switch
   left behind. With bookings not allowed, or no account, nothing is read. */

import { makeFakeDb } from "./fixtures/sm8-fake-db";

const fake = makeFakeDb();
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (t: string) => fake.from(t),
    rpc: (n: string, a: Record<string, unknown>) => fake.rpc(n, a),
  },
}));

import { readBookingOverlay, readMirrorBookings } from "../sm8-booking-overlay";
import { BOOKING_WORDS, localNow } from "../sm8-booking-plan";

type Row = Record<string, unknown>;

const ORG = "org-1";
const TENANT = "vendor-1";
const ZONE = "Australia/Sydney";
const JOB = "01a0dd9a-0000-4000-8000-000000003370";
const GONE_JOB = "01a0dd9a-0000-4000-8000-00000000dead";
const ISAAC = "985a32ef-398b-489f-882a-20fe666a5ebb";
const STATE = { linked: true, tenantId: TENANT };

const day = (days: number) => localNow(ZONE, Date.now() + days * 86_400_000)!.slice(0, 10);
const TOMORROW = day(1);

let seq = 0;
const uuid = (n: number) => `7e7e7e7e-0000-4000-8000-${String(n).padStart(12, "0")}`;

function create(over: Row = {}): Row {
  seq += 1;
  return {
    id: `c${seq}`,
    org_id: ORG,
    tenant_id: TENANT,
    kind: "booking",
    op: "create",
    status: "sent",
    subject: `slot:${ISAAC}:${TOMORROW}T${String(seq).padStart(2, "0")}:00`,
    sm8_job_uuid: JOB,
    remote_uuid: uuid(seq),
    replaced_uuids: [],
    booking_staff_uuid: ISAAC,
    booking_start: `${TOMORROW} ${String(seq).padStart(2, "0")}:00:00`,
    booking_end: `${TOMORROW} ${String(seq).padStart(2, "0")}:30:00`,
    booking_zone: ZONE,
    taken_back_at: null,
    last_error: null,
    depends_on: null,
    target_uuid: null,
    created_at: new Date().toISOString(),
    ...over,
  };
}

const booking = () => fake.on("sm8_writes");

beforeEach(() => {
  fake.reset();
  seq = 0;
  fake.db.sm8_writes = [];
  fake.db.sm8_jobs = [{ org_id: ORG, uuid: JOB, active: 1 }];
  fake.db.sm8_job_activities = [];
  process.env.SM8_WRITES = "attachment,note,booking";
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  delete process.env.SM8_WRITES;
});

describe("the overlay (B-24)", () => {
  it("(F) reads nothing — and says nothing — where bookings aren't allowed, with no connection, or with no account", async () => {
    fake.db.sm8_writes.push(create());
    for (const setting of ["1", "attachment,note"]) {
      process.env.SM8_WRITES = setting;
      expect(await readBookingOverlay(ORG, STATE)).toEqual({ gone: new Set(), sentNotMirrored: [], rows: [] });
    }
    process.env.SM8_WRITES = "attachment,note,booking";
    expect(await readBookingOverlay(ORG, { linked: false, tenantId: TENANT })).toEqual({ gone: new Set(), sentNotMirrored: [], rows: [] });
    expect(await readBookingOverlay(ORG, { linked: true, tenantId: null })).toEqual({ gone: new Set(), sentNotMirrored: [], rows: [] });
    expect(booking()).toHaveLength(0);
    expect(fake.log).toHaveLength(0);
  });

  it("(F) only the account connected now: another tenant's sent booking and its removal are ignored", async () => {
    const ours = create();
    const theirs = create({ tenant_id: "vendor-old" });
    const theirUndo = { ...create({ tenant_id: "vendor-old" }), op: "delete", depends_on: theirs.id, booking_start: null, booking_end: null };
    fake.db.sm8_writes.push(ours, theirs, theirUndo);
    const o = await readBookingOverlay(ORG, STATE);
    expect(o.sentNotMirrored.map((s) => s.rowId)).toEqual([ours.id]);
    expect(o.gone.has(String(theirs.remote_uuid))).toBe(false);
    expect(booking().every((s) => s.filters.includes(`tenant_id=${TENANT}`) || s.filters.some((f) => f.startsWith("id")))).toBe(true);
  });

  it("(F) a sent booking shows until the mirror holds its uuid — whatever the case — and only on a job the mirror holds", async () => {
    const shown = create();
    const twin = create({ remote_uuid: uuid(90).toUpperCase() });
    const orphan = create({ sm8_job_uuid: GONE_JOB });
    fake.db.sm8_writes.push(shown, twin, orphan);
    /* the sync brought the twin, spelt the other way */
    fake.db.sm8_job_activities = [{ org_id: ORG, uuid: uuid(90), job_uuid: JOB, active: 1 }];
    const o = await readBookingOverlay(ORG, STATE);
    expect(o.sentNotMirrored).toEqual([
      {
        rowId: shown.id,
        uuid: shown.remote_uuid,
        jobUuid: JOB,
        staffUuid: ISAAC,
        start: shown.booking_start,
        end: shown.booking_end,
      },
    ]);
  });

  it("(F) a booking kept at another time, on someone else, or changed there is never drawn at the row's time; nor is one taken back, or before today", async () => {
    fake.db.sm8_writes.push(
      create({ last_error: BOOKING_WORDS.row.timeNotKept }),
      create({ last_error: BOOKING_WORDS.row.personNotKept }),
      create({ last_error: BOOKING_WORDS.row.movedThere }),
      create({ taken_back_at: new Date().toISOString() }),
      create({ booking_start: `${day(-2)} 09:00:00`, booking_end: `${day(-2)} 10:00:00` }),
      create({ status: "failed" })
    );
    expect((await readBookingOverlay(ORG, STATE)).sentNotMirrored).toEqual([]);
  });

  it("(F) gone is never windowed: a Clear sent 60 days ago is still gone, and so is every uuid of a create an Undo took back", async () => {
    const old = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const c = create({ replaced_uuids: [uuid(70)], taken_back_at: old });
    fake.db.sm8_writes.push(
      c,
      { ...create(), id: "undo-1", op: "delete", depends_on: c.id, booking_start: null, booking_end: null, status: "sent", updated_at: old },
      { ...create(), id: "clear-1", op: "delete", target_uuid: uuid(80).toUpperCase(), status: "sent", booking_start: `${day(-60)} 09:00:00`, updated_at: old },
      { ...create(), id: "clear-2", op: "delete", target_uuid: uuid(81), status: "failed" }
    );
    const o = await readBookingOverlay(ORG, STATE, { from: TOMORROW, to: day(2) });
    expect([...o.gone].sort()).toEqual([String(c.remote_uuid), uuid(70), uuid(80)].sort());
  });

  it("windows what we sent by the booking's start, from inclusive and to exclusive, and narrows it to the jobs asked", async () => {
    const a = create();
    const b = create({ booking_start: `${day(2)} 09:00:00`, booking_end: `${day(2)} 10:00:00` });
    const other = create({ sm8_job_uuid: "01a0dd9a-0000-4000-8000-000000000288" });
    fake.db.sm8_jobs.push({ org_id: ORG, uuid: other.sm8_job_uuid, active: 1 });
    fake.db.sm8_writes.push(a, b, other);
    const o = await readBookingOverlay(ORG, STATE, { from: TOMORROW, to: day(2) });
    expect(o.sentNotMirrored.map((s) => s.rowId).sort()).toEqual([a.id, other.id].sort());
    const j = await readBookingOverlay(ORG, STATE, { jobUuids: [JOB] });
    expect(j.sentNotMirrored.map((s) => s.rowId).sort()).toEqual([a.id, b.id].sort());
  });

  it("the rows a job's lines are drawn from: creates from 30 days back, their status rows and take-backs, and the Clears", async () => {
    const status = { ...create(), id: "status-1", op: "update", booking_start: null, booking_end: null, booking_staff_uuid: null, target_uuid: JOB };
    const c = create({ depends_on: "status-1" });
    const old = create({ booking_start: `${day(-40)} 09:00:00`, booking_end: `${day(-40)} 10:00:00` });
    const undo = { ...create(), id: "undo-2", op: "delete", depends_on: c.id, booking_start: null, booking_end: null };
    const clear = { ...create(), id: "clear-3", op: "delete", target_uuid: uuid(99) };
    fake.db.sm8_writes.push(status, c, old, undo, clear);
    const o = await readBookingOverlay(ORG, STATE, { jobUuids: [JOB] });
    expect(o.rows.map((r) => r.id).sort()).toEqual([status.id, c.id, undo.id, clear.id].sort());
    expect((await readBookingOverlay(ORG, STATE)).rows).toEqual([]);
  });

  it("reads the mirror's copy of a booking by uuid, whatever its case", async () => {
    fake.db.sm8_job_activities = [
      { org_id: ORG, uuid: uuid(5).toUpperCase(), job_uuid: JOB, staff_uuid: ISAAC, start_date: "2026-10-06 09:00:00", end_date: "2026-10-06 10:00:00", activity_was_scheduled: 1, active: 0, edit_date: "2026-10-01 10:00:00" },
    ];
    const m = await readMirrorBookings(ORG, [uuid(5)]);
    expect(m?.get(uuid(5))).toMatchObject({ active: 0, staffUuid: ISAAC, start: "2026-10-06 09:00:00" });
    fake.failing.add("sm8_job_activities");
    expect(await readMirrorBookings(ORG, [uuid(5)])).toBeNull();
  });
});
