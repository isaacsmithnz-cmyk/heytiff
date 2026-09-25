/**
 * @jest-environment node
 */

/* A task's Done, to ServiceM8 and back (two-way phase 2, PR C).

   Ticking a task made from a ServiceM8 mention files "@lukeingold Done." in
   the job's diary and sends it as whoever ticked; Reopen takes it back; the
   task's page and the bell say what became of it. Held here against the
   in-memory database that keeps the notes migrations' rules (fixtures/
   sm8-fake-db — the one-Done index and the task keys included), with the
   real queue helpers and the real sender behind them and ServiceM8 replaced
   at its request functions. Every action is a Server Function, reachable by
   direct POST: what is held is what the server does.

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
/* the real actions, counted: a tick where notes aren't sent must not even
   ask for a Done */
const doneCalls = { send: 0, takeBack: 0 };
jest.mock("@/app/actions/task-sm8", () => {
  const actual = jest.requireActual("@/app/actions/task-sm8");
  return {
    ...actual,
    sendTaskDone: (...a: unknown[]) => {
      doneCalls.send++;
      return actual.sendTaskDone(...a);
    },
    takeBackTaskDone: (...a: unknown[]) => {
      doneCalls.takeBack++;
      return actual.takeBackTaskDone(...a);
    },
  };
});
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
/** who is signed in: their staff card */
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
jest.mock("@/lib/workboard/note-english", () => ({ englishLine: async (w: string) => w }));

import { completeTask, deleteTask, reopenTask } from "../dashboard";
import { retryTaskDone, sendTaskDone, takeBackTaskDone } from "../task-sm8";
import { replyToJobNote, sendJobNoteToServiceM8, takeBackJobNote } from "../job-note-sm8";
import { myUnsentDones, readTaskDoneLines } from "@/lib/dashboard/task-done-query";
import { readJobAttention, readOurJobNotes } from "@/lib/workboard/job-notes-query";
import { readJobNotes } from "@/lib/workboard/all-jobs-query";
import { recentlyDoneTasks } from "@/lib/dashboard/tasks-query";
import { sm8DoneChip } from "@/lib/dashboard/chips";
import { assembleChips } from "@/lib/dashboard/assemble";
import { fillWords, NOTE_WORDS, noteSubject } from "@/lib/integrations/sm8-note-plan";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";

const ORG = "org-1";
const TENANT = "vendor-1";
const JOB = "0f8c2b9e-1111-4a4a-8b8b-000000000001";
const ISAAC_SM8 = "5a1b2c3d-0000-4000-8000-00000000aaaa";
const LUKE_SM8 = "5a1b2c3d-0000-4000-8000-00000000bbbb";
/** Luke's note on the job, asking Isaac */
const ASK = "7e7e7e7e-0000-4000-8000-00000000a5c1";
/** the task made from it, on Isaac */
const TASK = "3a3a3a3a-0000-4000-8000-00000000000a";
/** a task typed straight in: made from no note */
const PLAIN_TASK = "3a3a3a3a-0000-4000-8000-00000000000b";

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
const tasks = () => (fake.db.tasks ?? []) as Row[];
const task = (id = TASK) => tasks().find((t) => t.id === id)!;
const dones = (taskId: string | null = TASK) => notes().filter((n) => n.is_task_done && n.task_id === taskId);
const liveDone = (taskId = TASK) => dones(taskId).find((n) => !n.removed_at);
const createOf = (noteId: unknown) => writes().find((w) => w.note_id === noteId && w.op === "create");
const deleteOf = (noteId: unknown) => writes().find((w) => w.note_id === noteId && w.op === "delete");
const conn = () => (fake.db.integration_connections as Row[])[0];
const as = (staff: string | null) => {
  who = staff;
};
const tick = (id = TASK) => completeTask(id, { postDone: true });
const reopen = (id = TASK) => reopenTask(id, { takeBackDone: true });
const linesFor = async (viewer: string | null, ids = [TASK]) => readTaskDoneLines(ORG, viewer, ids);
const SINCE = "2026-01-01";

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
  fake.db.sm8_jobs = [{ org_id: ORG, uuid: JOB, active: 1, generated_job_id: "2380", status: "Work Order" }];
  fake.db.sm8_job_notes = [
    {
      org_id: ORG,
      uuid: ASK,
      related_object_uuid: JOB,
      note: "@isaacsmith can you order the grilles",
      create_date: "2026-09-20 09:00:00",
      action_required: "0",
      action_completed_by_staff_uuid: null,
      edit_by_staff_uuid: LUKE_SM8,
      edit_date: "2026-09-20 10:00:00",
      active: 1,
    },
  ];
  const aTask = (id: string, title: string) => ({
    org_id: ORG,
    id,
    title,
    detail: null,
    assigned_to: "staff-isaac",
    created_by: "staff-luke",
    due_date: null,
    status: "open",
    created_at: "2026-09-20T00:00:00.000Z",
    done_at: null,
    done_by: null,
    remind_at: null,
    remind_kind: null,
  });
  fake.db.tasks = [aTask(TASK, "Order the grilles"), aTask(PLAIN_TASK, "Renew the WHS induction")];
  fake.db.job_note_actions = [{ org_id: ORG, sm8_note_uuid: ASK, sm8_job_uuid: JOB, action: "task", task_id: TASK }];
  fake.db.sm8_writes = [];
  fake.db.workboard_notes = [];
  fake.db.workboard_flags = [];
  getSession.mockReset().mockResolvedValue({ orgId: ORG, user: { sub: "auth0|someone" } });
  sm8AccessResult.mockReset().mockResolvedValue({ ok: true, access: { accessToken: "t", tenantId: TENANT, grant: "g", meter: TENANT } });
  postSm8Note.mockReset().mockResolvedValue(created());
  updateSm8NoteCompleter.mockReset().mockResolvedValue(created(200));
  deleteSm8Note.mockReset().mockResolvedValue(created(200));
  readSm8Note.mockReset().mockResolvedValue({ ok: true, found: false });
  familyMediaSources.mockReset().mockResolvedValue([]);
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  delete process.env.SM8_WRITES;
});

/* ── production today ── */

describe("on a deployment that sends files only (production today)", () => {
  beforeEach(() => {
    process.env.SM8_WRITES = "1";
  });

  it("(F) 10. a hand tick is the one read and one write it always was, and the Done actions answer before their first read", async () => {
    doneCalls.send = doneCalls.takeBack = 0;
    expect(await tick()).toEqual({ ok: true });
    // the tick never even asks for a Done where notes aren't sent
    expect(doneCalls.send).toBe(0);
    expect(fake.log.map((s) => `${s.table}:${s.op}`)).toEqual(["tasks:select", "tasks:update"]);
    expect(task().status).toBe("done");
    expect(notes()).toHaveLength(0);
    expect(writes()).toHaveLength(0);

    fake.log.length = 0;
    getSession.mockClear();
    const quiet = { ok: true, state: null };
    expect(await sendTaskDone({ taskId: TASK })).toEqual(quiet);
    expect(await takeBackTaskDone({ taskId: TASK })).toEqual(quiet);
    expect(await retryTaskDone({ taskId: TASK, noteId: newId(), act: "send_again" })).toEqual(quiet);
    expect(fake.log).toHaveLength(0);
    expect(getSession).not.toHaveBeenCalled();

    // a Reopen with the flag is the one read and one write too
    doneCalls.send = doneCalls.takeBack = 0;
    expect(await reopen()).toEqual({ ok: true });
    expect(fake.log.map((s) => `${s.table}:${s.op}`)).toEqual(["tasks:select", "tasks:update"]);
    expect(doneCalls.takeBack).toBe(0);
    expect(postSm8Note).not.toHaveBeenCalled();
  });

  it("(F) 23. the task lines and the bell read nothing at all", async () => {
    expect(await linesFor("staff-isaac")).toEqual({ lines: {}, sender: null });
    expect(await myUnsentDones(ORG, "staff-isaac", SINCE)).toEqual([]);
    expect(fake.log).toHaveLength(0);
  });

  it("(F) 28. the done list is only your own assignments, as it always was", async () => {
    Object.assign(task(PLAIN_TASK), { assigned_to: "staff-luke", status: "done", done_by: "staff-isaac", done_at: new Date().toISOString() });
    expect((await recentlyDoneTasks(ORG, "staff-isaac", 7)).map((t) => t.id)).toEqual([]);
    process.env.SM8_WRITES = "attachment,note";
    expect((await recentlyDoneTasks(ORG, "staff-isaac", 7)).map((t) => t.id)).toEqual([PLAIN_TASK]);
  });
});

/* ── ticking and the Done ── */

describe("ticking a task made from a mention", () => {
  it("(F) 1. a tick with no postDone — the bell's code path, a reply's close — files and queues nothing", async () => {
    expect(await completeTask(TASK)).toEqual({ ok: true });
    expect(task().status).toBe("done");
    expect(notes()).toHaveLength(0);
    expect(writes()).toHaveLength(0);
    expect(postSm8Note).not.toHaveBeenCalled();
  });

  it("(F) 2. a hand tick files '@lukeingold Done.' in the diary under Luke's note, and it goes as Isaac under the task's own subject", async () => {
    expect(await tick()).toEqual({ ok: true });
    expect(dones()).toHaveLength(1);
    const done = liveDone()!;
    expect(done).toMatchObject({
      target_kind: "job",
      target_id: JOB,
      author_id: "staff-isaac",
      status: "applied",
      task_id: TASK,
      is_task_done: true,
      reply_to_sm8_note_uuid: ASK,
      applied: { jobNotes: ["@lukeingold Done."], sm8Text: "@lukeingold Done." },
    });
    expect(done.applied_at).toBeTruthy();
    // the diary shows it
    const diary = await readOurJobNotes(ORG, JOB);
    expect(diary.map((n) => [n.id, n.text, n.isTaskDone, n.taskId])).toEqual([[done.id, "@lukeingold Done.", true, TASK]]);
    // one note create, under task:<id>:done:<noteId>, as whoever ticked
    const noteRows = writes().filter((w) => w.kind === "note");
    expect(noteRows).toHaveLength(1);
    expect(noteRows[0]).toMatchObject({
      op: "create",
      subject: noteSubject.done(TASK, String(done.id)),
      requested_by: "staff-isaac",
      payload: { name: "Done." },
      status: "sent",
    });
    expect(postSm8Note).toHaveBeenCalledTimes(1);
    expect(postSm8Note.mock.calls[0][1]).toMatchObject({ relatedUuid: JOB, text: "@lukeingold Done.", asStaffUuid: ISAAC_SM8 });
  });

  it("the Done addresses nobody when the asker is the one who ticked", async () => {
    (fake.db.sm8_job_notes as Row[])[0].edit_by_staff_uuid = ISAAC_SM8;
    await tick();
    expect(liveDone()!.applied).toEqual({ jobNotes: ["Done."], sm8Text: "Done." });
  });

  it("3. a task typed straight in (made from no note) files nothing", async () => {
    await tick(PLAIN_TASK);
    expect(task(PLAIN_TASK).status).toBe("done");
    expect(notes()).toHaveLength(0);
    expect(writes()).toHaveLength(0);
  });

  describe("(F) 4. settings that can be read and don't offer notes: no row, no queue", () => {
    it.each([
      ["Notes switched off", () => void (conn().write_kinds = ["attachment"])],
      ["sending Off", () => void (conn().write_mode = "off")],
      ["no connection", () => void (fake.db.integration_connections = [])],
    ])("%s", async (_why, set) => {
      set();
      expect(await tick()).toEqual({ ok: true });
      expect(task().status).toBe("done");
      expect(notes()).toHaveLength(0);
      expect(writes()).toHaveLength(0);
    });
  });

  it("(F) 5. without the Workboard, nothing is filed or queued", async () => {
    caps = new Set(["team"]);
    expect(await tick()).toEqual({ ok: true });
    expect(task().status).toBe("done");
    expect(notes()).toHaveLength(0);
    expect(writes()).toHaveLength(0);
  });

  it("(F) 6. an unlinked ticker: the task is done, the Done keeps 'unlinked', nothing is queued", async () => {
    fake.db.integration_links = (fake.db.integration_links as Row[]).filter((l) => l.staff_profile_id !== "staff-isaac");
    await tick();
    expect(task().status).toBe("done");
    expect(liveDone()).toMatchObject({ sm8_refusal: "unlinked" });
    expect(writes()).toHaveLength(0);
  });

  it("(F) 7. while paused, the Done is saved and held", async () => {
    conn().write_mode = "paused";
    await tick();
    expect(createOf(liveDone()!.id)).toMatchObject({ status: "queued" });
    expect(postSm8Note).not.toHaveBeenCalled();
    const { lines } = await linesFor("staff-isaac");
    expect(lines[TASK][0].state).toMatchObject({
      key: "line.waitingWhy",
      text: fillWords(NOTE_WORDS.line.waitingWhy, { why: NOTE_WORDS.why.paused }),
    });
  });

  it("(F) 8. a job no longer in ServiceM8's copy: the Done keeps 'job_gone'", async () => {
    (fake.db.sm8_jobs as Row[])[0].active = 0;
    await tick();
    expect(liveDone()).toMatchObject({ sm8_refusal: "job_gone" });
    expect(writes()).toHaveLength(0);
  });

  it("(F) 9. two ticks at once post one Done, and the loser is told; two Done presses at once make one row", async () => {
    const [a, b] = await Promise.all([tick(), tick()]);
    expect([a, b]).toContainEqual({ ok: false, error: "That task is already done." });
    expect([a, b]).toContainEqual({ ok: true });
    expect(dones()).toHaveLength(1);
    expect(postSm8Note).toHaveBeenCalledTimes(1);

    // two presses of the Done itself, racing: both get past "is there one",
    // and the one-Done index refuses the second insert
    notes().length = 0;
    fake.db.sm8_writes = [];
    postSm8Note.mockClear();
    fake.log.length = 0;
    const [c, d] = await Promise.all([sendTaskDone({ taskId: TASK }), sendTaskDone({ taskId: TASK })]);
    expect(c.ok && d.ok).toBe(true);
    expect(fake.on("workboard_notes").filter((s) => s.op === "insert")).toHaveLength(2);
    expect(dones()).toHaveLength(1);
    expect(writes().filter((w) => w.op === "create")).toHaveLength(1);
    expect(postSm8Note).toHaveBeenCalledTimes(1);
  });

  it("(F) two Reopens at once reopen it once, and take its Done back once; the loser is told", async () => {
    await tick();
    const done = liveDone()!;
    const [a, b] = await Promise.all([reopen(), reopen()]);
    expect([a, b]).toContainEqual({ ok: false, error: "That task is already open." });
    expect([a, b]).toContainEqual({ ok: true });
    expect(done.removed_at).toBeTruthy();
    expect(writes().filter((w) => w.op === "delete")).toHaveLength(1);
    expect(deleteSm8Note).toHaveBeenCalledTimes(1);
  });

  it("a direct call for a task ticked more than a day ago posts nothing: a Done is a tick's answer", async () => {
    Object.assign(task(), { status: "done", done_by: "staff-isaac", done_at: new Date(Date.now() - 2 * 86_400_000).toISOString() });
    expect(await sendTaskDone({ taskId: TASK })).toEqual({ ok: true, state: null });
    expect(notes()).toHaveLength(0);
  });

  it("nobody but the ticker sends a tick's Done", async () => {
    Object.assign(task(), { status: "done", done_by: "staff-luke", done_at: new Date().toISOString() });
    expect(await sendTaskDone({ taskId: TASK })).toEqual({ ok: true, state: null });
    expect(notes()).toHaveLength(0);
  });

  describe("(F) a Done answers only a note that still stands — the rule a reply keeps", () => {
    const nothingFiled = async () => {
      expect(task().status).toBe("done");
      expect(notes()).toHaveLength(0);
      expect(writes()).toHaveLength(0);
      expect(postSm8Note).not.toHaveBeenCalled();
    };

    it("Luke deleted his note in ServiceM8, then Isaac ticks: the tick stands, and no Done is filed or sent", async () => {
      (fake.db.sm8_job_notes as Row[])[0].active = 0;
      expect(await tick()).toEqual({ ok: true });
      await nothingFiled();
      // and a direct press of the Done is as quiet
      expect(await sendTaskDone({ taskId: TASK })).toEqual({ ok: true, state: null });
      await nothingFiled();
    });

    it("the task was made from one of OUR notes, taken back since: no Done under it", async () => {
      const OURS = "7e7e7e7e-0000-4000-8000-00000000a5c2";
      const ourRow = newId();
      fake.db.sm8_job_notes = [];
      notes().push({
        id: ourRow,
        org_id: ORG,
        author_id: "staff-luke",
        target_kind: "job",
        target_id: JOB,
        status: "applied",
        applied: { jobNotes: ["@isaacsmith can you order the grilles"], sm8Text: "@isaacsmith can you order the grilles" },
        removed_at: new Date().toISOString(),
        created_at: "2026-09-20T00:00:00.000Z",
      });
      writes().push({
        id: "w-ours",
        org_id: ORG,
        kind: "note",
        op: "create",
        status: "sent",
        note_id: ourRow,
        remote_uuid: OURS,
        sm8_job_uuid: JOB,
        as_staff_uuid: LUKE_SM8,
        requested_by: "staff-luke",
        taken_back_at: new Date().toISOString(),
      });
      (fake.db.job_note_actions as Row[])[0].sm8_note_uuid = OURS;
      expect(await tick()).toEqual({ ok: true });
      expect(task().status).toBe("done");
      expect(dones()).toHaveLength(0);
      expect(writes()).toHaveLength(1);
      expect(postSm8Note).not.toHaveBeenCalled();
    });

    it("whether it stands can't be read: quiet, and nothing is saved on a guess", async () => {
      // noteSourceOf's read goes through; the standing check's own read fails
      fake.before.sm8_job_notes = (s) => {
        if (s.columns === "active") fake.failing.add("sm8_job_notes");
      };
      expect(await tick()).toEqual({ ok: true });
      expect(fake.on("sm8_job_notes").map((s) => s.columns)).toContain("active");
      await nothingFiled();
    });

    it("the note it answers can't be found at all: quiet", async () => {
      fake.db.sm8_job_notes = [];
      expect(await tick()).toEqual({ ok: true });
      await nothingFiled();
    });
  });

  it("(F) 32. unreadable settings: the Done is saved with 'unreadable' and queues nothing; its line and the bell say so", async () => {
    fake.failing.add("integration_connections");
    await tick();
    expect(task().status).toBe("done");
    const done = liveDone()!;
    expect(done).toMatchObject({ sm8_refusal: "unreadable" });
    expect(writes()).toHaveLength(0);
    const { lines } = await linesFor("staff-isaac");
    expect(lines[TASK]).toEqual([
      {
        noteId: done.id,
        words: "@lukeingold Done.",
        state: expect.objectContaining({
          key: "line.notSent",
          text: fillWords(NOTE_WORDS.line.notSent, { reason: NOTE_WORDS.press.unreadable }),
          acts: ["send_again", "undo"],
        }),
      },
    ]);
    expect(await myUnsentDones(ORG, "staff-isaac", SINCE)).toEqual([
      { taskId: TASK, title: "Order the grilles", noteId: done.id, op: "post" },
    ]);
  });
});

/* ── taking it back ── */

describe("reopening takes the Done back", () => {
  it("(F) 11. a Reopen without takeBackDone leaves the Done as it is", async () => {
    await tick();
    const done = liveDone()!;
    expect(await reopenTask(TASK)).toEqual({ ok: true });
    expect(task().status).toBe("open");
    expect(done.removed_at).toBeNull();
    expect(deleteOf(done.id)).toBeUndefined();
    expect(createOf(done.id)).toMatchObject({ status: "sent", taken_back_at: null });
  });

  it("(F) 12. a Done still waiting: closed and cancelled, the row removed but kept, and nothing asked of ServiceM8", async () => {
    conn().write_mode = "paused";
    await tick();
    const done = liveDone()!;
    expect(await reopen()).toEqual({ ok: true });
    expect(task().status).toBe("open");
    expect(createOf(done.id)).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.takenBackBeforeSent });
    expect(createOf(done.id)!.taken_back_at).toBeTruthy();
    expect(notes().find((n) => n.id === done.id)!.removed_at).toBeTruthy();
    expect(deleteOf(done.id)).toBeUndefined();
    expect(postSm8Note).not.toHaveBeenCalled();
    expect(deleteSm8Note).not.toHaveBeenCalled();
  });

  it("(F) 13. a Done that went: removed at once, then a delete that depends on its create, taken out as Isaac", async () => {
    await tick();
    const done = liveDone()!;
    const create = createOf(done.id)!;
    await reopen();
    expect(notes().find((n) => n.id === done.id)!.removed_at).toBeTruthy();
    expect(deleteOf(done.id)).toMatchObject({ depends_on: create.id, subject: noteSubject.undo(String(create.id)), status: "sent" });
    expect(deleteSm8Note).toHaveBeenCalledTimes(1);
    expect(deleteSm8Note.mock.calls[0].slice(1)).toEqual([create.remote_uuid, ISAAC_SM8]);
    // settled: nothing of it is there, so the task shows nothing
    expect((await linesFor("staff-isaac")).lines).toEqual({});
  });

  it("(F) 14. someone else's Reopen after the tick answered: the task reopens, the Done stays, and they're told whose it is", async () => {
    await tick();
    const done = liveDone()!;
    as("staff-luke");
    caps = new Set(["workboard", "team"]);
    const r = await reopen();
    expect(r).toEqual({ ok: true, note: fillWords(NOTE_WORDS.press.notYours, { name: "Isaac Smith" }) });
    expect(task().status).toBe("open");
    expect(done.removed_at).toBeNull();
    expect(deleteOf(done.id)).toBeUndefined();
    expect(deleteSm8Note).not.toHaveBeenCalled();
  });

  it("(F) 15. tick, Undo (it went), tick again: a new Done under a new subject; the first is kept removed, nothing re-armed", async () => {
    await tick();
    const first = liveDone()!;
    const firstCreate = createOf(first.id)!;
    await reopen();
    await tick();
    const second = liveDone()!;
    expect(second.id).not.toBe(first.id);
    expect(dones()).toHaveLength(2);
    expect(first.removed_at).toBeTruthy();
    expect(createOf(second.id)).toMatchObject({ subject: noteSubject.done(TASK, String(second.id)), status: "sent" });
    expect(firstCreate).toMatchObject({ subject: noteSubject.done(TASK, String(first.id)), status: "sent" });
    expect(postSm8Note).toHaveBeenCalledTimes(2);
  });

  describe("(F) 16. a Reopen racing the tick, by anyone, never leaves a Done that stands for no tick", () => {
    /** Runs `then` once, just before the first statement of `op` on `table`. */
    const onFirst = (table: string, op: string, then: () => void) => {
      let fired = false;
      fake.before[table] = (s) => {
        if (!fired && s.op === op) {
          fired = true;
          then();
        }
      };
    };
    const reopenedBy = () => Object.assign(task(), { status: "open", done_at: null, done_by: null });

    it("the Reopen lands before the Done exists: the tick takes its own Done back by id, and nothing reaches ServiceM8", async () => {
      onFirst("workboard_notes", "insert", reopenedBy);
      await tick();
      expect(task().status).toBe("open");
      const [done] = dones();
      expect(done.removed_at).toBeTruthy();
      expect(createOf(done.id)).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.takenBackBeforeSent });
      expect(postSm8Note).not.toHaveBeenCalled();
      expect((await linesFor("staff-isaac")).lines).toEqual({});
    });

    it("the Reopen lands after the Done is filed and before its create: its take-back removes the Done, the create is closed and cancelled, nothing reaches ServiceM8", async () => {
      // the queue's one write of the create is its upsert
      onFirst("sm8_writes", "upsert", () => {
        reopenedBy();
        // the Reopen's own take-back: no create yet, so the tombstone only
        liveDone()!.removed_at = new Date().toISOString();
      });
      await tick();
      const [done] = dones();
      expect(done.removed_at).toBeTruthy();
      expect(createOf(done.id)).toMatchObject({ status: "cancelled", last_error: NOTE_WORDS.row.takenBackBeforeSent });
      expect(createOf(done.id)!.taken_back_at).toBeTruthy();
      expect(postSm8Note).not.toHaveBeenCalled();
    });

    it("someone else's Reopen while the tick files its Done: the ticker's own press takes it back", async () => {
      // Luke reopens; his take-back found no Done yet
      onFirst("workboard_notes", "insert", reopenedBy);
      await tick();
      expect(liveDone()).toBeUndefined();
      expect(postSm8Note).not.toHaveBeenCalled();
    });

    it("someone else's Reopen that answers not_yours, while the tick's Done waits: the tick takes it back, and what went is deleted", async () => {
      // the Done is filed and queued; then Luke reopens (his take-back is
      // refused: not his) before the tick reads the task again
      let ran = false;
      fake.before.tasks = (s) => {
        if (!ran && s.op === "select" && liveDone() && createOf(liveDone()!.id)) {
          ran = true;
          reopenedBy();
        }
      };
      await tick();
      expect(task().status).toBe("open");
      expect(liveDone()).toBeUndefined();
      expect(postSm8Note).not.toHaveBeenCalled();
    });

    it("someone else's Reopen and re-tick in that window: the Done stands, and their tick posts none", async () => {
      onFirst("workboard_notes", "insert", () =>
        Object.assign(task(), { status: "done", done_by: "staff-luke", done_at: new Date().toISOString() })
      );
      await tick();
      expect(liveDone()).toMatchObject({ author_id: "staff-isaac" });
      expect(postSm8Note).toHaveBeenCalledTimes(1);
      as("staff-luke");
      expect(await sendTaskDone({ taskId: TASK })).toMatchObject({ ok: true });
      expect(dones()).toHaveLength(1);
      expect(postSm8Note).toHaveBeenCalledTimes(1);
    });
  });
});

/* ── retrying from the task's line ── */

describe("the task's line and its doors", () => {
  it("(F) 24. a sent Done reads 'In ServiceM8'; the refusal 'unlinked' reads as the ticker's to fix, and as Isaac's to anyone else", async () => {
    await tick();
    const done = liveDone()!;
    expect((await linesFor("staff-isaac")).lines[TASK]).toEqual([
      { noteId: done.id, words: "@lukeingold Done.", state: expect.objectContaining({ key: "line.sent", tone: "ok" }) },
    ]);

    done.sm8_refusal = "unlinked";
    fake.db.sm8_writes = [];
    expect((await linesFor("staff-isaac")).lines[TASK][0].state).toMatchObject({
      text: fillWords(NOTE_WORDS.line.notSent, { reason: NOTE_WORDS.press.unlinked }),
      acts: ["send_again", "undo"],
    });
    expect((await linesFor("staff-luke")).lines[TASK][0].state).toMatchObject({
      text: fillWords(NOTE_WORDS.line.notSent, { reason: fillWords(NOTE_WORDS.row.unlinked, { name: "Isaac Smith" }) }),
      acts: [],
    });
  });

  it("the link question: the line asks, and the viewer's own link comes with it for the Yes", async () => {
    const link = (fake.db.integration_links as Row[])[0];
    Object.assign(link, { confirmed_remote_id: null, confirmed_answer: null });
    await tick();
    const got = await linesFor("staff-isaac");
    expect(liveDone()).toMatchObject({ sm8_refusal: "confirm" });
    expect(got.sender).toMatchObject({ state: "confirm", remoteId: ISAAC_SM8 });
    expect(got.lines[TASK][0].state.acts).toEqual(["confirm", "undo"]);
  });

  it("(F) 17. a task closed by a reply that failed: the line shows the reply with Send again, and the retry re-sends the reply — no Done is made", async () => {
    postSm8Note.mockResolvedValueOnce(refused(422));
    const composeId = newId();
    const r = await replyToJobNote({ jobUuid: JOB, sourceNoteUuid: ASK, words: "ordered them", composeId, closesTaskId: TASK });
    expect(r.ok).toBe(true);
    expect(task().status).toBe("done");
    expect(createOf(composeId)).toMatchObject({ status: "failed" });
    const [line] = (await linesFor("staff-isaac")).lines[TASK];
    expect(line).toMatchObject({ noteId: composeId, words: "@lukeingold ordered them", state: { key: "line.notSent", acts: ["send_again", "undo"] } });

    expect(await retryTaskDone({ taskId: TASK, noteId: composeId, act: "send_again" })).toMatchObject({
      ok: true,
      state: { key: "line.sent" },
    });
    expect(postSm8Note).toHaveBeenCalledTimes(2);
    expect(postSm8Note.mock.calls[1][1]).toMatchObject({ text: "@lukeingold ordered them" });
    expect(dones()).toHaveLength(0);
    expect(postSm8Note.mock.calls.some((c) => /Done\./.test(String((c[1] as Row).text)))).toBe(false);
  });

  it("(F) 18. a Done whose take-back failed stays on its task with Try again, even after the task is ticked again; the bell names it and Try again re-presses its delete", async () => {
    await tick();
    const first = liveDone()!;
    deleteSm8Note.mockResolvedValueOnce(refused(422));
    await reopen();
    expect(deleteOf(first.id)).toMatchObject({ status: "failed" });
    // ticked again: a new Done goes beside it
    await tick();
    const second = liveDone()!;
    const { lines } = await linesFor("staff-isaac");
    expect(lines[TASK].map((l) => [l.noteId, l.state.key])).toEqual([
      [second.id, "line.sent"],
      [first.id, "line.stillIn"],
    ]);
    expect(lines[TASK][1].state.acts).toEqual(["take_out_again"]);
    // the bell's item for it opens the task, and the line is there
    const unsent = await myUnsentDones(ORG, "staff-isaac", SINCE);
    expect(unsent).toEqual([{ taskId: TASK, title: "Order the grilles", noteId: first.id, op: "take_back" }]);
    expect(sm8DoneChip(unsent[0])).toMatchObject({ href: `/dashboard?task=${TASK}`, label: NOTE_WORDS.bell.doneStillIn });
    // Try again re-presses that delete, and it goes
    const deletes = writes().filter((w) => w.op === "delete").length;
    expect(await retryTaskDone({ taskId: TASK, noteId: String(first.id), act: "take_out_again" })).toMatchObject({ ok: true });
    expect(writes().filter((w) => w.op === "delete")).toHaveLength(deletes);
    expect(deleteOf(first.id)).toMatchObject({ status: "sent" });
    expect((await linesFor("staff-isaac")).lines[TASK].map((l) => l.noteId)).toEqual([second.id]);
    expect(await myUnsentDones(ORG, "staff-isaac", SINCE)).toEqual([]);
  });

  it("(F) 19. a Done whose take-back couldn't queue its delete, on a task ticked again: both lines, and Try again queues the old one's delete", async () => {
    await tick();
    const first = liveDone()!;
    // Notes off: the Reopen stops and removes it, and the delete can't queue
    conn().write_kinds = ["attachment"];
    const r = await reopen();
    expect(r).toEqual({ ok: true, note: NOTE_WORDS.press.takeBackOff });
    expect(first.removed_at).toBeTruthy();
    expect(deleteOf(first.id)).toBeUndefined();
    conn().write_kinds = ["attachment", "note"];
    await tick();
    const second = liveDone()!;
    expect(second.id).not.toBe(first.id);
    const { lines } = await linesFor("staff-isaac");
    expect(lines[TASK].map((l) => [l.noteId, l.state.key])).toEqual([
      [second.id, "line.sent"],
      [first.id, "line.stillIn"],
    ]);
    expect(await retryTaskDone({ taskId: TASK, noteId: String(first.id), act: "take_out_again" })).toMatchObject({ ok: true });
    expect(deleteOf(first.id)).toMatchObject({ status: "sent" });
  });

  it("20. a row that isn't one of the task's lines: nothing", async () => {
    await tick();
    const done = liveDone()!;
    const before = JSON.stringify(writes());
    expect(await retryTaskDone({ taskId: PLAIN_TASK, noteId: String(done.id), act: "take_out_again" })).toEqual({ ok: true, state: null });
    expect(await retryTaskDone({ taskId: TASK, noteId: newId(), act: "send_again" })).toEqual({ ok: true, state: null });
    expect(JSON.stringify(writes())).toBe(before);
  });

  it("(F) 33. Try again on a Done still in ServiceM8, by anyone but its sender: told whose it is, and nothing queued or re-pressed", async () => {
    await tick();
    const done = liveDone()!;
    deleteSm8Note.mockResolvedValueOnce(refused(422));
    await reopen();
    const del = deleteOf(done.id)!;
    expect(del).toMatchObject({ status: "failed" });
    const before = JSON.stringify(writes());
    as("staff-luke");
    expect(await retryTaskDone({ taskId: TASK, noteId: String(done.id), act: "take_out_again" })).toEqual({
      ok: false,
      error: fillWords(NOTE_WORDS.press.notYours, { name: "Isaac Smith" }),
    });
    expect(JSON.stringify(writes())).toBe(before);
    expect(deleteSm8Note).toHaveBeenCalledTimes(1);
    // and Send again on it, by anyone but its author, is the author's
    expect(await retryTaskDone({ taskId: TASK, noteId: String(done.id), act: "send_again" })).toMatchObject({ ok: false });
    expect(JSON.stringify(writes())).toBe(before);
  });
});

/* ── deleting, closing and the lines ── */

describe("deleting a task, and a reply that closes one", () => {
  it("(F) 21. deleting a task leaves a waiting Done, a sent Done and a waiting take-back exactly as they were; the Done stays in the diary with its Undo", async () => {
    caps = new Set(["workboard", "team"]);
    // a sent Done, and its take-back waiting behind a pause
    await tick();
    const sent = liveDone()!;
    conn().write_mode = "paused";
    await reopen();
    // a Done waiting, on the other task
    fake.db.job_note_actions.push({ org_id: ORG, sm8_note_uuid: ASK, sm8_job_uuid: JOB, action: "task", task_id: PLAIN_TASK });
    await tick(PLAIN_TASK);
    const waiting = liveDone(PLAIN_TASK)!;
    const before = JSON.stringify(writes());

    expect(await deleteTask(TASK)).toEqual({ ok: true });
    expect(await deleteTask(PLAIN_TASK)).toEqual({ ok: true });
    expect(JSON.stringify(writes())).toBe(before);
    expect(createOf(waiting.id)).toMatchObject({ status: "queued", subject: noteSubject.done(PLAIN_TASK, String(waiting.id)) });
    expect(deleteOf(sent.id)).toMatchObject({ status: "queued" });
    for (const d of [sent, waiting]) expect(notes().find((n) => n.id === d.id)).toMatchObject({ is_task_done: true, task_id: null });
    // the waiting Done is still in the diary, and its sender can Undo it there
    expect((await readOurJobNotes(ORG, JOB)).some((n) => n.id === waiting.id)).toBe(true);
    expect(await takeBackJobNote({ jobUuid: JOB, noteId: String(waiting.id) })).toMatchObject({ ok: true });
    expect(createOf(waiting.id)).toMatchObject({ status: "cancelled" });
  });

  it("(F) 21. Send again on a Done whose task was deleted re-presses it under its own subject", async () => {
    postSm8Note.mockResolvedValueOnce(refused(422));
    caps = new Set(["workboard", "team"]);
    await tick();
    const done = liveDone()!;
    expect(createOf(done.id)).toMatchObject({ status: "failed" });
    await deleteTask(TASK);
    expect(await sendJobNoteToServiceM8({ jobUuid: JOB, noteId: String(done.id) })).toMatchObject({ ok: true });
    expect(createOf(done.id)).toMatchObject({ status: "sent", subject: noteSubject.done(TASK, String(done.id)) });
    expect(writes().filter((w) => w.op === "create")).toHaveLength(1);
  });

  it("(F) 22. a reply that closes its task completes it with one note; the task shows the reply; Reopen takes nothing back and the line goes", async () => {
    const composeId = newId();
    const r = await replyToJobNote({ jobUuid: JOB, sourceNoteUuid: ASK, words: "ordered them", composeId, closesTaskId: TASK });
    expect(r.ok).toBe(true);
    expect(task()).toMatchObject({ status: "done", done_by: "staff-isaac" });
    expect(notes().find((n) => n.id === composeId)).toMatchObject({ task_id: TASK, is_task_done: false });
    expect(writes().filter((w) => w.op === "create")).toHaveLength(1);
    expect(postSm8Note).toHaveBeenCalledTimes(1);
    expect(dones()).toHaveLength(0);
    expect((await linesFor("staff-isaac")).lines[TASK]).toEqual([
      { noteId: composeId, words: "@lukeingold ordered them", state: expect.objectContaining({ key: "line.sent" }) },
    ]);

    expect(await reopen()).toEqual({ ok: true });
    expect(notes().find((n) => n.id === composeId)!.removed_at).toBeNull();
    expect(writes().filter((w) => w.op === "delete")).toHaveLength(0);
    expect(deleteSm8Note).not.toHaveBeenCalled();
    expect((await linesFor("staff-isaac")).lines).toEqual({});
  });

  it("(F) a reply naming a task made from another note closes nothing, and goes as a plain reply", async () => {
    fake.db.job_note_actions.push({
      org_id: ORG,
      sm8_note_uuid: "7e7e7e7e-0000-4000-8000-00000000a5c9",
      sm8_job_uuid: JOB,
      action: "task",
      task_id: PLAIN_TASK,
    });
    const composeId = newId();
    const r = await replyToJobNote({ jobUuid: JOB, sourceNoteUuid: ASK, words: "ordered them", composeId, closesTaskId: PLAIN_TASK });
    expect(r.ok).toBe(true);
    expect(task(PLAIN_TASK).status).toBe("open");
    expect(notes().find((n) => n.id === composeId)!.task_id).toBeNull();
    expect(postSm8Note).toHaveBeenCalledTimes(1);
  });

  it("(F) 25. a Done is never a mention, even after its task is deleted; a reply that closed its task and names Luke is one", async () => {
    caps = new Set(["workboard", "team"]);
    const mentions = async () => {
      const ourNotes = await readOurJobNotes(ORG, JOB, 60, { staffId: "staff-luke", state: await readSm8WriteState(ORG), sender: null });
      const { attention } = await readJobAttention(ORG, JOB, {
        notes: await readJobNotes(ORG, JOB),
        jobOpen: true,
        today: "2026-09-25",
        echoFiltered: true,
        viewerHandle: "lukeingold",
        ourNotes,
      });
      return attention.items.flatMap((i) => (i.kind === "mention" && i.origin === "heytiff" ? [i.rowId] : []));
    };
    await tick();
    const done = liveDone()!;
    expect(await mentions()).toEqual([]);
    await deleteTask(TASK);
    expect(notes().find((n) => n.id === done.id)).toMatchObject({ task_id: null, is_task_done: true });
    expect(await mentions()).toEqual([]);

    // a closing reply on the other task, naming Luke, is a mention for him
    fake.db.job_note_actions.push({ org_id: ORG, sm8_note_uuid: ASK, sm8_job_uuid: JOB, action: "task", task_id: PLAIN_TASK });
    const composeId = newId();
    await replyToJobNote({ jobUuid: JOB, sourceNoteUuid: ASK, words: "ordered them", composeId, closesTaskId: PLAIN_TASK });
    expect(notes().find((n) => n.id === composeId)).toMatchObject({ task_id: PLAIN_TASK, is_task_done: false });
    expect(await mentions()).toEqual([composeId]);
  });
});

/* ── the bell and the done list ── */

describe("the bell, for the one whose tick it was", () => {
  it("(F) 27. a Done that didn't go is a bad item for its ticker — the right words for each op — and for nobody else", async () => {
    postSm8Note.mockResolvedValueOnce(refused(422));
    await tick();
    const done = liveDone()!;
    const mine = await myUnsentDones(ORG, "staff-isaac", SINCE);
    expect(mine).toEqual([{ taskId: TASK, title: "Order the grilles", noteId: done.id, op: "post" }]);
    expect(await myUnsentDones(ORG, "staff-luke", SINCE)).toEqual([]);

    expect(sm8DoneChip({ taskId: TASK, title: "Order the grilles", op: "post" })).toEqual({
      key: `sm8-done:${TASK}`,
      kind: "sm8-done",
      state: "bad",
      label: NOTE_WORDS.bell.doneNotSent,
      subject: "Order the grilles",
      href: `/dashboard?task=${TASK}`,
      urgency: expect.any(Number),
    });
    expect(sm8DoneChip({ taskId: TASK, title: "x", op: "take_back" }).label).toBe(NOTE_WORDS.bell.doneStillIn);
    expect(sm8DoneChip({ taskId: TASK, title: "x", op: "check" }).label).toBe(NOTE_WORDS.bell.doneUnsure);

    // it reaches the ticker's own bell, and needs a staff card to
    const src = {
      today: "2026-09-25",
      warnDays: 30,
      isOwner: false,
      self: null,
      selfVehicle: null,
      teamPeople: [],
      fleet: [],
      orgCredentials: [],
      pendingClaims: 0,
      pendingLeave: 0,
      ownSheet: null,
      ownDeclinedClaims: [],
      ownDeclinedLeave: [],
      ownUnsentDones: mine,
    };
    expect(assembleChips({ ...src, viewerStaffId: "staff-isaac" }, new Set()).self.map((c) => c.kind)).toEqual(["sm8-done"]);
    expect(assembleChips({ ...src, viewerStaffId: null }, new Set()).self).toEqual([]);
  });

  it("an unsure Done is a 'check'", async () => {
    await tick();
    const done = liveDone()!;
    Object.assign(createOf(done.id)!, { status: "failed", maybe_landed: true, last_error: NOTE_WORDS.row.noteUnsure });
    expect((await myUnsentDones(ORG, "staff-isaac", SINCE))[0]).toMatchObject({ op: "check" });
  });

  it("(F) 28. where notes are sent, the done list holds what you ticked for somebody else", async () => {
    Object.assign(task(PLAIN_TASK), { assigned_to: "staff-luke", status: "done", done_by: "staff-isaac", done_at: new Date().toISOString() });
    expect((await recentlyDoneTasks(ORG, "staff-isaac", 7)).map((t) => t.id)).toEqual([PLAIN_TASK]);
    expect((await recentlyDoneTasks(ORG, "staff-luke", 7)).map((t) => t.id)).toEqual([PLAIN_TASK]);
  });
});
