/**
 * @jest-environment node
 */

/* What the job card reads about notes to ServiceM8 (two-way phase 2, PR B):
   our own notes with where each stands, a take-back still drawn while
   something of it may be in ServiceM8, our replies as mentions, "answered"
   worked out from the replies themselves, and ServiceM8's flags with our
   marks on them — against the in-memory database (fixtures/sm8-fake-db). */

import { makeFakeDb } from "@/lib/integrations/__tests__/fixtures/sm8-fake-db";

type Row = Record<string, unknown>;

const fake = makeFakeDb();
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: { from: (t: string) => fake.from(t), rpc: (n: string, a: Record<string, unknown>) => fake.rpc(n, a) },
}));
jest.mock("@/lib/permissions-server", () => ({
  requireOrg: async () => ({ orgId: "org-1", userId: "auth0|luke" }),
}));
jest.mock("@/lib/workboard/projects-query", () => ({ staffIdFor: async () => "staff-luke" }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: async () => null } }));

import { readJobNotes } from "../all-jobs-query";
import { readFlagStates, readJobAttention, readOurJobNotes, type NotesViewer } from "../job-notes-query";
import { dismissJobNote } from "@/app/actions/job-notes";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { NOTE_WORDS } from "@/lib/integrations/sm8-note-plan";

const ORG = "org-1";
const TENANT = "vendor-1";
const JOB = "0f8c2b9e-1111-4a4a-8b8b-000000000001";
const ISAAC_SM8 = "5a1b2c3d-0000-4000-8000-00000000aaaa";
const LUKE_SM8 = "5a1b2c3d-0000-4000-8000-00000000bbbb";
const ASK = "7e7e7e7e-0000-4000-8000-00000000a5c1";
const FLAG = "7e7e7e7e-0000-4000-8000-00000000f1a9";
const SENT_AS = "9a9a9a9a-0000-4000-8000-000000000001";
const LATER_AS = "9a9a9a9a-0000-4000-8000-000000000002";
const EDITED = "2026-09-20 10:00:00";

let seq = 0;
const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

const mirror = (uuid: string, over: Row = {}) => ({
  org_id: ORG,
  uuid,
  related_object_uuid: JOB,
  note: "@isaacsmith can you order the grilles",
  create_date: "2026-09-20 09:00:00",
  action_required: "0",
  action_completed_by_staff_uuid: null,
  edit_by_staff_uuid: LUKE_SM8,
  edit_date: EDITED,
  active: 1,
  ...over,
});

function seedOurs(over: Row = {}): string {
  const id = (over.id as string) ?? newId();
  (fake.db.workboard_notes ??= []).push({
    id,
    org_id: ORG,
    target_kind: "job",
    target_id: JOB,
    status: "applied",
    author_id: "staff-isaac",
    transcript: "on my way",
    applied: { jobNotes: ["@lukeingold on my way"], sm8Text: "@lukeingold on my way" },
    applied_at: "2026-09-21T01:00:00.000Z",
    created_at: "2026-09-21T01:00:00.000Z",
    removed_at: null,
    sm8_refusal: null,
    reply_to_sm8_note_uuid: ASK,
    task_id: null,
    is_task_done: false,
    ...over,
  });
  return id;
}

function seedCreate(noteId: string, over: Row = {}): Row {
  const row: Row = {
    id: `c-${noteId}`,
    org_id: ORG,
    tenant_id: TENANT,
    kind: "note",
    op: "create",
    note_id: noteId,
    subject: `jobnote:${noteId}`,
    sm8_job_uuid: JOB,
    status: "sent",
    remote_uuid: SENT_AS,
    requested_by: "staff-isaac",
    taken_back_at: null,
    maybe_landed: false,
    verify_uuids: [],
    lease_until: null,
    attempts: 1,
    last_error: null,
    replaced_uuids: [],
    ...over,
  };
  fake.db.sm8_writes.push(row);
  return row;
}

function seedTakeBack(noteId: string, over: Row = {}): Row {
  const row: Row = {
    id: `d-${noteId}`,
    org_id: ORG,
    tenant_id: TENANT,
    kind: "note",
    op: "delete",
    note_id: noteId,
    depends_on: `c-${noteId}`,
    subject: `undo:c-${noteId}`,
    status: "queued",
    remote_uuid: newId(),
    requested_by: "staff-isaac",
    attempts: 0,
    last_error: null,
    ...over,
  };
  fake.db.sm8_writes.push(row);
  return row;
}

async function viewer(staffId: string | null): Promise<NotesViewer> {
  return { staffId, state: await readSm8WriteState(ORG), sender: null };
}

beforeEach(() => {
  fake.reset();
  seq = 0;
  process.env.SM8_WRITES = "attachment,note";
  fake.db.integration_connections = [
    {
      org_id: ORG,
      provider: "servicem8",
      status: "connected",
      tenant_id: TENANT,
      scopes: "vendor read_jobs manage_attachments publish_job_notes",
      write_mode: "live",
      write_scope_refused: {},
      write_kinds: ["attachment", "note"],
    },
  ];
  fake.db.integration_links = [
    { org_id: ORG, provider: "servicem8", kind: "staff", tenant_id: TENANT, staff_profile_id: "staff-isaac", remote_id: ISAAC_SM8 },
    { org_id: ORG, provider: "servicem8", kind: "staff", tenant_id: TENANT, staff_profile_id: "staff-luke", remote_id: LUKE_SM8 },
  ];
  fake.db.sm8_staff = [
    { org_id: ORG, uuid: ISAAC_SM8, first: "Isaac", last: "Smith", active: 1 },
    { org_id: ORG, uuid: LUKE_SM8, first: "Luke", last: "Ingold", active: 1 },
  ];
  fake.db.staff_profiles = [
    { org_id: ORG, id: "staff-isaac", first_name: "Isaac", last_name: "Smith", status: "Active" },
    { org_id: ORG, id: "staff-luke", first_name: "Luke", last_name: "Ingold", status: "Active" },
  ];
  fake.db.sm8_job_notes = [mirror(ASK)];
  fake.db.sm8_writes = [];
  fake.db.workboard_notes = [];
  fake.db.job_note_actions = [];
  fake.db.workboard_flags = [];
  fake.db.tasks = [];
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  delete process.env.SM8_WRITES;
});

/* ── ServiceM8's notes ── */

describe("ServiceM8's notes, with our marks on them", () => {
  it("(F) after our Mark done made the presser the last editor, the author is who it was when we marked it", async () => {
    fake.db.sm8_job_notes = [mirror(FLAG, { action_required: "1", action_completed_by_staff_uuid: ISAAC_SM8, edit_by_staff_uuid: ISAAC_SM8 })];
    fake.db.sm8_writes.push({
      id: "u1", org_id: ORG, kind: "note", op: "update", flag_done: true, status: "sent", target_uuid: FLAG,
      seen_edit_by: LUKE_SM8, as_staff_uuid: ISAAC_SM8, created_at: "2026-09-21T00:00:00Z",
    });
    const [n] = await readJobNotes(ORG, JOB);
    expect(n).toMatchObject({ writtenBy: "Luke Ingold", authorSm8Uuid: LUKE_SM8, authorHandle: "lukeingold", doneBy: "Isaac Smith", actionRequired: false, flagged: true, editedAt: EDITED, relatedUuid: JOB });
    // files only: no queue read, and the mirror's own editor
    process.env.SM8_WRITES = "1";
    fake.log.length = 0;
    const [m] = await readJobNotes(ORG, JOB);
    expect(m.writtenBy).toBe("Isaac Smith");
    expect(fake.on("sm8_writes")).toHaveLength(0);
  });
});

/* ── our notes ── */

describe("our own notes, each with where it stands", () => {
  it("say where they stand, and the doors are their sender's only", async () => {
    const id = seedOurs();
    seedCreate(id);
    const [mine] = await readOurJobNotes(ORG, JOB, 60, await viewer("staff-isaac"));
    expect(mine).toMatchObject({ id, replyTo: ASK, removed: false, sm8Uuid: SENT_AS, hasCreate: true, mine: true, authorId: "staff-isaac" });
    expect(mine.state).toMatchObject({ key: "line.sent", text: NOTE_WORDS.line.sent, acts: ["undo"] });
    const [theirs] = await readOurJobNotes(ORG, JOB, 60, await viewer("staff-luke"));
    expect(theirs.state).toMatchObject({ key: "line.sent", acts: [] });
    expect(theirs.mine).toBe(false);
  });

  it("a database without the phase 2 columns reads as it always did", async () => {
    seedOurs();
    const removed = seedOurs({ removed_at: "2026-09-22T00:00:00Z", status: "dismissed" });
    fake.missing.add("removed_at");
    fake.missing.add("sm8_refusal");
    fake.missing.add("reply_to_sm8_note_uuid");
    const read = await readOurJobNotes(ORG, JOB, 60, await viewer("staff-isaac"));
    expect(read).toHaveLength(1);
    expect(read[0].id).not.toBe(removed);
  });

  describe("a note taken back", () => {
    it("is drawn while its take-back hasn't settled, and not once it has", async () => {
      const id = seedOurs({ removed_at: "2026-09-22T00:00:00Z" });
      seedCreate(id, { taken_back_at: "2026-09-22T00:00:00Z" });
      const tb = seedTakeBack(id);
      let [row] = await readOurJobNotes(ORG, JOB, 60, await viewer("staff-isaac"));
      expect(row).toMatchObject({ id, removed: true, state: { key: "line.takingOut" } });
      tb.status = "sent";
      expect(await readOurJobNotes(ORG, JOB, 60, await viewer("staff-isaac"))).toEqual([]);
      tb.status = "failed";
      tb.last_error = NOTE_WORDS.row.noteRefused;
      [row] = await readOurJobNotes(ORG, JOB, 60, await viewer("staff-isaac"));
      expect(row.state).toMatchObject({ key: "line.stillIn", acts: ["take_out_again"] });
    });

    it("one that never reached ServiceM8 is not drawn", async () => {
      const id = seedOurs({ removed_at: "2026-09-22T00:00:00Z" });
      seedCreate(id, { status: "cancelled", taken_back_at: "2026-09-22T00:00:00Z", last_error: NOTE_WORDS.row.takenBackBeforeSent });
      expect(await readOurJobNotes(ORG, JOB, 60, await viewer("staff-isaac"))).toEqual([]);
      // and a removed plain entry with no create at all
      seedOurs({ removed_at: "2026-09-22T00:00:00Z", reply_to_sm8_note_uuid: null });
      expect(await readOurJobNotes(ORG, JOB, 60, await viewer("staff-isaac"))).toEqual([]);
    });

    it("(F) one the rollback set to dismissed reads the same", async () => {
      const id = seedOurs({ removed_at: "2026-09-22T00:00:00Z", status: "dismissed" });
      seedCreate(id, { taken_back_at: "2026-09-22T00:00:00Z" });
      seedTakeBack(id);
      const [row] = await readOurJobNotes(ORG, JOB, 60, await viewer("staff-isaac"));
      expect(row).toMatchObject({ id, state: { key: "line.takingOut" } });
    });
  });

  it("the stored summary, reading with nobody looking, gets the same set", async () => {
    const a = seedOurs();
    seedCreate(a);
    const b = seedOurs({ removed_at: "2026-09-22T00:00:00Z" });
    seedCreate(b, { taken_back_at: "2026-09-22T00:00:00Z" });
    seedTakeBack(b);
    seedOurs({ removed_at: "2026-09-22T00:00:00Z", reply_to_sm8_note_uuid: null });
    const card = await readOurJobNotes(ORG, JOB, 60, await viewer("staff-isaac"));
    const summary = await readOurJobNotes(ORG, JOB);
    expect(summary.map((n) => n.id)).toEqual(card.map((n) => n.id));
  });
});

/* ── the strip ── */

describe("the strip", () => {
  const attention = async (viewerHandle: string | null, ourNotesFor = "staff-luke") => {
    const notes = await readJobNotes(ORG, JOB);
    const ourNotes = await readOurJobNotes(ORG, JOB, 60, await viewer(ourNotesFor));
    return readJobAttention(ORG, JOB, { notes, jobOpen: true, today: "2026-09-25", echoFiltered: true, viewerHandle, ourNotes });
  };

  it("(F) our sent reply is a mention for the person it names, and ServiceM8's copy of it is not drawn", async () => {
    const id = seedOurs();
    seedCreate(id);
    fake.db.sm8_job_notes.push(mirror(SENT_AS, { note: "@lukeingold on my way", edit_by_staff_uuid: ISAAC_SM8 }));
    // Isaac's reply answered Luke's ask
    fake.db.sm8_job_notes[0].note = "@isaacsmith can you order the grilles";
    const { attention: a } = await attention("lukeingold");
    const ours = a.items.filter((i) => i.kind === "mention");
    expect(ours).toHaveLength(1);
    expect(ours[0]).toMatchObject({ origin: "heytiff", rowId: id, noteUuid: SENT_AS, you: true, named: [{ name: "Luke Ingold" }] });
    // Isaac looking: not a mention of him
    const { attention: b } = await attention("isaacsmith", "staff-isaac");
    expect(b.items.find((i) => i.kind === "mention")).toMatchObject({ origin: "heytiff", you: false });
    // and the twin never reaches the diary
    expect((await readJobNotes(ORG, JOB)).map((n) => n.remoteId)).toEqual([ASK]);
  });

  it("(F) (verifier r3 10) Luke's Not work on it clears it with no reply, before it went and after, and it stays cleared under a new uuid", async () => {
    const id = seedOurs();
    const c = seedCreate(id, { status: "queued", remote_uuid: SENT_AS });
    let { attention: a } = await attention("lukeingold");
    expect(a.items.find((i) => i.kind === "mention")).toMatchObject({ rowId: id, noteUuid: null });
    await dismissJobNote(JOB, id);
    ({ attention: a } = await attention("lukeingold"));
    expect(a.items.filter((i) => i.kind === "mention")).toHaveLength(0);
    c.status = "sent";
    c.remote_uuid = LATER_AS;
    ({ attention: a } = await attention("lukeingold"));
    expect(a.items.filter((i) => i.kind === "mention")).toHaveLength(0);
  });

  it("(F) a mention stays answered after a task is made from it and after a second reply; taking the first back leaves it answered", async () => {
    const before = await attention("isaacsmith", "staff-isaac");
    expect(before.attention.items.find((i) => i.kind === "mention" && i.noteUuid === ASK)).toMatchObject({ you: true, origin: "sm8" });
    const first = seedOurs();
    const second = seedOurs({ transcript: "done", applied: { jobNotes: ["@lukeingold done"], sm8Text: "@lukeingold done" } });
    fake.db.job_note_actions.push({ org_id: ORG, sm8_note_uuid: ASK, sm8_job_uuid: JOB, action: "task", task_id: "t1" });
    const stillAsking = async () =>
      (await attention("isaacsmith", "staff-isaac")).attention.items.some((i) => i.kind === "mention" && i.noteUuid === ASK);
    // a task made from it, and two replies
    expect(await stillAsking()).toBe(false);
    // the replies alone answer it
    fake.db.job_note_actions = [];
    expect(await stillAsking()).toBe(false);
    // the first taken back: the second still answers it
    (fake.db.workboard_notes as Row[]).find((n) => n.id === first)!.removed_at = "2026-09-22T00:00:00Z";
    expect(await stillAsking()).toBe(false);
    // both taken back: it asks again
    (fake.db.workboard_notes as Row[]).find((n) => n.id === second)!.removed_at = "2026-09-22T00:00:00Z";
    expect(await stillAsking()).toBe(true);
  });

  describe("a flag we marked done", () => {
    const flagged = () => {
      fake.db.sm8_job_notes = [mirror(FLAG, { action_required: "1", note: "call the builder" })];
    };
    const mark = (over: Row = {}) =>
      fake.db.sm8_writes.push({
        id: "u1", org_id: ORG, kind: "note", op: "update", flag_done: true, status: "queued", target_uuid: FLAG,
        seen_edit_date: EDITED, landed_edit_date: null, requested_by: "staff-isaac", created_at: "2026-09-21T00:00:00Z",
        ...over,
      });
    const stripFlags = async () => {
      const notes = await readJobNotes(ORG, JOB);
      const v = await viewer("staff-isaac");
      const { flags, held } = await readFlagStates(ORG, notes, v);
      const { attention: a } = await readJobAttention(ORG, JOB, { notes, jobOpen: true, today: "2026-09-25", echoFiltered: true, heldFlags: held, ourNotes: [] });
      return { flags, onStrip: a.items.some((i) => i.kind === "sm8flag") };
    };

    it("(F) a waiting mark takes it off the strip; a failed one brings it back", async () => {
      flagged();
      expect((await stripFlags()).onStrip).toBe(true);
      mark();
      let r = await stripFlags();
      expect(r.onStrip).toBe(false);
      expect(r.flags[FLAG]).toMatchObject({ key: "flag.marking", acts: ["unmark"] });
      (fake.db.sm8_writes[0] as Row).status = "failed";
      r = await stripFlags();
      expect(r.onStrip).toBe(true);
      expect(r.flags[FLAG].acts).toEqual(["mark_done"]);
    });

    it("(F) a sent mark keeps it off until somebody clears it in ServiceM8, and then Mark done again", async () => {
      flagged();
      mark({ status: "sent", landed_edit_date: "2026-09-21 08:00:00" });
      fake.db.sm8_job_notes[0].edit_date = "2026-09-21 08:00:00";
      expect((await stripFlags()).onStrip).toBe(false);
      // someone cleared our mark by hand: a new edit time, no completer
      fake.db.sm8_job_notes[0].edit_date = "2026-09-22 09:00:00";
      const r = await stripFlags();
      expect(r.onStrip).toBe(true);
      expect(r.flags[FLAG]).toMatchObject({ key: "flag.flagged", acts: ["mark_done_again"] });
    });
  });
});
