/**
 * @jest-environment node
 */

/* ONE TASK PER ASK — the settle (H18). A ServiceM8 note that asks somebody
   something becomes ONE task for them, with no review, after a sync. What
   can go wrong, each held by a test seen failing without its guard:
     - two tasks for one ask (a second run, a stale claim, a row that
       wouldn't take its task id);
     - a task for somebody the new Home isn't on yet, or who isn't linked,
       or can't see the board — the crew's old Tasks face would show it;
     - a task for an ask that asks nothing, is older than 30 days, or is on
       a job its business deleted;
     - a run that reads past its cap or its function's end;
     - anything at all going to ServiceM8;
     - your reply making a second task instead of moving or ticking the one.
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
    const fail = failing[`${table}:${op}`];
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

type AskArgs = { text: string; tasks: string[]; person: string; at: string };
let clock = Date.parse("2026-09-25T00:00:00Z");
/** How long each model read takes. */
let readTakes = 0;
let askAnswer: (a: AskArgs) => { ok: true; read: unknown } | { ok: false; error: string } = () => ({
  ok: true,
  read: { kind: "do", title: "Call Mary about 2041 Wollstonecraft", dueDate: null },
});
let replyAnswer: () => { ok: true; read: unknown } | { ok: false; error: string } = () => ({
  ok: true,
  read: { says: "none", dueDate: null, dueSaid: null },
});
let keyed = true;
const readAsk = jest.fn(async (a: AskArgs) => {
  clock += readTakes;
  return askAnswer(a);
});
const readReply = jest.fn(async () => {
  clock += readTakes;
  return replyAnswer();
});
jest.mock("@/lib/workboard/mention-brain", () => ({
  READ_TIMEOUT_MS: 45_000,
  canReadAsks: () => keyed,
  readAsk: (a: AskArgs) => readAsk(a),
  readReply: (...a: unknown[]) => readReply(...(a as [])),
}));

const logTaskEvent = jest.fn(async () => {});
jest.mock("../task-events", () => ({
  logTaskEvent: (...a: unknown[]) => logTaskEvent(...(a as [])),
  missingTable: (code: unknown) => code === "PGRST205" || code === "42P01",
}));

import { CLAIM_MS, MAX_ATTEMPTS, SETTLE_MAX, settleMentionAsks, type SettleOutcome } from "../mention-settle";

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

const settle = (over: { budgetMs?: number; max?: number } = {}): Promise<SettleOutcome> =>
  settleMentionAsks(ORG, { budgetMs: 250_000, now: () => clock, ...over });

const rowsOf = (t: string) => db[t] ?? [];
const asksTable = () => rowsOf("mention_asks");
const tasksTable = () => rowsOf("tasks");

beforeEach(() => {
  process.env.HOME_DESK = "owner";
  keyed = true;
  clock = Date.parse("2026-09-25T00:00:00Z");
  readTakes = 0;
  nextId = 0;
  failing = {};
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
    tasks: [],
  };
  askAnswer = () => ({ ok: true, read: { kind: "do", title: "Call Mary about 2041 Wollstonecraft", dueDate: null } });
  replyAnswer = () => ({ ok: true, read: { says: "none", dueDate: null, dueSaid: null } });
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
  it("makes the ask one task for the person asked, from nobody, and records it", async () => {
    askAnswer = () => ({ ok: true, read: { kind: "do", title: "Call Mary about 2041 Wollstonecraft", dueDate: "2026-09-22" } });
    const out = await settle();

    expect(out).toMatchObject({ reads: 1, tasks: 1, failed: 0 });
    expect(tasksTable()).toEqual([
      expect.objectContaining({
        org_id: ORG,
        title: "Call Mary about 2041 Wollstonecraft",
        assigned_to: "s-isaac",
        created_by: null,
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

  it("starts a read only while its whole timeout still fits the budget", async () => {
    notes = [ASK_MARY, ASK_FANS, ASK_HOLLY];
    readTakes = 30_000;
    // 0 + 45 fits 100; 30 + 45 fits; 60 + 45 doesn't
    const out = await settle({ budgetMs: 100_000 });
    expect(out.reads).toBe(2);
    expect(await settle({ budgetMs: 44_999 })).toMatchObject({ reads: 0, skipped: "no-time" });
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

  it("lets a failed read go, to be tried again, and sets it aside after the third", async () => {
    askAnswer = () => ({ ok: false, error: "rate limited" });
    await settle();
    expect(asksTable()[0]).toMatchObject({ status: "reading", attempts: 1, claimed_at: null, error: "rate limited" });
    await settle();
    await settle();
    expect(asksTable()[0]).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    readAsk.mockClear();
    await settle();
    expect(readAsk).not.toHaveBeenCalled();
    expect(tasksTable()).toEqual([]);
  });

  it("takes the task back out when the row won't take its id, so no later run makes a second", async () => {
    failing = { "mention_asks:update": { message: "boom" } };
    const out = await settle();
    expect(out).toMatchObject({ tasks: 0, failed: 1 });
    expect(tasksTable()).toEqual([]);
    expect(writes.filter((w) => w.table === "tasks").map((w) => w.op)).toEqual(["insert", "delete"]);
  });
});

describe("your reply", () => {
  const MINE = note("n-mine", ISAAC.uuid, "2026-09-22 15:10:00", "@lukeingold calling her this afternoon");

  it("moves the task to the day it names, keeps its words, and is read once", async () => {
    notes = [ASK_MARY, MINE];
    replyAnswer = () => ({ ok: true, read: { says: "when", dueDate: "2026-09-22", dueSaid: "this afternoon" } });
    const out = await settle();
    expect(out).toMatchObject({ reads: 2, tasks: 1, moved: 1 });
    expect(tasksTable()).toHaveLength(1);
    expect(tasksTable()[0]).toMatchObject({ due_date: "2026-09-22", status: "open" });
    expect(asksTable()[0]).toMatchObject({ due_said: "this afternoon", last_reply_note: "n-mine" });
    expect(logTaskEvent).toHaveBeenCalledWith(ORG, tasksTable()[0].id, "s-isaac", { kind: "due", from: null, to: "2026-09-22" });

    readReply.mockClear();
    await settle();
    expect(readReply).not.toHaveBeenCalled();
  });

  it("ticks it off when it says it's done, as the person who replied, and never makes a second task", async () => {
    notes = [ASK_MARY, MINE];
    replyAnswer = () => ({ ok: true, read: { says: "done", dueDate: null, dueSaid: null } });
    const out = await settle();
    expect(out).toMatchObject({ tasks: 1, done: 1 });
    expect(tasksTable()).toHaveLength(1);
    expect(tasksTable()[0]).toMatchObject({ status: "done", done_by: "s-isaac" });
    expect(writes.filter((w) => w.table === "tasks" && w.op === "insert")).toHaveLength(1);
  });

  it("reads only your newest reply since the ask, and nothing for a task already done", async () => {
    const later = note("n-later", ISAAC.uuid, "2026-09-23 10:00:00", "@lukeingold done, she's booked");
    notes = [ASK_MARY, MINE, later];
    await settle();
    expect(readReply).toHaveBeenCalledTimes(1);
    expect(readReply.mock.calls[0]).toEqual([expect.objectContaining({ reply: "done, she's booked" })]);

    notes = [ASK_MARY, MINE, later, note("n-last", ISAAC.uuid, "2026-09-24 10:00:00", "@lukeingold all sorted")];
    tasksTable()[0].status = "done";
    readReply.mockClear();
    await settle();
    expect(readReply).not.toHaveBeenCalled();
  });
});

describe("ServiceM8", () => {
  it("is never written to: no sm8_writes row, and only the ask, the task and its history change", async () => {
    notes = [ASK_MARY, note("n-mine", ISAAC.uuid, "2026-09-22 15:10:00", "@lukeingold done")];
    replyAnswer = () => ({ ok: true, read: { says: "done", dueDate: null, dueSaid: null } });
    await settle();
    expect(writes.length).toBeGreaterThan(0);
    expect([...new Set(writes.map((w) => w.table))].sort()).toEqual(["mention_asks", "tasks"]);
    expect(rowsOf("sm8_writes")).toEqual([]);
  });
});
