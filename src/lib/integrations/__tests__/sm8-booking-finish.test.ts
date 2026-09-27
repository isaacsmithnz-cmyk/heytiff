/**
 * @jest-environment node
 */

/* THE RUN RECORDS WHAT A BOOKING'S SENDER SAYS BY ITS OP (two-way phase 3,
   PR B; the spec's B-18), with the sender stubbed so `finish` is held on
   its own: a status change's or a take-back's x-record-uuid is someone
   else's record (the job, the booking removed), and stored as the row's
   remote_uuid it would read as one of ours. Only a create names a record of
   its own. A take-back keeps its target; every booking row, its edit time. */

import { makeFakeDb } from "./fixtures/sm8-fake-db";

const fake = makeFakeDb();
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (t: string) => fake.from(t),
    rpc: (n: string, a: Record<string, unknown>) => fake.rpc(n, a),
  },
}));
jest.mock("../sm8-store", () => ({
  sm8AccessResult: jest.fn(async () => ({ ok: true, access: { accessToken: "t", tenantId: "vendor-1", grant: "g", meter: "vendor-1" } })),
  renewSm8Access: jest.fn(),
  markSm8NeedsReauth: jest.fn(),
}));
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: jest.fn(async () => null) } }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => null) }));
jest.mock("next/server", () => ({ after: () => {} }));
jest.mock("@/lib/workboard/job-notes-query", () => ({ staffDisplayNames: jest.fn(async () => new Map()) }));
const sendBookingRow = jest.fn();
jest.mock("../sm8-booking-send", () => ({ sendBookingRow: (...a: unknown[]) => sendBookingRow(...a) }));

import { runSm8Writes } from "../sm8-writes";

type Row = Record<string, unknown>;

const ORG = "org-1";
const JOB = "0b1e0b1e-0000-4000-8000-000000009001";
const THEIRS = "acac01aa-0000-4000-8000-00000000acaa";
const OURS = "7e7e7e7e-0000-4000-8000-00000000000a";

const row = (op: string, over: Row = {}): Row => ({
  id: `${op}-1`,
  org_id: ORG,
  tenant_id: "vendor-1",
  kind: "booking",
  op,
  sm8_job_uuid: JOB,
  subject: `${op}:x`,
  payload: {},
  remote_uuid: OURS,
  replaced_uuids: [],
  status: "queued",
  attempts: 0,
  next_attempt_at: new Date(Date.now() - 1000).toISOString(),
  created_at: new Date().toISOString(),
  lease_until: null,
  maybe_landed: false,
  verify_uuids: [],
  free_retries: 0,
  verb_id: "v",
  taken_back_at: null,
  ...over,
});

beforeEach(() => {
  fake.reset();
  fake.db.integration_connections = [
    {
      org_id: ORG,
      provider: "servicem8",
      status: "connected",
      tenant_id: "vendor-1",
      tenants: [],
      scopes: "vendor manage_schedule manage_jobs",
      write_mode: "live",
      write_scope_refused: {},
      connected_at: "2026-09-01T00:00:00.000Z",
      write_kinds: ["booking"],
    },
  ];
  process.env.SM8_WRITES = "booking";
  sendBookingRow.mockReset().mockImplementation(async (_o: unknown, _s: unknown, _r: unknown, _a: unknown, access: unknown) => ({
    finish: { status: "sent", error: null, httpStatus: 200, remoteUuid: THEIRS, replacedUuids: [OURS], targetUuid: THEIRS, landedEditDate: "2026-09-27 17:00:00" },
    access,
  }));
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  delete process.env.SM8_WRITES;
});

describe("finish keys on the op, not the kind (B-18)", () => {
  it("(F) a status change's x-record-uuid never becomes its remote_uuid, and its edit time is kept", async () => {
    const s = row("update", { target_uuid: JOB, job_status_from: "Quote", job_status_to: "Work Order", seen_edit_date: "2026-09-27 16:00:00" });
    fake.db.sm8_writes = [s];
    await runSm8Writes(ORG, "send");
    expect(s).toMatchObject({ status: "sent", remote_uuid: OURS, replaced_uuids: [], landed_edit_date: "2026-09-27 17:00:00" });
  });

  it("(F) a take-back's neither — it records its target instead", async () => {
    const d = row("delete", { depends_on: "create-1" });
    fake.db.sm8_writes = [d];
    await runSm8Writes(ORG, "send");
    expect(d).toMatchObject({ status: "sent", remote_uuid: OURS, replaced_uuids: [], target_uuid: THEIRS });
  });

  it("a booking's own create does take the uuid ServiceM8 kept it under", async () => {
    const c = row("create", {
      booking_staff_uuid: "5a0e5a0e-0000-4000-8000-00000000a001",
      booking_start: "2026-10-06 20:00:00",
      booking_end: "2026-10-06 21:00:00",
      booking_zone: "Australia/Sydney",
    });
    fake.db.sm8_writes = [c];
    await runSm8Writes(ORG, "send");
    expect(c).toMatchObject({ status: "sent", remote_uuid: THEIRS, replaced_uuids: [OURS] });
  });
});
