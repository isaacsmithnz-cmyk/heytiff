/**
 * @jest-environment node
 */

/* Notes on the job card, to ServiceM8 and back (two-way phase 2, PR B).

   The card's actions — reply, Send to ServiceM8, Undo/Remove, Mark done and
   its Undo, the link question, the poll — against the in-memory database
   that keeps the notes migration's rules (fixtures/sm8-fake-db), with the
   real queue helpers and the real sender behind them and ServiceM8 replaced
   at its request functions. Every one is a Server Function, reachable by
   direct POST: what is held here is what the server does, whatever a
   browser sends.

   First of all: PRODUCTION SENDS FILES ONLY (SM8_WRITES=1), and nothing
   about notes may change there until Isaac's phase-1 live walk. */

import { makeFakeDb } from "@/lib/integrations/__tests__/fixtures/sm8-fake-db";

type Row = Record<string, unknown>;

const fake = makeFakeDb();
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (t: string) => fake.from(t),
    rpc: (n: string, a: Record<string, unknown>) => fake.rpc(n, a),
    storage: { from: () => ({ download: async () => ({ data: null, error: null }) }) },
  },
}));
jest.unmock("@/app/actions/job-note-sm8");

const sm8AccessResult = jest.fn();
jest.mock("@/lib/integrations/sm8-store", () => ({
  sm8AccessResult: (...a: unknown[]) => sm8AccessResult(...a),
  renewSm8Access: jest.fn(async () => ({ ok: false })),
  markSm8NeedsReauth: jest.fn(async () => true),
}));
const postSm8Note = jest.fn();
const updateSm8NoteCompleter = jest.fn();
const deleteSm8Note = jest.fn();
const readSm8Note = jest.fn();
jest.mock("@/lib/integrations/sm8-write", () => ({
  postSm8Attachment: jest.fn(),
  readSm8Attachment: jest.fn(),
  postSm8Note: (...a: unknown[]) => postSm8Note(...a),
  updateSm8NoteCompleter: (...a: unknown[]) => updateSm8NoteCompleter(...a),
  deleteSm8Note: (...a: unknown[]) => deleteSm8Note(...a),
  readSm8Note: (...a: unknown[]) => readSm8Note(...a),
}));

const getSession = jest.fn();
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: (...a: unknown[]) => getSession(...a) } }));
/** who is signed in: their staff card (null: a login with none) */
let who: string | null = "staff-isaac";
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => who) }));
jest.mock("@/lib/workboard/projects-query", () => ({ staffIdFor: jest.fn(async () => who) }));
let caps = new Set(["workboard"]);
jest.mock("@/lib/permissions-server", () => ({
  requireOrg: jest.fn(async (c?: string) => {
    if (c && !caps.has(c)) throw new Error("Insufficient permissions");
    return { orgId: "org-1", userId: "auth0|someone" };
  }),
  can: jest.fn(async (c: string) => caps.has(c)),
  getDbRole: jest.fn(async () => "staff"),
}));
jest.mock("next/server", () => ({ after: () => {} }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
const familyMediaSources = jest.fn(async (): Promise<{ remoteId: string; claimNumber: string | null }[]> => []);
jest.mock("@/lib/workboard/all-jobs-query", () => ({
  ...jest.requireActual("@/lib/workboard/all-jobs-query"),
  familyMediaSources: (...a: unknown[]) => familyMediaSources(...(a as [])),
}));
jest.mock("@/lib/compliance/send", () => ({
  jobIsReal: jest.fn(async (orgId: string, job: string) =>
    (fake.db.sm8_jobs ?? []).some((j) => j.org_id === orgId && j.uuid === job && j.active === 1)
  ),
}));
/* the diary keeps the English: a stand-in for the model, which only runs
   on foreign words */
const englishLine = jest.fn(async (w: string) => w);
jest.mock("@/lib/workboard/note-english", () => ({ englishLine: (w: string) => englishLine(w) }));

import {
  confirmMySm8Link,
  markJobNoteDone,
  readJobNoteStates,
  replyToJobNote,
  sendJobNoteToServiceM8,
  takeBackJobNote,
  undoJobNoteDone,
} from "../job-note-sm8";
import { removeJobNote, addJobNote } from "../job-notes";
import { readJobRecord } from "../workboard";
import { replyText, NOTE_WORDS } from "@/lib/integrations/sm8-note-plan";
import { mentionedHandles } from "@/lib/workboard/sm8-mentions";

const ORG = "org-1";
const TENANT = "vendor-1";
const JOB = "0f8c2b9e-1111-4a4a-8b8b-000000000001";
const CLAIM = "0f8c2b9e-1111-4a4a-8b8b-0000000000c1";
const ISAAC_SM8 = "5a1b2c3d-0000-4000-8000-00000000aaaa";
const LUKE_SM8 = "5a1b2c3d-0000-4000-8000-00000000bbbb";
/** Luke's note on the job, asking Isaac */
const ASK = "7e7e7e7e-0000-4000-8000-00000000a5c1";
/** Luke's note on a claim, asking Isaac */
const CLAIM_ASK = "7e7e7e7e-0000-4000-8000-00000000a5c2";
/** a note that asks nobody */
const PLAIN = "7e7e7e7e-0000-4000-8000-00000000a5c3";
/** a flagged note */
const FLAG = "7e7e7e7e-0000-4000-8000-00000000f1a9";
const EDITED = "2026-09-20 10:00:00";

let seq = 0;
const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const created = (status = 201) => ({
  status,
  outcome: status >= 200 && status < 300 ? { kind: "created", remoteUuid: null } : { kind: "unavailable", status },
  remote: null,
  recordUuid: null,
});

const refused = (status: number) => ({ status, outcome: { kind: "rejected", status }, remote: null, recordUuid: null });

const notes = () => (fake.db.workboard_notes ?? []) as Row[];
const writes = () => (fake.db.sm8_writes ?? []) as Row[];
const noteRow = (id: string) => notes().find((n) => n.id === id);
const createOf = (id: string) => writes().find((w) => w.note_id === id && w.op === "create");
const deleteOf = (id: string) => writes().find((w) => w.note_id === id && w.op === "delete");
const conn = () => (fake.db.integration_connections as Row[])[0];

const reply = (over: Partial<Parameters<typeof replyToJobNote>[0]> = {}) =>
  replyToJobNote({ jobUuid: JOB, sourceNoteUuid: ASK, words: "on my way", composeId: newId(), ...over });

function seedEntry(over: Row = {}): string {
  const id = (over.id as string) ?? newId();
  notes().push({
    id,
    org_id: ORG,
    target_kind: "job",
    target_id: JOB,
    status: "applied",
    author_id: "staff-isaac",
    transcript: "the filter is in the van",
    source: "text",
    applied: { jobNotes: ["the filter is in the van"] },
    applied_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    removed_at: null,
    sm8_refusal: null,
    reply_to_sm8_note_uuid: null,
    task_id: null,
    is_task_done: false,
    ...over,
  });
  return id;
}

const as = (staff: string | null) => {
  who = staff;
};

beforeEach(() => {
  fake.reset();
  seq = 0;
  who = "staff-isaac";
  caps = new Set(["workboard"]);
  process.env.SM8_WRITES = "attachment,note";
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
    { id: "l1", org_id: ORG, provider: "servicem8", kind: "staff", tenant_id: TENANT, staff_profile_id: "staff-isaac", remote_id: ISAAC_SM8, confirmed_remote_id: ISAAC_SM8, confirmed_answer: "yes" },
    { id: "l2", org_id: ORG, provider: "servicem8", kind: "staff", tenant_id: TENANT, staff_profile_id: "staff-luke", remote_id: LUKE_SM8, confirmed_remote_id: LUKE_SM8, confirmed_answer: "yes" },
  ];
  fake.db.sm8_staff = [
    { org_id: ORG, uuid: ISAAC_SM8, first: "Isaac", last: "Smith", active: 1 },
    { org_id: ORG, uuid: LUKE_SM8, first: "Luke", last: "Ingold", active: 1 },
  ];
  fake.db.staff_profiles = [
    { org_id: ORG, id: "staff-isaac", first_name: "Isaac", last_name: "Smith", full_name: null, preferred_name: null },
    { org_id: ORG, id: "staff-luke", first_name: "Luke", last_name: "Ingold", full_name: null, preferred_name: null },
  ];
  fake.db.sm8_jobs = [
    { org_id: ORG, uuid: JOB, active: 1, generated_job_id: "2380", status: "Work Order" },
    { org_id: ORG, uuid: CLAIM, active: 1, generated_job_id: "2381", status: "Work Order" },
  ];
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
  fake.db.sm8_job_notes = [
    mirror(ASK),
    mirror(CLAIM_ASK, { related_object_uuid: CLAIM }),
    mirror(PLAIN, { note: "Filters are in the van" }),
    mirror(FLAG, { note: "@isaacsmith call the builder", action_required: "1" }),
  ];
  fake.db.sm8_writes = [];
  fake.db.workboard_notes = [];
  fake.db.job_note_actions = [];
  fake.db.workboard_flags = [];
  fake.db.tasks = [];
  getSession.mockReset().mockResolvedValue({ orgId: ORG, user: { sub: "auth0|someone" } });
  sm8AccessResult.mockReset().mockResolvedValue({ ok: true, access: { accessToken: "t", tenantId: TENANT, grant: "g", meter: TENANT } });
  postSm8Note.mockReset().mockResolvedValue(created());
  updateSm8NoteCompleter.mockReset().mockResolvedValue(created(200));
  deleteSm8Note.mockReset().mockResolvedValue(created(200));
  readSm8Note.mockReset().mockResolvedValue({ ok: true, found: false });
  familyMediaSources.mockReset().mockResolvedValue([{ remoteId: CLAIM, claimNumber: "2381" }]);
  englishLine.mockReset().mockImplementation(async (w: string) => w);
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  delete process.env.SM8_WRITES;
});

/* ── the pure pieces B leans on ── */

describe("the words a reply goes with", () => {
  it("replyText addresses the asker, keeps the words alone without one, and leaves other languages as said", () => {
    expect(replyText("lukeingold", "on my way")).toBe("@lukeingold on my way");
    expect(replyText(null, "on my way")).toBe("on my way");
    expect(replyText("lukeingold", "Tôi đang đến")).toBe("@lukeingold Tôi đang đến");
  });

  it("mentionedHandles finds @LukeIngold. and not luke@x.com", () => {
    expect(mentionedHandles("Thanks @LukeIngold.", ["lukeingold"])).toEqual(["lukeingold"]);
    expect(mentionedHandles("mail luke@x.com", ["lukeingold"])).toEqual([]);
  });
});

/* ── production today ── */

describe("on a deployment that sends files only (production today)", () => {
  beforeEach(() => {
    process.env.SM8_WRITES = "1";
  });

  it("(F) every action answers before any read or write, and the poll reads nothing", async () => {
    const id = seedEntry();
    const results = await Promise.all([
      reply(),
      sendJobNoteToServiceM8({ jobUuid: JOB, noteId: id }),
      takeBackJobNote({ jobUuid: JOB, noteId: id }),
      markJobNoteDone({ jobUuid: JOB, noteUuid: FLAG, seenEditDate: EDITED, pressId: newId() }),
      undoJobNoteDone({ jobUuid: JOB, noteUuid: FLAG, pressId: newId() }),
      confirmMySm8Link({ remoteId: ISAAC_SM8, answer: "yes" }),
    ]);
    for (const r of results) expect(r).toEqual({ ok: false, error: NOTE_WORDS.card.notesUnavailable });
    expect(await readJobNoteStates({ jobUuid: JOB })).toBeNull();
    expect(fake.log).toHaveLength(0);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("(F) a card open reads exactly what it always read: no viewer, no settings, no queue read but the strip's one echo, and the diary's own query", async () => {
    seedEntry();
    const r = await readJobRecord(JOB);
    expect(r).not.toBeNull();
    /* main's reads, one for one: the record, the diary, the strip (whose
       roster reads the links through the connection, as it always has) */
    expect(fake.log.map((s) => `${s.table}:${s.op}`).sort()).toEqual(
      [
        "job_summaries",
        "sm8_vendor",
        "sm8_jobs",
        "sm8_job_notes",
        "sm8_staff",
        "workboard_notes",
        "staff_profiles",
        "workboard_flags",
        "workboard_notes",
        "job_note_actions",
        "job_note_actions",
        "sm8_staff",
        "integration_connections",
        "integration_links",
        "staff_profiles",
        "sm8_writes",
      ]
        .map((t) => `${t}:select`)
        .sort()
    );
    // the links are the roster's, never a viewer's confirmation
    expect(fake.on("integration_links")[0].columns).not.toMatch(/confirmed/);
    expect(fake.on("sm8_writes").filter((s) => !s.filters.some((f) => f.startsWith("or(remote_uuid")))).toHaveLength(0);
    // the diary's own read, exactly as it was: its columns and its status
    const ours = fake.on("workboard_notes").filter((s) => s.columns?.includes("transcript"));
    expect(ours).toHaveLength(1);
    expect(ours[0].columns).toBe("id, transcript, applied, applied_at, created_at, author_id");
    expect(ours[0].filters).toContain("status=applied");
    // nothing on the record that notes would add
    expect(r).not.toHaveProperty("sender");
    expect(r).not.toHaveProperty("flags");
    expect(r!.ourNotes[0]).toEqual({ id: expect.any(String), text: "the filter is in the van", at: expect.any(String), author: "Isaac Smith" });
    // and a mention on the strip is today's
    expect(r!.attention.items.find((i) => i.kind === "mention")).not.toHaveProperty("you");
  });

  it("(F) Remove deletes as today, with no read", async () => {
    const id = seedEntry();
    expect(await removeJobNote(id)).toEqual({ ok: true, gone: true });
    expect(noteRow(id)).toBeUndefined();
    expect(fake.log.map((s) => `${s.table}:${s.op}`)).toEqual(["workboard_notes:delete"]);
  });

  it("(F) (verifier 10) a row a queue row names can't be removed: it stays, with its queue rows, and says why", async () => {
    const id = seedEntry();
    writes().push({ id: "w1", org_id: ORG, kind: "note", op: "create", note_id: id, status: "sent", subject: `jobnote:${id}` });
    expect(await removeJobNote(id)).toEqual({ ok: false, error: NOTE_WORDS.press.removeHeld });
    expect(noteRow(id)).toBeDefined();
    expect(writes()).toHaveLength(1);
  });
});

/* ── a reply ── */

describe("replying to a note that mentions you", () => {
  it("(F) saves the reply, threaded to what it answers, and sends it as you on that note's job", async () => {
    const composeId = newId();
    const r = await reply({ composeId });
    expect(r).toMatchObject({ ok: true, note: { id: composeId, replyTo: ASK, mine: true } });
    expect(noteRow(composeId)).toMatchObject({
      target_kind: "job",
      target_id: JOB,
      author_id: "staff-isaac",
      reply_to_sm8_note_uuid: ASK,
      status: "applied",
      applied: { jobNotes: ["@lukeingold on my way"], sm8Text: "@lukeingold on my way" },
    });
    expect(noteRow(composeId)!.applied_at).toBeTruthy();
    expect(createOf(composeId)).toMatchObject({ subject: `jobnote:${composeId}`, sm8_job_uuid: JOB, payload: { name: "Reply" } });
    expect(postSm8Note).toHaveBeenCalledTimes(1);
    expect(postSm8Note.mock.calls[0][1]).toMatchObject({ relatedUuid: JOB, text: "@lukeingold on my way", asStaffUuid: ISAAC_SM8 });
    // the line, as the person who sent it reads it
    if (!r.ok) throw new Error("reply refused");
    expect(r.note.state).toMatchObject({ key: "line.sent", acts: ["undo"] });
  });

  it("a reply to a note filed on a claim goes to the claim", async () => {
    const composeId = newId();
    expect(await reply({ sourceNoteUuid: CLAIM_ASK, composeId })).toMatchObject({ ok: true });
    expect(createOf(composeId)).toMatchObject({ sm8_job_uuid: CLAIM });
    expect(noteRow(composeId)).toMatchObject({ target_id: JOB });
  });

  it("(F) a spoken reply in Vietnamese goes as said, and the diary keeps the English — every time it is sent", async () => {
    englishLine.mockImplementation(async () => "I'm on my way");
    postSm8Note.mockResolvedValueOnce(refused(422));
    const composeId = newId();
    await reply({ words: "Tôi đang đến", spoken: true, composeId });
    expect(noteRow(composeId)).toMatchObject({
      transcript: "Tôi đang đến",
      source: "voice",
      applied: { jobNotes: ["@lukeingold I'm on my way"], sm8Text: "@lukeingold Tôi đang đến" },
    });
    expect(createOf(composeId)).toMatchObject({ status: "failed", note_text: "@lukeingold Tôi đang đến" });
    // Send again: the words as said, never the English
    expect(await sendJobNoteToServiceM8({ jobUuid: JOB, noteId: composeId })).toMatchObject({ ok: true });
    expect(postSm8Note).toHaveBeenCalledTimes(2);
    expect(postSm8Note.mock.calls[1][1]).toMatchObject({ text: "@lukeingold Tôi đang đến" });
  });

  describe("is refused with nothing saved, and the words stay in the box", () => {
    const nothingSaved = () => {
      expect(notes()).toHaveLength(0);
      expect(writes()).toHaveLength(0);
    };

    it("without a press", async () => {
      getSession.mockResolvedValue(null);
      expect(await reply()).toMatchObject({ ok: false });
      nothingSaved();
    });

    it("without Workboard access", async () => {
      caps = new Set();
      expect(await reply()).toMatchObject({ ok: false });
      nothingSaved();
    });

    it("where notes aren't offered: the owner's Notes Off", async () => {
      conn().write_kinds = ["attachment"];
      expect(await reply()).toEqual({ ok: false, error: NOTE_WORDS.press.kindOff });
      nothingSaved();
    });

    it("an empty reply", async () => {
      expect(await reply({ words: "   " })).toEqual({ ok: false, error: NOTE_WORDS.press.emptyReply });
      nothingSaved();
    });

    it("unlinked", async () => {
      fake.db.integration_links.splice(0, 1);
      expect(await reply()).toMatchObject({ ok: false, error: NOTE_WORDS.press.unlinked });
      nothingSaved();
    });

    it("unconfirmed: the question, with who the server found", async () => {
      Object.assign(fake.db.integration_links[0], { confirmed_answer: null, confirmed_remote_id: null });
      expect(await reply()).toMatchObject({
        ok: false,
        error: "Is Isaac Smith you?",
        sender: { state: "confirm", remoteId: ISAAC_SM8, handle: "isaacsmith" },
      });
      nothingSaved();
    });

    it("a note that doesn't mention you", async () => {
      expect(await reply({ sourceNoteUuid: PLAIN })).toEqual({ ok: false, error: NOTE_WORDS.press.notMentioned });
      nothingSaved();
    });

    it("(F) a job no longer active in ServiceM8's copy — checked before the save", async () => {
      fake.db.sm8_jobs[0].active = 0;
      expect(await reply()).toEqual({ ok: false, error: NOTE_WORDS.press.jobGone });
      nothingSaved();
    });

    it("a note that isn't on this job or one of its claims", async () => {
      familyMediaSources.mockResolvedValue([]);
      expect(await reply({ sourceNoteUuid: CLAIM_ASK })).toEqual({ ok: false, error: NOTE_WORDS.press.noNote });
      nothingSaved();
    });
  });

  it("(F) the same compose id twice is one row and one note; two ids are two; the same id after an Undo is refused and queues nothing", async () => {
    const a = newId();
    await reply({ composeId: a });
    await reply({ composeId: a });
    expect(notes().filter((n) => n.id === a)).toHaveLength(1);
    expect(writes().filter((w) => w.note_id === a)).toHaveLength(1);
    expect(postSm8Note).toHaveBeenCalledTimes(1);
    const b = newId();
    await reply({ composeId: b, words: "on my way" });
    expect(notes()).toHaveLength(2);
    expect(postSm8Note).toHaveBeenCalledTimes(2);
    // Undo, then the box's late second press
    expect(await takeBackJobNote({ jobUuid: JOB, noteId: a })).toMatchObject({ ok: true });
    const before = writes().length;
    expect(await reply({ composeId: a })).toEqual({ ok: false, error: NOTE_WORDS.press.noNote });
    expect(writes()).toHaveLength(before);
  });

  it("(F) while paused the reply is saved and held, never refused and deleted; a capped queue keeps the row with why", async () => {
    conn().write_mode = "paused";
    const a = newId();
    const r = await reply({ composeId: a });
    expect(r).toMatchObject({ ok: true, note: { state: { key: "line.waitingWhy", text: "Not in ServiceM8 yet. Sending is paused.", acts: ["undo"] } } });
    expect(createOf(a)).toMatchObject({ status: "queued" });
    expect(postSm8Note).not.toHaveBeenCalled();

    conn().write_mode = "live";
    for (let i = 0; i < 60; i++) {
      writes().push({ id: `cap-${i}`, org_id: "org-2", tenant_id: TENANT, kind: "attachment", status: "sent", pressed_at: new Date().toISOString(), subject: `document:${i}` });
    }
    const b = newId();
    const capped = await reply({ composeId: b });
    expect(capped).toMatchObject({ ok: true, note: { state: { key: "line.notSent" } } });
    expect(noteRow(b)).toMatchObject({ sm8_refusal: "capped" });
  });

  describe("(F) a note that no longer stands is not answered, and nothing is saved or queued", () => {
    /** Isaac's two replies to Luke's ask, both in ServiceM8; each mentions
        Luke, so Luke may answer either. */
    const twoSent = async () => {
      const a = newId();
      const b = newId();
      await reply({ composeId: a });
      await reply({ composeId: b, words: "grilles ordered" });
      expect(createOf(a)).toMatchObject({ status: "sent" });
      expect(createOf(b)).toMatchObject({ status: "sent" });
      return { a, b, aUuid: createOf(a)!.remote_uuid as string, bUuid: createOf(b)!.remote_uuid as string };
    };
    const lukeAnswers = (sourceNoteUuid: string) => {
      as("staff-luke");
      return reply({ sourceNoteUuid, words: "cheers" });
    };
    const nothingNew = (notesBefore: number, writesBefore: number) => {
      expect(notes()).toHaveLength(notesBefore);
      expect(writes()).toHaveLength(writesBefore);
    };

    it("one somebody removed in ServiceM8", async () => {
      fake.db.sm8_job_notes.find((n) => n.uuid === ASK)!.active = 0;
      expect(await reply()).toEqual({ ok: false, error: NOTE_WORDS.press.noNote });
      nothingNew(0, 0);
    });

    it("one of ours its author took back, while it is still being taken out of ServiceM8", async () => {
      const { a, aUuid, bUuid } = await twoSent();
      conn().write_mode = "paused";
      expect(await takeBackJobNote({ jobUuid: JOB, noteId: a })).toMatchObject({ ok: true, gone: false });
      expect(deleteOf(a)).toMatchObject({ status: "queued" });
      conn().write_mode = "live";
      const [n, w] = [notes().length, writes().length];
      expect(await lukeAnswers(aUuid)).toEqual({ ok: false, error: NOTE_WORDS.press.noNote });
      nothingNew(n, w);
      // the one still standing is answered as ever
      expect(await lukeAnswers(bUuid)).toMatchObject({ ok: true, note: { replyTo: bUuid } });
    });

    it("one of ours whose create was closed by a take-back that stopped before its row was removed", async () => {
      const { a, aUuid } = await twoSent();
      createOf(a)!.taken_back_at = new Date().toISOString();
      expect(noteRow(a)!.removed_at).toBeNull();
      const [n, w] = [notes().length, writes().length];
      expect(await lukeAnswers(aUuid)).toEqual({ ok: false, error: NOTE_WORDS.press.noNote });
      nothingNew(n, w);
    });

    it("one of ours whose row was removed, its create not closed", async () => {
      const { a, aUuid } = await twoSent();
      noteRow(a)!.removed_at = new Date().toISOString();
      expect(createOf(a)!.taken_back_at).toBeNull();
      const [n, w] = [notes().length, writes().length];
      expect(await lukeAnswers(aUuid)).toEqual({ ok: false, error: NOTE_WORDS.press.noNote });
      nothingNew(n, w);
    });

    it("one of ours taken back whose copy the mirror still holds as active (the sync hasn't caught up)", async () => {
      const { a, aUuid, bUuid } = await twoSent();
      for (const [uuid, text] of [
        [aUuid, "@lukeingold on my way"],
        [bUuid, "@lukeingold grilles ordered"],
      ]) {
        fake.db.sm8_job_notes.push({
          org_id: ORG,
          uuid,
          related_object_uuid: JOB,
          note: text,
          create_date: "2026-09-20 10:00:00",
          action_required: "0",
          action_completed_by_staff_uuid: null,
          edit_by_staff_uuid: ISAAC_SM8,
          edit_date: "2026-09-20 10:00:00",
          active: 1,
        });
      }
      conn().write_mode = "paused";
      await takeBackJobNote({ jobUuid: JOB, noteId: a });
      conn().write_mode = "live";
      const [n, w] = [notes().length, writes().length];
      expect(await lukeAnswers(aUuid)).toEqual({ ok: false, error: NOTE_WORDS.press.noNote });
      nothingNew(n, w);
      expect(await lukeAnswers(bUuid)).toMatchObject({ ok: true });
    });

    it("and where that can't be read, nothing is saved on a guess", async () => {
      fake.failing.add("sm8_writes");
      expect(await reply()).toEqual({ ok: false, error: NOTE_WORDS.press.saveFailed });
      fake.failing.delete("sm8_writes");
      nothingNew(0, 0);
    });
  });
});

/* ── Send to ServiceM8 ── */

describe("sending a diary entry", () => {
  it("(F) only its author; anyone else is refused and nothing is queued", async () => {
    const id = seedEntry();
    as("staff-luke");
    expect(await sendJobNoteToServiceM8({ jobUuid: JOB, noteId: id })).toEqual({ ok: false, error: NOTE_WORDS.press.notAuthor });
    expect(writes()).toHaveLength(0);
    as("staff-isaac");
    expect(await sendJobNoteToServiceM8({ jobUuid: JOB, noteId: id })).toMatchObject({ ok: true, state: { key: "line.sent" } });
    expect(createOf(id)).toMatchObject({ sm8_job_uuid: JOB, payload: { name: "Note" }, note_text: "the filter is in the van" });
  });

  it("(F) a Send again goes where the note's create went, whatever job the browser names", async () => {
    const id = newId();
    await reply({ sourceNoteUuid: CLAIM_ASK, composeId: id });
    createOf(id)!.status = "failed";
    // the browser names the note's own job; the create's object stands
    expect(await sendJobNoteToServiceM8({ jobUuid: JOB, noteId: id })).toMatchObject({ ok: true });
    expect(createOf(id)).toMatchObject({ sm8_job_uuid: CLAIM });
    // and another job isn't this note's
    expect(await sendJobNoteToServiceM8({ jobUuid: CLAIM, noteId: id })).toEqual({ ok: false, error: NOTE_WORDS.press.noNote });
  });

  it("a refusal kept on the row comes back with the line that says it", async () => {
    const id = seedEntry();
    fake.db.integration_links.splice(0, 1);
    const r = await sendJobNoteToServiceM8({ jobUuid: JOB, noteId: id });
    expect(r).toMatchObject({ ok: false, error: NOTE_WORDS.press.unlinked, state: { key: "line.notSent", acts: ["send_again", "undo"] } });
    expect(noteRow(id)).toMatchObject({ sm8_refusal: "unlinked" });
  });
});

/* ── the link question ── */

describe("\"Is <name> you?\"", () => {
  beforeEach(() => {
    Object.assign(fake.db.integration_links[0], { confirmed_answer: null, confirmed_remote_id: null });
  });

  it("Yes confirms your own link and sends nothing by itself", async () => {
    const r = await confirmMySm8Link({ remoteId: ISAAC_SM8, answer: "yes" });
    expect(r).toMatchObject({ ok: true, sender: { state: "ready", staffUuid: ISAAC_SM8 } });
    expect(fake.db.integration_links[0]).toMatchObject({ confirmed_answer: "yes", confirmed_remote_id: ISAAC_SM8 });
    expect(writes()).toHaveLength(0);
    expect(postSm8Note).not.toHaveBeenCalled();
  });

  it("(F) Yes after an owner relinked you says so and confirms nothing", async () => {
    fake.db.integration_links[0].remote_id = LUKE_SM8.replace("bbbb", "cccc");
    expect(await confirmMySm8Link({ remoteId: ISAAC_SM8, answer: "yes" })).toEqual({ ok: false, error: NOTE_WORDS.press.linkChanged });
    expect(fake.db.integration_links[0].confirmed_answer).toBeNull();
  });

  it("(F) Not me is kept as a denial, and you read as denied, handle and all", async () => {
    const r = await confirmMySm8Link({ remoteId: ISAAC_SM8, answer: "no" });
    expect(r).toMatchObject({ ok: true, sender: { state: "denied", handle: "isaacsmith", sm8Name: "Isaac Smith" } });
    expect(fake.db.integration_links[0]).toMatchObject({ confirmed_answer: "no" });
  });

  it("answers only for your own card", async () => {
    await confirmMySm8Link({ remoteId: LUKE_SM8, answer: "yes" });
    expect(fake.db.integration_links[1]).toMatchObject({ confirmed_answer: "yes" }); // Luke's own, untouched
    expect(fake.db.integration_links[0].confirmed_answer).toBeNull();
  });
});

/* ── ServiceM8's flags ── */

describe("marking a flagged note done", () => {
  const mark = (over: Partial<Parameters<typeof markJobNoteDone>[0]> = {}) =>
    markJobNoteDone({ jobUuid: JOB, noteUuid: FLAG, seenEditDate: EDITED, pressId: newId(), ...over });

  it("(F) queues an update of that note, as you, under a uuid of its own", async () => {
    conn().write_mode = "paused";
    const r = await mark();
    expect(r).toMatchObject({ ok: true, state: { key: "flag.waitingWhy" } });
    const op = writes().find((w) => w.op === "update")!;
    expect(op).toMatchObject({ target_uuid: FLAG, flag_done: true, seen_edit_date: EDITED, requested_by: "staff-isaac" });
    expect(op.remote_uuid).not.toBe(FLAG);
  });

  it("(F) a note changed in ServiceM8 since it was read is refused, and nothing is queued", async () => {
    expect(await mark({ seenEditDate: "2026-09-19 08:00:00" })).toMatchObject({ ok: false, error: NOTE_WORDS.press.changed });
    expect(writes()).toHaveLength(0);
  });
});

describe("taking a Mark done back", () => {
  const mark = () => markJobNoteDone({ jobUuid: JOB, noteUuid: FLAG, seenEditDate: EDITED, pressId: newId() });
  const undo = () => undoJobNoteDone({ jobUuid: JOB, noteUuid: FLAG, pressId: newId() });

  beforeEach(() => {
    conn().write_mode = "paused";
  });

  it("(F) a waiting mark is cancelled, with no edit time and nothing queued — also with Notes Off", async () => {
    await mark();
    conn().write_kinds = ["attachment"];
    const before = writes().length;
    const r = await undo();
    expect(r).toMatchObject({ ok: true });
    expect(writes()).toHaveLength(before);
    expect(writes().find((w) => w.op === "update")).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.takenBackBeforeSent });
    expect(updateSm8NoteCompleter).not.toHaveBeenCalled();
  });

  it("(F) somebody else's Undo names who marked it, and their card offers them no Undo", async () => {
    await mark();
    as("staff-luke");
    expect(await undo()).toMatchObject({ ok: false, error: "Only Isaac Smith, who marked it done, can take that back." });
    expect(writes().find((w) => w.op === "update")).toMatchObject({ status: "queued" });
    const states = await readJobNoteStates({ jobUuid: JOB });
    expect(states!.flags[FLAG].acts).not.toContain("unmark");
    as("staff-isaac");
    expect((await readJobNoteStates({ jobUuid: JOB }))!.flags[FLAG].acts).toContain("unmark");
  });

  it("(F) (verifier r2 11) a mark that went out in between can't be taken back here, and says so as final", async () => {
    await mark();
    writes().find((w) => w.op === "update")!.status = "sending";
    expect(await undo()).toMatchObject({ ok: false, error: NOTE_WORDS.press.inFlightFinal });
  });
});

/* ── taking a note back ── */

describe("Undo and Remove on a note that went, or was queued", () => {
  it("(F) with Notes Off: a reply whose create was cancelled goes; a sent one is removed but stays, still in ServiceM8, with Try again", async () => {
    const a = newId();
    conn().write_mode = "paused";
    await reply({ composeId: a });
    Object.assign(createOf(a)!, { status: "cancelled", last_error: NOTE_WORDS.row.notesSwitchedOff });
    conn().write_mode = "live";
    const b = newId();
    await reply({ composeId: b });
    expect(createOf(b)).toMatchObject({ status: "sent" });

    conn().write_kinds = ["attachment"];
    expect(await takeBackJobNote({ jobUuid: JOB, noteId: a })).toEqual({ ok: true, gone: true, state: null });
    expect(noteRow(a)!.removed_at).toBeTruthy();

    const r = await takeBackJobNote({ jobUuid: JOB, noteId: b });
    expect(r).toEqual({
      ok: false,
      error: NOTE_WORDS.press.takeBackOff,
      state: expect.objectContaining({ key: "line.stillIn", text: "Still in ServiceM8. Sending notes is switched off.", acts: ["take_out_again"] }),
    });
    expect(createOf(b)!.taken_back_at).toBeTruthy();
    expect(noteRow(b)!.removed_at).toBeTruthy();
    expect(deleteSm8Note).not.toHaveBeenCalled();
  });

  it("Undo of a sent reply takes it out of ServiceM8, and the row goes", async () => {
    const a = newId();
    await reply({ composeId: a });
    const r = await takeBackJobNote({ jobUuid: JOB, noteId: a });
    expect(r).toEqual({ ok: true, gone: true, state: null });
    expect(deleteOf(a)).toMatchObject({ status: "sent" });
    expect(deleteSm8Note).toHaveBeenCalledTimes(1);
  });

  describe("(F) (verifier r2 1) by anyone but its sender: refused, naming them, and nothing queued", () => {
    const refusedFor = async (id: string) => {
      as("staff-luke");
      const before = JSON.stringify(writes());
      expect(await takeBackJobNote({ jobUuid: JOB, noteId: id })).toEqual({
        ok: false,
        error: "Only Isaac Smith, who sent it, can take it out of ServiceM8.",
      });
      expect(JSON.stringify(writes())).toBe(before);
      as("staff-isaac");
    };

    it("on a live row", async () => {
      const a = newId();
      await reply({ composeId: a });
      await refusedFor(a);
    });

    it("on a removed row still in ServiceM8, its delete failed (case 3)", async () => {
      const a = newId();
      await reply({ composeId: a });
      deleteSm8Note.mockResolvedValueOnce(refused(422));
      await takeBackJobNote({ jobUuid: JOB, noteId: a });
      expect(deleteOf(a)).toMatchObject({ status: "failed" });
      await refusedFor(a);
    });

    it("on a removed row still in ServiceM8, its delete never queued (case 5)", async () => {
      const a = newId();
      await reply({ composeId: a });
      conn().write_kinds = ["attachment"];
      await takeBackJobNote({ jobUuid: JOB, noteId: a });
      expect(deleteOf(a)).toBeUndefined();
      await refusedFor(a);
    });

    it("on a removed row whose create isn't closed", async () => {
      const a = newId();
      await reply({ composeId: a });
      Object.assign(noteRow(a)!, { removed_at: new Date().toISOString() });
      expect(createOf(a)!.taken_back_at).toBeNull();
      await refusedFor(a);
    });
  });
});

describe("Remove (removeJobNote)", () => {
  it("a plain entry that never left HeyTiff is deleted, by anyone with Workboard access", async () => {
    const id = seedEntry();
    as("staff-luke");
    expect(await removeJobNote(id)).toEqual({ ok: true, gone: true });
    expect(noteRow(id)).toBeUndefined();
  });

  it("queued: the create is closed and cancelled, and the row is kept as a tombstone", async () => {
    conn().write_mode = "paused";
    const id = seedEntry();
    await sendJobNoteToServiceM8({ jobUuid: JOB, noteId: id });
    expect(await removeJobNote(id)).toEqual({ ok: true, gone: true });
    expect(noteRow(id)!.removed_at).toBeTruthy();
    expect(createOf(id)).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.takenBackBeforeSent });
    expect(createOf(id)!.taken_back_at).toBeTruthy();
  });

  it("(F) sent: removed at once, then a delete is queued", async () => {
    conn().write_mode = "live";
    const id = seedEntry();
    await sendJobNoteToServiceM8({ jobUuid: JOB, noteId: id });
    conn().write_mode = "paused";
    const r = await removeJobNote(id);
    expect(r).toEqual({ ok: true, gone: false });
    expect(noteRow(id)!.removed_at).toBeTruthy();
    expect(deleteOf(id)).toMatchObject({ status: "queued", depends_on: createOf(id)!.id });
  });

  it("(F) cancelled but it may have landed: a delete is queued", async () => {
    conn().write_mode = "paused";
    const id = seedEntry();
    await sendJobNoteToServiceM8({ jobUuid: JOB, noteId: id });
    Object.assign(createOf(id)!, { status: "cancelled", maybe_landed: true, last_error: "Sending was switched off." });
    await removeJobNote(id);
    expect(deleteOf(id)).toMatchObject({ status: "queued" });
  });

  it("someone else can't remove a copy that went", async () => {
    const id = seedEntry();
    await sendJobNoteToServiceM8({ jobUuid: JOB, noteId: id });
    as("staff-luke");
    expect(await removeJobNote(id)).toEqual({ ok: false, error: "Only Isaac Smith, who sent it, can take it out of ServiceM8." });
    expect(noteRow(id)!.removed_at).toBeNull();
  });

  it("(F) (verifier r2 1) someone else's Remove on a removed row still in ServiceM8 names its sender, and queues nothing", async () => {
    const id = seedEntry();
    await sendJobNoteToServiceM8({ jobUuid: JOB, noteId: id });
    conn().write_kinds = ["attachment"];
    await takeBackJobNote({ jobUuid: JOB, noteId: id });
    expect(noteRow(id)!.removed_at).toBeTruthy();
    const before = JSON.stringify(writes());
    as("staff-luke");
    expect(await removeJobNote(id)).toEqual({ ok: false, error: "Only Isaac Smith, who sent it, can take it out of ServiceM8." });
    expect(JSON.stringify(writes())).toBe(before);
    expect(noteRow(id)).toBeDefined();
  });

  it("(F) (verifier 2c) a Remove racing its author's Send meets the key, and takes it back as the author — or not at all for anyone else", async () => {
    conn().write_mode = "paused";
    const race = async (remover: string) => {
      const id = seedEntry();
      /* the author's Send lands between the Remove's read and its delete */
      fake.before.workboard_notes = (s) => {
        if (s.op !== "delete") return;
        fake.before.workboard_notes = undefined;
        writes().push({
          id: `c-${id}`,
          org_id: ORG,
          tenant_id: TENANT,
          kind: "note",
          op: "create",
          note_id: id,
          status: "queued",
          subject: `jobnote:${id}`,
          sm8_job_uuid: JOB,
          requested_by: "staff-isaac",
          remote_uuid: newId(),
          taken_back_at: null,
          maybe_landed: false,
          verify_uuids: [],
          attempts: 0,
          last_error: null,
          lease_until: null,
        });
      };
      as(remover);
      const r = await removeJobNote(id);
      as("staff-isaac");
      return { id, r };
    };
    const mine = await race("staff-isaac");
    expect(mine.r).toEqual({ ok: true, gone: true });
    expect(noteRow(mine.id)!.removed_at).toBeTruthy();
    expect(createOf(mine.id)).toMatchObject({ status: "cancelled" });

    const theirs = await race("staff-luke");
    expect(theirs.r).toEqual({ ok: false, error: "Only Isaac Smith, who sent it, can take it out of ServiceM8." });
    expect(noteRow(theirs.id)!.removed_at).toBeNull();
    expect(createOf(theirs.id)).toMatchObject({ status: "queued" });
  });
});

/* ── the pen, under its own id ── */

describe("the pen saves once per compose id (verifier r2 12)", () => {
  it("(F) the same id twice is one entry; different words under it are a second; one taken back is gone for good", async () => {
    const id = newId();
    const a = await addJobNote(JOB, "Drain kit still to go on", { id });
    const b = await addJobNote(JOB, "Drain kit still to go on", { id });
    expect(a.id).toBe(id);
    expect(b.id).toBe(id);
    expect(notes()).toHaveLength(1);
    const c = await addJobNote(JOB, "Something else entirely", { id });
    expect(c.id).not.toBe(id);
    expect(notes()).toHaveLength(2);
    // taken back, then the same id again
    await sendJobNoteToServiceM8({ jobUuid: JOB, noteId: id });
    await takeBackJobNote({ jobUuid: JOB, noteId: id });
    const before = writes().length;
    await expect(addJobNote(JOB, "Drain kit still to go on", { id })).rejects.toThrow("That note is no longer here.");
    expect(writes()).toHaveLength(before);
  });

  it("an id that isn't a uuid saves nothing", async () => {
    await expect(addJobNote(JOB, "hello", { id: "tmp-1" })).rejects.toThrow("Couldn't save that note");
    expect(notes()).toHaveLength(0);
  });

  it("someone else's id is never theirs to write under", async () => {
    const id = newId();
    await addJobNote(JOB, "mine", { id });
    as("staff-luke");
    await expect(addJobNote(JOB, "mine", { id })).rejects.toThrow("Couldn't save that note");
    expect(notes()).toHaveLength(1);
  });
});

/* ── the card's poll ── */

describe("readJobNoteStates", () => {
  it("says where each of our notes stands and each flag, for the viewer", async () => {
    conn().write_mode = "paused";
    const a = newId();
    await reply({ composeId: a });
    const s = await readJobNoteStates({ jobUuid: JOB });
    expect(s!.ours[a]).toMatchObject({ key: "line.waitingWhy", acts: ["undo"] });
    expect(s!.flags[FLAG]).toMatchObject({ key: "flag.flagged", acts: ["mark_done"] });
    as("staff-luke");
    expect((await readJobNoteStates({ jobUuid: JOB }))!.ours[a].acts).toEqual([]);
  });
});
