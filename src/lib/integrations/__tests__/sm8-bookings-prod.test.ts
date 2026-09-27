/**
 * @jest-environment node
 */

/* PRODUCTION TODAY DOESN'T NAME `booking` IN SM8_WRITES (it is 1, or
   attachment,note), and nothing about bookings may change there until it
   does — after P0 to P6, the notes walk and PR D (DECISIONS 14). This suite
   holds PR A's reads and writes to that (A-1): with either setting, the
   owner's counts make exactly today's queries, none names a booking, a run
   cancels nothing it didn't, and the numbers read as they did. With
   `booking` allowed, each does what it should: the counts split three ways,
   Bookings Off cancels waiting booking rows only, in bookings' words
   (A-10), a cancelled booking comes back as one (A-11), and the owner's
   list names a booking by its label. */

import { makeFakeDb } from "./fixtures/sm8-fake-db";

const fake = makeFakeDb();
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (t: string) => fake.from(t),
    rpc: (n: string, a: Record<string, unknown>) => fake.rpc(n, a),
  },
}));
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: jest.fn(async () => null) } }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => "staff-isaac") }));
jest.mock("next/server", () => ({ after: () => {} }));
jest.mock("@/lib/workboard/job-notes-query", () => ({
  staffDisplayNames: jest.fn(async () => new Map([["staff-isaac", "Isaac Smith"]])),
}));

import { cancelWaitingSm8Writes, countWaitingSm8WritesByKind } from "../sm8-write-cancel";
import { countSm8Queue, listRecentSm8Writes, runSm8Writes, setSm8WriteKind, sm8QueueStuck } from "../sm8-writes";
import { sm8BookingsAllowed } from "../sm8-kinds";
import { BOOKING_WORDS } from "../sm8-booking-words";
import { NOTE_WORDS } from "../sm8-note-words";
import { WRITE_WORDS } from "../sm8-write-plan";

type Row = Record<string, unknown>;

const ORG = "org-1";
const JOB = "a0a0a0a0-0000-4000-8000-0000000000b1";
const LONG_AGO = new Date(Date.now() - 3_600_000).toISOString();

let seq = 0;
const write = (kind: string, over: Row = {}): Row => ({
  id: `w${++seq}`,
  org_id: ORG,
  tenant_id: "vendor-1",
  kind,
  op: "create",
  sm8_job_uuid: JOB,
  subject: `${kind}:${seq}`,
  payload: { name: kind === "attachment" ? `File ${seq}.pdf` : kind === "note" ? "Reply" : BOOKING_WORDS.label.create },
  status: "queued",
  attempts: 0,
  next_attempt_at: LONG_AGO,
  lease_until: null,
  last_error: null,
  requested_by: "staff-isaac",
  updated_at: LONG_AGO,
  ...over,
});

const connection = (over: Row = {}): Row => ({
  org_id: ORG,
  provider: "servicem8",
  status: "connected",
  tenant_id: "vendor-1",
  tenants: [{ tenantId: "vendor-1", tenantName: "Acme Air", timezoneName: "Australia/Sydney" }],
  scopes: "vendor read_jobs manage_attachments publish_job_notes manage_schedule manage_jobs",
  write_mode: "live",
  paused_reason: null,
  paused_at: null,
  write_scope_refused: {},
  connected_at: "2026-09-01T00:00:00.000Z",
  write_kinds: ["attachment", "note"],
  ...over,
});

const writes = () => fake.db.sm8_writes as Row[];
const byId = (id: unknown) => writes().find((w) => w.id === id)!;
const onWrites = () => fake.on("sm8_writes");
const namesBooking = () => onWrites().filter((s) => s.filters.some((f) => f.includes("booking")));

beforeEach(() => {
  fake.reset();
  seq = 0;
  fake.db.sm8_writes = [write("attachment"), write("note")];
  fake.db.integration_connections = [connection()];
  fake.db.sm8_jobs = [{ org_id: ORG, uuid: JOB, generated_job_id: "3370" }];
  process.env.SM8_WRITES = "1";
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  delete process.env.SM8_WRITES;
});

describe.each([
  ["1", 1],
  ["attachment,note", 2],
])("with SM8_WRITES=%s (no booking: production today)", (setting, counts) => {
  beforeEach(() => {
    process.env.SM8_WRITES = setting;
  });

  it("allows no booking", () => {
    expect(sm8BookingsAllowed()).toBe(false);
  });

  it("(F) the owner's waiting count makes today's queries, and none names a booking", async () => {
    const kinds = await countWaitingSm8WritesByKind(ORG, Date.now());
    expect(onWrites()).toHaveLength(counts);
    expect(namesBooking()).toEqual([]);
    expect(kinds.booking).toBe(0);
    // files alone count every row as a file, as always; files and notes, each apart
    expect(kinds).toEqual(setting === "1" ? { attachment: 2, note: 0, booking: 0 } : { attachment: 1, note: 1, booking: 0 });
  });

  it("(F) the screen's queue and the owner's bell make today's queries, with today's numbers", async () => {
    const queue = await countSm8Queue(ORG, "vendor-1", Date.now());
    expect(queue.waiting).toBe(2);
    // the waiting count(s), then what failed for this account (files only)
    expect(onWrites()).toHaveLength(counts + 1);
    fake.log.length = 0;
    fake.db.integration_connections = [connection({ write_mode: "paused", paused_reason: "cap" })];
    expect(await sm8QueueStuck(ORG, Date.now())).toMatchObject({ reason: "cap", waiting: 2 });
    expect(onWrites()).toHaveLength(counts);
    expect(namesBooking()).toEqual([]);
  });

  it("(F) a run cancels nothing in bookings' words and makes no booking query, whatever the owner's switch holds", async () => {
    /* production's own switch values first — {attachment} and {attachment,
       note} — then one that holds booking: a switched-off kind is only ever
       one the deployment allows */
    for (const owner of [["attachment"], ["attachment", "note"], ["attachment", "note", "booking"]]) {
      seq = 0;
      fake.db.sm8_writes = [write("attachment"), write("note"), write("booking")];
      fake.db.integration_connections = [connection({ write_mode: "paused", write_kinds: owner })];
      fake.log.length = 0;
      await runSm8Writes(ORG, "kick");
      expect([owner, namesBooking()]).toEqual([owner, []]);
      expect([owner, writes().some((w) => w.last_error === BOOKING_WORDS.row.switchedOff)]).toEqual([owner, false]);
      expect([owner, byId("w3").status]).toEqual([owner, "queued"]);
      // files are never cancelled for a switch; notes only where they are allowed and switched off, as today
      expect(byId("w1").status).toBe("queued");
      const notesOff = setting === "attachment,note" && !owner.includes("note");
      expect([owner, byId("w2").status]).toEqual([owner, notesOff ? "cancelled" : "queued"]);
    }
  });

  it("names files and notes in the owner's list as before", async () => {
    const list = await listRecentSm8Writes(ORG, Date.now());
    expect(list.map((w) => [w.kind, w.name])).toEqual(
      expect.arrayContaining([
        ["attachment", "File 1.pdf"],
        ["note", "Reply"],
      ])
    );
  });
});

describe("where the deployment names booking", () => {
  beforeEach(() => {
    process.env.SM8_WRITES = "attachment,note,booking";
    fake.db.integration_connections = [connection({ write_kinds: ["attachment", "note", "booking"] })];
  });

  it("allows bookings", () => {
    expect(sm8BookingsAllowed()).toBe(true);
  });

  it("(F) counts the three kinds apart, one head count each, and adds them up", async () => {
    fake.db.sm8_writes.push(write("booking"), write("booking", { op: "update" }));
    expect(await countWaitingSm8WritesByKind(ORG, Date.now())).toEqual({ attachment: 1, note: 1, booking: 2 });
    expect(onWrites()).toHaveLength(3);
    expect((await countSm8Queue(ORG, "vendor-1", Date.now())).waiting).toBe(4);
  });

  it("(F) Bookings Off cancels waiting booking rows only — creates, status changes, take-backs and clears — in bookings' words", async () => {
    const create = write("booking");
    const status = write("booking", { op: "update" });
    const undo = write("booking", { op: "delete", depends_on: create.id });
    const clear = write("booking", { op: "delete", target_uuid: "act-1" });
    const sent = write("booking", { status: "sent" });
    const inFlight = write("booking", { status: "sending", lease_until: new Date(Date.now() + 60_000).toISOString() });
    fake.db.sm8_writes.push(create, status, undo, clear, sent, inFlight);
    const off = await setSm8WriteKind(ORG, "booking", false);
    expect(off.ok && off.cancelled.map((c) => [c.id, c.kind, c.name])).toEqual(
      [create, status, undo, clear].map((r) => [r.id, "booking", BOOKING_WORDS.label.create])
    );
    for (const r of [create, status, undo, clear]) {
      expect(byId(r.id)).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.switchedOff });
    }
    // what went, went; what is in flight is left to land or not
    expect(byId(sent.id).status).toBe("sent");
    expect(byId(inFlight.id).status).toBe("sending");
    // files and notes untouched
    expect(byId("w1")).toMatchObject({ status: "queued", last_error: null });
    expect(byId("w2")).toMatchObject({ status: "queued", last_error: null });
    expect(fake.db.integration_connections[0].write_kinds).toEqual(["attachment", "note"]);
    expect(fake.on("rpc:sm8_set_write_kind")).toHaveLength(1);
  });

  it("(F) a guard switching Bookings off puts its own words on what it cancels", async () => {
    fake.db.sm8_writes.push(write("booking"));
    const reason = BOOKING_WORDS.row.guardStopped.replace("{number}", "3370");
    await setSm8WriteKind(ORG, "booking", false, Date.now(), { reason });
    expect(byId("w3")).toMatchObject({ status: "cancelled", last_error: reason });
    // and the other kinds' switches keep their own words
    await setSm8WriteKind(ORG, "note", false);
    expect(byId("w2")).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.notesSwitchedOff });
    await setSm8WriteKind(ORG, "attachment", false);
    expect(byId("w1")).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.filesSwitchedOff });
  });

  it("switches Bookings back on without cancelling anything", async () => {
    fake.db.integration_connections = [connection({ write_kinds: ["attachment", "note"] })];
    fake.db.sm8_writes.push(write("booking"));
    expect(await setSm8WriteKind(ORG, "booking", true)).toEqual({ ok: true, cancelled: [] });
    expect(fake.db.integration_connections[0].write_kinds).toEqual(["attachment", "booking", "note"]);
    expect(byId("w3").status).toBe("queued");
  });

  it("(F) a booking queued just before the Off is cancelled by the next run in bookings' words, even while paused", async () => {
    fake.db.sm8_writes.push(write("booking"));
    fake.db.integration_connections = [connection({ write_mode: "paused", write_kinds: ["attachment", "note"] })];
    await runSm8Writes(ORG, "kick");
    expect(byId("w3")).toMatchObject({ status: "cancelled", last_error: BOOKING_WORDS.row.switchedOff });
    expect(byId("w1").status).toBe("queued");
    expect(byId("w2").status).toBe("queued");
  });

  it("(F) a booking a cancel took comes back as a booking, named by its label", async () => {
    const status = write("booking", { op: "update", payload: { name: BOOKING_WORDS.label.status } });
    fake.db.sm8_writes = [status];
    const cancelled = await cancelWaitingSm8Writes(ORG, WRITE_WORDS.disconnected, Date.now());
    expect(cancelled).toEqual([{ id: status.id, kind: "booking", name: BOOKING_WORDS.label.status }]);
  });

  it("(F) the owner's list says a booking is one, by its label, or 'A booking' with none", async () => {
    fake.db.sm8_writes = [write("booking"), write("booking", { payload: {} })];
    const list = await listRecentSm8Writes(ORG, Date.now());
    expect(list.map((w) => [w.kind, w.name])).toEqual(
      expect.arrayContaining([
        ["booking", "Booking"],
        ["booking", "A booking"],
      ])
    );
    expect(list.every((w) => w.jobNumber === "3370")).toBe(true);
  });

  it("(F) the owner's bell counts bookings, and asks for a reconnect only while Bookings is On without its permissions", async () => {
    fake.db.sm8_writes.push(write("booking"));
    fake.db.integration_connections = [
      connection({ write_kinds: ["attachment", "note", "booking"], scopes: "vendor manage_attachments publish_job_notes manage_schedule" }),
    ];
    expect(await sm8QueueStuck(ORG, Date.now())).toEqual({
      reason: "reconnect",
      waiting: 3,
      kinds: { attachment: 1, note: 1, booking: 1 },
    });
    // Bookings Off: a kind switched off never asks for a reconnect
    fake.db.integration_connections[0].write_kinds = ["attachment", "note"];
    expect(await sm8QueueStuck(ORG, Date.now())).toBeNull();
  });
});
