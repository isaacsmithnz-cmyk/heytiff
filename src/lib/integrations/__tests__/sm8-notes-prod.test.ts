/**
 * @jest-environment node
 */

/* PRODUCTION TODAY SENDS FILES ONLY (SM8_WRITES=1), and nothing about notes
   may change there until SM8_WRITES names `note` — Isaac's order, after
   phase 1's live walk. This suite holds every new read and write of PR A to
   that: with SM8_WRITES=1 none of them makes a query, and with `note`
   allowed each does what it should.

   Also here: the echo (our own notes, mirrored back, left out of our lists;
   one echo read per card open), a flag somebody marked done isn't open,
   and a note's words leaving the queue. */

import { makeFakeDb } from "./fixtures/sm8-fake-db";

const fake = makeFakeDb();
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (t: string) => fake.from(t),
    rpc: (n: string, a: Record<string, unknown>) => fake.rpc(n, a),
    storage: { from: () => ({ remove: async () => ({ error: null }), list: async () => ({ data: [], error: null }) }) },
  },
}));
const afters: (() => Promise<unknown> | unknown)[] = [];
jest.mock("next/server", () => ({ after: (fn: () => unknown) => afters.push(fn) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("../sm8-sync", () => ({ runSm8Sync: jest.fn(async () => ({ ran: false })), sm8SyncIsStale: jest.fn(async () => false) }));
jest.mock("@/lib/permissions-server", () => ({ requireOrg: async () => ({ orgId: "org-1", userId: "auth0|i" }), can: async () => true }));
jest.mock("@/lib/workboard/projects-query", () => ({ staffIdFor: async () => "staff-isaac" }));

import {
  clearDisconnectedSm8NoteText,
  clearSm8NoteText,
  countWaitingSm8WritesByKind,
  sm8NoteTextDue,
} from "../sm8-write-cancel";
import { freshenSm8AfterResponse } from "../sm8-freshness";
import { readJobNotes } from "@/lib/workboard/all-jobs-query";
import { readJobAttention } from "@/lib/workboard/job-notes-query";
import { listJournal } from "@/lib/dashboard/journal-query";
import { taskFromJobNote } from "@/app/actions/job-notes";
import { countSm8Queue } from "../sm8-writes";
import { disconnectSm8 } from "../sm8-store";

const ORG = "org-1";
const JOB = "0f8c2b9e-1111-4a4a-8b8b-000000000001";
const OURS = "7e7e7e7e-0000-4000-8000-000000000001";
const OLD = "7e7e7e7e-0000-4000-8000-000000000002";
const THEIRS = "7e7e7e7e-0000-4000-8000-000000000003";
const LONG_AGO = new Date(Date.now() - 40 * 86_400_000).toISOString();

const mirrorNote = (uuid: string, over: Record<string, unknown> = {}) => ({
  org_id: ORG,
  uuid,
  related_object_uuid: JOB,
  note: `note ${uuid}`,
  create_date: "2026-09-20 10:00:00",
  action_required: "0",
  action_completed_by_staff_uuid: null,
  edit_by_staff_uuid: null,
  edit_date: "2026-09-20 10:00:00",
  active: 1,
  ...over,
});

const echoReads = () => fake.on("sm8_writes").filter((s) => s.op === "select" && s.filters.some((f) => f.startsWith("or(remote_uuid")));
const writesTouched = () => fake.on("sm8_writes");

beforeEach(() => {
  fake.reset();
  afters.length = 0;
  fake.db.sm8_job_notes = [mirrorNote(OURS), mirrorNote(OLD), mirrorNote(THEIRS)];
  fake.db.sm8_writes = [
    { id: "w1", org_id: ORG, tenant_id: "v", kind: "note", op: "create", status: "sent", remote_uuid: OURS, replaced_uuids: [OLD], note_id: "n1", note_text: "x", remote_message: "m", updated_at: LONG_AGO },
  ];
  fake.db.sm8_staff = [];
  fake.db.integration_connections = [{ org_id: ORG, provider: "servicem8", status: "connected", tenant_id: "v" }];
  process.env.SM8_WRITES = "1";
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  delete process.env.SM8_WRITES;
});

describe("on a deployment that sends files only (production today)", () => {
  it("(F) readJobNotes makes no queue read, and shows every note as today", async () => {
    const notes = await readJobNotes(ORG, JOB);
    expect(notes.map((n) => n.remoteId).sort()).toEqual([OURS, OLD, THEIRS].sort());
    expect(writesTouched()).toHaveLength(0);
  });

  it("(F) a card open makes exactly one echo read — the attention strip's, as today", async () => {
    const notes = await readJobNotes(ORG, JOB);
    await readJobAttention(ORG, JOB, { notes, jobOpen: true, today: "2026-09-25", echoFiltered: false });
    expect(echoReads()).toHaveLength(1);
  });

  it("(F) taskFromJobNote makes no queue read", async () => {
    fake.db.staff_profiles = [{ org_id: ORG, id: "staff-luke" }];
    fake.db.tasks = [];
    fake.db.job_note_actions = [];
    const r = await taskFromJobNote({ jobUuid: JOB, noteUuid: OURS, title: "Order the grilles", assigneeId: "staff-luke" });
    expect(r.ok).toBe(true);
    expect(writesTouched()).toHaveLength(0);
  });

  it("(F) no note-text clear, count or check makes a query: the cron's, a disconnect's, a switch's or a page load's", async () => {
    expect(await clearSm8NoteText({ orgId: ORG }, Date.now())).toBe(0);
    expect(await clearSm8NoteText({ olderThanDays: 30 }, Date.now())).toBe(0);
    expect(await clearDisconnectedSm8NoteText(Date.now())).toBe(0);
    expect(await sm8NoteTextDue(ORG, Date.now())).toBe(false);
    expect(writesTouched()).toHaveLength(0);
    freshenSm8AfterResponse(ORG);
    for (const fn of afters) await fn();
    expect(writesTouched().filter((s) => s.op === "update" || s.filters.some((f) => f.startsWith("note_text")))).toHaveLength(0);
    // and the queue's words are exactly as they were
    expect(fake.db.sm8_writes[0]).toMatchObject({ note_text: "x", remote_message: "m" });
  });

  it("(F) a disconnect clears no note text", async () => {
    await disconnectSm8(ORG, Date.now());
    const updates = fake.on("sm8_writes").filter((s) => s.op === "update");
    expect(updates.every((u) => !("note_text" in (u.patch ?? {})))).toBe(true);
  });

  it("(F) the owner's counts make today's one query, every row of it a file", async () => {
    expect(await countWaitingSm8WritesByKind(ORG, Date.now())).toEqual({ attachment: 0, note: 0 });
    expect(fake.on("sm8_writes")).toHaveLength(1);
    fake.log.length = 0;
    await countSm8Queue(ORG, "v", Date.now());
    expect(fake.on("sm8_writes")).toHaveLength(2);
  });
});

describe("where the deployment sends notes", () => {
  beforeEach(() => {
    process.env.SM8_WRITES = "attachment,note";
  });

  it("(F) readJobNotes hides the notes HeyTiff sent, under their current or a replaced uuid", async () => {
    const notes = await readJobNotes(ORG, JOB);
    expect(notes.map((n) => n.remoteId)).toEqual([THEIRS]);
    expect(echoReads()).toHaveLength(1);
  });

  it("shows everything when that read fails: a duplicate beats a diary that won't open", async () => {
    fake.failing.add("sm8_writes");
    expect(await readJobNotes(ORG, JOB)).toHaveLength(3);
  });

  it("(F) the attention strip doesn't ask again: still one echo read per card open", async () => {
    const notes = await readJobNotes(ORG, JOB);
    await readJobAttention(ORG, JOB, { notes, jobOpen: true, today: "2026-09-25", echoFiltered: true });
    expect(echoReads()).toHaveLength(1);
  });

  it("(F) taskFromJobNote refuses a note HeyTiff sent", async () => {
    const r = await taskFromJobNote({ jobUuid: JOB, noteUuid: OURS, title: "x", assigneeId: "staff-luke" });
    expect(r).toEqual({ ok: false, error: "That note is no longer here." });
  });

  it("the counts split by kind", async () => {
    fake.db.sm8_writes.push(
      { id: "w2", org_id: ORG, kind: "note", status: "queued", next_attempt_at: LONG_AGO },
      { id: "w3", org_id: ORG, kind: "attachment", status: "queued", next_attempt_at: LONG_AGO }
    );
    expect(await countWaitingSm8WritesByKind(ORG, Date.now())).toEqual({ attachment: 1, note: 1 });
  });
});

describe("a flag somebody marked done", () => {
  it("(F) isn't open, whichever deployment", async () => {
    fake.db.sm8_job_notes = [
      mirrorNote(THEIRS, { action_required: "1", action_completed_by_staff_uuid: "5a1b2c3d-0000-4000-8000-00000000aaaa" }),
      mirrorNote(OLD, { action_required: "1" }),
    ];
    const byId = new Map((await readJobNotes(ORG, JOB)).map((n) => [n.remoteId, n.actionRequired]));
    expect(byId.get(THEIRS)).toBe(false);
    expect(byId.get(OLD)).toBe(true);
  });
});

describe("a note's words leave the queue", () => {
  beforeEach(() => {
    process.env.SM8_WRITES = "attachment,note";
    fake.db.sm8_writes = [
      { id: "settled", org_id: ORG, tenant_id: "v", kind: "note", status: "sent", note_text: "a", remote_message: "m", updated_at: LONG_AGO },
      { id: "fresh", org_id: ORG, tenant_id: "v", kind: "note", status: "failed", note_text: "b", remote_message: "m", updated_at: new Date().toISOString() },
      { id: "waiting", org_id: ORG, tenant_id: "v", kind: "note", status: "queued", note_text: "c", updated_at: LONG_AGO },
      { id: "file", org_id: ORG, tenant_id: "v", kind: "attachment", status: "sent", note_text: null, remote_message: "kept", updated_at: LONG_AGO },
    ];
  });
  const row = (id: string) => fake.db.sm8_writes.find((w) => w.id === id)!;

  it("(F) touches only settled note rows, keeps updated_at, and never a file row's remote_message", async () => {
    const n = await clearSm8NoteText({ orgId: ORG, olderThanDays: 30 }, Date.now());
    expect(n).toBe(1);
    expect(row("settled")).toMatchObject({ note_text: null, remote_message: null, updated_at: LONG_AGO });
    expect(row("settled").text_cleared_at).toBeTruthy();
    expect(row("fresh").note_text).toBe("b");
    expect(row("waiting").note_text).toBe("c");
    expect(row("file").remote_message).toBe("kept");
    // at once, for a disconnect: every settled note row, however new
    await clearSm8NoteText({ orgId: ORG }, Date.now());
    expect(row("fresh").note_text).toBeNull();
    expect(row("waiting").note_text).toBe("c");
  });

  it("(F) the nightly clears a disconnected workspace's words, which the page load can't reach", async () => {
    fake.db.integration_connections = [];
    fake.db.sm8_writes.forEach((w) => (w.updated_at = new Date().toISOString()));
    const n = await clearDisconnectedSm8NoteText(Date.now());
    expect(n).toBe(2);
    expect(row("settled").note_text).toBeNull();
    expect(row("fresh").note_text).toBeNull();
    expect(row("waiting").note_text).toBe("c");
  });

  it("the page load clears only after a one-row read finds work", async () => {
    fake.db.sm8_writes = fake.db.sm8_writes.filter((w) => w.id !== "settled");
    freshenSm8AfterResponse(ORG);
    for (const fn of afters) await fn();
    expect(fake.on("sm8_writes").filter((s) => s.op === "update")).toHaveLength(0);
    afters.length = 0;
    fake.db.sm8_writes.push({ id: "old", org_id: ORG, tenant_id: "v", kind: "note", status: "cancelled", note_text: "d", updated_at: LONG_AGO });
    freshenSm8AfterResponse(ORG);
    for (const fn of afters) await fn();
    expect(row("old").note_text).toBeNull();
  });

  it("a disconnect clears every settled note row of the workspace", async () => {
    await disconnectSm8(ORG, Date.now());
    expect(row("settled").note_text).toBeNull();
    expect(row("fresh").note_text).toBeNull();
  });
});

describe("the journal", () => {
  it("(F) leaves out a note somebody took back, and reads as today on a database without the column", async () => {
    fake.db.workboard_notes = [
      { org_id: ORG, id: "a", author_id: "s1", status: "applied", removed_at: null, created_at: "2026-09-25T01:00:00Z", applied: {}, transcript: "kept" },
      { org_id: ORG, id: "b", author_id: "s1", status: "applied", removed_at: "2026-09-25T02:00:00Z", created_at: "2026-09-25T02:00:00Z", applied: {}, transcript: "taken back" },
    ];
    expect((await listJournal(ORG, "s1")).map((e) => e.id)).toEqual(["a"]);
    fake.missing.add("removed_at");
    fake.db.workboard_notes.forEach((n) => delete n.removed_at);
    expect(await listJournal(ORG, "s1")).toHaveLength(2);
  });
});
