/**
 * @jest-environment node
 */

/* A COST FROM A JOB'S CONVERSATION (v2 step 6, slice C) — the server.

   "$85 at Reece for fittings, on this job." The router's cost lane is faked
   (no model is called), and so is today's receipt reader; everything after
   them is real: `fileNote` files the cost through the expense form's own
   action (`submitClaim`, its rules and its receipt adoption, against this
   fake database), asks first when the amount is missing, and Undo cancels
   the claim the way its author cancels one (`cancelClaim`). */

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

import { continueNote, fileNote, routeNote, undoCost, undoNote } from "../workboard-notes";
import type { NoteProposal } from "@/lib/workboard/note-brain";
import type { ProposedCost } from "@/lib/workboard/note-cost";
import { appliedOf } from "@/lib/workboard/note-applied";
import { WHICH_JOB } from "@/lib/workboard/note-turns";

const { readNote } = jest.requireMock("@/lib/workboard/note-brain") as { readNote: jest.Mock };

const JOB = "0000000b-0000-4000-8000-000000003209";
const STAFF = [
  { id: "s-me", first_name: "Isaac", last_name: "Smith", full_name: "Isaac Smith", org_id: "org-1" },
  { id: "s-lyle", first_name: "Lyle", last_name: "Irving", full_name: "Lyle Irving", org_id: "org-1" },
];

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
  say: "",
  clarify: null,
};

const reece = (over: Partial<ProposedCost> = {}): ProposedCost => ({
  amount: 85,
  gst: 0,
  gstBasis: "unsaid",
  supplier: "Reece",
  whatFor: "fittings",
  category: "materials",
  day: "",
  paidWith: "own",
  payerId: null,
  payerHint: "",
  ...over,
});

const SAID = "$85 at Reece for fittings, on this job.";
const t = (who: "you" | "tiff", text: string) => ({ who, text, at: "2026-10-13T00:05:00.000Z" });

/** The board's note: on job 3209, one cost, waiting to be filed. */
function note(costs: ProposedCost[] = [reece()], extra: Row = {}) {
  const p = { ...EMPTY, costs, say: "$85 at Reece for fittings, on this job.", ...extra };
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
const claims = () => db.expense_claims ?? [];
const tasks = () => db.tasks ?? [];

/** The speaker's photo of the docket, uploaded as the expense form uploads one. */
const receiptDoc = (over: Row = {}): Row => ({
  id: "doc-1",
  org_id: "org-1",
  uploaded_by: "s-me",
  kind: "receipt",
  uploaded_at: "2026-10-13T00:04:00.000Z",
  storage_ref: "org/org-1/receipt/doc-1.jpg",
  mime_type: "image/jpeg",
  size_bytes: 2000,
  expense_claim_id: null,
  ...over,
});
const READ = {
  ok: true,
  total: 93.5,
  gst: 8.5,
  supplier: "Reece Plumbing Preston",
  date: "2026-10-12",
  description: "Copper fittings and flux",
  category: "materials",
};

beforeEach(() => {
  db = {
    staff_profiles: STAFF.map((s) => ({ ...s })),
    sm8_jobs: [{ org_id: "org-1", uuid: JOB, generated_job_id: "3209", company_uuid: "co-1" }],
    sm8_companies: [{ org_id: "org-1", uuid: "co-1", name: "Richards" }],
  };
  seq = 0;
  caps = new Set(["workboard"]);
  me = "s-me";
  candidates = [];
  readNote.mockReset();
  readExpenseReceipt.mockReset();
  download.mockClear();
});

describe("filing through the expense form's gate", () => {
  it("records $85 at Reece as the speaker's claim, the ServiceM8 job named in its words", async () => {
    note();
    const res = await fileNote("n-1");
    if (!res.ok) throw new Error(res.error);
    expect(claims()).toEqual([
      expect.objectContaining({
        org_id: "org-1",
        staff_profile_id: "s-me",
        expense_date: "2026-10-13",
        description: "fittings, for #3209 — Richards",
        category: "materials",
        amount: 85,
        gst_amount: null,
        supplier: "Reece",
        paid_with: "own",
        status: "pending",
        job_kind: "none",
        job_id: null,
      }),
    ]);
    const id = claims()[0]!.id;
    expect(appliedOf(noteRow().applied).costs).toEqual([
      expect.objectContaining({ index: 0, how: "claim", claimId: id, amount: 85, day: "2026-10-13", undone: false }),
    ]);
    expect(res.costs).toEqual([
      {
        index: 0,
        how: "claim",
        title: "$85.00 at Reece",
        line: "Fittings, Tuesday 13 October",
        aside: "Waiting on approval.",
        receipt: false,
        undo: true,
      },
    ]);
    expect(res.doors).toEqual(expect.arrayContaining([{ kind: "costs", count: 1, label: "1 cost recorded", ids: [id] }]));
    expect(res.turns.slice(-2).map((x) => x.text)).toEqual([
      "Done. $85 at Reece for fittings, on this job.",
      "Claimed: $85.00 at Reece, fittings. It's waiting on approval.",
    ]);
    expect(noteRow().status).toBe("applied");
  });

  it("links the claim to the job where the claim's column can hold it: a project", async () => {
    db.projects = [{ id: "p-1", org_id: "org-1", name: "Northgate fit-out", client_name: "Northgate" }];
    note();
    noteRow().target_kind = "project";
    noteRow().target_id = "p-1";
    const res = await fileNote("n-1");
    expect(res.ok).toBe(true);
    expect(claims()[0]).toMatchObject({
      description: "fittings",
      job_kind: "project",
      job_id: "p-1",
      job_label: "Northgate, Northgate fit-out",
    });
  });

  it("files the company card as a receipt on record, nobody owed", async () => {
    note([reece({ paidWith: "company", gst: 7.73, gstBasis: "inc" })]);
    const res = await fileNote("n-1");
    if (!res.ok) throw new Error(res.error);
    expect(claims()[0]).toMatchObject({ paid_with: "company", status: "recorded", gst_amount: 7.73 });
    expect(res.costs![0]).toMatchObject({ how: "company", aside: "On the company card." });
  });

  it("says the expense action's own refusal, and files nothing for it", async () => {
    note([reece({ day: "2026-10-20" })]);
    const res = await fileNote("n-1");
    if (!res.ok) throw new Error(res.error);
    expect(claims()).toEqual([]);
    expect(res.costs).toBeUndefined();
    expect(res.turns.at(-1)!.text).toBe("$85.00 at Reece wasn't recorded. That date is in the future.");
  });
});

describe("a receipt photo with the note", () => {
  it("is read by today's receipt reader beside the words, and kept on the note", async () => {
    db.documents = [receiptDoc()];
    readExpenseReceipt.mockResolvedValue(READ);
    readNote.mockResolvedValue({ ok: true, proposal: { ...EMPTY, costs: [reece()], say: "$85 at Reece." } });
    const res = await routeNote({ transcript: SAID, target: { kind: "job", id: JOB }, receiptId: "doc-1" });
    if (!res.ok) throw new Error(res.error);
    expect(download).toHaveBeenCalledWith("org/org-1/receipt/doc-1.jpg");
    expect(readExpenseReceipt).toHaveBeenCalledWith(PHOTO.toString("base64"), "image/jpeg");
    // the router is told a receipt came, and reads no photo itself
    expect(readNote.mock.calls[0][1]).toMatchObject({ receipt: true });
    expect((noteRow().proposal as Row).receipt).toEqual({
      documentId: "doc-1",
      read: {
        total: 93.5,
        gst: 8.5,
        supplier: "Reece Plumbing Preston",
        date: "2026-10-12",
        description: "Copper fittings and flux",
        category: "materials",
      },
    });
  });

  it("wins over what was said, and the photo goes on the claim", async () => {
    db.documents = [receiptDoc()];
    readExpenseReceipt.mockResolvedValue(READ);
    readNote.mockResolvedValue({ ok: true, proposal: { ...EMPTY, costs: [reece()], say: "$85 at Reece." } });
    await routeNote({ transcript: SAID, target: { kind: "job", id: JOB }, receiptId: "doc-1" });
    const res = await fileNote(String(noteRow().id));
    if (!res.ok) throw new Error(res.error);
    expect(claims()[0]).toMatchObject({
      amount: 93.5,
      gst_amount: 8.5,
      supplier: "Reece Plumbing Preston",
      expense_date: "2026-10-12",
      description: "Copper fittings and flux, for #3209 — Richards",
    });
    // adopted by submitClaim, as the form's upload is
    expect(db.documents[0]!.expense_claim_id).toBe(claims()[0]!.id);
    expect(res.costs![0]).toMatchObject({ receipt: true, title: "$93.50 at Reece Plumbing Preston" });
    expect(res.turns.at(-1)!.text).toBe(
      "Claimed: $93.50 at Reece Plumbing Preston, Copper fittings and flux. It's waiting on approval. The receipt says $93.50, so that's what I used.",
    );
  });

  it("gives the amount the words left out, so nothing is asked", async () => {
    note([reece({ amount: 0 })], { receipt: { documentId: "doc-1", read: { ...READ, ok: undefined } } });
    db.documents = [receiptDoc()];
    const res = await fileNote("n-1");
    expect(res.ok).toBe(true);
    expect(claims()[0]).toMatchObject({ amount: 93.5 });
  });

  it("one that couldn't be read is still filed with the claim, from the words, and she says so", async () => {
    db.documents = [receiptDoc()];
    readExpenseReceipt.mockResolvedValue({ ok: false, reason: "Tiff couldn't read that receipt." });
    readNote.mockResolvedValue({ ok: true, proposal: { ...EMPTY, costs: [reece()], say: "$85 at Reece." } });
    await routeNote({ transcript: SAID, target: { kind: "job", id: JOB }, receiptId: "doc-1" });
    const res = await fileNote(String(noteRow().id));
    if (!res.ok) throw new Error(res.error);
    expect(claims()[0]).toMatchObject({ amount: 85, supplier: "Reece" });
    expect(db.documents[0]!.expense_claim_id).toBe(claims()[0]!.id);
    expect(res.turns.at(-1)!.text).toMatch(/I couldn't read the receipt, so it's from what you said\.$/);
  });

  it("someone else's photo is not read, and she says it isn't here", async () => {
    db.documents = [receiptDoc({ uploaded_by: "s-lyle" })];
    readNote.mockResolvedValue({ ok: true, proposal: { ...EMPTY, costs: [reece()], say: "$85 at Reece." } });
    const res = await routeNote({ transcript: SAID, target: { kind: "job", id: JOB }, receiptId: "doc-1" });
    if (!res.ok) throw new Error(res.error);
    expect(readExpenseReceipt).not.toHaveBeenCalled();
    expect(res.turns.at(-1)!.text).toBe("That receipt photo isn't here any more. Attach it again.");
    expect((noteRow().proposal as Row).receipt).toBeUndefined();
  });

  it("can come with the answer to How much was it, and is kept on the note for the cost lane", async () => {
    note([reece({ amount: 0 })], { clarify: { question: "How much was it: fittings at Reece?", options: [] } });
    noteRow().status = "clarifying";
    db.documents = [receiptDoc()];
    readExpenseReceipt.mockResolvedValue(READ);
    readNote.mockResolvedValue({ ok: true, proposal: { ...EMPTY, costs: [reece({ amount: 0 })], say: "Fittings at Reece." } });
    const res = await continueNote("n-1", "Here's the docket", [], "doc-1");
    if (!res.ok) throw new Error(res.error);
    expect(readNote.mock.calls[0][1]).toMatchObject({ receipt: true });
    expect((noteRow().proposal as Row).receipt).toMatchObject({ documentId: "doc-1", read: { total: 93.5 } });
    const filed = await fileNote("n-1");
    expect(filed.ok).toBe(true);
    expect(claims()[0]).toMatchObject({ amount: 93.5 });
    expect(db.documents[0]!.expense_claim_id).toBe(claims()[0]!.id);
  });
});

describe("asking first", () => {
  it("asks how much when the amount is missing, and files nothing until it's answered", async () => {
    note([reece({ amount: 0 })]);
    const res = await fileNote("n-1");
    expect(res).toMatchObject({
      ok: false,
      error: "How much was it: fittings at Reece?",
      ask: { question: "How much was it: fittings at Reece?", options: [] },
    });
    expect(claims()).toEqual([]);
    expect(noteRow().status).toBe("clarifying");
    expect((noteRow().proposal as Row).clarify).toEqual({ question: "How much was it: fittings at Reece?", options: [] });
    expect((noteRow().turns as Row[]).at(-1)!.text).toBe("How much was it: fittings at Reece?");
  });

  it("asks for the total when only a figure before GST was said", async () => {
    note([reece({ gstBasis: "plus" })]);
    const res = await fileNote("n-1");
    expect(res).toMatchObject({ ok: false, error: "What was the total with GST: $85.00 plus GST at Reece?" });
    expect(claims()).toEqual([]);
  });

  it("asks which job when it was said off any job, with the jobs it names as tap answers", async () => {
    candidates = [{ kind: "project", id: "p-1", label: "Northgate fit-out", clientName: "Northgate", jobNumber: null }];
    note();
    noteRow().target_kind = "none";
    noteRow().target_id = null;
    noteRow().transcript = "$85 at Reece for fittings for Northgate";
    const res = await fileNote("n-1");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.ask!.question).toBe(WHICH_JOB);
    expect(res.ask!.options).toEqual([expect.objectContaining({ target: { kind: "project", id: "p-1" } })]);
    expect(claims()).toEqual([]);
  });
});

describe("Undo", () => {
  it("a cost card's Undo cancels its claim the way its author would, and the rest stands", async () => {
    note();
    await fileNote("n-1");
    const res = await undoCost("n-1", 0);
    expect(res).toMatchObject({ ok: true, summary: "$85.00 at Reece taken back." });
    expect(claims()[0]).toMatchObject({ status: "cancelled" });
    expect(appliedOf(noteRow().applied).costs[0]!.undone).toBe(true);
    expect(noteRow().status).toBe("applied");
    expect(await undoCost("n-1", 0)).toMatchObject({ ok: false, error: "That was already taken back." });
  });

  it("the note's Undo cancels its claims with its tasks", async () => {
    note([reece()], {
      tasks: [
        {
          title: "Order the grilles",
          detail: "",
          assigneeId: "s-lyle",
          assigneeHint: "Lyle",
          dueHint: "",
          dueDate: "",
          remindTime: "",
          remindKind: "at",
        },
      ],
    });
    await fileNote("n-1");
    const res = await undoNote("n-1");
    expect(res).toMatchObject({ ok: true, summary: "1 task and 1 cost taken back." });
    expect(claims()[0]).toMatchObject({ status: "cancelled" });
    expect(tasks()).toEqual([]);
  });

  it("a claim somebody has decided since stops both Undos, with nothing taken back", async () => {
    note();
    await fileNote("n-1");
    claims()[0]!.status = "approved";
    expect(await undoNote("n-1")).toEqual({
      ok: false,
      error: "That expense claim has been decided since, so nothing was taken back.",
    });
    expect(await undoCost("n-1", 0)).toEqual({ ok: false, error: "That claim has already been decided." });
    expect(claims()[0]).toMatchObject({ status: "approved" });
    expect(noteRow().status).toBe("applied");
  });
});

describe("the gates", () => {
  it("someone else's money is theirs to claim: a task for them, and Tiff says why", async () => {
    note([reece({ payerId: "s-lyle", payerHint: "Lyle" })]);
    const res = await fileNote("n-1");
    if (!res.ok) throw new Error(res.error);
    expect(claims()).toEqual([]);
    expect(tasks()).toEqual([
      expect.objectContaining({
        title: "Claim $85.00 at Reece",
        assigned_to: "s-lyle",
        detail: "Fittings, today, for #3209 — Richards. Isaac said you paid. Claim it in Expense claims.",
      }),
    ]);
    expect(res.turns.at(-1)!.text).toBe(
      "A claim is the payer's own to make, so I've made it a task for Lyle: Claim $85.00 at Reece.",
    );
    expect(res.costs).toEqual([expect.objectContaining({ how: "task", title: "Claim $85.00 at Reece", aside: "A task for Lyle.", undo: true })]);
    expect(appliedOf(noteRow().applied).taskIds).toEqual([tasks()[0]!.id]);
    // its Undo is a task's
    expect(await undoCost("n-1", 0)).toMatchObject({ ok: true, summary: "$85.00 at Reece task taken back." });
    expect(tasks()).toEqual([]);
    expect(appliedOf(noteRow().applied).taskIds).toEqual([]);
  });

  it("fuel goes on the vehicle's log: a task for the speaker, as the expense form sends it", async () => {
    note([reece({ supplier: "BP", whatFor: "diesel", category: "fuel" })]);
    const res = await fileNote("n-1");
    if (!res.ok) throw new Error(res.error);
    expect(claims()).toEqual([]);
    expect(tasks()).toEqual([expect.objectContaining({ title: "Log fuel: $85.00 at BP", assigned_to: "s-me" })]);
    expect(res.turns.at(-1)!.text).toBe("Fuel goes on the vehicle's log, so I've made it a task: Log fuel: $85.00 at BP.");
  });

  it("with no staff record nothing can be filed, and she says why", async () => {
    me = null;
    note();
    const res = await fileNote("n-1");
    if (!res.ok) throw new Error(res.error);
    expect(claims()).toEqual([]);
    expect(res.turns.at(-1)!.text).toBe("$85.00 at Reece wasn't recorded. Your staff profile isn't set up yet.");
  });

  it("a note needs the Workboard, as every note does", async () => {
    caps = new Set();
    note();
    expect(await fileNote("n-1")).toEqual({ ok: false, error: "You don't have access to the Workboard." });
    expect(claims()).toEqual([]);
  });
});
