/**
 * @jest-environment node
 */

/* A VISIT FROM A JOB'S CONVERSATION (v2 step 6, slice B) — the server.

   "…and book commissioning for Friday arvo." The router's visit lane is
   faked (no model is called); everything after it is real: `fileNote`
   files the rest and asks "which time?" with the person's free starts,
   `answerVisit` books the one picked, and Undo takes the booking back.
   Book in itself (actions/booking-sm8) is the fake here: these tests pin
   that a visit goes THROUGH it — its live read, its press, its take-back —
   and never around it, and what happens where its gate says no. */

type Row = Record<string, unknown>;
type Filter = [op: "eq" | "in" | "is", column: string, value: unknown];

let db: Record<string, Row[]> = {};
let seq = 0;

function from(table: string) {
  const filters: Filter[] = [];
  let mode: "select" | "update" | "delete" = "select";
  let patch: Row = {};
  let returning = false;
  const match = (r: Row) =>
    filters.every(([op, col, val]) =>
      op === "eq" ? r[col] === val : op === "is" ? (r[col] ?? null) === val : (val as unknown[]).includes(r[col]),
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

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: { from: (t: string) => from(t), rpc: (n: string, a: Row) => rpc(n, a) },
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn(async () => ({ user: { sub: "auth0|me" }, orgId: "org-1" })) },
}));

/* WHO IS PRESSING: Book in's gate is Workboard manage, and the owner while
   bookings are the owner's. */
let caps = new Set<string>();
let role: string | null = "owner";
jest.mock("@/lib/permissions-server", () => ({
  can: async (c: string) => caps.has(c),
  getDbRole: async () => role,
}));
jest.mock("@/lib/workboard/projects-query", () => ({ staffIdFor: async () => "s-me" }));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: async () => "Australia/Sydney" }));
/* Tuesday 13 October, as on the board, so Friday is "Friday" */
jest.mock("@/lib/workboard/dates", () => ({
  ...jest.requireActual("@/lib/workboard/dates"),
  todayInZone: () => "2026-10-13",
}));
jest.mock("@/lib/dashboard/reminders-query", () => ({
  workdayHours: async () => ({ start: "07:00", end: "17:00" }),
}));
jest.mock("@/lib/brain/tools", () => ({
  jobHistory: async () => ({ equipment: [], issues: [], flags: [], recentNotes: [] }),
}));
jest.mock("@/lib/dashboard/job-candidates", () => ({ jobCandidates: async () => [] }));
jest.mock("@/lib/tiff/field-notes", () => ({ publishFieldNote: jest.fn() }));

/* WHETHER BOOKINGS GO: the deployment (SM8_WRITES) and the workspace's
   sending state, and who is linked to whom in ServiceM8. */
let bookingsOn = true;
let sendOn = true;
let trial = false;
jest.mock("@/lib/integrations/sm8-kinds", () => ({
  ...jest.requireActual("@/lib/integrations/sm8-kinds"),
  sm8BookingsAllowed: () => bookingsOn,
  sm8NotesAllowed: () => false,
}));
jest.mock("@/lib/integrations/sm8-writes", () => ({
  readSm8WriteState: async () => ({ tenantId: "tenant-1", mode: trial ? "trial" : "live" }),
}));
jest.mock("@/lib/integrations/sm8-write-plan", () => ({
  ...jest.requireActual("@/lib/integrations/sm8-write-plan"),
  offersSend: () => sendOn,
}));
const LYLE = "0000000a-0000-4000-8000-00000000001e";
let links = [{ staffProfileId: "s-lyle", remoteId: LYLE }];
jest.mock("@/lib/integrations/links", () => ({ listSm8StaffLinks: async () => links }));
jest.mock("@/lib/integrations/sm8-booking-read", () => ({
  ...jest.requireActual("@/lib/integrations/sm8-booking-read"),
  bookingZone: async () => ({ zone: "Australia/Sydney" }),
}));

/* BOOK IN, faked at its door: its live read, its press, its take-back. */
const JOB = "0000000b-0000-4000-8000-000000003342";
const FRIDAY = "2026-10-16";
let lyleFriday: Row[] = [];
const readBookInContext = jest.fn(async (input: { jobUuid: string; days: string[] }) => ({
  ok: true as const,
  offered: true as const,
  trial,
  hold: null,
  zone: "Australia/Sydney",
  today: "2026-10-13",
  job: { uuid: input.jobUuid, number: "3342", status: "Work Order" as const, editDate: "2026-10-12 08:00:00" },
  bookings: [],
  days: { [FRIDAY]: lyleFriday },
  jobNumbers: {},
  staff: [],
  readAt: "2026-10-13T00:00:00.000Z",
  off: { [FRIDAY]: { away: [], closed: [] } },
}));
let bookAnswer: { ok: true; rowIds: string[] } | { ok: false; error: string } = { ok: true, rowIds: ["row-1"] };
const bookJobIn = jest.fn(async (input: unknown) => {
  void input;
  return bookAnswer.ok ? { ok: true as const, verb: {}, rowIds: bookAnswer.rowIds } : bookAnswer;
});
let takeBackAnswer: { ok: true; line: null } | { ok: false; error: string } = { ok: true, line: null };
const takeBackBooking = jest.fn(async (input: unknown) => {
  void input;
  return takeBackAnswer;
});
jest.mock("@/app/actions/booking-sm8", () => ({
  readBookInContext: (i: { jobUuid: string; days: string[] }) => readBookInContext(i),
  bookJobIn: (i: unknown) => bookJobIn(i),
  takeBackBooking: (i: unknown) => takeBackBooking(i),
}));

import { answerVisit, fileNote, undoNote, undoVisit } from "../workboard-notes";
import type { NoteProposal } from "@/lib/workboard/note-brain";
import { appliedOf } from "@/lib/workboard/note-applied";

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

const grilles = {
  title: "Order the grilles",
  detail: "",
  assigneeId: "s-lyle",
  assigneeHint: "Lyle",
  dueHint: "today",
  dueDate: "2026-10-13",
  remindTime: "12:30",
  remindKind: "by" as const,
};
const commissioning = (over: Partial<NoteProposal["visits"][number]> = {}) => ({
  work: "commissioning",
  assigneeId: "s-lyle",
  assigneeHint: "Lyle",
  day: FRIDAY,
  start: "",
  part: "afternoon" as const,
  minutes: 90,
  ...over,
});

const SAID = "Get Lyle to order the grilles before lunch, and book commissioning for Friday arvo.";
const t = (who: "you" | "tiff", text: string) => ({ who, text, at: "2026-10-13T00:05:00.000Z" });

/** The board's note: on job 3342, a task and a visit, waiting to be filed. */
function note(proposal: Partial<NoteProposal> = {}) {
  const p = { ...EMPTY, tasks: [grilles], visits: [commissioning()], say: "A task for Lyle, and commissioning Friday arvo.", ...proposal };
  db.workboard_notes = [
    {
      id: "n-1",
      org_id: "org-1",
      author_id: "s-me",
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
  db = { staff_profiles: STAFF.map((s) => ({ ...s })) };
  seq = 0;
  caps = new Set(["workboard", "workboard_manage"]);
  role = "owner";
  bookingsOn = true;
  sendOn = true;
  trial = false;
  links = [{ staffProfileId: "s-lyle", remoteId: LYLE }];
  lyleFriday = [{ uuid: "a-1", jobUuid: "other", staffUuid: LYLE.toUpperCase(), start: `${FRIDAY} 13:00:00`, end: `${FRIDAY} 14:00:00` }];
  bookAnswer = { ok: true, rowIds: ["row-1"] };
  takeBackAnswer = { ok: true, line: null };
  readBookInContext.mockClear();
  bookJobIn.mockClear();
  takeBackBooking.mockClear();
  jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-12T23:05:00Z"));
});
afterEach(() => jest.restoreAllMocks());

describe("a visit with a clear time", () => {
  it("books through Book in: its live read, then its press, with the person, the day, the start and the length", async () => {
    note({ tasks: [], visits: [commissioning({ start: "14:00", minutes: 120 })] });
    const res = await fileNote("n-1");
    expect(res.ok).toBe(true);
    expect(readBookInContext).toHaveBeenCalledWith({ jobUuid: JOB, days: [FRIDAY] });
    expect(bookJobIn).toHaveBeenCalledTimes(1);
    expect(bookJobIn.mock.calls[0]![0]).toMatchObject({
      jobUuid: JOB,
      makeWorkOrder: false,
      seen: { jobEditDate: "2026-10-12 08:00:00", readAt: "2026-10-13T00:00:00.000Z" },
      bookings: [{ staffUuid: LYLE, day: FRIDAY, start: "14:00", minutes: 120 }],
    });
    // the record keeps the rows Undo takes back; the card is the conversation's
    expect(appliedOf(noteRow().applied).visits).toEqual([
      expect.objectContaining({ index: 0, how: "booked", rowIds: ["row-1"], jobUuid: JOB, staffId: "s-lyle" }),
    ]);
    if (!res.ok) throw new Error(res.error);
    expect(res.visits).toEqual([
      expect.objectContaining({ title: "Commissioning", line: "Lyle, Friday 16 October, 2:00 to 4:00 pm", undo: true }),
    ]);
    expect(res.doors).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "visits", label: "1 visit booked" })]));
    expect(res.turns.at(-1)!.text).toBe("Booked: commissioning, Lyle, Friday 16 October, 2:00 to 4:00 pm.");
    expect(res.ask).toBeUndefined();
  });

  it("presses the same press for the same visit at the same time, so a second answer is Book in's to dedupe", async () => {
    note({ tasks: [], visits: [commissioning({ start: "14:00" })] });
    await fileNote("n-1");
    const first = (bookJobIn.mock.calls[0]![0] as { pressId: string }).pressId;
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("says a trial run sent nothing, as Book in's does", async () => {
    trial = true;
    note({ tasks: [], visits: [commissioning({ start: "14:00" })] });
    const res = await fileNote("n-1");
    if (!res.ok) throw new Error(res.error);
    expect(res.visits![0]).toMatchObject({ how: "trial", aside: "Trial run. Nothing went to ServiceM8." });
  });

  it("says Book in's own refusal, and offers the other starts that day", async () => {
    bookAnswer = { ok: false, error: "Lyle is already booked then." };
    note({ tasks: [], visits: [commissioning({ start: "13:00" })] });
    const res = await fileNote("n-1");
    if (!res.ok) throw new Error(res.error);
    expect(res.turns.map((x) => x.text)).toContain("Commissioning wasn't booked. Lyle is already booked then.");
    expect(res.ask!.options.map((o) => o.label)).toEqual(["2:00 pm", "3:30 pm", "Another time"]);
    expect(appliedOf(noteRow().applied).visits).toEqual([]);
  });
});

describe("a visit with no clear time", () => {
  it("files the task, then asks which time with Lyle's free starts that day (the board)", async () => {
    note();
    const res = await fileNote("n-1");
    if (!res.ok) throw new Error(res.error);
    // the task just happened
    expect(tasks()).toEqual([expect.objectContaining({ title: "Order the grilles", assigned_to: "s-lyle" })]);
    // nothing was booked: the visit is asked first
    expect(bookJobIn).not.toHaveBeenCalled();
    // the crew's day is Book in's own read of that day
    expect(readBookInContext).toHaveBeenCalledWith({ jobUuid: JOB, days: [FRIDAY] });
    expect(res.ask).toEqual({
      question: "Commissioning on Friday: which time? Lyle's free at both.",
      options: [
        { label: "2:00 pm", visit: { index: 0, start: "14:00" } },
        { label: "3:30 pm", visit: { index: 0, start: "15:30" } },
        { label: "Another time", visit: { index: 0, start: null } },
      ],
    });
    expect(res.turns.slice(-2).map((x) => x.text)).toEqual([
      "Done. A task for Lyle, and commissioning Friday arvo.",
      "Commissioning on Friday: which time? Lyle's free at both.",
    ]);
    // the question waits on the filed note
    expect(noteRow().status).toBe("applied");
    expect((noteRow().proposal as Row).visitAsks).toEqual([0]);
    expect((noteRow().proposal as Row).clarify).toEqual({
      question: "Commissioning on Friday: which time? Lyle's free at both.",
      options: ["2:00 pm", "3:30 pm", "Another time"],
    });
  });

  it("an answer books it, and the question is settled", async () => {
    note();
    await fileNote("n-1");
    const res = await answerVisit("n-1", "2:00 pm");
    if (!res.ok) throw new Error(res.error);
    expect(bookJobIn).toHaveBeenCalledTimes(1);
    expect(bookJobIn.mock.calls[0]![0]).toMatchObject({ bookings: [{ staffUuid: LYLE, day: FRIDAY, start: "14:00", minutes: 90 }] });
    expect(res.visit).toMatchObject({ title: "Commissioning", line: "Lyle, Friday 16 October, 2:00 to 3:30 pm" });
    expect(res.turns.slice(-2).map((x) => x.text)).toEqual([
      "2:00 pm",
      "Booked: commissioning, Lyle, Friday 16 October, 2:00 to 3:30 pm.",
    ]);
    expect((noteRow().proposal as Row).clarify).toBeNull();
    expect((noteRow().proposal as Row).visitAsks).toEqual([]);
    // the grilles task the filing made is still on the record beside it
    const a = appliedOf(noteRow().applied);
    expect(a.taskIds).toHaveLength(1);
    expect(a.visits).toEqual([expect.objectContaining({ how: "booked", start: "14:00", rowIds: ["row-1"] })]);
    // answered once
    expect(await answerVisit("n-1", "3:30 pm")).toEqual({ ok: false, error: "There's no visit waiting on a time." });
  });

  it("\"Another time\" asks for one, and a typed time books it", async () => {
    note();
    await fileNote("n-1");
    const another = await answerVisit("n-1", "Another time");
    expect(another).toMatchObject({ ok: false, error: "What time? Say it like 2:30 pm." });
    expect(bookJobIn).not.toHaveBeenCalled();
    const typed = await answerVisit("n-1", "4pm");
    expect(typed.ok).toBe(true);
    expect(bookJobIn.mock.calls[0]![0]).toMatchObject({ bookings: [expect.objectContaining({ start: "16:00" })] });
  });

  it("is only the author's to answer", async () => {
    note();
    await fileNote("n-1");
    noteRow().author_id = "s-lyle";
    expect(await answerVisit("n-1", "2:00 pm")).toEqual({ ok: false, error: "That note isn't yours." });
  });
});

describe("Undo", () => {
  it("a visit card's Undo cancels its booking the way the job card's does, and the rest stands", async () => {
    note();
    await fileNote("n-1");
    await answerVisit("n-1", "2:00 pm");
    const res = await undoVisit("n-1", 0);
    expect(res).toMatchObject({ ok: true, summary: "Commissioning booking taken back." });
    expect(takeBackBooking).toHaveBeenCalledWith({ jobUuid: JOB, rowId: "row-1" });
    expect(appliedOf(noteRow().applied).visits[0]!.undone).toBe(true);
    expect(tasks()).toHaveLength(1); // the grilles stay
    expect(await undoVisit("n-1", 0)).toMatchObject({ ok: false, error: "That was already taken back." });
  });

  it("the note's Undo takes back its bookings with its tasks", async () => {
    note({ visits: [commissioning({ start: "14:00" })] });
    await fileNote("n-1");
    const res = await undoNote("n-1");
    expect(res).toMatchObject({ ok: true, summary: "1 task and 1 visit taken back." });
    expect(takeBackBooking).toHaveBeenCalledWith({ jobUuid: JOB, rowId: "row-1" });
    expect(tasks()).toEqual([]);
  });

  it("a booking Book in won't take back stops the note's Undo, with nothing else taken back", async () => {
    note({ visits: [commissioning({ start: "14:00" })] });
    await fileNote("n-1");
    takeBackAnswer = { ok: false, error: "Lyle has checked in to that booking." };
    expect(await undoNote("n-1")).toEqual({ ok: false, error: "Lyle has checked in to that booking." });
    expect(noteRow().status).toBe("applied");
    expect(tasks()).toHaveLength(1);
  });
});

describe("the gates", () => {
  it("someone who may not book gets it as a task, \"Book commissioning Friday\", and Tiff says why", async () => {
    caps = new Set(["workboard"]); // no workboard_manage
    note();
    const res = await fileNote("n-1");
    if (!res.ok) throw new Error(res.error);
    expect(readBookInContext).not.toHaveBeenCalled();
    expect(bookJobIn).not.toHaveBeenCalled();
    expect(tasks()).toEqual([
      expect.objectContaining({ title: "Order the grilles" }),
      expect.objectContaining({ title: "Book commissioning Friday", assigned_to: "s-me", detail: "Lyle, Friday afternoon, 90 min" }),
    ]);
    expect(res.ask).toBeUndefined();
    expect(res.turns.at(-1)!.text).toBe("You can't book visits, so I've made it a task: Book commissioning Friday.");
    expect(res.visits).toEqual([expect.objectContaining({ how: "task", title: "Book commissioning Friday", undo: true })]);
    // its Undo is a task's
    expect(await undoVisit("n-1", 0)).toMatchObject({ ok: true, summary: "Commissioning taken back." });
    expect(tasks().map((x) => x.title)).toEqual(["Order the grilles"]);
  });

  it("a manager is not the owner while bookings are the owner's: a task too", async () => {
    role = "manager";
    note({ tasks: [], visits: [commissioning({ start: "14:00" })] });
    await fileNote("n-1");
    expect(bookJobIn).not.toHaveBeenCalled();
    expect(tasks()).toEqual([expect.objectContaining({ title: "Book commissioning Friday" })]);
  });

  it("bookings off: made in HeyTiff only, a task at its time for the person, and she says so", async () => {
    bookingsOn = false;
    note({ tasks: [], visits: [commissioning({ start: "14:00" })] });
    const res = await fileNote("n-1");
    if (!res.ok) throw new Error(res.error);
    expect(readBookInContext).not.toHaveBeenCalled();
    expect(bookJobIn).not.toHaveBeenCalled();
    expect(tasks()).toEqual([
      expect.objectContaining({ title: "Commissioning", assigned_to: "s-lyle", due_date: FRIDAY, remind_kind: null }),
    ]);
    expect(tasks()[0]!.remind_at).toEqual(expect.any(String));
    expect(res.turns.at(-1)!.text).toBe(
      "Commissioning is in HeyTiff only: Lyle, Friday 16 October, 2:00 to 3:30 pm. Bookings don't go to ServiceM8 here.",
    );
    expect(res.visits![0]).toMatchObject({ how: "heytiff", aside: "In HeyTiff only." });
  });

  it("bookings off with no clear time still asks first, and an answer makes it in HeyTiff", async () => {
    sendOn = false;
    note({ tasks: [] });
    const res = await fileNote("n-1");
    if (!res.ok) throw new Error(res.error);
    expect(res.ask!.question).toMatch(/^Commissioning on Friday: which time\?/);
    expect(readBookInContext).not.toHaveBeenCalled();
    const answered = await answerVisit("n-1", "3:30 pm");
    expect(answered).toMatchObject({ ok: true, visit: { how: "heytiff" } });
    expect(tasks()).toEqual([expect.objectContaining({ title: "Commissioning", due_date: FRIDAY })]);
    expect(appliedOf(noteRow().applied).taskIds).toEqual([tasks()[0]!.id]);
  });

  it("a visit off a job can't be booked: a task for the speaker", async () => {
    note({ tasks: [], visits: [commissioning({ start: "14:00" })] });
    noteRow().target_kind = "none";
    noteRow().target_id = null;
    const res = await fileNote("n-1");
    if (!res.ok) throw new Error(res.error);
    expect(bookJobIn).not.toHaveBeenCalled();
    expect(res.turns.at(-1)!.text).toBe("A visit needs a ServiceM8 job, so I've made it a task: Book commissioning Friday.");
  });

  it("asks who's going before anything is filed, as for a task", async () => {
    note({ tasks: [], visits: [commissioning({ assigneeId: null, assigneeHint: "" })] });
    const res = await fileNote("n-1");
    expect(res).toMatchObject({ ok: false, error: "Who's going: commissioning?" });
    expect(noteRow().status).toBe("clarifying");
  });
});
