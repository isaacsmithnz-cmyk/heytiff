/**
 * @jest-environment node
 */

/* Notes to ServiceM8 — the engine, end to end (two-way phase 2, PR A).

   The queue helpers (app/actions/sm8-note-queue) and the sender
   (sm8-writes' run, sm8-note-send) against an in-memory database that keeps
   the notes migration's own rules (fixtures/sm8-fake-db), with ServiceM8
   replaced at the request functions. What is held here:
   - a note goes AS THE PERSON who pressed it, checked again at send time;
   - a lost answer is read back before anything goes again, and a note a
     person removed in ServiceM8 is never posted again;
   - a take-back is final, never goes ahead of its note, and every race
     between a press and a take-back ends taken back;
   - only whoever pressed a note can press it again or take it back;
   - every request checks its account, the one after a renewal included. */

import { makeFakeDb } from "./fixtures/sm8-fake-db";

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
jest.mock("../sm8-write", () => ({
  postSm8Attachment: (...a: unknown[]) => postSm8Attachment(...a),
  readSm8Attachment: (...a: unknown[]) => readSm8Attachment(...a),
  postSm8Note: (...a: unknown[]) => postSm8Note(...a),
  updateSm8NoteCompleter: (...a: unknown[]) => updateSm8NoteCompleter(...a),
  deleteSm8Note: (...a: unknown[]) => deleteSm8Note(...a),
  readSm8Note: (...a: unknown[]) => readSm8Note(...a),
}));

const getSession = jest.fn();
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: (...a: unknown[]) => getSession(...a) } }));
/** null: a login with no staff card */
let whoIsSignedIn: string | null = "staff-isaac";
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => whoIsSignedIn) }));
jest.mock("next/server", () => ({ after: () => {} }));
jest.mock("@/lib/workboard/job-notes-query", () => ({
  staffDisplayNames: jest.fn(
    async () =>
      new Map([
        ["staff-isaac", "Isaac Smith"],
        ["staff-luke", "Luke Ingold"],
      ])
  ),
}));
const familyMediaSources = jest.fn(async () => [] as { remoteId: string; claimNumber: string | null }[]);
jest.mock("@/lib/workboard/all-jobs-query", () => ({ familyMediaSources: (...a: unknown[]) => familyMediaSources(...(a as [])) }));

import { sm8PressFromSession, type Sm8Press } from "../sm8-press";
import {
  enqueueAttachments,
  listRecentSm8Writes,
  readSm8WriteState,
  retryFailedSm8Writes,
  runSm8Writes,
  setSm8WriteKind,
  sm8QueueStuck,
} from "../sm8-writes";
import { NOTE_WORDS, noteState, type QueueRowIn } from "../sm8-note-plan";
import { WRITE_WORDS, sendHold, offersSend } from "../sm8-write-plan";
import { queueFlagChange, queueNoteCreate, queueNoteTakeBack } from "@/app/actions/sm8-note-queue";

const ORG = "org-1";
const TENANT = "vendor-1";
const JOB = "0f8c2b9e-1111-4a4a-8b8b-000000000001";
const ISAAC_SM8 = "5a1b2c3d-0000-4000-8000-00000000aaaa";
const LUKE_SM8 = "5a1b2c3d-0000-4000-8000-00000000bbbb";
const FLAG = "7e7e7e7e-0000-4000-8000-00000000f1a9";
const ACCESS = { accessToken: "token-1", tenantId: TENANT, grant: "g1", meter: TENANT };
const RENEWED = { accessToken: "token-2", tenantId: TENANT, grant: "g2", meter: TENANT };

let seq = 0;
const noteId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

const created = (status = 201, recordUuid: string | null = null) => ({
  status,
  outcome: status >= 200 && status < 300 ? { kind: "created", remoteUuid: recordUuid } : { kind: "unavailable", status },
  remote: null,
  recordUuid,
});
const answered = (status: number, outcome: Row) => ({ status, outcome, remote: null, recordUuid: null });
const found = (over: Row = {}) => ({
  ok: true,
  found: true,
  relatedUuid: JOB,
  active: true,
  flagged: false,
  completedBy: null,
  editDate: "2026-09-20 10:00:00",
  editBy: null,
  ...over,
});
const NOT_FOUND = { ok: true, found: false };

const writes = () => fake.db.sm8_writes as Row[];
const createOf = (id: string) => writes().find((w) => w.note_id === id && w.op === "create")!;
const deleteOf = (createId: string) => writes().find((w) => w.depends_on === createId && w.op === "delete");
const noteRow = (id: string) => (fake.db.workboard_notes as Row[]).find((n) => n.id === id)!;

function seedNote(over: Row = {}): string {
  const id = (over.id as string) ?? noteId();
  (fake.db.workboard_notes ??= []).push({
    id,
    org_id: ORG,
    target_kind: "job",
    target_id: JOB,
    status: "applied",
    author_id: "staff-isaac",
    transcript: "the filter is in the van",
    applied: { jobNotes: ["the filter is in the van"] },
    removed_at: null,
    sm8_refusal: null,
    reply_to_sm8_note_uuid: null,
    task_id: null,
    is_task_done: false,
    created_at: new Date().toISOString(),
    ...over,
  });
  return id;
}

async function pressAs(staff: string | null): Promise<Sm8Press> {
  whoIsSignedIn = staff;
  return (await sm8PressFromSession())!;
}

/** The line HeyTiff's row reads, as its sender sees it. */
async function lineOf(id: string, viewerIsSender = true) {
  const c = writes().find((w) => w.note_id === id && w.op === "create") as unknown as QueueRowIn | undefined;
  const tb = c ? ((writes().find((w) => w.depends_on === (c as unknown as Row).id) as unknown as QueueRowIn | undefined) ?? null) : null;
  const state = await readSm8WriteState(ORG);
  const n = noteRow(id);
  return noteState({
    row: { removed: !!n.removed_at, refusal: (n.sm8_refusal as never) ?? null },
    create: c ?? null,
    takeBack: tb,
    hold: sendHold(state, "note"),
    offered: offersSend(state, "note"),
    viewerIsSender,
    senderName: "Isaac Smith",
    sm8Name: "Isaac Smith",
  });
}

const run = () => runSm8Writes(ORG, "send");

beforeEach(() => {
  fake.reset();
  seq = 0;
  fake.db.integration_connections = [
    {
      org_id: ORG,
      provider: "servicem8",
      status: "connected",
      tenant_id: TENANT,
      tenants: [{ tenantId: TENANT, tenantName: "Acme Air", timezoneName: "Australia/Sydney" }],
      scopes: "vendor read_jobs manage_attachments publish_job_notes",
      write_mode: "live",
      paused_reason: null,
      paused_at: null,
      write_scope_refused: {},
      connected_at: "2026-09-01T00:00:00.000Z",
      write_kinds: ["attachment", "note"],
    },
  ];
  fake.db.integration_links = [
    { org_id: ORG, provider: "servicem8", kind: "staff", tenant_id: TENANT, staff_profile_id: "staff-isaac", remote_id: ISAAC_SM8, confirmed_remote_id: ISAAC_SM8, confirmed_answer: "yes" },
    { org_id: ORG, provider: "servicem8", kind: "staff", tenant_id: TENANT, staff_profile_id: "staff-luke", remote_id: LUKE_SM8, confirmed_remote_id: LUKE_SM8, confirmed_answer: "yes" },
  ];
  fake.db.sm8_staff = [
    { org_id: ORG, uuid: ISAAC_SM8, first: "Isaac", last: "Smith", active: 1 },
    { org_id: ORG, uuid: LUKE_SM8, first: "Luke", last: "Ingold", active: 1 },
  ];
  fake.db.sm8_jobs = [{ org_id: ORG, uuid: JOB, active: 1, generated_job_id: "2380" }];
  fake.db.sm8_writes = [];
  fake.db.workboard_notes = [];
  fake.db.documents = [];
  fake.db.sm8_job_notes = [];
  process.env.SM8_WRITES = "attachment,note";
  whoIsSignedIn = "staff-isaac";
  getSession.mockReset().mockResolvedValue({ orgId: ORG, user: { sub: "auth0|someone" } });
  sm8AccessResult.mockReset().mockResolvedValue({ ok: true, access: ACCESS });
  renewSm8Access.mockReset().mockResolvedValue({ ok: true, access: RENEWED });
  markSm8NeedsReauth.mockReset().mockResolvedValue(true);
  postSm8Attachment.mockReset().mockResolvedValue({ status: 200, outcome: { kind: "created", remoteUuid: null } });
  readSm8Attachment.mockReset();
  postSm8Note.mockReset().mockResolvedValue(created());
  updateSm8NoteCompleter.mockReset().mockResolvedValue(created(200));
  deleteSm8Note.mockReset().mockResolvedValue(created(200));
  readSm8Note.mockReset().mockResolvedValue(NOT_FOUND);
  familyMediaSources.mockReset().mockResolvedValue([]);
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  delete process.env.SM8_WRITES;
});

/* ── a note, sent ── */

describe("a note goes, as the person who pressed it", () => {
  it("is queued from HeyTiff's own row and sent as its presser, with nothing but its four fields", async () => {
    const id = seedNote();
    const q = await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    expect(q).toMatchObject({ ok: true, already: false });
    const c = createOf(id);
    expect(c).toMatchObject({
      kind: "note",
      op: "create",
      subject: `jobnote:${id}`,
      sm8_job_uuid: JOB,
      payload: { name: "Note" },
      note_text: "the filter is in the van",
      requested_by: "staff-isaac",
      status: "queued",
    });
    await run();
    expect(postSm8Note).toHaveBeenCalledTimes(1);
    expect(postSm8Note.mock.calls[0][1]).toEqual({
      relatedUuid: JOB,
      uuid: c.remote_uuid,
      text: "the filter is in the van",
      asStaffUuid: ISAAC_SM8,
    });
    expect(createOf(id)).toMatchObject({ status: "sent", as_staff_uuid: ISAAC_SM8, maybe_landed: false });
    expect((await lineOf(id)).key).toBe("line.sent");
  });

  it("(F) goes as the CURRENT link, re-read at send time: a relink and a confirm after the press", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    const NEW = "5a1b2c3d-0000-4000-8000-00000000cccc";
    fake.db.sm8_staff.push({ org_id: ORG, uuid: NEW, first: "Isaac", last: "Smith", active: 1 });
    Object.assign(fake.db.integration_links[0], { remote_id: NEW, confirmed_remote_id: NEW, confirmed_answer: "yes" });
    await run();
    expect(postSm8Note.mock.calls[0][1].asStaffUuid).toBe(NEW);
    expect(createOf(id).as_staff_uuid).toBe(NEW);
  });

  it("the sender at send time: unlinked, unconfirmed, denied or inactive fail with their words, and no request", async () => {
    const cases: [Row, string][] = [
      [{ remove: true }, "Isaac Smith isn't linked to ServiceM8."],
      [{ confirmed_answer: null, confirmed_remote_id: null }, "Isaac Smith hasn't confirmed their ServiceM8 link."],
      [{ confirmed_answer: "no" }, "Isaac Smith said the ServiceM8 link isn't them."],
    ];
    for (const [change, words] of cases) {
      fake.reset();
      await setupAgain();
      const id = seedNote();
      await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
      if (change.remove) fake.db.integration_links.splice(0, 1);
      else Object.assign(fake.db.integration_links[0], change);
      await run();
      expect(createOf(id)).toMatchObject({ status: "failed", last_error: words });
    }
    fake.reset();
    await setupAgain();
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    fake.db.sm8_staff[0].active = 0;
    await run();
    expect(createOf(id)).toMatchObject({ status: "failed", last_error: "Isaac Smith isn't active in ServiceM8." });
    expect(postSm8Note).not.toHaveBeenCalled();
  });

  it("a link that can't be read waits a minute, handed back; nothing goes as unknown", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    fake.failing.add("integration_links");
    await run();
    expect(createOf(id)).toMatchObject({
      status: "queued",
      attempts: 0,
      last_error: "HeyTiff couldn't check Isaac Smith's ServiceM8 link.",
    });
    expect(postSm8Note).not.toHaveBeenCalled();
  });

  it("(F) a malformed link fails the row for good, never falls into the catch, and a press stores bad_link", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    Object.assign(fake.db.integration_links[0], { remote_id: "not-a-uuid", confirmed_remote_id: "not-a-uuid" });
    await run();
    expect(createOf(id)).toMatchObject({ status: "failed", last_error: "Isaac Smith's ServiceM8 link is broken. An owner can fix it in Integrations, ServiceM8.", maybe_landed: false });
    await run();
    expect(createOf(id).status).toBe("failed");
    expect(postSm8Note).not.toHaveBeenCalled();
    // a press on a fresh note stores the code
    const other = seedNote();
    expect(await queueNoteCreate(await pressAs("staff-isaac"), { noteId: other })).toEqual({ ok: false, refusal: "bad_link" });
    expect(noteRow(other).sm8_refusal).toBe("bad_link");
  });

  it("a job made inactive after the press is cancelled; a create whose words were cleared is cancelled", async () => {
    const a = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: a });
    fake.db.sm8_jobs[0].active = 0;
    await run();
    expect(createOf(a)).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.jobGone });
    fake.db.sm8_jobs[0].active = 1;
    const b = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: b });
    createOf(b).note_text = null;
    await run();
    expect(createOf(b)).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.noteWordsCleared });
    expect(postSm8Note).not.toHaveBeenCalled();
  });

  it("a trial run checks the person and the job, and sends nothing", async () => {
    fake.db.integration_connections[0].write_mode = "trial";
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    await run();
    expect(createOf(id)).toMatchObject({ status: "trial", maybe_landed: false });
    expect(postSm8Note).not.toHaveBeenCalled();
    expect(readSm8Note).not.toHaveBeenCalled();
    expect((await lineOf(id))).toMatchObject({ key: "line.trial", acts: ["send_again", "undo"] });
  });
});

async function setupAgain() {
  /* the beforeEach, for a loop that resets the database mid-test */
  fake.db.integration_connections = [
    {
      org_id: ORG,
      provider: "servicem8",
      status: "connected",
      tenant_id: TENANT,
      tenants: [],
      scopes: "vendor manage_attachments publish_job_notes",
      write_mode: "live",
      write_scope_refused: {},
      connected_at: "2026-09-01T00:00:00.000Z",
      write_kinds: ["attachment", "note"],
    },
  ];
  fake.db.integration_links = [
    { org_id: ORG, provider: "servicem8", kind: "staff", tenant_id: TENANT, staff_profile_id: "staff-isaac", remote_id: ISAAC_SM8, confirmed_remote_id: ISAAC_SM8, confirmed_answer: "yes" },
  ];
  fake.db.sm8_staff = [{ org_id: ORG, uuid: ISAAC_SM8, first: "Isaac", last: "Smith", active: 1 }];
  fake.db.sm8_jobs = [{ org_id: ORG, uuid: JOB, active: 1 }];
  fake.db.sm8_writes = [];
  fake.db.workboard_notes = [];
}

/* ── a lost answer ── */

describe("a lost answer is read back before anything goes again", () => {
  it("(F) a create whose answer was lost stays queued, may have landed; the next run reads it back, finds it, and posts nothing", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    postSm8Note.mockResolvedValueOnce({ status: null, outcome: { kind: "unavailable", status: null }, remote: null, recordUuid: null });
    await run();
    const c = createOf(id);
    expect(c).toMatchObject({ status: "queued", maybe_landed: true });
    c.next_attempt_at = new Date(Date.now() - 1000).toISOString();
    readSm8Note.mockResolvedValueOnce(found());
    await run();
    expect(postSm8Note).toHaveBeenCalledTimes(1);
    expect(readSm8Note.mock.calls[0][1]).toBe(c.remote_uuid);
    // the read-back is the account asking: never impersonated (it takes no staff uuid)
    expect(readSm8Note.mock.calls[0]).toHaveLength(2);
    expect(createOf(id)).toMatchObject({ status: "sent", maybe_landed: false });
  });

  it("(F) own uuid not found: can't tell, so nothing is posted — unsure; Send again reads it back and posts under a fresh uuid", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    Object.assign(createOf(id), { maybe_landed: true });
    await run();
    expect(postSm8Note).not.toHaveBeenCalled();
    expect(createOf(id)).toMatchObject({ status: "failed", last_error: NOTE_WORDS.row.noteUnsure, maybe_landed: true });
    expect((await lineOf(id))).toMatchObject({ key: "line.unsure", acts: ["send_again", "undo"] });

    const old = createOf(id).remote_uuid as string;
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    expect(createOf(id)).toMatchObject({ status: "queued", verify_uuids: [old], maybe_landed: false });
    expect(createOf(id).remote_uuid).not.toBe(old);
    await run();
    expect(readSm8Note.mock.calls.at(-1)?.[1]).toBe(old);
    expect(postSm8Note).toHaveBeenCalledTimes(1);
    expect(postSm8Note.mock.calls[0][1].uuid).not.toBe(old);
    expect(createOf(id)).toMatchObject({ status: "sent", verify_uuids: [] });
    expect(createOf(id).replaced_uuids).toContain(old);
  });

  it("(F) a lost-answer create then cancelled by Notes Off reads unsure, never Not sent", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    Object.assign(createOf(id), { maybe_landed: true });
    await setSm8WriteKind(ORG, "note", false);
    expect(createOf(id)).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.notesSwitchedOff });
    expect((await lineOf(id)).key).toBe("line.unsure");
  });

  it("a read-back that fails posts nothing and keeps the list", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    Object.assign(createOf(id), { verify_uuids: ["5a1b2c3d-0000-4000-8000-00000000dddd"] });
    readSm8Note.mockResolvedValueOnce({ ok: false });
    await run();
    expect(postSm8Note).not.toHaveBeenCalled();
    expect(createOf(id)).toMatchObject({ status: "queued", verify_uuids: ["5a1b2c3d-0000-4000-8000-00000000dddd"] });
  });

  it("(F) a uuid of ours found INACTIVE: a person removed it — cancelled, never posted, and never queued again", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    Object.assign(createOf(id), { maybe_landed: true });
    readSm8Note.mockResolvedValueOnce(found({ active: false }));
    await run();
    expect(createOf(id)).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.noteGone });
    expect(postSm8Note).not.toHaveBeenCalled();
    expect(await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id })).toEqual({ ok: false, refusal: "removed_there" });
    expect((await lineOf(id))).toMatchObject({ key: "line.removedThere", acts: ["undo"] });
  });

  it("(F) a 409 whose uuid reads back inactive is cancelled, never posted again; not found fails as refused", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    postSm8Note.mockResolvedValueOnce(answered(409, { kind: "exists" }));
    readSm8Note.mockResolvedValueOnce(found({ active: false }));
    await run();
    expect(createOf(id)).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.noteGone });
    const other = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: other });
    postSm8Note.mockResolvedValueOnce(answered(400, { kind: "rejected", status: 400 }));
    readSm8Note.mockResolvedValueOnce(NOT_FOUND);
    await run();
    expect(createOf(other)).toMatchObject({ status: "failed", last_error: NOTE_WORDS.row.noteRefused });
  });

  it("(F) a Done pressed more than a day ago fails doneStale — after the read-back, so one found landed is sent", async () => {
    const id = seedNote({ is_task_done: true, task_id: "11111111-0000-4000-8000-000000000001", applied: { jobNotes: ["Done."], sm8Text: "Done." } });
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    expect(createOf(id).subject).toBe(`task:11111111-0000-4000-8000-000000000001:done:${id}`);
    createOf(id).pressed_at = new Date(Date.now() - 86_400_000 - 60_000).toISOString();
    await run();
    expect(createOf(id)).toMatchObject({ status: "failed", last_error: NOTE_WORDS.row.doneStale });
    expect(postSm8Note).not.toHaveBeenCalled();

    const landed = seedNote({ is_task_done: true, applied: { sm8Text: "Done." } });
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: landed });
    Object.assign(createOf(landed), { maybe_landed: true, pressed_at: new Date(Date.now() - 2 * 86_400_000).toISOString() });
    readSm8Note.mockResolvedValueOnce(found());
    await run();
    expect(createOf(landed).status).toBe("sent");
  });

  it("(F) a create with three uuids to check lets go, in notes' words, before a POST could outlive the lease", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    const three = ["a", "b", "c"].map((x) => `5a1b2c3d-0000-4000-8000-00000000000${x}`);
    /* three old uuids a person pressed past, each read taking half a
       minute: the POST would start past NOTE_SEND_BY_MS */
    Object.assign(createOf(id), { maybe_landed: false, verify_uuids: three, free_retries: 2 });
    let now = Date.now();
    readSm8Note.mockImplementation(async () => {
      now += 30_000; // each read takes half a minute
      return NOT_FOUND;
    });
    await runSm8Writes(ORG, "send", { clock: () => now });
    expect(postSm8Note).not.toHaveBeenCalled();
    expect(createOf(id)).toMatchObject({ status: "failed", last_error: NOTE_WORDS.row.noteTooSlow });
  });
});

/* ── Undo ── */

describe("a take-back never goes ahead of its note", () => {
  it("(F) Undo of a queued create that may have landed cancels it and queues a delete of what may be there; no POST ever goes", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    const c = createOf(id);
    Object.assign(c, { maybe_landed: true, verify_uuids: ["5a1b2c3d-0000-4000-8000-00000000000e"] });
    const t = await queueNoteTakeBack(await pressAs("staff-isaac"), { noteId: id });
    expect(t).toEqual({ ok: true, plan: "deleting", removed: true });
    expect(createOf(id)).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.takenBackBeforeSent, maybe_landed: true });
    expect(createOf(id).taken_back_at).toBeTruthy();
    expect(noteRow(id).removed_at).toBeTruthy();
    const d = deleteOf(c.id as string)!;
    expect(d).toMatchObject({ kind: "note", op: "delete", subject: `undo:${c.id}`, note_id: id, payload: { name: "Note taken out of ServiceM8" } });
    await run();
    expect(postSm8Note).not.toHaveBeenCalled();
    expect(deleteSm8Note.mock.calls.map((x) => x[1])).toEqual([c.remote_uuid, "5a1b2c3d-0000-4000-8000-00000000000e"]);
    expect(deleteSm8Note.mock.calls[0][2]).toBe(ISAAC_SM8);
    expect(deleteOf(c.id as string)).toMatchObject({ status: "sent", target_uuid: c.remote_uuid });
    // the create keeps its uuid: it hides the twin while the sync catches up
    expect(createOf(id).remote_uuid).toBe(c.remote_uuid);
    expect((await lineOf(id)).key).toBeNull();
  });

  it("(F) Undo lands between the read and the claim: the claim misses, and the next run cancels it without claiming", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    fake.before.sm8_writes = (s) => {
      if (s.op === "update" && s.patch?.status === "sending") createOf(id).taken_back_at = new Date().toISOString();
    };
    await run();
    fake.before.sm8_writes = undefined;
    expect(postSm8Note).not.toHaveBeenCalled();
    expect(createOf(id)).toMatchObject({ status: "queued", attempts: 0, maybe_landed: false });
    await run();
    expect(createOf(id)).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.takenBackBeforeSent, maybe_landed: false, attempts: 0 });
    expect(postSm8Note).not.toHaveBeenCalled();
  });

  it("(F) Undo lands after the claim, before the POST: the check inside the attempt stops it, and maybe_landed goes back", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    readSm8Note.mockImplementation(async () => NOT_FOUND);
    fake.before.sm8_writes = (s) => {
      /* the check's own read: an Undo lands just before it */
      if (s.op === "select" && s.columns?.includes("workboard_notes!")) createOf(id).taken_back_at = new Date().toISOString();
    };
    await run();
    fake.before.sm8_writes = undefined;
    expect(postSm8Note).not.toHaveBeenCalled();
    expect(createOf(id)).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.takenBackBeforeSent, maybe_landed: false });
  });

  it("(F) a 401, then an Undo during the renewal: the second attempt checks again and never POSTs", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    postSm8Note.mockResolvedValueOnce(answered(401, { kind: "unauthorized" }));
    readSm8Note.mockResolvedValue({ ok: false, unauthorized: true }); // confirmDead: the grant is refused too
    renewSm8Access.mockImplementation(async () => {
      createOf(id).taken_back_at = new Date().toISOString();
      return { ok: true, access: RENEWED };
    });
    await run();
    expect(postSm8Note).toHaveBeenCalledTimes(1);
    expect(createOf(id)).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.takenBackBeforeSent, maybe_landed: false });
  });

  it("(F) the check whose read fails after a renewal: no second POST, and the row goes back to the queue", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    postSm8Note.mockResolvedValueOnce(answered(401, { kind: "unauthorized" }));
    readSm8Note.mockResolvedValue({ ok: false, unauthorized: true });
    let checks = 0;
    fake.before.sm8_writes = (s) => {
      if (s.op === "select" && s.columns?.includes("workboard_notes!") && ++checks === 2) fake.failing.add("sm8_writes");
    };
    renewSm8Access.mockResolvedValue({ ok: true, access: RENEWED });
    await run().catch(() => null);
    fake.failing.delete("sm8_writes");
    fake.before.sm8_writes = undefined;
    expect(postSm8Note).toHaveBeenCalledTimes(1);
  });

  it("(F) a create whose note was removed while it wasn't closed yet: the run closes and cancels it without claiming", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    noteRow(id).removed_at = new Date().toISOString();
    await run();
    expect(postSm8Note).not.toHaveBeenCalled();
    expect(createOf(id)).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.takenBackBeforeSent, attempts: 0 });
    expect(createOf(id).taken_back_at).toBeTruthy();
  });

  it("(F) ...and a sender already holding it reads removed_at inside the attempt, closes it, and posts nothing", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    fake.before.sm8_writes = (s) => {
      if (s.op === "select" && s.columns?.includes("workboard_notes!")) noteRow(id).removed_at = new Date().toISOString();
    };
    await run();
    fake.before.sm8_writes = undefined;
    expect(postSm8Note).not.toHaveBeenCalled();
    expect(createOf(id)).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.takenBackBeforeSent });
    expect(createOf(id).taken_back_at).toBeTruthy();
  });

  it("(F) Undo after the POST went and its answer was lost: the delete doesn't wait out the retry — it cancels and deletes", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    postSm8Note.mockResolvedValueOnce({ status: 503, outcome: { kind: "unavailable", status: 503 }, remote: null, recordUuid: null });
    await run();
    const c = createOf(id);
    expect(c).toMatchObject({ status: "queued", maybe_landed: true });
    expect(Date.parse(c.next_attempt_at as string)).toBeGreaterThan(Date.now());
    await queueNoteTakeBack(await pressAs("staff-isaac"), { noteId: id });
    await run();
    expect(postSm8Note).toHaveBeenCalledTimes(1);
    expect(deleteSm8Note.mock.calls.map((x) => x[1])).toEqual([c.remote_uuid]);
    expect(createOf(id).status).toBe("cancelled");
  });

  it("a delete whose create is sending under a live claim waits, and never goes first", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    Object.assign(createOf(id), { status: "sending", lease_until: new Date(Date.now() + 90_000).toISOString(), maybe_landed: true, claim_id: "x" });
    const t = await queueNoteTakeBack(await pressAs("staff-isaac"), { noteId: id });
    expect(t).toEqual({ ok: true, plan: "deleting", removed: true });
    const d = deleteOf(createOf(id).id as string)!;
    await run();
    expect(deleteSm8Note).not.toHaveBeenCalled();
    expect(d.status).toBe("queued");
    expect(Date.parse(d.next_attempt_at as string)).toBeGreaterThanOrEqual(Date.now() + 29_000);
    expect((await lineOf(id)).key).toBe("line.takingOut");
  });

  it("(F) a delete whose create never landed ends with nothing to take back, with no request", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    Object.assign(createOf(id), { status: "sending", lease_until: new Date(Date.now() + 90_000).toISOString(), maybe_landed: true, claim_id: "x" });
    await queueNoteTakeBack(await pressAs("staff-isaac"), { noteId: id });
    // its sender's check stopped the POST: nothing landed
    Object.assign(createOf(id), { status: "cancelled", lease_until: null, maybe_landed: false });
    const d = deleteOf(createOf(id).id as string)!;
    d.next_attempt_at = new Date(Date.now() - 1000).toISOString();
    await run();
    expect(deleteSm8Note).not.toHaveBeenCalled();
    expect(d).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.nothingToTakeBack });
    expect((await lineOf(id)).key).toBeNull();
  });

  it("(F) a delete queued after an account switch is cancelled otherAccount, never counted as gone, and reads Still in with Try again", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    await run();
    const c = createOf(id);
    // the account changed, and the owner connected another one
    c.tenant_id = "vendor-old";
    await queueNoteTakeBack(await pressAs("staff-isaac"), { noteId: id });
    await run();
    expect(deleteSm8Note).not.toHaveBeenCalled();
    expect(deleteOf(c.id as string)).toMatchObject({ status: "cancelled", last_error: WRITE_WORDS.otherAccount });
    expect(await lineOf(id)).toMatchObject({ key: "line.stillIn", text: `Still in ServiceM8. ${WRITE_WORDS.otherAccount}`, acts: ["take_out_again"] });
  });

  it("(F) a delete whose presser isn't its create's (written by hand) is cancelled notSender, with no request", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    await run();
    const c = createOf(id);
    fake.db.sm8_writes.push({
      id: "hand-1",
      org_id: ORG,
      tenant_id: TENANT,
      kind: "note",
      op: "delete",
      sm8_job_uuid: JOB,
      subject: `undo:${c.id}`,
      payload: { name: "x" },
      remote_uuid: "5a1b2c3d-0000-4000-8000-000000000999",
      status: "queued",
      attempts: 0,
      next_attempt_at: new Date(Date.now() - 1000).toISOString(),
      created_at: new Date().toISOString(),
      note_id: id,
      depends_on: c.id,
      requested_by: "staff-luke",
      lease_until: null,
      maybe_landed: false,
      verify_uuids: [],
      replaced_uuids: [],
      free_retries: 0,
    });
    await run();
    expect(deleteSm8Note).not.toHaveBeenCalled();
    expect(fake.db.sm8_writes.find((w) => w.id === "hand-1")).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.notSender });
  });

  it("(F) a take-back whose presser has since been unlinked fails at send time, and its line offers Try again", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    await run();
    fake.db.integration_links.splice(0, 1);
    await queueNoteTakeBack(await pressAs("staff-isaac"), { noteId: id });
    await run();
    expect(deleteSm8Note).not.toHaveBeenCalled();
    expect(await lineOf(id)).toMatchObject({ key: "line.stillIn", text: "Still in ServiceM8. Isaac Smith isn't linked to ServiceM8.", acts: ["take_out_again"] });
  });

  it("(F, final check) a 401 whose renewal hands back another account's token makes no second request; a take-back meeting it is cancelled otherAccount", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    await run();
    await queueNoteTakeBack(await pressAs("staff-isaac"), { noteId: id });
    deleteSm8Note.mockResolvedValueOnce(answered(401, { kind: "unauthorized" }));
    readSm8Note.mockResolvedValue({ ok: false, unauthorized: true });
    renewSm8Access.mockResolvedValue({ ok: true, access: { ...RENEWED, tenantId: "vendor-other" } });
    await run();
    expect(deleteSm8Note).toHaveBeenCalledTimes(1);
    expect(deleteOf(createOf(id).id as string)).toMatchObject({ status: "cancelled", last_error: WRITE_WORDS.otherAccount });
    expect((await lineOf(id)).key).toBe("line.stillIn");
  });

  it("(F) a take-back in a trial run ends as a trial and reads Still in; once On, Try again deletes it", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    await run();
    fake.db.integration_connections[0].write_mode = "trial";
    await queueNoteTakeBack(await pressAs("staff-isaac"), { noteId: id });
    await run();
    const c = createOf(id);
    expect(deleteOf(c.id as string)?.status).toBe("trial");
    expect(await lineOf(id)).toMatchObject({ text: "Still in ServiceM8. Sending is a trial run.", acts: ["take_out_again"] });
    fake.db.integration_connections[0].write_mode = "live";
    const again = await queueNoteTakeBack(await pressAs("staff-isaac"), { noteId: id });
    expect(again).toEqual({ ok: true, plan: "deleting", removed: true });
    expect(writes().filter((w) => w.op === "delete")).toHaveLength(1);
    await run();
    expect(deleteSm8Note).toHaveBeenCalledTimes(1);
    expect((await lineOf(id)).key).toBeNull();
  });

  it("(F) a take-back of a create a trial run held, nothing of it sent, settles it and ends nothingToTakeBack — never trial", async () => {
    fake.db.integration_connections[0].write_mode = "trial";
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    await run();
    expect(createOf(id).status).toBe("trial");
    const t = await queueNoteTakeBack(await pressAs("staff-isaac"), { noteId: id });
    expect(t).toEqual({ ok: true, plan: "cancelled", removed: true });
    expect(deleteOf(createOf(id).id as string)).toBeUndefined();
    expect((await lineOf(id)).key).toBeNull();
  });
});

/* ── who may press ── */

describe("only whoever pressed a note can press it again or take it back", () => {
  it("(F) anyone else gets not_yours on every path, and no delete row is inserted or pressed again", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    await run();
    const luke = await pressAs("staff-luke");
    // a live row
    expect(await queueNoteTakeBack(luke, { noteId: id })).toEqual({ ok: false, refusal: "not_yours", removed: false });
    expect(noteRow(id).removed_at).toBeNull();
    // a removed row whose take-back failed
    deleteSm8Note.mockResolvedValueOnce(answered(422, { kind: "rejected", status: 422 }));
    await queueNoteTakeBack(await pressAs("staff-isaac"), { noteId: id });
    await run();
    expect(deleteOf(createOf(id).id as string)?.status).toBe("failed");
    const before = JSON.stringify(writes());
    expect(await queueNoteTakeBack(await pressAs("staff-luke"), { noteId: id })).toEqual({ ok: false, refusal: "not_yours", removed: false });
    expect(JSON.stringify(writes())).toBe(before);
    // a note with no create: only its author
    const other = seedNote();
    expect(await queueNoteTakeBack(await pressAs("staff-luke"), { noteId: other })).toEqual({ ok: false, refusal: "not_yours", removed: false });
    expect(await queueNoteCreate(await pressAs("staff-luke"), { noteId: other })).toEqual({ ok: false, refusal: "not_yours" });
  });

  it("(F) a note row pressed by another card is left alone in `others`, and no note patch names the presser", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    createOf(id).status = "failed";
    // the fake database refuses (as the migration's trigger does) any update of a note row naming requested_by
    const again = await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    expect(again).toMatchObject({ ok: true });
    expect(createOf(id).status).toBe("queued");
    const patches = fake.on("sm8_writes").filter((s) => s.op === "update" && s.patch);
    expect(patches.some((s) => "requested_by" in s.patch! || "requested_by_user" in s.patch!)).toBe(false);
  });

  it("(F) both re-press patches put the words back after the 30-day clear, and neither touches a create taken back", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    Object.assign(createOf(id), { status: "failed", note_text: null });
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    expect(createOf(id)).toMatchObject({ status: "queued", note_text: "the filter is in the van", note_id: id });
    Object.assign(createOf(id), { note_text: null });
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    expect(createOf(id).note_text).toBe("the filter is in the van");
    await run();
    expect(postSm8Note).toHaveBeenCalledTimes(1);
  });

  it("(F) a take-back never deletes HeyTiff's row, and a press after it answers no_note", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    await queueNoteTakeBack(await pressAs("staff-isaac"), { noteId: id });
    expect(noteRow(id)).toBeDefined();
    expect(noteRow(id).removed_at).toBeTruthy();
    expect(createOf(id).note_id).toBe(id);
    expect(await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id })).toEqual({ ok: false, refusal: "no_note" });
  });

  it("(F) an enqueue racing the Undo misses on taken_back_at and answers no_note, not already", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    createOf(id).status = "failed";
    fake.before.sm8_writes = (s) => {
      if (s.op === "update" && s.patch?.status === "queued") createOf(id).taken_back_at = new Date().toISOString();
    };
    const r = await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    fake.before.sm8_writes = undefined;
    expect(r).toEqual({ ok: false, refusal: "no_note" });
    expect(createOf(id).status).toBe("failed");
  });

  it("(F) a take-back racing a first Send: the Send reads the tombstone after queueing and takes its own create back", async () => {
    const id = seedNote();
    /* the take-back reads no create, the Send inserts one, then the take-back
       sets removed_at — before the Send reads the note again */
    fake.before.workboard_notes = (s) => {
      if (s.op === "select" && fake.db.sm8_writes.length > 0 && !noteRow(id).removed_at) noteRow(id).removed_at = new Date().toISOString();
    };
    const r = await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    fake.before.workboard_notes = undefined;
    expect(r).toEqual({ ok: false, refusal: "no_note" });
    expect(createOf(id)).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.takenBackBeforeSent });
    expect(createOf(id).taken_back_at).toBeTruthy();
    await run();
    expect(postSm8Note).not.toHaveBeenCalled();
  });

  it("(F) ...and the other order: the take-back reads the create again after its tombstone and stops it", async () => {
    const id = seedNote();
    let inserted = false;
    fake.before.workboard_notes = (s) => {
      /* the take-back's first read of the create found none; a Send's
         create lands as it sets the tombstone, before its second read */
      if (s.op === "update" && s.patch && "removed_at" in s.patch && !inserted) {
        inserted = true;
        fake.db.sm8_writes.push({
          id: "raced",
          org_id: ORG,
          tenant_id: TENANT,
          kind: "note",
          op: "create",
          sm8_job_uuid: JOB,
          subject: `jobnote:${id}`,
          dedupe_key: `note:${JOB}:jobnote:${id}`,
          payload: { name: "Note" },
          remote_uuid: "5a1b2c3d-0000-4000-8000-000000000777",
          status: "queued",
          attempts: 0,
          next_attempt_at: new Date(Date.now() - 1000).toISOString(),
          created_at: new Date().toISOString(),
          note_id: id,
          note_text: "x",
          requested_by: "staff-isaac",
          lease_until: null,
          maybe_landed: false,
          verify_uuids: [],
          replaced_uuids: [],
          taken_back_at: null,
          free_retries: 0,
        });
      }
    };
    const t = await queueNoteTakeBack(await pressAs("staff-isaac"), { noteId: id });
    fake.before.workboard_notes = undefined;
    expect(inserted).toBe(true);
    expect(t).toEqual({ ok: true, plan: "cancelled", removed: true });
    expect(createOf(id)).toMatchObject({ status: "cancelled" });
    expect(createOf(id).taken_back_at).toBeTruthy();
    await run();
    expect(postSm8Note).not.toHaveBeenCalled();
  });

  it("(F) a take-back needs no ready sender: an unconfirmed presser's queued, maybe-landed create is stopped and its delete queued", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    Object.assign(createOf(id), { maybe_landed: true });
    Object.assign(fake.db.integration_links[0], { confirmed_answer: null, confirmed_remote_id: null });
    const t = await queueNoteTakeBack(await pressAs("staff-isaac"), { noteId: id });
    expect(t).toEqual({ ok: true, plan: "deleting", removed: true });
    expect(createOf(id).status).toBe("cancelled");
    expect(deleteOf(createOf(id).id as string)?.status).toBe("queued");
  });

  it("a double Undo makes one delete row", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    await run();
    await queueNoteTakeBack(await pressAs("staff-isaac"), { noteId: id });
    const twice = await queueNoteTakeBack(await pressAs("staff-isaac"), { noteId: id });
    expect(twice).toEqual({ ok: true, plan: "already", removed: true });
    expect(writes().filter((w) => w.op === "delete")).toHaveLength(1);
  });

  it("(F) a login with no staff card is nobody's presser: a note whose author is gone can't be taken back or sent by it, and nothing is read or kept", async () => {
    /* author_id is null for a note whose author's card was deleted (the key
       is ON DELETE SET NULL), and a cardless press's staffId is null too */
    const id = seedNote({ author_id: null });
    const cardless = await pressAs(null);
    expect(cardless.staffId).toBeNull();
    fake.log.length = 0;
    expect(await queueNoteTakeBack(cardless, { noteId: id })).toEqual({ ok: false, refusal: "not_yours", removed: false });
    expect(await queueNoteCreate(cardless, { noteId: id })).toEqual({ ok: false, refusal: "no_card" });
    expect(await queueFlagChange(cardless, { noteUuid: FLAG, done: true, seenEditDate: null, pressId: noteId() })).toEqual({
      ok: false,
      refusal: "no_card",
    });
    expect(await queueFlagChange(cardless, { noteUuid: FLAG, done: false, pressId: noteId() })).toEqual({ ok: false, refusal: "not_yours" });
    expect(noteRow(id)).toMatchObject({ removed_at: null, sm8_refusal: null });
    expect(writes()).toHaveLength(0);
    expect(fake.log).toHaveLength(0);
  });

  /** A create written by hand, as a race (or a branch) would leave one. */
  const plantCreate = (id: string, over: Row = {}): Row => ({
    id: `planted-${id}`,
    org_id: ORG,
    tenant_id: TENANT,
    kind: "note",
    op: "create",
    sm8_job_uuid: JOB,
    subject: `jobnote:${id}`,
    dedupe_key: `note:${JOB}:jobnote:${id}`,
    payload: { name: "Note" },
    remote_uuid: "5a1b2c3d-0000-4000-8000-000000000888",
    status: "queued",
    attempts: 0,
    next_attempt_at: new Date(Date.now() - 1000).toISOString(),
    created_at: new Date().toISOString(),
    note_id: id,
    note_text: "x",
    requested_by: "staff-isaac",
    lease_until: null,
    maybe_landed: false,
    verify_uuids: [],
    replaced_uuids: [],
    taken_back_at: null,
    free_retries: 0,
    ...over,
  });

  it("(F) a create somebody else queued, found by the take-back's second read, is left alone: not closed, not cancelled, nothing deleted", async () => {
    const id = seedNote();
    let planted = false;
    fake.before.workboard_notes = (s) => {
      /* the take-back's first read of the create found none; one that isn't
         this presser's lands as it sets the tombstone */
      if (s.op === "update" && s.patch && "removed_at" in s.patch && !planted) {
        planted = true;
        fake.db.sm8_writes.push(plantCreate(id, { requested_by: "staff-luke", status: "sent" }));
      }
    };
    const t = await queueNoteTakeBack(await pressAs("staff-isaac"), { noteId: id });
    fake.before.workboard_notes = undefined;
    expect(planted).toBe(true);
    expect(t).toEqual({ ok: true, plan: "nothing", removed: true });
    expect(noteRow(id).removed_at).toBeTruthy();
    expect(createOf(id)).toMatchObject({ status: "sent", taken_back_at: null, requested_by: "staff-luke" });
    expect(writes().filter((w) => w.op === "delete")).toHaveLength(0);
  });

  it("(F) ...and a Send that meets somebody else's create and a take-back leaves that create alone too", async () => {
    const id = seedNote();
    fake.before.sm8_writes = (s) => {
      /* between this press's read of the create and its insert: another
         person's create lands, and a take-back tombstones the note */
      if (s.op === "upsert" && !writes().some((w) => w.note_id === id)) {
        fake.db.sm8_writes.push(plantCreate(id, { requested_by: "staff-luke", status: "sent" }));
        noteRow(id).removed_at = new Date().toISOString();
      }
    };
    const r = await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    fake.before.sm8_writes = undefined;
    expect(r).toEqual({ ok: false, refusal: "no_note" });
    expect(createOf(id)).toMatchObject({ status: "sent", taken_back_at: null, requested_by: "staff-luke" });
    expect(writes().filter((w) => w.op === "delete")).toHaveLength(0);
  });

  it("(F) a note deleted while its first create goes in answers no_note, and keeps nothing on a row that isn't there", async () => {
    const id = seedNote();
    fake.before.sm8_writes = (s) => {
      /* a Remove of the plain entry lands just before the insert, which then
         fails the note_id key (23503) */
      if (s.op === "upsert") fake.db.workboard_notes = fake.db.workboard_notes.filter((n) => n.id !== id);
    };
    const r = await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    fake.before.sm8_writes = undefined;
    expect(r).toEqual({ ok: false, refusal: "no_note" });
    expect(writes()).toHaveLength(0);
    expect(fake.on("workboard_notes").filter((s) => s.op === "update")).toHaveLength(0);
  });

  it("(F) queueDelete reads who off the create as it now stands: one whose presser was changed by hand under the take-back queues no delete", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    await run();
    expect(createOf(id).status).toBe("sent");
    /* the migration's trigger keeps a note row's presser fixed; this is a row
       changed by hand (a branch without it), as the take-back closes it —
       after the take-back's own check, before queueDelete's */
    fake.before.sm8_writes = (s) => {
      if (s.op === "update" && s.patch && "taken_back_at" in s.patch && !("status" in s.patch)) createOf(id).requested_by = "staff-luke";
    };
    const t = await queueNoteTakeBack(await pressAs("staff-isaac"), { noteId: id });
    fake.before.sm8_writes = undefined;
    expect(createOf(id).requested_by).toBe("staff-luke");
    expect(t).toEqual({ ok: false, refusal: "unqueued", removed: true });
    expect(writes().filter((w) => w.op === "delete")).toHaveLength(0);
  });
});

/* ── record first, and refusals ── */

describe("record first", () => {
  it("(F) unreadable settings store unreadable — never answered as not offered", async () => {
    const id = seedNote();
    fake.missing.add("paused_reason"); // a settings read that fails
    fake.failing.add("integration_connections");
    expect(await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id })).toEqual({ ok: false, refusal: "unreadable" });
    expect(noteRow(id).sm8_refusal).toBe("unreadable");
  });

  it("not offered stores nothing, and clears a refusal already kept", async () => {
    const id = seedNote({ sm8_refusal: "unlinked" });
    fake.db.integration_connections[0].write_kinds = ["attachment"];
    expect(await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id })).toEqual({ ok: false, refusal: "not_offered" });
    expect(noteRow(id).sm8_refusal).toBeNull();
  });

  it("unlinked, confirm, capped or unqueued are kept on the row, and the row stays", async () => {
    const a = seedNote();
    fake.db.integration_links.splice(0, 1);
    expect(await queueNoteCreate(await pressAs("staff-isaac"), { noteId: a })).toEqual({ ok: false, refusal: "unlinked" });
    expect(noteRow(a).sm8_refusal).toBe("unlinked");
    await setupAgain();
    fake.db.integration_links[0].confirmed_answer = null;
    fake.db.integration_links[0].confirmed_remote_id = null;
    const b = seedNote();
    expect(await queueNoteCreate(await pressAs("staff-isaac"), { noteId: b })).toEqual({ ok: false, refusal: "confirm" });
    expect(noteRow(b).sm8_refusal).toBe("confirm");
  });

  it("(F) a press on a note whose create is queued, refused unlinked, stores nothing: the line still reads the queued create", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    fake.db.integration_links.splice(0, 1);
    expect(await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id })).toEqual({ ok: false, refusal: "unlinked" });
    expect(noteRow(id).sm8_refusal).toBeNull();
    expect((await lineOf(id)).key).toBe("line.sending");
  });

  it("while paused, the note is queued and held — never refused", async () => {
    fake.db.integration_connections[0].write_mode = "paused";
    const id = seedNote();
    expect(await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id })).toMatchObject({ ok: true });
    expect(createOf(id).status).toBe("queued");
    expect((await lineOf(id)).text).toBe("Not in ServiceM8 yet. Sending is paused.");
  });

  it("no press, or a stale one, queues nothing", async () => {
    const id = seedNote();
    const fakePress = { orgId: ORG, userId: "u", staffId: "staff-isaac", at: Date.now() } as unknown as Sm8Press;
    expect(await queueNoteCreate(fakePress, { noteId: id })).toMatchObject({ ok: false });
    expect(await queueNoteTakeBack(fakePress, { noteId: id })).toMatchObject({ ok: false, removed: false });
    expect(writes()).toHaveLength(0);
  });

  it("(F) one create per note: a Send again re-presses under the create's own job and subject, whatever changed since", async () => {
    const task = "11111111-0000-4000-8000-000000000002";
    const id = seedNote({ is_task_done: true, task_id: task, applied: { sm8Text: "Done." } });
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    const subject = createOf(id).subject;
    createOf(id).status = "failed";
    // the task is deleted (task_id goes null), and the note's job changes
    Object.assign(noteRow(id), { task_id: null, target_id: "another-job" });
    expect(await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id })).toMatchObject({ ok: true });
    expect(writes().filter((w) => w.op === "create")).toHaveLength(1);
    expect(createOf(id)).toMatchObject({ subject, sm8_job_uuid: JOB, status: "queued" });
    // a Done with no create and no task queues under task:none
    const orphan = seedNote({ is_task_done: true, task_id: null, applied: { sm8Text: "Done." } });
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: orphan });
    expect(createOf(orphan).subject).toBe(`task:none:done:${orphan}`);
  });

  it("(F) an Undo whose delete can't be queued (capped) removes the row, closes the create, keeps capped, and Try again queues it", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    await run();
    // sixty presses this hour
    for (let i = 0; i < 60; i++) {
      fake.db.sm8_writes.push({ id: `cap-${i}`, org_id: "org-2", tenant_id: TENANT, kind: "attachment", status: "sent", pressed_at: new Date().toISOString(), subject: `document:${i}` });
    }
    const t = await queueNoteTakeBack(await pressAs("staff-isaac"), { noteId: id });
    expect(t).toEqual({ ok: false, refusal: "capped", removed: true });
    expect(noteRow(id)).toMatchObject({ sm8_refusal: "capped" });
    expect(noteRow(id).removed_at).toBeTruthy();
    expect(createOf(id).taken_back_at).toBeTruthy();
    expect(await lineOf(id)).toMatchObject({ key: "line.stillIn", acts: ["take_out_again"] });
    fake.db.sm8_writes = fake.db.sm8_writes.filter((w) => !String(w.id).startsWith("cap-"));
    fake.db.integration_connections[0].write_mode = "live";
    const again = await queueNoteTakeBack(await pressAs("staff-isaac"), { noteId: id });
    expect(again).toEqual({ ok: true, plan: "deleting", removed: true });
    await run();
    expect(deleteSm8Note).toHaveBeenCalledTimes(1);
    expect((await lineOf(id)).key).toBeNull();
  });

  it("(F) a take-back refused while its create is mid-send reads Still in, then nothing once the sender's check stops the POST", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    Object.assign(createOf(id), { status: "sending", lease_until: new Date(Date.now() + 90_000).toISOString(), maybe_landed: true, claim_id: "c" });
    fake.db.integration_connections[0].write_kinds = ["attachment"]; // Notes Off
    const t = await queueNoteTakeBack(await pressAs("staff-isaac"), { noteId: id });
    expect(t).toEqual({ ok: false, refusal: "not_offered", removed: true });
    expect(await lineOf(id)).toMatchObject({ key: "line.stillIn", text: "Still in ServiceM8. Sending notes is switched off.", acts: ["take_out_again"] });
    // the sender's check stopped the POST: nothing landed
    Object.assign(createOf(id), { status: "cancelled", lease_until: null, maybe_landed: false, last_error: NOTE_WORDS.row.takenBackBeforeSent });
    expect((await lineOf(id)).key).toBeNull();
  });

  it("(F) with Notes Off: an Undo of a note that never went works; one that went answers not_offered, removed, and Try again after Notes On deletes it", async () => {
    const a = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: a });
    const b = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: b });
    postSm8Note.mockResolvedValue(created());
    // b goes; a waits
    createOf(a).next_attempt_at = new Date(Date.now() + 3_600_000).toISOString();
    await run();
    expect(createOf(b).status).toBe("sent");
    await setSm8WriteKind(ORG, "note", false);
    expect(await queueNoteTakeBack(await pressAs("staff-isaac"), { noteId: a })).toMatchObject({ ok: true, removed: true });
    expect((await lineOf(a)).key).toBeNull();
    expect(await queueNoteTakeBack(await pressAs("staff-isaac"), { noteId: b })).toEqual({ ok: false, refusal: "not_offered", removed: true });
    expect(await lineOf(b)).toMatchObject({ text: "Still in ServiceM8. Sending notes is switched off.", acts: ["take_out_again"] });
    await setSm8WriteKind(ORG, "note", true);
    expect(await queueNoteTakeBack(await pressAs("staff-isaac"), { noteId: b })).toMatchObject({ ok: true, plan: "deleting" });
    await run();
    expect(deleteSm8Note).toHaveBeenCalledTimes(1);
    expect((await lineOf(b)).key).toBeNull();
  });
});

/* ── the run ── */

describe("the run, with notes beside files", () => {
  const fileDoc = (id: string) => ({ id, org_id: ORG, storage_ref: `org/${ORG}/jobs/${id}.pdf`, mime_type: "application/pdf", uploaded_at: "2026-09-01T00:00:00.000Z" });

  it("(F) two personal 403s don't stop the run, and a file after them still goes", async () => {
    const a = seedNote();
    const b = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: a });
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: b });
    postSm8Note.mockResolvedValue(answered(403, { kind: "forbidden", scope: false }));
    fake.db.documents.push(fileDoc("d1"));
    await enqueueAttachments(await pressAs("staff-isaac"), await readSm8WriteState(ORG), [
      { jobUuid: JOB, documentId: "d1", name: "d1.pdf", mimeType: "application/pdf", sizeBytes: 4, key: "d:d1" },
    ]);
    const r = await run();
    expect(createOf(a)).toMatchObject({ status: "failed", last_error: "Isaac Smith's ServiceM8 login can't do this." });
    expect(createOf(b).status).toBe("failed");
    expect(r.stopped).toBeNull();
    expect(postSm8Attachment).toHaveBeenCalledTimes(1);
  });

  it("(F) two impersonated 401s with the plain read working fail only that row, and flag nothing; throttled, the row waits", async () => {
    const a = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: a });
    postSm8Note.mockResolvedValue(answered(401, { kind: "unauthorized" }));
    readSm8Note.mockResolvedValue(NOT_FOUND); // the plain read answers
    await run();
    expect(createOf(a)).toMatchObject({ status: "failed", last_error: "Isaac Smith's ServiceM8 login can't do this." });
    expect(markSm8NeedsReauth).not.toHaveBeenCalled();
    expect(renewSm8Access).not.toHaveBeenCalled();

    const b = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: b });
    readSm8Note.mockResolvedValueOnce({ ok: false, unauthorized: true }).mockResolvedValue({ ok: false, limited: { kind: "rate_limited", limit: "ours" } });
    await run();
    expect(createOf(b)).toMatchObject({ status: "queued", last_error: NOTE_WORDS.row.loginUnchecked });
    expect(markSm8NeedsReauth).not.toHaveBeenCalled();
  });

  it("dead under the renewed token too: the grant is flagged, as today", async () => {
    const a = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: a });
    postSm8Note.mockResolvedValue(answered(401, { kind: "unauthorized" }));
    readSm8Note.mockResolvedValue({ ok: false, unauthorized: true });
    await run();
    expect(markSm8NeedsReauth).toHaveBeenCalledTimes(1);
    expect(createOf(a)).toMatchObject({ status: "queued", last_error: WRITE_WORDS.reauth });
  });

  it("a scope 403 on a note holds notes — recorded through the function — and files still go in the same run", async () => {
    const a = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: a });
    const b = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: b });
    postSm8Note.mockResolvedValue(answered(403, { kind: "forbidden", scope: true }));
    fake.db.documents.push(fileDoc("d1"));
    await enqueueAttachments(await pressAs("staff-isaac"), await readSm8WriteState(ORG), [
      { jobUuid: JOB, documentId: "d1", name: "d1.pdf", mimeType: "application/pdf", sizeBytes: 4, key: "d:d1" },
    ]);
    await run();
    expect(postSm8Note).toHaveBeenCalledTimes(1);
    expect(createOf(a)).toMatchObject({ status: "queued", last_error: NOTE_WORDS.row.scopeHeldNote, attempts: 0 });
    expect(createOf(b)).toMatchObject({ status: "queued", attempts: 0 });
    expect(fake.db.integration_connections[0].write_scope_refused).toHaveProperty("note");
    expect(fake.on("rpc:sm8_mark_kind_refused")).toHaveLength(1);
    expect(postSm8Attachment).toHaveBeenCalledTimes(1);
  });

  it("a scope refusal still records through the old merge when the function is missing", async () => {
    fake.setRpcMissing(true);
    const a = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: a });
    postSm8Note.mockResolvedValue(answered(403, { kind: "forbidden", scope: true }));
    await run();
    expect(fake.db.integration_connections[0].write_scope_refused).toHaveProperty("note");
  });

  it("(F) Notes switched Off after a run read the state: it claims no further note, and files after them still go", async () => {
    const a = seedNote();
    const b = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: a });
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: b });
    fake.db.documents.push(fileDoc("d1"));
    await enqueueAttachments(await pressAs("staff-isaac"), await readSm8WriteState(ORG), [
      { jobUuid: JOB, documentId: "d1", name: "d1.pdf", mimeType: "application/pdf", sizeBytes: 4, key: "d:d1" },
    ]);
    postSm8Note.mockImplementation(async () => {
      fake.db.integration_connections[0].write_kinds = ["attachment"]; // Off lands mid-run
      return created();
    });
    await run();
    expect(postSm8Note).toHaveBeenCalledTimes(1);
    expect(createOf(b).status).toBe("queued");
    expect(postSm8Attachment).toHaveBeenCalledTimes(1);
  });

  it("(F) Notes Off landing before the run's FIRST claim: the switch is read again before every note, not only after a send", async () => {
    const a = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: a });
    fake.before.sm8_writes = (s) => {
      /* the run's read of what is due: the owner switches Notes off right after it */
      if (s.op === "select" && s.columns?.includes("taken_back_at") && s.columns.includes("free_retries")) {
        fake.db.integration_connections[0].write_kinds = ["attachment"];
      }
    };
    await run();
    fake.before.sm8_writes = undefined;
    expect(postSm8Note).not.toHaveBeenCalled();
    expect(createOf(a)).toMatchObject({ status: "queued", attempts: 0 });
  });

  it("(F) a note queued just before the Off is cancelled by the next run in notes' words, even while paused", async () => {
    const a = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: a });
    Object.assign(fake.db.integration_connections[0], { write_kinds: ["attachment"], write_mode: "paused" });
    await run();
    expect(createOf(a)).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.notesSwitchedOff });
  });

  it("(F) with files alone allowed, or every allowed kind on, a run makes no cancel query", async () => {
    process.env.SM8_WRITES = "1";
    fake.db.integration_connections[0].write_kinds = ["attachment"];
    fake.log.length = 0;
    await run();
    expect(fake.on("sm8_writes").filter((s) => s.op === "update")).toHaveLength(0);
    process.env.SM8_WRITES = "attachment,note";
    fake.db.integration_connections[0].write_kinds = ["attachment", "note"];
    fake.log.length = 0;
    await run();
    expect(fake.on("sm8_writes").filter((s) => s.op === "update")).toHaveLength(0);
  });

  it("setSm8WriteKind Off cancels waiting notes only — creates, flag changes and take-backs — in notes' words", async () => {
    const a = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: a });
    fake.db.documents.push(fileDoc("d1"));
    await enqueueAttachments(await pressAs("staff-isaac"), await readSm8WriteState(ORG), [
      { jobUuid: JOB, documentId: "d1", name: "d1.pdf", mimeType: "application/pdf", sizeBytes: 4, key: "d:d1" },
    ]);
    const off = await setSm8WriteKind(ORG, "note", false);
    expect(off).toMatchObject({ ok: true });
    expect(off.ok && off.cancelled.map((c) => c.kind)).toEqual(["note"]);
    expect(createOf(a)).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.notesSwitchedOff });
    expect(writes().find((w) => w.kind === "attachment")?.status).toBe("queued");
    expect(fake.db.integration_connections[0].write_kinds).toEqual(["attachment"]);
    expect(fake.on("rpc:sm8_set_write_kind")).toHaveLength(1);
  });

  it("(F) the owner's bell ignores a kind the owner switched off: Notes Off without its permission never says reconnect", async () => {
    Object.assign(fake.db.integration_connections[0], { scopes: "vendor manage_attachments", write_kinds: ["attachment"] });
    fake.db.documents.push(fileDoc("d1"));
    await enqueueAttachments(await pressAs("staff-isaac"), await readSm8WriteState(ORG), [
      { jobUuid: JOB, documentId: "d1", name: "d1.pdf", mimeType: "application/pdf", sizeBytes: 4, key: "d:d1" },
    ]);
    expect(await sm8QueueStuck(ORG)).toBeNull();
    // Notes On without the permission: that IS a reconnect
    fake.db.integration_connections[0].write_kinds = ["attachment", "note"];
    expect(await sm8QueueStuck(ORG)).toMatchObject({ reason: "reconnect", kinds: { attachment: 1, note: 0 } });
  });

  it("reads a database without write_kinds as files on, and never holds files for it", async () => {
    fake.missing.add("write_kinds");
    const s = await readSm8WriteState(ORG);
    expect(s).toMatchObject({ readable: true, ownerKinds: ["attachment"], ownerKindsRead: false });
    expect(offersSend(s, "attachment")).toBe(true);
    expect(offersSend(s, "note")).toBe(false);
  });

  it("(F) Retry failed files leaves a failed note alone, and counts only failed files as left", async () => {
    const a = seedNote();
    const b = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: a });
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: b });
    createOf(a).status = "failed";
    createOf(b).status = "failed";
    fake.db.documents.push(fileDoc("d1"));
    await enqueueAttachments(await pressAs("staff-isaac"), await readSm8WriteState(ORG), [
      { jobUuid: JOB, documentId: "d1", name: "d1.pdf", mimeType: "application/pdf", sizeBytes: 4, key: "d:d1" },
    ]);
    writes().find((w) => w.kind === "attachment")!.status = "failed";
    const state = await readSm8WriteState(ORG);
    const p = await pressAs("staff-isaac");
    fake.log.length = 0;
    const r = await retryFailedSm8Writes(p, state);
    expect(r).toMatchObject({ queued: 1, left: 0 });
    expect(createOf(a).status).toBe("failed");
    expect(createOf(b).status).toBe("failed");
    // it never even tries a note row (the database would refuse it: the patch names the presser)
    const noteIds = [createOf(a).id, createOf(b).id];
    expect(fake.on("sm8_writes").some((s) => s.op === "update" && noteIds.some((id) => s.filters.includes(`id=${id}`)))).toBe(false);
  });

  it("the owner's list names a note by its label and never reads its words", async () => {
    const a = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: a });
    fake.log.length = 0;
    const list = await listRecentSm8Writes(ORG);
    expect(list[0]).toMatchObject({ kind: "note", name: "Note" });
    expect(fake.on("sm8_writes").some((s) => s.columns?.includes("note_text"))).toBe(false);
    createOf(a).payload = {};
    expect((await listRecentSm8Writes(ORG))[0].name).toBe("A note");
  });

  it("(F) a finished update or delete never stores the x-record-uuid it was answered with", async () => {
    const id = seedNote();
    await queueNoteCreate(await pressAs("staff-isaac"), { noteId: id });
    await run();
    const c = createOf(id);
    await queueNoteTakeBack(await pressAs("staff-isaac"), { noteId: id });
    const d = deleteOf(c.id as string)!;
    const own = d.remote_uuid;
    deleteSm8Note.mockResolvedValue({ status: 200, outcome: { kind: "created", remoteUuid: "someone-elses" }, remote: null, recordUuid: "someone-elses" });
    await run();
    expect(d.status).toBe("sent");
    expect(d.remote_uuid).toBe(own);
  });
});

/* ── flags ── */

describe("a flag marked done, as the person pressing", () => {
  const PRESS = "9a9a9a9a-0000-4000-8000-000000000001";
  const PRESS2 = "9a9a9a9a-0000-4000-8000-000000000002";
  beforeEach(() => {
    fake.db.sm8_job_notes = [
      {
        org_id: ORG,
        uuid: FLAG,
        related_object_uuid: JOB,
        note: "@isaacsmith order the grilles",
        edit_by_staff_uuid: LUKE_SM8,
        edit_date: "2026-09-20 10:00:00",
        action_required: "1",
        action_completed_by_staff_uuid: null,
      },
    ];
  });
  const flagRow = () => writes().find((w) => w.op === "update")!;

  it("queues an update against the edit time seen, and sends only the completer, as the presser", async () => {
    const q = await queueFlagChange(await pressAs("staff-isaac"), { noteUuid: FLAG, done: true, seenEditDate: "2026-09-20 10:00:00", pressId: PRESS });
    expect(q).toMatchObject({ ok: true });
    expect(flagRow()).toMatchObject({ op: "update", target_uuid: FLAG, flag_done: true, seen_edit_date: "2026-09-20 10:00:00", subject: `flag:${FLAG}:${PRESS}` });
    expect(flagRow().remote_uuid).not.toBe(FLAG);
    readSm8Note
      .mockResolvedValueOnce(found({ flagged: true, completedBy: null, editDate: "2026-09-20 10:00:00" }))
      .mockResolvedValueOnce(found({ flagged: true, completedBy: ISAAC_SM8, editDate: "2026-09-25 09:00:00" }));
    await run();
    expect(updateSm8NoteCompleter).toHaveBeenCalledTimes(1);
    expect(updateSm8NoteCompleter.mock.calls[0].slice(1)).toEqual([FLAG, ISAAC_SM8, ISAAC_SM8]);
    expect(flagRow()).toMatchObject({ status: "sent", landed_edit_date: "2026-09-25 09:00:00" });
  });

  it("refuses a moved edit time at the press, and a note that isn't flagged is already answered", async () => {
    expect(await queueFlagChange(await pressAs("staff-isaac"), { noteUuid: FLAG, done: true, seenEditDate: "2026-09-19 10:00:00", pressId: PRESS })).toEqual({ ok: false, refusal: "changed" });
    fake.db.sm8_job_notes[0].action_completed_by_staff_uuid = LUKE_SM8;
    expect(await queueFlagChange(await pressAs("staff-isaac"), { noteUuid: FLAG, done: true, seenEditDate: "2026-09-20 10:00:00", pressId: PRESS })).toEqual({ ok: true, rowIds: [], already: true });
  });

  it("a flag already done in ServiceM8 is sent with no request; a moved edit time is cancelled changed; the mirror's and the live shape compare equal", async () => {
    await queueFlagChange(await pressAs("staff-isaac"), { noteUuid: FLAG, done: true, seenEditDate: "2026-09-20 10:00:00", pressId: PRESS });
    readSm8Note.mockResolvedValueOnce(found({ flagged: true, completedBy: LUKE_SM8, editDate: "2026-09-20 10:00:00" }));
    await run();
    expect(updateSm8NoteCompleter).not.toHaveBeenCalled();
    expect(flagRow()).toMatchObject({ status: "sent", landed_edit_date: "2026-09-20 10:00:00" });

    fake.db.sm8_writes = [];
    await queueFlagChange(await pressAs("staff-isaac"), { noteUuid: FLAG, done: true, seenEditDate: "2026-09-20 10:00:00", pressId: PRESS2 });
    readSm8Note.mockResolvedValueOnce(found({ flagged: true, editDate: "2026-09-24 08:00:00" }));
    await run();
    expect(flagRow()).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.changed });
  });

  it("(F) a 404 on the update is a cancel built by the sender, never a verdict", async () => {
    await queueFlagChange(await pressAs("staff-isaac"), { noteUuid: FLAG, done: true, seenEditDate: "2026-09-20 10:00:00", pressId: PRESS });
    readSm8Note.mockResolvedValueOnce(found({ flagged: true, editDate: "2026-09-20 10:00:00" }));
    updateSm8NoteCompleter.mockResolvedValueOnce(answered(404, { kind: "rejected", status: 404 }));
    await run();
    expect(flagRow()).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.noteGone, http_status: 404 });
  });

  it("a change ServiceM8 took but didn't keep fails notKept", async () => {
    await queueFlagChange(await pressAs("staff-isaac"), { noteUuid: FLAG, done: true, seenEditDate: "2026-09-20 10:00:00", pressId: PRESS });
    readSm8Note
      .mockResolvedValueOnce(found({ flagged: true, editDate: "2026-09-20 10:00:00" }))
      .mockResolvedValueOnce(found({ flagged: true, completedBy: null, editDate: "2026-09-25 09:00:00" }));
    await run();
    expect(flagRow()).toMatchObject({ status: "failed", last_error: NOTE_WORDS.row.notKept });
  });

  it("(F) Clear of a waiting mark cancels it with nothing checked — it works with Notes Off; anyone else gets not_yours", async () => {
    await queueFlagChange(await pressAs("staff-isaac"), { noteUuid: FLAG, done: true, seenEditDate: "2026-09-20 10:00:00", pressId: PRESS });
    expect(await queueFlagChange(await pressAs("staff-luke"), { noteUuid: FLAG, done: false, pressId: PRESS2 })).toEqual({ ok: false, refusal: "not_yours" });
    fake.db.integration_connections[0].write_kinds = ["attachment"];
    fake.db.integration_links.length = 0;
    expect(await queueFlagChange(await pressAs("staff-isaac"), { noteUuid: FLAG, done: false, pressId: PRESS2 })).toEqual({ ok: true, rowIds: [], already: false });
    expect(flagRow()).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.takenBackBeforeSent });
    expect(writes()).toHaveLength(1);
  });

  it("(F) a Clear of a mark that is sending answers in_flight; of a trial mark, not_flagged; of a sent mark, not_flagged until live test 5", async () => {
    await queueFlagChange(await pressAs("staff-isaac"), { noteUuid: FLAG, done: true, seenEditDate: "2026-09-20 10:00:00", pressId: PRESS });
    flagRow().status = "sending";
    expect(await queueFlagChange(await pressAs("staff-isaac"), { noteUuid: FLAG, done: false, pressId: PRESS2 })).toEqual({ ok: false, refusal: "in_flight" });
    flagRow().status = "trial";
    expect(await queueFlagChange(await pressAs("staff-isaac"), { noteUuid: FLAG, done: false, pressId: PRESS2 })).toEqual({ ok: false, refusal: "not_flagged" });
    flagRow().status = "sent";
    expect(await queueFlagChange(await pressAs("staff-isaac"), { noteUuid: FLAG, done: false, pressId: PRESS2 })).toEqual({ ok: false, refusal: "not_flagged" });
  });

  it("(F) a clear whose mark someone changed after us is cancelled changed, as is one whose mark left no edit time", async () => {
    /* a clear row, as FLAG_UNDO_AFTER_SENT will queue it: its seen edit
       time is the edit time our mark left */
    await queueFlagChange(await pressAs("staff-isaac"), { noteUuid: FLAG, done: true, seenEditDate: "2026-09-20 10:00:00", pressId: PRESS });
    Object.assign(flagRow(), { status: "sent", landed_edit_date: "2026-09-25 09:00:00" });
    const { enqueueSm8Writes } = await import("../sm8-writes");
    await enqueueSm8Writes(await pressAs("staff-isaac"), await readSm8WriteState(ORG), [
      { kind: "note", op: "update", jobUuid: JOB, subject: `flag:${FLAG}:${PRESS2}`, payload: { name: "Done mark taken off" }, ref: PRESS2, targetUuid: FLAG, flagDone: false, seenEditDate: "2026-09-25 09:00:00" },
    ]);
    const clear = writes().find((w) => w.subject === `flag:${FLAG}:${PRESS2}`)!;
    readSm8Note.mockResolvedValueOnce(found({ flagged: true, completedBy: ISAAC_SM8, editDate: "2026-09-25 11:11:11" }));
    await run();
    expect(clear).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.changed });
    expect(updateSm8NoteCompleter).not.toHaveBeenCalled();
  });
});
