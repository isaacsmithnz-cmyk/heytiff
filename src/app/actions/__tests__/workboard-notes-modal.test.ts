/**
 * @jest-environment node
 */

/* THE TIFF MODAL'S SERVER — a note as a conversation, filed live, taken back.

   Nothing reviews what `fileNote` writes (Isaac, 2026-09-25: filing live,
   with Undo as the safety net), so the guards here ARE the review: what gets
   filed comes from the stored proposal and nowhere else, a question stops
   the filing, two presses file once, and Undo either takes back everything
   a note made or nothing at all.

   The database is a small in-memory one rather than a scripted chain,
   because Undo's whole claim is about STATE — that after it runs the rows
   are gone, the count is back and the column says what it said — and a
   chain that returns canned rows can't show a row being gone. */

type Row = Record<string, unknown>;
type Filter = [op: "eq" | "in", column: string, value: unknown];

let db: Record<string, Row[]> = {};
const writes: { op: "insert" | "update" | "delete"; table: string; payload?: unknown; filters: Filter[] }[] = [];
let seq = 0;

/* What the database fills in that the code doesn't send. */
const DEFAULTS: Record<string, Row> = {
  workboard_notes: {
    status: "pending",
    proposal: null,
    applied: null,
    turns: [],
    undone_at: null,
    created_at: "2026-09-25T00:00:00Z",
  },
  workboard_flags: { active: true },
  workboard_issues: { occurrences: 1, resolved: false },
  project_checklist_items: { done: false },
  job_picklist_items: { picked: false },
};

function from(table: string) {
  const filters: Filter[] = [];
  let mode: "select" | "update" | "delete" = "select";
  let patch: Row = {};
  let returning = false;
  const match = (r: Row) =>
    filters.every(([op, col, val]) =>
      op === "eq" ? r[col] === val : (val as unknown[]).includes(r[col]),
    );
  const run = (one = false) => {
    const all = (db[table] ??= []);
    const hit = all.filter(match);
    if (mode === "update") {
      for (const r of hit) Object.assign(r, structuredClone(patch));
      writes.push({ op: "update", table, payload: patch, filters: [...filters] });
      return { data: returning ? hit.map((r) => ({ ...r })) : null, error: null };
    }
    if (mode === "delete") {
      db[table] = all.filter((r) => !match(r));
      writes.push({ op: "delete", table, filters: [...filters] });
      return { data: null, error: null };
    }
    if (one) return { data: hit[0] ? structuredClone(hit[0]) : null, error: null };
    return { data: hit.map((r) => structuredClone(r)), error: null };
  };
  const b: Record<string, unknown> = {};
  b.select = () => {
    if (mode !== "select") returning = true;
    return b;
  };
  b.eq = (col: string, val: unknown) => (filters.push(["eq", col, val]), b);
  b.in = (col: string, val: unknown[]) => (filters.push(["in", col, val]), b);
  b.order = () => b;
  b.limit = () => b;
  b.maybeSingle = async () => run(true);
  b.single = async () => run(true);
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(run()).then(res, rej);
  b.update = (p: Row) => ((mode = "update"), (patch = p), b);
  b.delete = () => ((mode = "delete"), b);
  b.insert = (payload: Row | Row[]) => {
    const made = (Array.isArray(payload) ? payload : [payload]).map((p) => ({
      id: `${table}-${++seq}`,
      ...structuredClone(DEFAULTS[table] ?? {}),
      ...structuredClone(p),
    }));
    (db[table] ??= []).push(...made);
    writes.push({ op: "insert", table, payload, filters: [] });
    const out = () => made.map((m) => ({ ...m }));
    return {
      select: () => ({
        single: async () => ({ data: out()[0], error: null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: out(), error: null }).then(res),
      }),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
    };
  };
  return b;
}

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (t: string) => from(t) } }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

let session: { user: { sub: string }; orgId: string } | null = { user: { sub: "auth0|me" }, orgId: "org-1" };
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: jest.fn(async () => session) } }));

let caps = new Set<string>();
jest.mock("@/lib/permissions-server", () => ({ can: async (c: string) => caps.has(c) }));
let me: string | null = "s-me";
jest.mock("@/lib/workboard/projects-query", () => ({ staffIdFor: async () => me }));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: async () => "Australia/Sydney" }));
jest.mock("@/lib/dashboard/reminders-query", () => ({
  workdayHours: async () => ({ start: "06:30", end: "15:00" }),
}));
jest.mock("@/lib/brain/tools", () => ({
  jobHistory: async () => ({ equipment: [], issues: [], flags: [], recentNotes: [] }),
}));
let candidates: Row[] = [];
jest.mock("@/lib/dashboard/job-candidates", () => ({ jobCandidates: async () => candidates }));
const publishFieldNote = jest.fn();
jest.mock("@/lib/tiff/field-notes", () => ({
  publishFieldNote: (i: unknown) => publishFieldNote(i),
}));
jest.mock("@/lib/workboard/note-brain", () => ({
  ...jest.requireActual("@/lib/workboard/note-brain"),
  readNote: jest.fn(),
}));

import {
  answerClarify,
  applyNote,
  continueNote,
  fileNote,
  keepWords,
  publishNoteKb,
  routeNote,
  undoNote,
} from "../workboard-notes";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listJournal } from "@/lib/dashboard/journal-query";
import { TURNS_MAX } from "@/lib/workboard/note-turns";
import type { NoteProposal } from "@/lib/workboard/note-brain";
const { readNote } = jest.requireMock("@/lib/workboard/note-brain") as { readNote: jest.Mock };

/* ── fixtures ─────────────────────────────────────────────────────────── */

const STAFF = [
  { id: "s-me", first_name: "Isaac", last_name: "Smith", full_name: "Isaac Smith", org_id: "org-1" },
  { id: "s-luke", first_name: "Luke", last_name: "Nguyen", full_name: "Luke Nguyen", org_id: "org-1" },
  { id: "s-callum", first_name: "Callum", last_name: "Reid", full_name: "Callum Reid", org_id: "org-1" },
];

const EMPTY: NoteProposal = {
  tasks: [],
  bringItems: [],
  flags: [],
  progressBullets: [],
  commissioningEntries: [],
  issueEntries: [],
  kbEntries: [],
  plainNote: "",
  say: "",
  clarify: null,
};

const task = (over: Partial<NoteProposal["tasks"][number]> = {}) => ({
  title: "Order the grilles",
  detail: "",
  assigneeId: "s-luke",
  assigneeHint: "Luke",
  dueHint: "",
  dueDate: "",
  remindTime: "",
  remindKind: "at" as const,
  ...over,
});

const t = (who: "you" | "tiff", text: string) => ({ who, text, at: "2026-09-25T00:00:00.000Z" });

/** A modal note waiting to be filed, in the database. */
function note(over: Row = {}): Row {
  const row: Row = {
    id: "n-1",
    org_id: "org-1",
    author_id: "s-me",
    target_kind: "none",
    target_id: null,
    transcript: "Luke needs to order the grilles",
    source: "text",
    status: "pending",
    proposal: { ...EMPTY, tasks: [task()], say: "A task for Luke to order the grilles." },
    applied: null,
    turns: [t("you", "Luke needs to order the grilles"), t("tiff", "A task for Luke to order the grilles.")],
    undone_at: null,
    created_at: "2026-09-25T00:00:00Z",
    ...over,
  };
  db.workboard_notes = [...(db.workboard_notes ?? []).filter((r) => r.id !== row.id), row];
  return row;
}

const noteRow = (id = "n-1") => db.workboard_notes.find((r) => r.id === id)!;
const rowsOf = (table: string) => db[table] ?? [];

beforeEach(() => {
  db = { staff_profiles: STAFF.map((s) => ({ ...s })) };
  writes.length = 0;
  seq = 0;
  session = { user: { sub: "auth0|me" }, orgId: "org-1" };
  caps = new Set(["workboard"]);
  me = "s-me";
  candidates = [];
  readNote.mockReset();
  publishFieldNote.mockReset();
});

/* ── routeNote: the modal's door and the card's ──────────────────────── */

describe("routeNote", () => {
  const proposal: NoteProposal = { ...EMPTY, tasks: [task()], say: "A task for Luke." };

  it("keeps the modal's note as a conversation, and routes it asking who", async () => {
    readNote.mockResolvedValue({ ok: true, proposal });
    const res = await routeNote({
      transcript: "Luke needs to order the grilles",
      target: { kind: "none" },
      room: "tasks",
      conversation: true,
    });
    expect(res.ok).toBe(true);
    const ctx = readNote.mock.calls[0][1];
    expect(ctx).toMatchObject({ askWho: true, room: "tasks" });

    const row = rowsOf("workboard_notes")[0];
    expect((row.turns as Row[]).map((x) => [x.who, x.text, x.room])).toEqual([
      ["you", "Luke needs to order the grilles", "tasks"],
      ["tiff", "A task for Luke.", undefined],
    ]);
    expect(res.ok && res.turns).toHaveLength(2);
  });

  it("the review card's door names no turns and asks nobody who — the crew's capture is unchanged", async () => {
    readNote.mockResolvedValue({ ok: true, proposal });
    await routeNote({ transcript: "Luke needs to order the grilles", target: { kind: "none" } });
    const ctx = readNote.mock.calls[0][1];
    expect(ctx).not.toHaveProperty("askWho");
    expect(ctx).not.toHaveProperty("room");
    for (const w of writes.filter((x) => x.table === "workboard_notes")) {
      expect(w.payload).not.toHaveProperty("turns");
    }
  });

  it("files the modal's words as said when routing fails, and says so", async () => {
    readNote.mockResolvedValue({ ok: false, error: "Too busy right now — the note was saved as written." });
    const res = await routeNote({ transcript: "gate code 4821", target: { kind: "none" }, conversation: true });
    expect(res).toEqual({
      ok: false,
      error: "I couldn't sort that out just now, so it's in your diary as you said it.",
      kept: true,
    });
    const row = rowsOf("workboard_notes")[0];
    expect(row).toMatchObject({ status: "applied", applied: {} });
    expect((row.turns as Row[]).at(-1)).toMatchObject({ who: "tiff", text: expect.stringContaining("in your diary") });
  });

  it("the card's failure still leaves its note pending for the card to offer", async () => {
    readNote.mockResolvedValue({ ok: false, error: "Too busy right now — the note was saved as written." });
    const res = await routeNote({ transcript: "gate code 4821", target: { kind: "none" } });
    expect(res).toEqual({ ok: false, error: "Too busy right now — the note was saved as written." });
    expect(rowsOf("workboard_notes")[0].status).toBe("pending");
  });
});

/* ── continueNote ───────────────────────────────────────────────────── */

describe("continueNote", () => {
  it("refuses a note from another workspace", async () => {
    note({ org_id: "org-2" });
    expect(await continueNote("n-1", "Callum")).toEqual({ ok: false, error: "That note is no longer here." });
    expect(readNote).not.toHaveBeenCalled();
  });

  it.each([
    ["applied", "That note has already been filed."],
    ["dismissed", "That note was set aside."],
    ["undone", "That note was taken back."],
  ])("refuses a note that is %s", async (status, error) => {
    note({ status, undone_at: status === "undone" ? "2026-09-25T01:00:00Z" : null });
    expect(await continueNote("n-1", "Callum")).toEqual({ ok: false, error });
    expect(readNote).not.toHaveBeenCalled();
  });

  it("refuses somebody else's note", async () => {
    note({ author_id: "s-luke" });
    expect((await continueNote("n-1", "Callum")).ok).toBe(false);
    expect(readNote).not.toHaveBeenCalled();
  });

  it("refuses a seventh reply", async () => {
    const turns = [t("you", "the note")];
    for (let i = 0; i < 6; i++) turns.push(t("tiff", `q${i}`), t("you", `a${i}`));
    note({ turns });
    const res = await continueNote("n-1", "and another thing");
    expect(res.ok).toBe(false);
    expect(readNote).not.toHaveBeenCalled();
  });

  it("routes the whole note again with the plan, the reply and the rows taken off, and stores what came back", async () => {
    note({
      status: "clarifying",
      proposal: {
        ...EMPTY,
        tasks: [task({ assigneeId: null, assigneeHint: "" }), task({ title: "Ring the sparky" })],
        flags: [{ message: "Roof hatch seized", severity: "warn" }],
        say: "Who should do this: Order the grilles?",
        clarify: { question: "Who should do this: Order the grilles?", options: ["Me", "Luke"] },
      },
      turns: [
        { ...t("you", "Luke needs to order the grilles"), room: "diary" },
        t("tiff", "Who should do this: Order the grilles?"),
      ],
    });
    const next: NoteProposal = { ...EMPTY, tasks: [task({ assigneeId: "s-callum" })], say: "A task for Callum." };
    readNote.mockResolvedValue({ ok: true, proposal: next });

    const res = await continueNote("n-1", "Callum", ["flags:0", "tasks:9", "junk"]);
    expect(res.ok).toBe(true);

    const [, ctx, follow] = readNote.mock.calls[0];
    expect(ctx).toMatchObject({ askWho: true, room: "diary" });
    expect(follow.plan.clarify.question).toBe("Who should do this: Order the grilles?");
    expect(follow.turns.map((x: Row) => x.text)).toEqual([
      "Luke needs to order the grilles",
      "Who should do this: Order the grilles?",
      "Callum",
    ]);
    // only keys that name a row of the stored plan ride along
    expect(follow.leftOut).toEqual(["flags:0"]);

    const row = noteRow();
    expect(row.proposal).toEqual(next);
    expect(row.status).toBe("pending");
    expect((row.turns as Row[]).map((x) => [x.who, x.text])).toEqual([
      ["you", "Luke needs to order the grilles"],
      ["tiff", "Who should do this: Order the grilles?"],
      ["you", "Callum"],
      ["tiff", "A task for Callum."],
    ]);
  });

  it("stays clarifying when Tiff asks again", async () => {
    note();
    readNote.mockResolvedValue({
      ok: true,
      proposal: { ...EMPTY, say: "Which job?", clarify: { question: "Which job?", options: [] } },
    });
    await continueNote("n-1", "the one at Smith St");
    expect(noteRow().status).toBe("clarifying");
  });

  it("a reply that crosses a filing in flight does not drag the note back to waiting", async () => {
    note();
    readNote.mockImplementation(async () => {
      // the other tab's Save lands while this reply is being read
      noteRow().status = "applied";
      return { ok: true, proposal: { ...EMPTY, say: "Sure." } };
    });
    const res = await continueNote("n-1", "and the filters");
    expect(res).toEqual({ ok: false, error: "That note has already been filed." });
    expect(noteRow().status).toBe("applied");
    expect((noteRow().proposal as NoteProposal).say).toBe("A task for Luke to order the grilles.");
  });

  it("a failed read changes nothing", async () => {
    note();
    const before = structuredClone(noteRow());
    readNote.mockResolvedValue({ ok: false, error: "Too busy right now — the note was saved as written." });
    expect((await continueNote("n-1", "Callum")).ok).toBe(false);
    expect(noteRow()).toEqual(before);
  });
});

describe("answerClarify — the card's wrapper", () => {
  it("writes no turns, and routes with the answer as plain", async () => {
    note({
      status: "clarifying",
      turns: undefined,
      proposal: { ...EMPTY, tasks: [task()], clarify: { question: "Which Luke?", options: ["Luke Nguyen"] } },
    });
    readNote.mockResolvedValue({ ok: true, proposal: { ...EMPTY, tasks: [task()] } });
    const res = await answerClarify("n-1", "Luke Nguyen");
    expect(res.ok).toBe(true);
    expect(readNote.mock.calls[0][1]).not.toHaveProperty("askWho");
    expect(readNote.mock.calls[0][2].plain).toBe(true);
    for (const w of writes) expect(w.payload ?? {}).not.toHaveProperty("turns");
  });
});

/* ── fileNote ───────────────────────────────────────────────────────── */

describe("fileNote", () => {
  it("files the STORED proposal and ignores rows a browser posts", async () => {
    note();
    const res = await fileNote("n-1", {
      leaveOut: [],
      // a direct POST can send anything; none of it is a row
      tasks: [{ title: "Pay me", assigneeId: "s-me" }],
    } as Parameters<typeof fileNote>[1]);
    expect(res.ok).toBe(true);
    expect(rowsOf("tasks").map((r) => [r.title, r.assigned_to, r.created_by])).toEqual([
      ["Order the grilles", "s-luke", "s-me"],
    ]);
  });

  it("drops the rows taken off, and never files a library entry", async () => {
    note({
      target_kind: "project",
      target_id: "p-1",
      proposal: {
        ...EMPTY,
        tasks: [task(), task({ title: "Ring the sparky" })],
        kbEntries: [{ title: "Clearing an E6", body: "Power the outdoor board separately." }],
      },
    });
    db.projects = [{ id: "p-1", org_id: "org-1", name: "Smith St", notes: null }];
    const res = await fileNote("n-1", { leaveOut: ["tasks:0"] });
    expect(res.ok).toBe(true);
    expect(rowsOf("tasks").map((r) => r.title)).toEqual(["Ring the sparky"]);
    expect(publishFieldNote).not.toHaveBeenCalled();
    expect(noteRow().applied).not.toHaveProperty("kbIds");
  });

  it("asks instead of filing while Tiff's own question is open", async () => {
    note({
      status: "clarifying",
      proposal: { ...EMPTY, tasks: [task()], clarify: { question: "Which Luke?", options: ["Luke Nguyen", "Luke Tran"] } },
    });
    const res = await fileNote("n-1");
    expect(res).toEqual({
      ok: false,
      error: "Which Luke?",
      ask: { question: "Which Luke?", options: [{ label: "Luke Nguyen" }, { label: "Luke Tran" }] },
    });
    expect(rowsOf("tasks")).toEqual([]);
    expect(noteRow().status).toBe("clarifying");
  });

  it("asks who when a task has nobody on it, offering Me and the people the note names", async () => {
    note({
      transcript: "Callum said the grilles need ordering, tell Luke too",
      proposal: { ...EMPTY, tasks: [task({ assigneeId: null, assigneeHint: "" })] },
    });
    const res = await fileNote("n-1");
    expect(res).toEqual({
      ok: false,
      error: "Who should do this: Order the grilles?",
      ask: {
        question: "Who should do this: Order the grilles?",
        options: [{ label: "Me" }, { label: "Callum" }, { label: "Luke" }],
      },
    });
    expect(rowsOf("tasks")).toEqual([]);
    expect(noteRow().status).toBe("pending");
  });

  it("asks which job when a row needs one, with the jobs the words match as answers that carry the job", async () => {
    note({
      transcript: "Meridian roof hatch is seized",
      proposal: { ...EMPTY, flags: [{ message: "Roof hatch seized", severity: "warn" }] },
    });
    candidates = [
      { kind: "visit", id: "v-1", clientName: "Meridian Data", label: "Quarterly service", jobNumber: "1042" },
      { kind: "project", id: "p-9", clientName: "Kingsford Medical", label: "Ducted change-over" },
    ];
    const res = await fileNote("n-1");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("Which job is this for?");
      expect(res.ask?.options).toEqual([
        { label: "Meridian Data — Quarterly service, job #1042", target: { kind: "visit", id: "v-1" } },
      ]);
    }
    expect(rowsOf("workboard_flags")).toEqual([]);
    expect(noteRow().status).toBe("pending");
  });

  it("files onto the job the answer carries", async () => {
    note({ proposal: { ...EMPTY, flags: [{ message: "Roof hatch seized", severity: "warn" }] } });
    db.maintenance_visits = [{ id: "v-1", org_id: "org-1", notes: null }];
    const res = await fileNote("n-1", { retarget: { kind: "visit", id: "v-1" } });
    expect(res.ok).toBe(true);
    expect(rowsOf("workboard_flags")[0]).toMatchObject({ target_kind: "visit", target_id: "v-1" });
    expect(noteRow()).toMatchObject({ target_kind: "visit", target_id: "v-1" });
  });

  it("a refused filing leaves the note on the job it was on", async () => {
    note({
      proposal: {
        ...EMPTY,
        tasks: [task({ assigneeId: null, assigneeHint: "" })],
        flags: [{ message: "Roof hatch seized", severity: "warn" }],
      },
    });
    db.maintenance_visits = [{ id: "v-1", org_id: "org-1", notes: null }];
    const res = await fileNote("n-1", { retarget: { kind: "visit", id: "v-1" } });
    expect(res.ok).toBe(false);
    expect(noteRow()).toMatchObject({ target_kind: "none", target_id: null, status: "pending" });
  });

  it("refuses a job that isn't in this workspace", async () => {
    note({ proposal: { ...EMPTY, flags: [{ message: "Roof hatch seized", severity: "warn" }] } });
    db.maintenance_visits = [{ id: "v-9", org_id: "org-2", notes: null }];
    const res = await fileNote("n-1", { retarget: { kind: "visit", id: "v-9" } });
    expect(res).toEqual({ ok: false, error: "That job isn't on this workspace's board any more." });
    expect(rowsOf("workboard_flags")).toEqual([]);
  });

  it("says Done. with Tiff's line, and returns the doors", async () => {
    note();
    const res = await fileNote("n-1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.turns.at(-1)).toMatchObject({ who: "tiff", text: "Done. A task for Luke to order the grilles." });
      expect(res.doors).toEqual([
        { kind: "tasks", count: 1, label: "1 task filed", ids: [rowsOf("tasks")[0].id] },
      ]);
    }
    expect(noteRow()).toMatchObject({ status: "applied" });
    expect((noteRow().turns as Row[]).at(-1)).toMatchObject({ text: "Done. A task for Luke to order the grilles." });
  });

  it("files once, however many times it is pressed", async () => {
    note();
    const [a, b] = await Promise.all([fileNote("n-1"), fileNote("n-1")]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(rowsOf("tasks")).toHaveLength(1);
  });

  it("refuses somebody else's note", async () => {
    note({ author_id: "s-luke" });
    expect((await fileNote("n-1")).ok).toBe(false);
    expect(rowsOf("tasks")).toEqual([]);
  });

  it("carries a library entry published before filing into the record", async () => {
    note({ applied: { kbIds: ["kb-1"], kbTitles: ["Clearing an E6"] } });
    await fileNote("n-1");
    expect(noteRow().applied).toMatchObject({ v: 2, kbIds: ["kb-1"], taskIds: [expect.any(String)] });
  });
});

/* ── the v2 record ──────────────────────────────────────────────────── */

describe("what applyConfirmed records for Undo (v2)", () => {
  it("keeps checklist ids for a project's bring-items", async () => {
    note({ target_kind: "project", target_id: "p-1", proposal: { ...EMPTY, bringItems: ["2 × 595 filters"] } });
    db.projects = [{ id: "p-1", org_id: "org-1" }];
    await fileNote("n-1");
    const applied = noteRow().applied as Row;
    expect(applied.v).toBe(2);
    expect(applied.checklistIds).toEqual([rowsOf("project_checklist_items")[0].id]);
    expect(applied.bringItems).toEqual(["2 × 595 filters"]);
  });

  it("keeps picklist ids for a job's bring-items", async () => {
    note({ target_kind: "job", target_id: "job-uuid", proposal: { ...EMPTY, bringItems: ["1060 grille"] } });
    db.sm8_jobs = [{ uuid: "job-uuid", org_id: "org-1" }];
    await fileNote("n-1");
    expect((noteRow().applied as Row).picklistIds).toEqual([rowsOf("job_picklist_items")[0].id]);
  });

  it("keeps a bump apart from a fresh issue, with what the bumped row said before", async () => {
    note({
      target_kind: "project",
      target_id: "p-1",
      proposal: {
        ...EMPTY,
        issueEntries: [
          { body: "Tripped again", equipmentHint: "" },
          { body: "New rattle", equipmentHint: "" },
        ],
      },
    });
    db.projects = [{ id: "p-1", org_id: "org-1" }];
    db.workboard_issues = [
      { id: "i-old", org_id: "org-1", target_kind: "project", summary: "Tripped again", occurrences: 2, last_seen: "2026-09-01", resolved: false },
    ];
    await fileNote("n-1");
    const applied = noteRow().applied as Row;
    const fresh = rowsOf("workboard_issues").find((i) => i.summary === "New rattle")!;
    // the journal's chips still read every issue the note touched
    expect(applied.issueIds).toEqual(["i-old", fresh.id]);
    expect(applied.issueBumps).toEqual([{ id: "i-old", occurrences: 2, lastSeen: "2026-09-01" }]);
  });

  it("keeps an append to a visit's notes as before and after", async () => {
    note({ target_kind: "visit", target_id: "v-1", proposal: { ...EMPTY, progressBullets: ["Belts swapped"] } });
    db.maintenance_visits = [{ id: "v-1", org_id: "org-1", notes: "gate 4417" }];
    await fileNote("n-1");
    expect((noteRow().applied as Row).textWrites).toEqual([
      { table: "maintenance_visits", id: "v-1", column: "notes", before: "gate 4417", after: "gate 4417\nBelts swapped" },
    ]);
  });

  it("keeps an agreement's bring list as before and after, null included", async () => {
    note({ target_kind: "agreement", target_id: "a-1", proposal: { ...EMPTY, bringItems: ["coil cleaner"] } });
    db.maintenance_agreements = [{ id: "a-1", org_id: "org-1", bring_list: null }];
    await fileNote("n-1");
    expect((noteRow().applied as Row).textWrites).toEqual([
      { table: "maintenance_agreements", id: "a-1", column: "bring_list", before: null, after: "coil cleaner" },
    ]);
  });

  it("the review card's apply writes the same record", async () => {
    note({ target_kind: "visit", target_id: "v-1", turns: undefined });
    db.maintenance_visits = [{ id: "v-1", org_id: "org-1", notes: null }];
    const res = await applyNote("n-1", {
      tasks: [],
      bringItems: [],
      flags: [],
      progressBullets: ["Belts swapped"],
      commissioningEntries: [],
      issueEntries: [],
    });
    expect(res.ok).toBe(true);
    expect(noteRow().applied).toMatchObject({ v: 2, textWrites: [{ before: null, after: "Belts swapped" }] });
  });
});

/* ── undoNote ───────────────────────────────────────────────────────── */

describe("undoNote", () => {
  /** A note filed through fileNote onto a visit, touching every kind of row. */
  async function filedEverything() {
    note({
      target_kind: "visit",
      target_id: "v-1",
      proposal: {
        ...EMPTY,
        tasks: [task()],
        flags: [{ message: "Roof hatch seized", severity: "warn" }],
        progressBullets: ["Belts swapped"],
        issueEntries: [
          { body: "Tripped again", equipmentHint: "" },
          { body: "New rattle", equipmentHint: "" },
        ],
        bringItems: ["coil cleaner"],
        say: "Luke orders the grilles.",
      },
    });
    db.maintenance_visits = [{ id: "v-1", org_id: "org-1", agreement_id: "a-1", notes: "gate 4417" }];
    db.maintenance_agreements = [{ id: "a-1", org_id: "org-1", bring_list: "ladder" }];
    db.workboard_issues = [
      { id: "i-old", org_id: "org-1", target_kind: "visit", summary: "Tripped again", occurrences: 2, last_seen: "2026-09-01", resolved: false },
    ];
    const res = await fileNote("n-1");
    expect(res.ok).toBe(true);
  }

  it("takes back every row, puts the bump back, restores the text, and marks the note undone", async () => {
    await filedEverything();
    expect(rowsOf("tasks")).toHaveLength(1);

    const res = await undoNote("n-1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.summary).toBe("1 task, 1 flag, 2 issues, 1 thing to bring and 1 line taken back.");
      expect(res.turns.at(-1)).toMatchObject({ who: "tiff", text: res.summary });
    }
    expect(rowsOf("tasks")).toEqual([]);
    expect(rowsOf("workboard_flags")).toEqual([]);
    expect(rowsOf("workboard_issues")).toEqual([
      expect.objectContaining({ id: "i-old", occurrences: 2, last_seen: "2026-09-01" }),
    ]);
    expect(rowsOf("maintenance_visits")[0].notes).toBe("gate 4417");
    expect(rowsOf("maintenance_agreements")[0].bring_list).toBe("ladder");
    expect(noteRow()).toMatchObject({ status: "undone", undone_at: expect.any(String) });
    // the words and the record of what existed both stay
    expect(noteRow().transcript).toBe("Luke needs to order the grilles");
    expect((noteRow().applied as Row).taskIds).toHaveLength(1);
  });

  it("takes back the project entries, checklist and picklist rows and library entries too", async () => {
    note({
      status: "applied",
      applied: {
        v: 2,
        entryIds: ["e-1"],
        checklistIds: ["c-1"],
        picklistIds: ["pk-1"],
        kbIds: ["kb-1"],
      },
    });
    db.project_entries = [{ id: "e-1", org_id: "org-1" }];
    db.project_checklist_items = [{ id: "c-1", org_id: "org-1", done: false }];
    db.job_picklist_items = [{ id: "pk-1", org_id: "org-1", picked: false }];
    db.kb_documents = [
      { id: "kb-1", org_id: "org-1", category: "field" },
      { id: "kb-manual", org_id: "org-1", category: "install" },
    ];
    expect((await undoNote("n-1")).ok).toBe(true);
    expect(rowsOf("project_entries")).toEqual([]);
    expect(rowsOf("project_checklist_items")).toEqual([]);
    expect(rowsOf("job_picklist_items")).toEqual([]);
    expect(rowsOf("kb_documents").map((d) => d.id)).toEqual(["kb-manual"]);
  });

  it("refuses, and changes nothing, when one task has been ticked off", async () => {
    await filedEverything();
    rowsOf("tasks")[0].status = "done";
    rowsOf("tasks")[0].done_by = "s-luke";
    const before = structuredClone(db);

    const res = await undoNote("n-1");
    expect(res).toEqual({
      ok: false,
      error: "Luke has already ticked off one of those, so nothing was taken back.",
    });
    expect(db).toEqual(before);
  });

  it("refuses, and changes nothing, when the job's notes changed since", async () => {
    await filedEverything();
    rowsOf("maintenance_visits")[0].notes = "gate 4417\nBelts swapped\nLuke: done";
    const before = structuredClone(db);

    const res = await undoNote("n-1");
    expect(res).toEqual({
      ok: false,
      error: "That job's notes have changed since, so nothing was taken back.",
    });
    expect(db).toEqual(before);
  });

  it.each([
    ["a flag was cleared", () => (rowsOf("workboard_flags")[0].active = false)],
    ["the bumped issue was counted again", () => (rowsOf("workboard_issues")[0].occurrences = 4)],
    [
      "the fresh issue was counted again",
      () => (rowsOf("workboard_issues").find((i) => i.summary === "New rattle")!.occurrences = 2),
    ],
  ])("refuses, and changes nothing, when %s", async (_label, act) => {
    await filedEverything();
    act();
    const before = structuredClone(db);
    const res = await undoNote("n-1");
    expect(res.ok).toBe(false);
    expect(db).toEqual(before);
  });

  it("refuses someone who is neither the author nor team", async () => {
    await filedEverything();
    me = "s-callum";
    const before = structuredClone(db);
    expect(await undoNote("n-1")).toEqual({ ok: false, error: "That note isn't yours to take back." });
    expect(db).toEqual(before);
  });

  it("lets team take back somebody else's note", async () => {
    await filedEverything();
    me = "s-callum";
    caps = new Set(["workboard", "team"]);
    expect((await undoNote("n-1")).ok).toBe(true);
    expect(rowsOf("tasks")).toEqual([]);
  });

  it("refuses a note filed before the v2 record", async () => {
    note({ status: "applied", applied: { taskIds: ["t-1"] } });
    db.tasks = [{ id: "t-1", org_id: "org-1", status: "open" }];
    const res = await undoNote("n-1");
    expect(res).toEqual({ ok: false, error: "That one was filed before Undo existed, so it can't be taken back." });
    expect(rowsOf("tasks")).toHaveLength(1);
    expect(noteRow().status).toBe("applied");
  });

  it("takes back once, even pressed twice at the same moment", async () => {
    await filedEverything();
    const [a, b] = await Promise.all([undoNote("n-1"), undoNote("n-1")]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok)).toEqual({ ok: false, error: "That was already taken back." });
    // Tiff's "taken back" line is on the note once
    expect((noteRow().turns as Row[]).filter((x) => /taken back/.test(String(x.text)))).toHaveLength(1);
    expect(await undoNote("n-1")).toEqual({ ok: false, error: "That was already taken back." });
  });

  it("refuses a note that was never filed", async () => {
    note();
    expect(await undoNote("n-1")).toEqual({ ok: false, error: "There's nothing filed on that note to take back." });
  });
});

/* ── keepWords ──────────────────────────────────────────────────────── */

describe("keepWords", () => {
  it("files the words as typed, which the journal reads back with nothing after them", async () => {
    const res = await keepWords("  Gate code is 4821 after hours.  ", "diary");
    expect(res.ok).toBe(true);
    const row = rowsOf("workboard_notes")[0];
    expect(row).toMatchObject({
      author_id: "s-me",
      transcript: "Gate code is 4821 after hours.",
      status: "applied",
      applied: {},
      proposal: null,
    });
    expect((row.turns as Row[]).map((x) => [x.who, x.text, x.room])).toEqual([
      ["you", "Gate code is 4821 after hours.", "diary"],
    ]);
    // no capability needed: your own diary is yours
    caps = new Set();
    expect((await keepWords("second line")).ok).toBe(true);

    const journal = await listJournal("org-1", "s-me");
    expect(journal.map((e) => [e.said, e.outcomes])).toEqual(
      expect.arrayContaining([["Gate code is 4821 after hours.", []]]),
    );
  });

  it("needs a staff card, and some words", async () => {
    expect((await keepWords("   ")).ok).toBe(false);
    me = null;
    expect((await keepWords("hello")).ok).toBe(false);
    expect(rowsOf("workboard_notes")).toEqual([]);
  });
});

/* ── publishNoteKb ──────────────────────────────────────────────────── */

describe("publishNoteKb", () => {
  const withKb = (over: Row = {}) =>
    note({
      proposal: { ...EMPTY, kbEntries: [{ title: "Clearing an E6", body: "Power the outdoor board separately." }] },
      ...over,
    });

  it("publishes the stored entry, once, and adds it to the record", async () => {
    withKb({ status: "applied", applied: { v: 2, taskIds: ["t-1"] } });
    publishFieldNote.mockResolvedValue({ ok: true, documentId: "kb-9" });

    const res = await publishNoteKb("n-1", 0);
    expect(res).toEqual({ ok: true, documentId: "kb-9", summary: "Added to the Library." });
    expect(publishFieldNote).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Clearing an E6",
        body: "Power the outdoor board separately.",
        authorId: "s-me",
        authorName: "Isaac Smith",
        noteId: "n-1",
      }),
    );
    expect(noteRow().applied).toEqual({ v: 2, taskIds: ["t-1"], kbIds: ["kb-9"], kbTitles: ["Clearing an E6"] });

    expect(await publishNoteKb("n-1", 0)).toEqual({ ok: false, error: "That's already in the Library." });
    expect(publishFieldNote).toHaveBeenCalledTimes(1);
  });

  it("publishes nothing for an entry that isn't there, or on a note taken back", async () => {
    withKb();
    expect((await publishNoteKb("n-1", 3)).ok).toBe(false);
    withKb({ status: "undone", undone_at: "2026-09-25T01:00:00Z" });
    expect((await publishNoteKb("n-1", 0)).ok).toBe(false);
    expect(publishFieldNote).not.toHaveBeenCalled();
  });

  it("Undo takes a published entry back with the rest", async () => {
    withKb({ status: "applied", applied: { v: 2 } });
    publishFieldNote.mockResolvedValue({ ok: true, documentId: "kb-9" });
    db.kb_documents = [{ id: "kb-9", org_id: "org-1", category: "field" }];
    await publishNoteKb("n-1", 0);
    const res = await undoNote("n-1");
    expect(res.ok && res.summary).toBe("1 library entry taken back.");
    expect(rowsOf("kb_documents")).toEqual([]);
  });
});

/* ── the migration the server depends on ────────────────────────────── */

describe("tiff_modal_turns.sql", () => {
  const sql = readFileSync(join(process.cwd(), "docs/migrations/tiff_modal_turns.sql"), "utf8");
  const code = sql.replace(/--.*$/gm, "");

  it("adds the two columns and the status Undo writes, idempotently", () => {
    expect(code).toMatch(/add column if not exists turns jsonb not null default '\[\]'::jsonb/);
    expect(code).toMatch(/add column if not exists undone_at timestamptz/);
    expect(code).toMatch(/'pending', 'clarifying', 'applied', 'dismissed', 'undone'/);
    // every constraint it adds, it drops first — so it can run twice
    for (const [, name] of code.matchAll(/add constraint (\w+)/g)) {
      expect(code).toContain(`drop constraint if exists ${name}`);
    }
  });

  it("says when to apply it and what to check first", () => {
    expect(sql).toMatch(/APPLY THIS BEFORE MERGING/);
    expect(sql).toMatch(/select status, count\(\*\) from public\.workboard_notes group by 1/);
  });

  it("allows as many turns as the server can write", () => {
    const cap = Number(/jsonb_array_length\(turns\) <= (\d+)/.exec(code)?.[1]);
    expect(cap).toBe(TURNS_MAX);
  });
});
