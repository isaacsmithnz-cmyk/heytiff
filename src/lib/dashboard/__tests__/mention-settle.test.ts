/**
 * @jest-environment node
 */

/* ONE TASK PER ASK — the settle (H18). A ServiceM8 note that asks somebody
   something becomes ONE task for them, with no review, after a sync. What
   can go wrong, each held by a test seen failing without its guard:
     - two tasks for one ask (a second run, a stale claim, a row that
       wouldn't take its task id, another run that won the row mid-read, a
       task the job card's strip already made);
     - a task for somebody the new Home isn't on yet, or who isn't linked,
       or can't see the board — the crew's old Tasks face would show it —
       or a task a manager's team list picks up as delegated work;
     - a task for an ask that asks nothing, is older than 30 days, or is on
       a job its business deleted;
     - a run that reads past its cap or its function's end;
     - a failure that wasn't the note's doing used against it, or one that
       was read again for ever;
     - anything at all going to ServiceM8;
     - your replies making a second task, moving the wrong one, or one
       hiding another, instead of moving or ticking the one.
   The people and jobs are the real ones the design was drawn from (Luke's
   asks of Isaac, September 2026); the replies are examples. The database
   is a small fake that keeps rows and records every write; the model is a
   stub; nothing here reaches ServiceM8. */

/* NOTHING HERE MAY REACH THE WRITE QUEUE: requiring it at all fails. */
jest.mock("@/lib/integrations/sm8-writes", () => {
  throw new Error("the settle must never reach ServiceM8's write queue");
});

type Row = Record<string, unknown>;
type Write = { table: string; op: "insert" | "update" | "delete"; row?: Row; patch?: Row };

let db: Record<string, Row[]> = {};
const writes: Write[] = [];
/** A read or write of `${table}:${op}` fails with this error. */
let failing: Record<string, { code?: string; message: string }> = {};
/** The same, once each. */
let failOnce: Record<string, { code?: string; message: string }> = {};
/** Run just before the next `${table}:${op}`, once: another run's write. */
let before: Record<string, () => void> = {};
let nextId = 0;

function query(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" | "update" | "delete" = "select";
  let payload: Row | null = null;
  let returning = false;
  let single = false;
  const q: Record<string, unknown> = {};
  q.select = () => ((returning = true), q);
  q.eq = (col: string, v: unknown) => (filters.push((r) => r[col] === v), q);
  q.in = (col: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), q);
  q.is = (col: string, v: unknown) => (filters.push((r) => (r[col] ?? null) === v), q);
  q.insert = (row: Row) => ((op = "insert"), (payload = row), q);
  q.update = (patch: Row) => ((op = "update"), (payload = patch), q);
  q.delete = () => ((op = "delete"), q);
  q.single = () => ((single = true), q);
  const run = (): { data: unknown; error: unknown } => {
    const key = `${table}:${op}`;
    const hook = before[key];
    if (hook) {
      delete before[key];
      hook();
    }
    const once = failOnce[key];
    if (once) {
      delete failOnce[key];
      return { data: null, error: once };
    }
    const fail = failing[key];
    if (fail) return { data: null, error: fail };
    const rows = (db[table] ??= []);
    if (op === "select") return { data: rows.filter((r) => filters.every((f) => f(r))), error: null };
    if (op === "insert") {
      const row: Row = { id: `${table}-${++nextId}`, ...(payload ?? {}) };
      if (
        table === "mention_asks" &&
        rows.some((r) => r.org_id === row.org_id && r.sm8_note_uuid === row.sm8_note_uuid && r.staff_id === row.staff_id)
      ) {
        return { data: null, error: { code: "23505", message: "duplicate key" } };
      }
      rows.push(row);
      writes.push({ table, op, row });
      const out = { id: row.id };
      return { data: single ? out : [out], error: null };
    }
    const hit = rows.filter((r) => filters.every((f) => f(r)));
    if (op === "update") for (const r of hit) Object.assign(r, payload);
    else db[table] = rows.filter((r) => !hit.includes(r));
    writes.push({ table, op, patch: payload ?? undefined, row: hit[0] });
    return { data: returning ? hit.map((r) => ({ id: r.id })) : null, error: null };
  };
  q.then = (res: (v: { data: unknown; error: unknown }) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(run()).then(res, rej);
  return q;
}

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (t: string) => query(t) } }));

let links = new Map<string, string>();
const sm8StaffLinkMap = jest.fn(async () => links);
jest.mock("@/lib/integrations/links", () => ({ sm8StaffLinkMap: () => sm8StaffLinkMap() }));

const ISAAC = { uuid: "u-isaac", handle: "isaacsmith", name: "Isaac Smith", first: "Isaac" };
const LUKE = { uuid: "u-luke", handle: "lukeingold", name: "Luke Ingold", first: "Luke" };
const MICHAEL = { uuid: "u-michael", handle: "michaeldiamond", name: "Michael Diamond", first: "Michael" };
const PEOPLE = [ISAAC, LUKE, MICHAEL];
jest.mock("@/lib/workboard/job-notes-query", () => ({ sm8Roster: async () => PEOPLE }));
jest.mock("@/lib/workboard/query", () => ({ sm8VendorOf: async () => ({ tz: "Australia/Sydney", connected: true }) }));

/* The notes in the mirror, and the diary's own threads over them. */
import { buildConversations, type MentionNote } from "../diary-feed";
let notes: MentionNote[] = [];
const JOBS = new Map([
  ["j-2041", { label: "2041 Wollstonecraft", live: true }],
  ["j-3294", { label: "3294 Rozelle", live: true }],
  ["j-2749", { label: "2749 Woolloomooloo", live: true }],
]);
const listMyMentions = jest.fn(async (_org: string, mine: string, today: string) => {
  const me = PEOPLE.find((p) => p.uuid === mine)!;
  return buildConversations({ notes, me, people: PEOPLE, jobs: JOBS, today });
});
jest.mock("../mentions-query", () => ({
  listMyMentions: (...a: unknown[]) => listMyMentions(...(a as [string, string, string])),
}));

type Failure = { ok: false; error: string; why: "refused" | "outage" | "failed" };
type AskArgs = { text: string; tasks: string[]; person: string; at: string };
type ReplyArgs = { task: string; others: string[]; replies: { text: string; at: string }[] };
const readingAs = (says: string, dueDate: string | null = null, dueSaid: string | null = null) => ({
  ok: true as const,
  read: { says, dueDate, dueSaid, saidOn: dueDate },
});
let clock = Date.parse("2026-09-25T00:00:00Z");
/** How long each model read takes. */
let readTakes = 0;
let askAnswer: (a: AskArgs) => { ok: true; read: unknown } | Failure = () => ({
  ok: true,
  read: { kind: "do", title: "Call Mary about 2041 Wollstonecraft", dueDate: null },
});
let replyAnswer: (a: ReplyArgs) => { ok: true; read: unknown } | Failure = () => readingAs("none");
let keyed = true;
const readAsk = jest.fn(async (a: AskArgs) => {
  clock += readTakes;
  return askAnswer(a);
});
const readReply = jest.fn(async (a: ReplyArgs) => {
  clock += readTakes;
  return replyAnswer(a);
});
jest.mock("@/lib/workboard/mention-brain", () => ({
  READ_TIMEOUT_MS: 45_000,
  canReadAsks: () => keyed,
  readAsk: (a: AskArgs) => readAsk(a),
  readReply: (a: ReplyArgs) => readReply(a),
}));

const logTaskEvent = jest.fn(async () => {});
jest.mock("../task-events", () => ({
  logTaskEvent: (...a: unknown[]) => logTaskEvent(...(a as [])),
  missingTable: (code: unknown) => code === "PGRST205" || code === "42P01",
}));

import { CLAIM_MS, MAX_ATTEMPTS, SETTLE_MAX, settleMentionAsks, type SettleOutcome } from "../mention-settle";
import { isDelegated } from "../tasks";

const ORG = "org-1";
const note = (uuid: string, author: string, at: string, text: string, jobUuid = "j-2041"): MentionNote => ({
  uuid,
  jobUuid,
  author,
  at,
  text,
});
/* Luke's three September asks of Isaac (21, 15 and 9 Sept). */
const ASK_MARY = note("n-mary", LUKE.uuid, "2026-09-21 13:42:10", "@isaacsmith Please call Mary to discuss");
const ASK_FANS = note("n-fans", LUKE.uuid, "2026-09-15 08:00:00", "@isaacsmith how many fans for this", "j-3294");
const ASK_HOLLY = note("n-holly", LUKE.uuid, "2026-09-09 10:04:00", "@isaacsmith can you advise Holly", "j-2749");
const mine = (uuid: string, at: string, text: string, jobUuid = "j-2041") => note(uuid, ISAAC.uuid, at, `@lukeingold ${text}`, jobUuid);

const settle = (over: { budgetMs?: number; max?: number } = {}): Promise<SettleOutcome> =>
  settleMentionAsks(ORG, { budgetMs: 250_000, now: () => clock, ...over });

const rowsOf = (t: string) => db[t] ?? [];
const asksTable = () => rowsOf("mention_asks");
const tasksTable = () => rowsOf("tasks");
const askRow = (note: string) => asksTable().find((r) => r.sm8_note_uuid === note)!;
const taskOf = (note: string) => tasksTable().find((t) => t.id === askRow(note).task_id)!;

/** A row a run before this one wrote: the ask read, its task made. */
const readRow = (note: string, task: string | null, over: Row = {}): Row => ({
  id: `a-${note}`,
  org_id: ORG,
  sm8_note_uuid: note,
  sm8_job_uuid: "j-2041",
  staff_id: "s-isaac",
  status: "read",
  kind: "do",
  task_id: task,
  attempts: 0,
  claimed_at: null,
  last_reply_note: null,
  reply_attempts: 0,
  due_said: null,
  ...over,
});
const openTask = (id: string, title: string, over: Row = {}): Row => ({
  id,
  org_id: ORG,
  title,
  status: "open",
  due_date: null,
  remind_at: null,
  assigned_to: "s-isaac",
  created_by: "s-isaac",
  ...over,
});

beforeEach(() => {
  process.env.HOME_DESK = "owner";
  keyed = true;
  clock = Date.parse("2026-09-25T00:00:00Z");
  readTakes = 0;
  nextId = 0;
  failing = {};
  failOnce = {};
  before = {};
  writes.length = 0;
  notes = [ASK_MARY];
  links = new Map([
    [ISAAC.uuid, "s-isaac"],
    [MICHAEL.uuid, "s-michael"],
  ]);
  db = {
    staff_profiles: [
      { id: "s-isaac", org_id: ORG, user_id: "auth|isaac" },
      { id: "s-michael", org_id: ORG, user_id: "auth|michael" },
    ],
    memberships: [
      { user_id: "auth|isaac", org_id: ORG, role: "owner", permissions: null },
      { user_id: "auth|michael", org_id: ORG, role: "staff", permissions: null },
    ],
    sm8_jobs: [...JOBS.keys()].map((uuid) => ({ uuid, org_id: ORG, active: 1 })),
    mention_asks: [],
    job_note_actions: [],
    tasks: [],
  };
  askAnswer = () => ({ ok: true, read: { kind: "do", title: "Call Mary about 2041 Wollstonecraft", dueDate: null } });
  replyAnswer = () => readingAs("none");
  readAsk.mockClear();
  readReply.mockClear();
  listMyMentions.mockClear();
  sm8StaffLinkMap.mockClear();
  logTaskEvent.mockClear();
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  delete process.env.HOME_DESK;
});

describe("one task per ask", () => {
  it("makes the ask one task on the list of the person asked, and records it", async () => {
    askAnswer = () => ({ ok: true, read: { kind: "do", title: "Call Mary about 2041 Wollstonecraft", dueDate: "2026-09-22" } });
    const out = await settle();

    expect(out).toMatchObject({ reads: 1, tasks: 1, failed: 0 });
    expect(tasksTable()).toEqual([
      expect.objectContaining({
        org_id: ORG,
        title: "Call Mary about 2041 Wollstonecraft",
        assigned_to: "s-isaac",
        due_date: "2026-09-22",
        status: "open",
      }),
    ]);
    const taskId = tasksTable()[0].id;
    expect(asksTable()).toEqual([
      expect.objectContaining({
        org_id: ORG,
        sm8_note_uuid: "n-mary",
        sm8_job_uuid: "j-2041",
        staff_id: "s-isaac",
        asker_sm8_uuid: LUKE.uuid,
        status: "read",
        kind: "do",
        task_id: taskId,
        claimed_at: null,
      }),
    ]);
    expect(logTaskEvent).toHaveBeenCalledWith(ORG, taskId, null, { kind: "created", to: "s-isaac" });
    // read as the diary quotes it, for the person it asks
    expect(readAsk).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Please call Mary to discuss", person: "Isaac Smith", asker: "Luke Ingold", job: "2041 Wollstonecraft" }),
    );
  });

  /* Nobody gave it to Isaac: it is his own. A task made "by nobody" is
     delegated work (tasks.ts isDelegated), and today's Home shows the
     team's delegated work to anyone with `team` — an admin would see
     Isaac's automatic tasks on the old Tasks face before the flip. */
  it("makes it the person's own task, never delegated work a manager's team list shows", async () => {
    await settle();
    const [t] = tasksTable();
    expect(t.created_by).toBe("s-isaac");
    expect(isDelegated({ assigneeId: t.assigned_to as string, createdBy: t.created_by as string | null })).toBe(false);
  });

  it("makes none on a second run", async () => {
    await settle();
    readAsk.mockClear();
    const again = await settle();
    expect(again).toMatchObject({ reads: 0, tasks: 0 });
    expect(readAsk).not.toHaveBeenCalled();
    expect(tasksTable()).toHaveLength(1);
  });

  it("makes no task of an ask that asks nothing, and doesn't read it again", async () => {
    askAnswer = () => ({ ok: true, read: { kind: "none", title: "", dueDate: null } });
    const out = await settle();
    expect(out).toMatchObject({ reads: 1, tasks: 0 });
    expect(tasksTable()).toEqual([]);
    expect(asksTable()[0]).toMatchObject({ status: "read", kind: "none" });
    expect(asksTable()[0].task_id ?? null).toBeNull();
    readAsk.mockClear();
    await settle();
    expect(readAsk).not.toHaveBeenCalled();
  });

  it("tells the reader what a chase's conversation already made, so a chase isn't a second task", async () => {
    notes = [ASK_MARY, note("n-chase", LUKE.uuid, "2026-09-23 08:00:00", "@isaacsmith did you get hold of her?")];
    askAnswer = (a) =>
      a.tasks.length
        ? { ok: true, read: { kind: "none", title: "", dueDate: null } }
        : { ok: true, read: { kind: "do", title: "Call Mary about 2041 Wollstonecraft", dueDate: null } };
    const out = await settle();
    expect(readAsk.mock.calls.map(([a]) => a.tasks)).toEqual([[], ["Call Mary about 2041 Wollstonecraft"]]);
    expect(out).toMatchObject({ reads: 2, tasks: 1 });
  });
});

/* The job card's strip offers an unanswered mention as a task, and a
   person may press it before a settle gets there. That is the ask's one
   task. */
describe("an ask the job card's strip already answered", () => {
  it("is recorded with the strip's task, never read and never made a second task", async () => {
    db.tasks = [openTask("t-strip", "Ring Mary re quote", { created_by: "s-isaac" })];
    db.job_note_actions = [{ org_id: ORG, sm8_note_uuid: "n-mary", sm8_job_uuid: "j-2041", action: "task", task_id: "t-strip" }];
    const out = await settle();
    expect(readAsk).not.toHaveBeenCalled();
    expect(writes.filter((w) => w.table === "tasks" && w.op === "insert")).toEqual([]);
    expect(out).toMatchObject({ reads: 0, tasks: 0, adopted: 1 });
    expect(askRow("n-mary")).toMatchObject({ status: "read", kind: "do", task_id: "t-strip", staff_id: "s-isaac" });
  });

  it("is read as asking nothing when the strip dismissed it: \"That isn't work\"", async () => {
    db.job_note_actions = [{ org_id: ORG, sm8_note_uuid: "n-mary", sm8_job_uuid: "j-2041", action: "dismissed", task_id: null }];
    await settle();
    expect(readAsk).not.toHaveBeenCalled();
    expect(tasksTable()).toEqual([]);
    expect(askRow("n-mary")).toMatchObject({ status: "read", kind: "none", task_id: null });
  });

  it("takes over an ask let go after a failure, or set aside", async () => {
    db.tasks = [openTask("t-strip", "Ring Mary re quote")];
    db.mention_asks = [readRow("n-mary", null, { status: "failed", kind: null, attempts: MAX_ATTEMPTS })];
    db.job_note_actions = [{ org_id: ORG, sm8_note_uuid: "n-mary", sm8_job_uuid: "j-2041", action: "task", task_id: "t-strip" }];
    await settle();
    expect(asksTable()).toHaveLength(1);
    expect(askRow("n-mary")).toMatchObject({ status: "read", kind: "do", task_id: "t-strip" });
  });

  it("makes nothing when it can't read what the strip answered", async () => {
    failing = { "job_note_actions:select": { message: "boom" } };
    const out = await settle();
    expect(out).toMatchObject({ reads: 0, tasks: 0 });
    expect(writes).toEqual([]);
  });
});

describe("who it reads for", () => {
  it("reads nothing at all while the flag is off", async () => {
    process.env.HOME_DESK = "off";
    const out = await settle();
    expect(out.skipped).toBe("off");
    expect(sm8StaffLinkMap).not.toHaveBeenCalled();
    expect(listMyMentions).not.toHaveBeenCalled();
  });

  /* The crew's old Tasks face never shows a task Tiff made before the flip:
     under `owner`, Michael (staff) is not read for, even when Luke asks him. */
  it("reads only for the people the flag gives the new Home, asked of their own role", async () => {
    notes = [ASK_MARY, note("n-ladder", LUKE.uuid, "2026-09-22 09:00:00", "@michaeldiamond bring the ladder")];
    await settle();
    expect(listMyMentions.mock.calls.map((c) => c[1])).toEqual([ISAAC.uuid]);
    expect(tasksTable().map((t) => t.assigned_to)).toEqual(["s-isaac"]);

    // after the flip, Michael too
    process.env.HOME_DESK = "on";
    listMyMentions.mockClear();
    await settle();
    expect(listMyMentions.mock.calls.map((c) => c[1]).sort()).toEqual([ISAAC.uuid, MICHAEL.uuid].sort());
    expect(tasksTable().map((t) => t.assigned_to).sort()).toEqual(["s-isaac", "s-michael"]);
  });

  /* Michael owns a workspace of his own. Here he is crew, and his role
     here is the one that counts. */
  it("asks a person's role in this workspace, never one they hold in another", async () => {
    db.memberships.push({ user_id: "auth|michael", org_id: "org-2", role: "owner", permissions: null });
    notes = [note("n-ladder", LUKE.uuid, "2026-09-22 09:00:00", "@michaeldiamond bring the ladder")];
    await settle();
    expect(listMyMentions.mock.calls.map((c) => c[1])).toEqual([ISAAC.uuid]);
    expect(tasksTable()).toEqual([]);
  });

  /* A link naming a staff card of another workspace (whose login is the
     owner here) must not make that card a reader in this one. */
  it("reads for a staff card of this workspace only", async () => {
    db.staff_profiles.push({ id: "s-elsewhere", org_id: "org-2", user_id: "auth|isaac" });
    links = new Map([
      [ISAAC.uuid, "s-isaac"],
      [MICHAEL.uuid, "s-elsewhere"],
    ]);
    notes = [note("n-ladder", LUKE.uuid, "2026-09-22 09:00:00", "@michaeldiamond bring the ladder")];
    await settle();
    expect(listMyMentions.mock.calls.map((c) => c[1])).toEqual([ISAAC.uuid]);
    expect(tasksTable()).toEqual([]);
  });

  it("reads for nobody who can't see the board, or whom integration_links doesn't name", async () => {
    process.env.HOME_DESK = "on";
    db.memberships[1].permissions = { workboard: false };
    links = new Map([[ISAAC.uuid, "s-isaac"]]);
    notes = [note("n-ladder", LUKE.uuid, "2026-09-22 09:00:00", "@michaeldiamond bring the ladder")];
    db.memberships[0].permissions = null;
    await settle();
    expect(listMyMentions.mock.calls.map((c) => c[1])).toEqual([ISAAC.uuid]);
    expect(tasksTable()).toEqual([]);

    links = new Map([
      [ISAAC.uuid, "s-isaac"],
      [MICHAEL.uuid, "s-michael"],
    ]);
    listMyMentions.mockClear();
    await settle();
    // Michael is linked now, but still can't see the board
    expect(listMyMentions.mock.calls.map((c) => c[1])).toEqual([ISAAC.uuid]);
  });

  it("claims nothing on a deployment with no key, so no ask's attempts are spent", async () => {
    keyed = false;
    const out = await settle();
    expect(out.skipped).toBe("no-key");
    expect(writes).toEqual([]);
  });
});

describe("which asks", () => {
  it("takes asks back 30 days and no further", async () => {
    notes = [ASK_MARY, note("n-old", LUKE.uuid, "2026-08-25 23:59:00", "@isaacsmith can you quote this"), note("n-edge", LUKE.uuid, "2026-08-26 07:00:00", "@isaacsmith quote this one", "j-3294")];
    await settle();
    expect(asksTable().map((r) => r.sm8_note_uuid).sort()).toEqual(["n-edge", "n-mary"]);
  });

  it("makes nothing for a job its business deleted", async () => {
    notes = [ASK_MARY, ASK_HOLLY];
    db.sm8_jobs = db.sm8_jobs.map((j) => (j.uuid === "j-2749" ? { ...j, active: 0 } : j));
    await settle();
    expect(asksTable().map((r) => r.sm8_note_uuid)).toEqual(["n-mary"]);
  });

  it("makes nothing when it can't read which jobs are live", async () => {
    failing = { "sm8_jobs:select": { message: "boom" } };
    const out = await settle();
    expect(out).toMatchObject({ reads: 0, tasks: 0 });
    expect(writes).toEqual([]);
  });

  it("makes nothing before the table exists, and says why", async () => {
    failing = { "mention_asks:select": { code: "PGRST205", message: "no table" } };
    const out = await settle();
    expect(out.skipped).toBe("no-table");
    expect(writes).toEqual([]);
  });
});

describe("bounded", () => {
  it(`stops at ${SETTLE_MAX} reads a run, newest first, and the next run takes the rest`, async () => {
    notes = Array.from({ length: 7 }, (_, i) =>
      note(`n${i}`, LUKE.uuid, `2026-09-${String(10 + i).padStart(2, "0")} 09:00:00`, "@isaacsmith quote this", `j-${i}`),
    );
    db.sm8_jobs = notes.map((n) => ({ uuid: n.jobUuid, org_id: ORG, active: 1 }));
    const first = await settle();
    expect(first.reads).toBe(SETTLE_MAX);
    expect(asksTable().map((r) => r.sm8_note_uuid)).toEqual(["n6", "n5", "n4", "n3", "n2"]);
    const second = await settle();
    expect(second.reads).toBe(2);
    expect(tasksTable()).toHaveLength(7);
  });

  /* Five new asks, each already answered: asks and replies share the cap. */
  it(`holds ${SETTLE_MAX} reads a run with replies counted in`, async () => {
    notes = Array.from({ length: 5 }, (_, i) => [
      note(`n${i}`, LUKE.uuid, `2026-09-${String(10 + i).padStart(2, "0")} 09:00:00`, "@isaacsmith quote this", `j-${i}`),
      mine(`r${i}`, `2026-09-${String(10 + i).padStart(2, "0")} 10:00:00`, "on it", `j-${i}`),
    ]).flat();
    db.sm8_jobs = notes.map((n) => ({ uuid: n.jobUuid, org_id: ORG, active: 1 }));
    const out = await settle();
    expect(out.reads).toBe(SETTLE_MAX);
    expect(readAsk.mock.calls.length + readReply.mock.calls.length).toBe(SETTLE_MAX);
  });

  it("starts a read only while its whole timeout still fits the budget", async () => {
    notes = [ASK_MARY, ASK_FANS, ASK_HOLLY];
    readTakes = 30_000;
    // 0 + 45 fits 100; 30 + 45 fits; 60 + 45 doesn't
    const out = await settle({ budgetMs: 100_000 });
    expect(out.reads).toBe(2);
    expect(await settle({ budgetMs: 44_999 })).toMatchObject({ reads: 0, skipped: "no-time" });
  });

  it("starts a reply's read only while its timeout still fits too", async () => {
    notes = [ASK_MARY, mine("r-mary", "2026-09-22 15:10:00", "calling her this afternoon"), ASK_FANS, mine("r-fans", "2026-09-16 09:00:00", "three", "j-3294")];
    readTakes = 10_000;
    // 0, 10 and 20 (+45) fit 70; 30 + 45 doesn't
    const out = await settle({ budgetMs: 70_000 });
    expect(out.reads).toBe(3);
    expect(readReply).toHaveBeenCalledTimes(1);
  });
});

describe("the lease", () => {
  it("leaves an ask another run is reading, and takes one whose claim has lapsed", async () => {
    db.mention_asks = [
      {
        id: "a-live",
        org_id: ORG,
        sm8_note_uuid: "n-mary",
        sm8_job_uuid: "j-2041",
        staff_id: "s-isaac",
        status: "reading",
        attempts: 0,
        claimed_at: new Date(clock - CLAIM_MS + 60_000).toISOString(),
      },
    ];
    expect((await settle()).reads).toBe(0);

    db.mention_asks[0].claimed_at = new Date(clock - CLAIM_MS).toISOString();
    const out = await settle();
    expect(out).toMatchObject({ reads: 1, tasks: 1 });
    expect(asksTable()).toHaveLength(1);
    expect(asksTable()[0]).toMatchObject({ id: "a-live", status: "read", task_id: tasksTable()[0].id });
  });

  /* Two runs find the same lapsed claim; the other one takes it first. */
  it("reads nothing when another run takes a lapsed claim between the read of it and the swap", async () => {
    const lapsed = new Date(clock - CLAIM_MS).toISOString();
    db.mention_asks = [readRow("n-mary", null, { id: "a-lapsed", status: "reading", kind: null, claimed_at: lapsed })];
    before["mention_asks:update"] = () => {
      db.mention_asks[0].claimed_at = new Date(clock).toISOString();
    };
    const out = await settle();
    expect(readAsk).not.toHaveBeenCalled();
    expect(out).toMatchObject({ reads: 0, tasks: 0 });
    expect(tasksTable()).toEqual([]);
  });

  /* The other run finished first: it read the ask, made its task and
     marked the row while this one was reading. This one's task goes back
     out, and the row keeps the other's. */
  it("takes its task back out when another run marked the row first, so one task is left", async () => {
    askAnswer = () => {
      Object.assign(asksTable()[0], { status: "read", kind: "do", task_id: "t-other" });
      tasksTable().push(openTask("t-other", "Call Mary about 2041 Wollstonecraft"));
      return { ok: true, read: { kind: "do", title: "Call Mary about 2041 Wollstonecraft", dueDate: null } };
    };
    const out = await settle();
    expect(out.tasks).toBe(0);
    expect(tasksTable().map((t) => t.id)).toEqual(["t-other"]);
    expect(writes.filter((w) => w.table === "tasks").map((w) => w.op)).toEqual(["insert", "delete"]);
    expect(asksTable()[0]).toMatchObject({ status: "read", task_id: "t-other" });
  });

  it("lets a failed read go, to be tried again, and sets it aside after the third", async () => {
    askAnswer = () => ({ ok: false, error: "an answer that isn't JSON", why: "failed" });
    await settle();
    expect(asksTable()[0]).toMatchObject({ status: "reading", attempts: 1, claimed_at: null, error: "an answer that isn't JSON" });
    await settle();
    await settle();
    expect(asksTable()[0]).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    readAsk.mockClear();
    await settle();
    expect(readAsk).not.toHaveBeenCalled();
    expect(tasksTable()).toEqual([]);
  });

  it("lets an ask go, counted, when its reading as asking nothing can't be saved", async () => {
    askAnswer = () => ({ ok: true, read: { kind: "none", title: "", dueDate: null } });
    failOnce = { "mention_asks:update": { message: "boom" } };
    await settle();
    expect(asksTable()[0]).toMatchObject({ status: "reading", attempts: 1, claimed_at: null });
  });

  it("takes the task back out when the row won't take its id, so no later run makes a second", async () => {
    failing = { "mention_asks:update": { message: "boom" } };
    const out = await settle();
    expect(out).toMatchObject({ tasks: 0, failed: 1 });
    expect(tasksTable()).toEqual([]);
    expect(writes.filter((w) => w.table === "tasks").map((w) => w.op)).toEqual(["insert", "delete"]);
  });
});

/* A refusal is final; an outage is nobody's fault. */
describe("failures that aren't the ask's", () => {
  it("reads a refused ask as asking nothing, once, and never again", async () => {
    askAnswer = () => ({ ok: false, error: "refused", why: "refused" });
    await settle();
    expect(asksTable()[0]).toMatchObject({ status: "read", kind: "none", attempts: 0, error: "refused" });
    readAsk.mockClear();
    await settle();
    expect(readAsk).not.toHaveBeenCalled();
    expect(tasksTable()).toEqual([]);
  });

  /* A rate limit, a timeout, the reader down or its key rotated: an ask is
     never set aside for it, and the run spends no more reads into it. */
  it("lets an ask go uncounted in an outage, and stops the run there", async () => {
    notes = [ASK_MARY, ASK_FANS];
    askAnswer = () => ({ ok: false, error: "rate limited", why: "outage" });
    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) {
      readAsk.mockClear();
      const out = await settle();
      expect(out).toMatchObject({ reads: 1, outage: true });
      expect(readAsk).toHaveBeenCalledTimes(1);
    }
    expect(askRow("n-mary")).toMatchObject({ status: "reading", attempts: 0, claimed_at: null, error: "rate limited" });

    askAnswer = () => ({ ok: true, read: { kind: "do", title: "Call Mary about 2041 Wollstonecraft", dueDate: null } });
    await settle();
    expect(askRow("n-mary")).toMatchObject({ status: "read", kind: "do" });
  });
});

describe("your replies", () => {
  const MINE = mine("n-mine", "2026-09-22 15:10:00", "calling her this afternoon");

  it("move the task to the day they name, keep the words and the day they were said, and are read once", async () => {
    notes = [ASK_MARY, MINE];
    replyAnswer = () => readingAs("when", "2026-09-22", "this afternoon");
    const out = await settle();
    expect(out).toMatchObject({ reads: 2, tasks: 1, moved: 1 });
    expect(tasksTable()).toHaveLength(1);
    expect(tasksTable()[0]).toMatchObject({ due_date: "2026-09-22", status: "open" });
    expect(asksTable()[0]).toMatchObject({
      due_said: "this afternoon",
      due_said_on: "2026-09-22",
      due_said_for: "2026-09-22",
      last_reply_note: "n-mine",
    });
    expect(logTaskEvent).toHaveBeenCalledWith(ORG, tasksTable()[0].id, "s-isaac", { kind: "due", from: null, to: "2026-09-22" });

    readReply.mockClear();
    await settle();
    expect(readReply).not.toHaveBeenCalled();
  });

  it("tick it off when they say it's done, as the person who replied, and never make a second task", async () => {
    notes = [ASK_MARY, MINE];
    replyAnswer = () => readingAs("done");
    const out = await settle();
    expect(out).toMatchObject({ tasks: 1, done: 1 });
    expect(tasksTable()).toHaveLength(1);
    expect(tasksTable()[0]).toMatchObject({ status: "done", done_by: "s-isaac" });
    expect(writes.filter((w) => w.table === "tasks" && w.op === "insert")).toHaveLength(1);
    expect(logTaskEvent).toHaveBeenCalledWith(ORG, tasksTable()[0].id, "s-isaac", { kind: "done" });
  });

  /* "called her, sorted" then "thanks mate", before the next settle. Read
     one at a time, "thanks mate" would hide the "done". */
  it("are read together, every one since, oldest first, so a later one can't hide an earlier", async () => {
    notes = [ASK_MARY, mine("n-done", "2026-09-22 15:10:00", "called her, sorted"), mine("n-thanks", "2026-09-23 08:00:00", "thanks mate")];
    replyAnswer = (a) => (a.replies.some((r) => r.text.includes("sorted")) ? readingAs("done") : readingAs("none"));
    await settle();
    expect(readReply).toHaveBeenCalledTimes(1);
    expect(readReply.mock.calls[0][0].replies.map((r) => r.text)).toEqual(["called her, sorted", "thanks mate"]);
    expect(taskOf("n-mary")).toMatchObject({ status: "done" });
    expect(askRow("n-mary").last_reply_note).toBe("n-thanks");
  });

  it("are read from the last one read for the task, and not at all for a task already done", async () => {
    notes = [ASK_MARY, MINE];
    await settle();
    notes = [ASK_MARY, MINE, mine("n-later", "2026-09-23 10:00:00", "done, she's booked")];
    readReply.mockClear();
    await settle();
    expect(readReply.mock.calls.map(([a]) => a.replies.map((r) => r.text))).toEqual([["done, she's booked"]]);

    notes = [...notes, mine("n-last", "2026-09-24 10:00:00", "all sorted")];
    taskOf("n-mary").status = "done";
    readReply.mockClear();
    await settle();
    expect(readReply).not.toHaveBeenCalled();
  });

  /* Luke asked two things on the job: a call, then a quote. "Called her"
     is about the call, and must tick off the call, not the newer quote. */
  it("are read for each open task, told of the other, and move only the one they are about", async () => {
    notes = [
      ASK_MARY,
      note("n-quote", LUKE.uuid, "2026-09-22 08:00:00", "@isaacsmith can you also quote the ducting"),
      mine("n-called", "2026-09-22 15:10:00", "called her"),
    ];
    askAnswer = (a) =>
      a.text.includes("ducting")
        ? { ok: true, read: { kind: "do", title: "Quote the ducting for 2041 Wollstonecraft", dueDate: null } }
        : { ok: true, read: { kind: "do", title: "Call Mary about 2041 Wollstonecraft", dueDate: null } };
    replyAnswer = (a) => (a.task.startsWith("Call Mary") ? readingAs("done") : readingAs("none"));
    await settle();
    expect(readReply.mock.calls.map(([a]) => [a.task, a.others])).toEqual([
      ["Call Mary about 2041 Wollstonecraft", ["Quote the ducting for 2041 Wollstonecraft"]],
      ["Quote the ducting for 2041 Wollstonecraft", []],
    ]);
    expect(taskOf("n-mary")).toMatchObject({ status: "done" });
    expect(taskOf("n-quote")).toMatchObject({ status: "open" });
  });

  /* Your "done" answered Luke's thanks, before he asked for the ducting:
     it can't be about the task his later ask made. */
  it("never count a reply written before the ask", async () => {
    notes = [
      note("n-thanks", LUKE.uuid, "2026-09-20 08:00:00", "@isaacsmith thanks for today"),
      mine("n-done", "2026-09-20 09:00:00", "done, called her"),
      note("n-quote", LUKE.uuid, "2026-09-22 08:00:00", "@isaacsmith can you quote the ducting"),
    ];
    askAnswer = (a) =>
      a.text.includes("ducting")
        ? { ok: true, read: { kind: "do", title: "Quote the ducting for 2041 Wollstonecraft", dueDate: null } }
        : { ok: true, read: { kind: "none", title: "", dueDate: null } };
    replyAnswer = () => readingAs("done");
    await settle();
    expect(readReply).not.toHaveBeenCalled();
    expect(taskOf("n-quote")).toMatchObject({ status: "open" });
  });

  /* A manager gave the task to Leo: it is his now, and your reply to Luke
     is not his to have ticked off. */
  it("never move a task given to someone else since", async () => {
    db.mention_asks = [readRow("n-mary", "t-mary")];
    db.tasks = [openTask("t-mary", "Call Mary about 2041 Wollstonecraft", { assigned_to: "s-leo" })];
    notes = [ASK_MARY, mine("n-done", "2026-09-22 15:10:00", "done")];
    replyAnswer = () => readingAs("done");
    await settle();
    expect(readReply).not.toHaveBeenCalled();
    expect(db.tasks[0].status).toBe("open");
  });

  /* Luke asked 31 days ago, before the window of new asks; the task is
     still open, and today you tell him it's done. */
  it("still reach the task of an ask older than the 30 days, with no newer ask about", async () => {
    notes = [note("n-old", LUKE.uuid, "2026-08-25 09:00:00", "@isaacsmith quote this"), mine("n-done", "2026-09-24 09:00:00", "done")];
    db.mention_asks = [readRow("n-old", "t-old")];
    db.tasks = [openTask("t-old", "Quote 2041 Wollstonecraft")];
    replyAnswer = () => readingAs("done");
    await settle();
    expect(readAsk).not.toHaveBeenCalled();
    expect(db.tasks[0].status).toBe("done");
  });

  it("are read again next time when the task's write fails", async () => {
    notes = [ASK_MARY, MINE];
    replyAnswer = () => readingAs("done");
    failOnce = { "tasks:update": { message: "boom" } };
    const out = await settle();
    expect(out.failed).toBe(1);
    expect(askRow("n-mary").last_reply_note ?? null).toBeNull();
    readReply.mockClear();
    await settle();
    expect(readReply).toHaveBeenCalledTimes(1);
    expect(taskOf("n-mary")).toMatchObject({ status: "done" });
  });

  it("change nothing on a task someone ticked off in the meantime", async () => {
    notes = [ASK_MARY, MINE];
    replyAnswer = () => readingAs("when", "2026-09-26", "tomorrow");
    before["tasks:update"] = () => {
      tasksTable()[0].status = "done";
    };
    const out = await settle();
    expect(out.moved).toBe(0);
    expect(tasksTable()[0]).toMatchObject({ status: "done", due_date: null });
    expect(askRow("n-mary").due_said ?? null).toBeNull();
  });

  it("log a new due day only when the day changes, and keep the words when they change nothing", async () => {
    db.mention_asks = [readRow("n-mary", "t-mary", { due_said: "today" })];
    db.tasks = [openTask("t-mary", "Call Mary about 2041 Wollstonecraft", { due_date: "2026-09-22" })];
    notes = [ASK_MARY, MINE];
    replyAnswer = () => readingAs("when", "2026-09-22", "this afternoon");
    const out = await settle();
    expect(out.moved).toBe(1);
    expect(logTaskEvent).not.toHaveBeenCalledWith(ORG, "t-mary", "s-isaac", expect.objectContaining({ kind: "due" }));
    expect(askRow("n-mary").due_said).toBe("this afternoon");

    notes = [...notes, mine("n-later", "2026-09-22 16:00:00", "will do")];
    replyAnswer = () => readingAs("later");
    await settle();
    expect(askRow("n-mary")).toMatchObject({ due_said: "this afternoon", last_reply_note: "n-later" });
  });

  it("set a refused read aside at once, and read nothing again until you write more", async () => {
    notes = [ASK_MARY, MINE];
    replyAnswer = () => ({ ok: false, error: "refused", why: "refused" });
    await settle();
    expect(askRow("n-mary")).toMatchObject({ last_reply_note: "n-mine", reply_attempts: 0 });
    readReply.mockClear();
    await settle();
    expect(readReply).not.toHaveBeenCalled();
  });

  it(`are read at most ${MAX_ATTEMPTS} times when their read keeps failing, then set aside`, async () => {
    notes = [ASK_MARY, MINE];
    replyAnswer = () => ({ ok: false, error: "an answer that isn't JSON", why: "failed" });
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) await settle();
    expect(readReply).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(askRow("n-mary")).toMatchObject({ last_reply_note: "n-mine", reply_attempts: 0 });
    expect(taskOf("n-mary")).toMatchObject({ status: "open" });

    // a new reply is read afresh
    notes = [...notes, mine("n-done", "2026-09-24 09:00:00", "done")];
    replyAnswer = () => readingAs("done");
    readReply.mockClear();
    await settle();
    expect(readReply.mock.calls.map(([a]) => a.replies.map((r) => r.text))).toEqual([["done"]]);
  });

  it("are never counted against in an outage, and the run stops there", async () => {
    notes = [ASK_MARY, MINE, ASK_FANS];
    replyAnswer = () => ({ ok: false, error: "the reader took too long", why: "outage" });
    const out = await settle();
    expect(out.outage).toBe(true);
    expect([askRow("n-mary").last_reply_note ?? null, askRow("n-mary").reply_attempts ?? 0]).toEqual([null, 0]);
    // the fans ask, next in line, waits for the next run
    expect(readAsk.mock.calls.map(([a]) => a.text)).toEqual(["Please call Mary to discuss"]);
  });
});

describe("ServiceM8", () => {
  it("is never written to: no sm8_writes row, and only the ask, the task and its history change", async () => {
    notes = [ASK_MARY, mine("n-mine", "2026-09-22 15:10:00", "done")];
    replyAnswer = () => readingAs("done");
    await settle();
    expect(writes.length).toBeGreaterThan(0);
    expect([...new Set(writes.map((w) => w.table))].sort()).toEqual(["mention_asks", "tasks"]);
    expect(rowsOf("sm8_writes")).toEqual([]);
  });
});
