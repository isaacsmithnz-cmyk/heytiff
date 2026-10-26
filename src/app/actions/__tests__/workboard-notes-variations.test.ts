/**
 * @jest-environment node
 */

/* A VARIATION FROM A JOB'S CONVERSATION (v2 step 6, slice D) — the server.

   "The client wants a return grille added in Bed 2." The router's
   variation lane is faked (no model is called), and so is the quote page's
   own action underneath (`startVariation`, `dropVariation`); everything
   between is real: `fileNote` asks which job when there is none, reads
   whether the job's quote has an accepted option, holds the quote page's
   money gate, starts the draft or makes the task its route says, and the
   card's Undo and the note's Undo take the empty draft back. The harness
   is the cost lane's (workboard-notes-costs.test.ts). */

type Row = Record<string, unknown>;
type Filter = [op: "eq" | "in" | "is" | "not", column: string, value: unknown];

let db: Record<string, Row[]> = {};
let seq = 0;

function from(table: string) {
  const filters: Filter[] = [];
  let mode: "select" | "update" | "delete" = "select";
  let patch: Row = {};
  let returning = false;
  const match = (r: Row) =>
    filters.every(([op, col, val]) =>
      op === "eq"
        ? r[col] === val
        : op === "is"
          ? (r[col] ?? null) === val
          : op === "not"
            ? (r[col] ?? null) !== val
            : (val as unknown[]).includes(r[col]),
    );
  const run = (one = false) => {
    const all = db[table] ?? [];
    const hit = all.filter(match);
    if (mode === "update") {
      for (const r of hit) Object.assign(r, structuredClone(patch));
      return { data: returning ? hit.map((r) => ({ ...r })) : null, error: null };
    }
    if (mode === "delete") {
      if (db[table]) db[table] = all.filter((r) => !match(r));
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
  b.is = (col: string, val: unknown) => (filters.push(["is", col, val]), b);
  b.not = (col: string, _op: string, val: unknown) => (filters.push(["not", col, val]), b);
  b.gte = () => b;
  b.lt = () => b;
  b.order = () => b;
  b.limit = () => b;
  b.maybeSingle = async () => run(true);
  b.single = async () => run(true);
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej);
  b.update = (p: Row) => ((mode = "update"), (patch = p), b);
  b.delete = () => ((mode = "delete"), b);
  b.insert = (payload: Row | Row[]) => {
    const made = (Array.isArray(payload) ? payload : [payload]).map((p) => ({
      id: `${table}-${++seq}`,
      ...structuredClone(p),
    }));
    (db[table] ??= []).push(...made);
    const out = () => made.map((m) => ({ ...m }));
    return {
      select: () => ({
        single: async () => ({ data: out()[0], error: null }),
        maybeSingle: async () => ({ data: out()[0], error: null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: out(), error: null }).then(res),
      }),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
    };
  };
  return b;
}

const isObj = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
/* tiff_modal_record.sql's merge, as the database runs it */
async function rpc(name: string, a: Row) {
  if (name !== "workboard_note_file_record") return { data: false, error: null };
  const n = (db.workboard_notes ?? []).find((r) => r.org_id === a.p_org && r.id === a.p_note && r.status === "applied");
  if (!n || !isObj(a.p_applied)) return { data: false, error: null };
  n.applied = { ...(isObj(n.applied) ? n.applied : {}), ...structuredClone(a.p_applied) };
  return { data: true, error: null };
}

/* the bucket: one photo, by its reference */
const PHOTO = Buffer.from("a receipt from Reece");
const download = jest.fn(async (ref: string) =>
  ref === "org/org-1/receipt/doc-1.jpg" ? { data: new Blob([PHOTO]), error: null } : { data: null, error: { message: "gone" } },
);

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (t: string) => from(t),
    rpc: (n: string, a: Row) => rpc(n, a),
    storage: { from: () => ({ download: (ref: string) => download(ref) }) },
  },
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn(async () => ({ user: { sub: "auth0|me" }, orgId: "org-1" })) },
}));

let caps = new Set<string>();
jest.mock("@/lib/permissions-server", () => ({
  can: async (c: string) => caps.has(c),
  getDbRole: async () => "staff",
}));
/* the speaker, to the notes action and to the expense action alike */
let me: string | null = "s-me";
jest.mock("@/lib/workboard/projects-query", () => ({ staffIdFor: async () => me }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: async () => me }));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: async () => "Australia/Sydney" }));
jest.mock("@/lib/workboard/dates", () => ({
  ...jest.requireActual("@/lib/workboard/dates"),
  todayInZone: () => "2026-10-13",
}));
jest.mock("@/lib/au-dates", () => ({
  ...jest.requireActual("@/lib/au-dates"),
  todayInAu: () => "2026-10-13",
}));
jest.mock("@/lib/dashboard/reminders-query", () => ({
  workdayHours: async () => ({ start: "07:00", end: "17:00" }),
}));
jest.mock("@/lib/brain/tools", () => ({
  jobHistory: async () => ({ equipment: [], issues: [], flags: [], recentNotes: [] }),
}));
let candidates: Row[] = [];
jest.mock("@/lib/dashboard/job-candidates", () => ({ jobCandidates: async () => candidates }));
jest.mock("@/lib/tiff/field-notes", () => ({ publishFieldNote: jest.fn() }));
jest.mock("@/lib/integrations/sm8-kinds", () => ({
  ...jest.requireActual("@/lib/integrations/sm8-kinds"),
  sm8NotesAllowed: () => false,
}));

/* the router and today's receipt reader, faked at their doors */
jest.mock("@/lib/workboard/note-brain", () => ({
  ...jest.requireActual("@/lib/workboard/note-brain"),
  readNote: jest.fn(),
}));
const readExpenseReceipt = jest.fn();
jest.mock("@/app/actions/expense-ai", () => ({
  readExpenseReceipt: (b: string, m: string) => readExpenseReceipt(b, m),
}));
jest.mock("@/lib/images/for-claude", () => ({
  imageForClaude: async (bytes: Buffer) => ({ bytes, mime: "image/jpeg" }),
}));

/* the quote page's own action, faked at its door */
const readByHand = jest.fn();
const startVariation = jest.fn();
const dropVariation = jest.fn();
const variationDraft = jest.fn();
jest.mock("@/lib/quotes/lines-job-server", () => ({
  readByHand: (...a: unknown[]) => readByHand(...a),
  startVariation: (...a: unknown[]) => startVariation(...a),
  dropVariation: (...a: unknown[]) => dropVariation(...a),
  variationDraft: (...a: unknown[]) => variationDraft(...a),
  VARIATION_KEPT: {
    gone: "That variation isn't on the quote any more.",
    touched: "That variation has been changed, approved or sent since, so it stays. Take it off on the quote page if it isn't wanted.",
  },
}));
const addEvents = jest.fn();
jest.mock("@/lib/quotes/session/store-server", () => ({
  readSession: async () => ({ id: "qs-1" }),
  addEvents: (...a: unknown[]) => addEvents(...a),
}));

import { fileNote, undoNote, undoVariation } from "../workboard-notes";
import type { NoteProposal } from "@/lib/workboard/note-brain";
import { appliedOf } from "@/lib/workboard/note-applied";
import { WHICH_JOB } from "@/lib/workboard/note-turns";

const { readNote } = jest.requireMock("@/lib/workboard/note-brain") as { readNote: jest.Mock };

const JOB = "0000000b-0000-4000-8000-000000003209";
const STAFF = [
  { id: "s-me", first_name: "Isaac", last_name: "Smith", full_name: "Isaac Smith", org_id: "org-1" },
  { id: "s-lyle", first_name: "Lyle", last_name: "Irving", full_name: "Lyle Irving", org_id: "org-1" },
];
const TOUCHED = "That variation has been changed, approved or sent since, so it stays. Take it off on the quote page if it isn't wanted.";

const EMPTY: NoteProposal = {
  tasks: [],
  visits: [],
  costs: [],
  variations: [],
  bringItems: [],
  flags: [],
  progressBullets: [],
  commissioningEntries: [],
  issueEntries: [],
  kbEntries: [],
  plainNote: "",
  jobNote: "",
  say: "",
  clarify: null,
};

const SAID = "The client wants a return grille added in Bed 2.";
const t = (who: "you" | "tiff", text: string) => ({ who, text, at: "2026-10-18T00:05:00.000Z" });
const LYLE_TASK = { title: "Order the grille", detail: "", assigneeId: "s-lyle", assigneeHint: "Lyle", dueHint: "", dueDate: "", remindTime: "", remindKind: "at" as const };

/** The board's note: on job 3209, one variation, waiting to be filed. */
function note(extra: Partial<NoteProposal> = {}) {
  const p = { ...EMPTY, variations: [{ what: "return grille in Bed 2" }], say: "I'll start a variation for the return grille.", ...extra };
  db.workboard_notes = [
    {
      id: "n-1",
      org_id: "org-1",
      author_id: me,
      target_kind: "job",
      target_id: JOB,
      transcript: SAID,
      source: "voice",
      status: "pending",
      proposal: p,
      applied: null,
      turns: [t("you", SAID), t("tiff", p.say)],
    },
  ];
}
const noteRow = () => db.workboard_notes[0]!;
const tasks = () => db.tasks ?? [];

beforeEach(() => {
  db = {
    staff_profiles: STAFF.map((s) => ({ ...s })),
    sm8_jobs: [{ org_id: "org-1", uuid: JOB, generated_job_id: "3209", company_uuid: "co-1", active: 1 }],
    sm8_companies: [{ org_id: "org-1", uuid: "co-1", name: "Richards" }],
  };
  seq = 0;
  caps = new Set(["workboard", "financials"]);
  me = "s-me";
  candidates = [];
  readNote.mockReset();
  readByHand.mockReset().mockResolvedValue({ accepted: [0], variations: [] });
  startVariation.mockReset().mockResolvedValue({ ok: true, option: 1, n: 1 });
  dropVariation.mockReset().mockResolvedValue({ ok: true });
  variationDraft.mockReset().mockResolvedValue({ state: "empty" });
  addEvents.mockReset();
});

describe("starting a variation from the words", () => {
  it("starts the draft on the accepted quote through the quote page's own action, and prices and sends nothing", async () => {
    note();
    const res = await fileNote("n-1");
    if (!res.ok) throw new Error(res.error);
    expect(startVariation).toHaveBeenCalledWith("org-1", JOB, "return grille in Bed 2", "auth0|me");
    expect(res.variations).toEqual([
      {
        index: 0,
        how: "started",
        title: "Started variation 1: return grille in Bed 2",
        line: "A draft to change and price on the quote.",
        href: `/dashboard/jobs/${JOB}/quote?option=1`,
        undo: true,
      },
    ]);
    expect(res.turns.at(-1)!.text).toBe(
      "Started variation 1: return grille in Bed 2. It's a copy of the accepted quote to change and price; nothing goes to the client or ServiceM8 until it's approved.",
    );
    expect(appliedOf(noteRow().applied).variations).toEqual([
      { index: 0, how: "started", why: null, what: "return grille in Bed 2", jobUuid: JOB, n: 1, option: 1, taskId: null, undone: false },
    ]);
    expect(res.doors).toEqual([{ kind: "variations", count: 1, label: "1 variation started", ids: [] }]);
    expect(tasks()).toEqual([]);
    /* the quote's history says so, as the quote page marks it */
    expect(addEvents).toHaveBeenCalledWith("org-1", "qs-1", null, [
      { kind: "milestone", author: "auth0|me", body: { text: "Variation 1 started: return grille in Bed 2" } },
    ]);
  });

  it("a job with no accepted quote has no variation: she says so, and makes it a task instead", async () => {
    readByHand.mockResolvedValue({ accepted: [], variations: [] });
    note();
    const res = await fileNote("n-1");
    if (!res.ok) throw new Error(res.error);
    expect(startVariation).not.toHaveBeenCalled();
    expect(tasks()).toEqual([
      expect.objectContaining({
        title: "Add to the quote: return grille in Bed 2",
        assigned_to: "s-me",
        detail: "Nothing is accepted on the quote on #3209 — Richards yet, so this changes the quote itself rather than starting a variation.",
      }),
    ]);
    expect(res.turns.at(-1)!.text).toBe(
      "There's no accepted quote on this job, so there's no variation to start. I've made it a task instead: Add to the quote: return grille in Bed 2.",
    );
    expect(res.variations).toEqual([expect.objectContaining({ how: "task", title: "Add to the quote: return grille in Bed 2", href: null, undo: true })]);
    expect(appliedOf(noteRow().applied).taskIds).toEqual([tasks()[0]!.id]);
  });

  it("someone without money access gets a task, and she says why: the quote page's own gate", async () => {
    caps = new Set(["workboard"]);
    note();
    const res = await fileNote("n-1");
    if (!res.ok) throw new Error(res.error);
    expect(startVariation).not.toHaveBeenCalled();
    expect(tasks()).toEqual([expect.objectContaining({ title: "Start variation: return grille in Bed 2", assigned_to: "s-me" })]);
    expect(res.turns.at(-1)!.text).toBe("Starting a variation needs money access, so I've made it a task for you: Start variation: return grille in Bed 2.");
  });

  it("says the quote page's own refusal, and makes nothing", async () => {
    startVariation.mockResolvedValue({ ok: false, reason: "A quote holds 20 options and variations at most." });
    note();
    const res = await fileNote("n-1");
    if (!res.ok) throw new Error(res.error);
    expect(res.variations).toBeUndefined();
    expect(res.turns.at(-1)!.text).toBe("The variation for return grille in Bed 2 wasn't started. A quote holds 20 options and variations at most.");
  });

  it("asks which job when it was said off any job, and starts nothing", async () => {
    note();
    noteRow().target_kind = "none";
    noteRow().target_id = null;
    const res = await fileNote("n-1");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.ask!.question).toBe(WHICH_JOB);
    expect(startVariation).not.toHaveBeenCalled();
  });

  it("a row crossed off starts nothing", async () => {
    note();
    const res = await fileNote("n-1", { leaveOut: ["variations:0"] });
    expect(res.ok).toBe(true);
    expect(startVariation).not.toHaveBeenCalled();
  });
});

describe("Undo", () => {
  it("a variation card's Undo takes back the empty draft, and the rest of the note stands", async () => {
    note();
    await fileNote("n-1");
    const res = await undoVariation("n-1", 0);
    expect(res).toMatchObject({ ok: true, summary: "Variation 1 taken back." });
    expect(dropVariation).toHaveBeenCalledWith("org-1", JOB, 1, "auth0|me");
    expect(appliedOf(noteRow().applied).variations[0]!.undone).toBe(true);
    expect(noteRow().status).toBe("applied");
    expect(await undoVariation("n-1", 0)).toMatchObject({ ok: false, error: "That was already taken back." });
  });

  it("one changed since stays, in the quote page's words", async () => {
    note();
    await fileNote("n-1");
    dropVariation.mockResolvedValue({ ok: false, reason: TOUCHED });
    expect(await undoVariation("n-1", 0)).toEqual({ ok: false, error: TOUCHED });
    expect(appliedOf(noteRow().applied).variations[0]!.undone).toBe(false);
  });

  it("taking one back needs money access, as starting one does", async () => {
    note();
    await fileNote("n-1");
    caps = new Set(["workboard"]);
    expect(await undoVariation("n-1", 0)).toEqual({ ok: false, error: "Taking a variation back needs money access, as starting one does." });
    expect(dropVariation).not.toHaveBeenCalled();
  });

  it("the note's Undo takes back the empty draft with its tasks", async () => {
    note({ tasks: [LYLE_TASK] });
    await fileNote("n-1");
    const res = await undoNote("n-1");
    expect(res).toMatchObject({ ok: true, summary: "1 task and 1 variation taken back." });
    expect(dropVariation).toHaveBeenCalledWith("org-1", JOB, 1, "auth0|me");
    expect(tasks()).toEqual([]);
  });

  it("a variation somebody has worked on since stops the note's Undo, with nothing taken back", async () => {
    note({ tasks: [LYLE_TASK] });
    await fileNote("n-1");
    variationDraft.mockResolvedValue({ state: "touched" });
    expect(await undoNote("n-1")).toEqual({ ok: false, error: TOUCHED });
    expect(dropVariation).not.toHaveBeenCalled();
    expect(tasks()).toHaveLength(1);
    expect(noteRow().status).toBe("applied");
  });

  it("a variation that became a task goes as a note's task goes", async () => {
    caps = new Set(["workboard"]);
    note();
    await fileNote("n-1");
    expect(await undoVariation("n-1", 0)).toMatchObject({ ok: true, summary: 'The task "Start variation: return grille in Bed 2" taken back.' });
    expect(tasks()).toEqual([]);
    expect(appliedOf(noteRow().applied).taskIds).toEqual([]);
  });
});
