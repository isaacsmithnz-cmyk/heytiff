/**
 * @jest-environment node
 */

/* MOVING A BOOKING FROM TIFF (note-move) — the server.

   Isaac, 2 November 2026: "Move Lisa and Mossman, uh, my booking this
   afternoon to Friday, seven AM" booked a second visit on the chip's job.
   The router's move lane is faked (no model is called); everything after it
   is real: `fileNote` finds the booking among his own and asks first,
   `answerVisit` (the door both apps send a tapped answer to) moves it
   through the Schedule's own change, and Undo moves it back. The bookings'
   read and the Schedule's change are the fakes: these tests pin that a move
   goes THROUGH the change, with no new visit and no job note. */
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
/* a filed job note sends on to ServiceM8 after the answer; not these tests' business */
jest.mock("next/server", () => ({ after: () => undefined }));
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
jest.mock("@/lib/integrations/sm8-booking-read", () => ({
  ...jest.requireActual("@/lib/integrations/sm8-booking-read"),
  bookingZone: async () => ({ zone: "Australia/Sydney" }),
}));
jest.mock("@/app/actions/booking-sm8", () => ({ takeBackBooking: jest.fn() }));

/* HIS COMING BOOKINGS, as the mirror has them */
const TODAY = "2026-10-13";
let bookings: Row[] = [];
jest.mock("@/lib/workboard/note-move-read", () => ({
  sm8StaffOfCard: async (_org: string, card: string) => (card === "s-me" ? "sm8-me" : card === "s-lyle" ? "sm8-lyle" : null),
  comingBookingsOf: async (_org: string, staffUuid: string, staffName: string) => bookings.filter((b) => b.staffUuid === staffUuid).map((b) => ({ ...b, staffName })),
}));

/* THE SCHEDULE'S OWN CHANGE, faked at its door */
let gateOk = true;
jest.mock("@/lib/mobile/schedule-gate", () => ({
  changeAllowed: async (ctx: { caps: Set<string> }) =>
    gateOk && ctx.caps.has("workboard_manage") ? { ok: true, state: {}, zone: "Australia/Sydney" } : { ok: false, error: "You can't change the schedule.", status: 403 },
}));
let changeAnswer: Row = { ok: true, state: "sent", said: "", undo: { do: "time", activity: "act-new", start: "2026-10-13 15:00:00", end: "2026-10-13 16:00:00" } };
const changeSchedule = jest.fn(async (ctx: unknown, press: unknown, input: unknown) => {
  void ctx;
  void press;
  void input;
  return changeAnswer;
});
jest.mock("@/lib/mobile/schedule-change", () => ({
  changeSchedule: (c: unknown, p: unknown, i: unknown) => changeSchedule(c, p, i),
}));
jest.mock("@/lib/integrations/sm8-press", () => ({ sm8PressFromSession: async () => ({ orgId: "org-1", userId: "auth0|me", staffId: "s-me" }) }));

import { answerVisit, fileNote, undoNote } from "../workboard-notes";
import type { NoteProposal } from "@/lib/workboard/note-brain";
import type { ProposedMove } from "@/lib/workboard/note-move";
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
  jobNote: "",
  say: "",
  clarify: null,
};
const CHIP_JOB = "job-3375";
const move = (over: Partial<ProposedMove> = {}): ProposedMove => ({
  whoId: null,
  whoHint: "",
  words: "Lisa in Mossman",
  fromDay: TODAY,
  fromStart: "",
  fromPart: "afternoon",
  toDay: "2026-10-16",
  toStart: "07:00",
  ...over,
});
const SAID = "Move Lisa and Mossman, my booking this afternoon to Friday seven am.";
const t = (who: "you" | "tiff", text: string) => ({ who, text, at: "2026-10-13T00:05:00.000Z" });
function note(proposal: Partial<NoteProposal> = {}) {
  const p = { ...EMPTY, moves: [move()], jobNote: "Move Lisa in Mosman to Friday 7 am.", ...proposal };
  db.workboard_notes = [
    {
      id: "n-1",
      org_id: "org-1",
      author_id: "s-me",
      target_kind: "job",
      target_id: CHIP_JOB,
      transcript: SAID,
      source: "voice",
      status: "pending",
      proposal: p,
      applied: null,
      turns: [t("you", SAID)],
    },
  ];
}
const noteRow = () => db.workboard_notes[0]!;

const MOSMAN = { uuid: "act-mosman", jobUuid: "job-3488", staffUuid: "sm8-me", start: "2026-10-13 15:00:00", end: "2026-10-13 16:00:00", place: "6/40 Raglan St, Mosman", match: "3488 Lisa Brown 6/40 Raglan St Mosman" };
const MANLY = { uuid: "act-manly", jobUuid: CHIP_JOB, staffUuid: "sm8-me", start: "2026-10-13 07:00:00", end: "2026-10-13 11:00:00", place: "12 Pittwater Rd, Manly", match: "3375 Hall 12 Pittwater Rd Manly" };

beforeEach(() => {
  db = { staff_profiles: STAFF.map((s) => ({ ...s })) };
  seq = 0;
  caps = new Set(["workboard", "workboard_manage"]);
  role = "owner";
  bookingsOn = true;
  sendOn = true;
  trial = false;
  gateOk = true;
  bookings = [MANLY, MOSMAN];
  changeAnswer = { ok: true, state: "sent", said: "", undo: { do: "time", activity: "act-new", start: "2026-10-13 15:00:00", end: "2026-10-13 16:00:00" } };
  changeSchedule.mockClear();
});

describe("moving his booking", () => {
  it("finds the one he named, not the chip's job, and asks before anything moves", async () => {
    note();
    const res = await fileNote("n-1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ask).toEqual({
      question: "Move your visit at 6/40 Raglan St, Mosman from today 3:00 to 4:00 pm to Friday 7:00 to 8:00 am?",
      options: [
        { label: "Move the visit", visit: { index: 100, start: null } },
        { label: "Not now", visit: { index: 100, start: null } },
      ],
    });
    expect(changeSchedule).not.toHaveBeenCalled();
    // no "Done." over nothing, no new visit, no task, and no job note on the chip's job
    expect(res.turns.map((x) => x.text)).not.toContain("Done.");
    expect(db.tasks ?? []).toEqual([]);
    expect(noteRow().target_kind).toBe("none");
    expect(db.job_notes ?? []).toEqual([]);
  });

  it("moves it through the Schedule's change on Move the visit, keeping its length, and Undo moves it back", async () => {
    note();
    await fileNote("n-1");
    const res = await answerVisit("n-1", "Move the visit");
    expect(res.ok).toBe(true);
    expect(changeSchedule).toHaveBeenCalledTimes(1);
    expect(changeSchedule.mock.calls[0]![2]).toEqual({
      change: { do: "time", activity: "act-mosman", start: "2026-10-16 07:00:00", end: "2026-10-16 08:00:00" },
      tell: true,
    });
    if (res.ok) {
      expect(res.turns.at(-1)!.text).toBe("Moved. Your visit at 6/40 Raglan St, Mosman is Friday 7:00 to 8:00 am now.");
      expect(res.visit).toMatchObject({ title: "Moved", undo: true });
    }
    expect(appliedOf(noteRow().applied).moves).toEqual([expect.objectContaining({ index: 0, undo: { do: "time", activity: "act-new", start: "2026-10-13 15:00:00", end: "2026-10-13 16:00:00" } })]);
    // asked once: the answer is spent
    expect((noteRow().proposal as Row).moveAsk).toBeNull();

    const undone = await undoNote("n-1");
    expect(undone.ok).toBe(true);
    expect(changeSchedule).toHaveBeenCalledTimes(2);
    expect(changeSchedule.mock.calls[1]![2]).toEqual({ change: { do: "time", activity: "act-new", start: "2026-10-13 15:00:00", end: "2026-10-13 16:00:00" }, tell: true });
    if (undone.ok) expect(undone.summary).toBe("1 move taken back.");
  });

  it("leaves it on Not now, and says so", async () => {
    note();
    await fileNote("n-1");
    const res = await answerVisit("n-1", "Not now");
    expect(changeSchedule).not.toHaveBeenCalled();
    if (res.ok) expect(res.turns.at(-1)!.text).toBe("Left where it is.");
  });

  it("offers each that fits to tap when the words don't tell them apart, and moves the one tapped", async () => {
    note({ moves: [move({ words: "my booking", fromPart: "day" })] });
    const res = await fileNote("n-1");
    if (!res.ok) throw new Error("not filed");
    expect(res.ask!.question).toBe("Which one goes to Friday 7:00 am? Two fit.");
    expect(res.ask!.options.map((o) => o.label)).toEqual(["Today 7:00 to 11:00 am, 12 Pittwater Rd, Manly", "Today 3:00 to 4:00 pm, 6/40 Raglan St, Mosman", "Neither"]);
    await answerVisit("n-1", "Today 3:00 to 4:00 pm, 6/40 Raglan St, Mosman");
    expect(changeSchedule.mock.calls[0]![2]).toMatchObject({ change: { activity: "act-mosman" } });
  });

  it("does nothing when none fits, and says so", async () => {
    note({ moves: [move({ words: "Parramatta", fromDay: "2026-10-14" })] });
    const res = await fileNote("n-1");
    if (!res.ok) throw new Error("not filed");
    expect(res.ask).toBeUndefined();
    expect(res.turns.at(-1)!.text).toContain('I couldn\'t find "Parramatta" in your bookings');
    expect(changeSchedule).not.toHaveBeenCalled();
  });

  it("asks nobody who may not change the schedule", async () => {
    caps = new Set(["workboard"]);
    note();
    const res = await fileNote("n-1");
    if (!res.ok) throw new Error("not filed");
    expect(res.ask).toBeUndefined();
    expect(res.turns.at(-1)!.text).toBe("I can't move a booking for you: You can't change the schedule.");
  });

  it("says why when ServiceM8 refuses, and records nothing moved", async () => {
    note();
    await fileNote("n-1");
    changeAnswer = { ok: false, error: "Lisa's job is Completed in ServiceM8.", status: 409 };
    const res = await answerVisit("n-1", "yes");
    expect(res).toMatchObject({ ok: false, error: "It didn't move: Lisa's job is Completed in ServiceM8." });
    expect(appliedOf(noteRow().applied).moves).toEqual([]);
  });

  it("moves the named person's booking, theirs not his", async () => {
    bookings = [MANLY, { ...MOSMAN, uuid: "act-lyle", staffUuid: "sm8-lyle" }];
    note({ moves: [move({ whoId: "s-lyle", whoHint: "Lyle" })] });
    const res = await fileNote("n-1");
    if (!res.ok) throw new Error("not filed");
    expect(res.ask!.question).toBe("Move Lyle's visit at 6/40 Raglan St, Mosman from today 3:00 to 4:00 pm to Friday 7:00 to 8:00 am?");
  });
});
