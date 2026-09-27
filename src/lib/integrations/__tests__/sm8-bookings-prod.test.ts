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
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn(async () => ({ orgId: "org-1", user: { sub: "auth0|sam" } })) },
}));
jest.mock("../sm8-store", () => ({
  sm8AccessResult: jest.fn(async () => ({ ok: true, access: { accessToken: "t", tenantId: "vendor-1", grant: "g", meter: "vendor-1" } })),
  renewSm8Access: jest.fn(),
  markSm8NeedsReauth: jest.fn(),
}));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => "staff-sam") }));
jest.mock("next/server", () => ({ after: () => {} }));
jest.mock("@/lib/workboard/job-notes-query", () => ({
  staffDisplayNames: jest.fn(async () => new Map([["staff-sam", "Sam Tester"]])),
}));

import { cancelWaitingSm8Writes, countWaitingSm8WritesByKind } from "../sm8-write-cancel";
import {
  countSm8Queue,
  enqueueAttachments,
  enqueueSm8Writes,
  listRecentSm8Writes,
  readSm8WriteState,
  runSm8Writes,
  setSm8WriteKind,
  sm8QueueStuck,
} from "../sm8-writes";
import { readBookingOverlay } from "../sm8-booking-overlay";
import { sm8PressFromSession } from "../sm8-press";
import { sm8BookingsAllowed } from "../sm8-kinds";
import { BOOKING_WORDS } from "../sm8-booking-words";
import { NOTE_WORDS } from "../sm8-note-words";
import { WRITE_WORDS } from "../sm8-write-plan";

type Row = Record<string, unknown>;

const ORG = "org-1";
const JOB = "0b1e0b1e-0000-4000-8000-000000009001";
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
  requested_by: "staff-sam",
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
  fake.db.sm8_jobs = [{ org_id: ORG, uuid: JOB, generated_job_id: "9001" }];
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
    const reason = BOOKING_WORDS.row.guardStopped.replace("{number}", "9001");
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
    expect(list.every((w) => w.jobNumber === "9001")).toBe(true);
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

/* ── B-12: PR B's reads and writes, as production has them ── */

/** The columns the sender read its due rows with on main, word for word. */
const MAIN_ROW_COLUMNS =
  "id, tenant_id, kind, sm8_job_uuid, subject, payload, remote_uuid, status, attempts, lease_until, replaced_uuids, maybe_landed, verify_uuids, free_retries, op, note_id, depends_on, target_uuid, flag_done, seen_edit_date, seen_edit_by, note_text, requested_by, pressed_at, next_attempt_at, taken_back_at";
const MAIN_EXISTING_COLUMNS =
  "id, dedupe_key, kind, requested_by, status, attempts, remote_uuid, replaced_uuids, maybe_landed, verify_uuids, pressed_at";

const dueReads = () =>
  onWrites().filter((s) => s.op === "select" && s.filters.includes("status in") && s.filters.some((f) => f.startsWith("next_attempt_at")));

describe.each([
  ["1", ["attachment"]],
  ["attachment,note", ["attachment", "note"]],
])("with SM8_WRITES=%s, PR B changes nothing (B-12)", (setting, owner) => {
  beforeEach(() => {
    process.env.SM8_WRITES = setting;
    fake.db.integration_connections = [connection({ write_kinds: owner })];
    fake.db.sm8_writes = [];
    fake.db.workboard_notes = [];
  });

  it("(F) the run reads its due rows with exactly main's columns, and never a booking row", async () => {
    const b = write("booking", { verb_id: "v" });
    fake.db.sm8_writes = [b];
    await runSm8Writes(ORG, "kick");
    const reads = dueReads();
    expect(reads).toHaveLength(1);
    expect(reads[0].columns).toBe(MAIN_ROW_COLUMNS);
    expect(namesBooking()).toEqual([]);
    expect(b).toMatchObject({ status: "queued", attempts: 0 });
  });

  it("(F) a file press reads the queue with main's columns and inserts a row with no note or booking column", async () => {
    const press = (await sm8PressFromSession())!;
    const q = await enqueueAttachments(press, await readSm8WriteState(ORG), [
      { jobUuid: JOB, documentId: "doc-1", name: "Quote.pdf", mimeType: "application/pdf", sizeBytes: 4, key: "k" },
    ]);
    expect(q?.ids).toHaveLength(1);
    expect(onWrites().find((s) => s.op === "select")?.columns).toBe(MAIN_EXISTING_COLUMNS);
    const row = byId(q!.ids[0]);
    for (const col of ["op", "note_id", "depends_on", "target_uuid", "verb_id", "booking_staff_uuid", "booking_start", "booking_zone", "job_status_to"]) {
      expect([col, col in row && row[col] !== "create" ? row[col] : null]).toEqual([col, null]);
    }
  });

  it("(F) a note press reads the queue with main's columns and inserts main's note columns, in main's order, and none of a booking's", async () => {
    if (!owner.includes("note")) return;
    fake.db.workboard_notes = [{ id: "n1", org_id: ORG }];
    const press = (await sm8PressFromSession())!;
    const q = await enqueueSm8Writes(press, await readSm8WriteState(ORG), [
      { kind: "note", op: "create", jobUuid: JOB, subject: "jobnote:n1", payload: { name: "Note" }, ref: "n1", noteId: "n1", noteText: "hi" },
    ]);
    expect(q?.ids).toHaveLength(1);
    expect(onWrites().find((s) => s.op === "select")?.columns).toBe(`${MAIN_EXISTING_COLUMNS}, op, taken_back_at`);
    const row = byId(q!.ids[0]);
    const keys = Object.keys(row);
    const noteKeys = ["op", "note_id", "depends_on", "target_uuid", "flag_done", "seen_edit_date", "seen_edit_by", "note_text"];
    expect(keys.filter((k) => noteKeys.includes(k))).toEqual(noteKeys);
    expect(keys.filter((k) => /^(verb_id|booking_|job_status_)/.test(k))).toEqual([]);
  });

  it("(F) the overlay reads nothing", async () => {
    fake.db.sm8_writes = [write("booking", { status: "sent", booking_start: "2099-01-01 09:00:00" })];
    expect(await readBookingOverlay(ORG, { linked: true, tenantId: "vendor-1" }, { jobUuids: [JOB] })).toEqual({
      gone: new Set(),
      sentNotMirrored: [],
      rows: [],
    });
    expect(fake.log).toHaveLength(0);
  });
});

describe("with booking named (B-12)", () => {
  beforeEach(() => {
    process.env.SM8_WRITES = "attachment,note,booking";
    fake.db.integration_connections = [connection({ write_kinds: ["attachment", "note", "booking"] })];
    fake.db.sm8_writes = [];
  });

  it("(F) no kind ready: the run says it in bookings' words for every kind", async () => {
    fake.db.integration_connections = [connection({ write_kinds: ["attachment", "note", "booking"], scopes: "vendor" })];
    expect((await runSm8Writes(ORG, "kick")).stopped).toBe(BOOKING_WORDS.kindWords.heldAny);
    fake.db.integration_connections = [connection({ write_kinds: [] })];
    expect((await runSm8Writes(ORG, "kick")).stopped).toBe(BOOKING_WORDS.kindWords.offAll);
    /* without bookings, today's words */
    process.env.SM8_WRITES = "attachment,note";
    fake.db.integration_connections = [connection({ write_kinds: ["attachment", "note"], scopes: "vendor" })];
    expect((await runSm8Writes(ORG, "kick")).stopped).toBe(NOTE_WORDS.kindWords.heldAll);
  });

  it("(F) the run reads its due rows with a booking's columns too", async () => {
    await runSm8Writes(ORG, "kick");
    const reads = dueReads();
    expect(reads).toHaveLength(1);
    expect(reads[0].columns).toBe(
      `${MAIN_ROW_COLUMNS}, verb_id, booking_staff_uuid, booking_start, booking_end, booking_zone, job_status_from, job_status_to, landed_edit_date`
    );
  });

  it("(F) ...but Bookings Off reads exactly main's again, and a database without the bookings migration still sends files and notes", async () => {
    fake.db.integration_connections = [connection({ write_kinds: ["attachment", "note"] })];
    await runSm8Writes(ORG, "kick");
    expect(dueReads()[0].columns).toBe(MAIN_ROW_COLUMNS);

    fake.log.length = 0;
    fake.db.integration_connections = [connection({ write_kinds: ["attachment", "note", "booking"] })];
    fake.missing.add("verb_id");
    await runSm8Writes(ORG, "kick");
    expect(dueReads().map((s) => s.columns)).toEqual([expect.stringContaining("verb_id"), MAIN_ROW_COLUMNS]);
  });
});
