/* WHAT A JOB'S OVERVIEW READS (v2, step 6): what each note on the job
   made, Undo only where the viewer may press it, and the job's open tasks,
   with or without `tasks.sm8_job_uuid` (docs/migrations/tasks_job.sql, not
   yet applied). */

import type { JobDiaryEntry } from "@/lib/dashboard/journal-query";
import { appliedOf } from "@/lib/workboard/note-applied";

type Call = { table: string; eq: Record<string, unknown>; in?: [string, string[]] };
const calls: Call[] = [];
let rows: Record<string, Record<string, unknown>[]> = {};
/** The column New › Task writes isn't on the table yet. */
let noJobColumn = false;

const table = (name: string) => {
  const call: Call = { table: name, eq: {} };
  calls.push(call);
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = (col: string, val: unknown) => {
    call.eq[col] = val;
    return chain;
  };
  chain.in = (col: string, vals: string[]) => {
    call.in = [col, vals];
    return chain;
  };
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.then = (res: (v: { data: unknown; error: unknown }) => unknown) => {
    const byColumn = name === "tasks" && "sm8_job_uuid" in call.eq;
    if (byColumn && noJobColumn) return Promise.resolve({ data: null, error: { code: "42703" } }).then(res);
    const all = rows[name] ?? [];
    const data = byColumn
      ? all.filter((r) => r.sm8_job_uuid === call.eq.sm8_job_uuid && r.status === "open")
      : call.in
        ? all.filter((r) => call.in![1].includes(String(r.id)))
        : all;
    return Promise.resolve({ data, error: null }).then(res);
  };
  return chain;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (n: string) => table(n) } }));

let entries: JobDiaryEntry[] = [];
jest.mock("@/lib/dashboard/journal-query", () => ({
  listJobDiaryEntries: async () => entries,
}));

jest.mock("@/lib/workboard/job-notes-query", () => ({
  staffDisplayNames: async (_org: string, ids: (string | null)[]) =>
    new Map(
      ids
        .filter((i): i is string => !!i)
        .map((i) => [i, i === "s-lyle" ? "Lyle Irving" : i === "s-isaac" ? "Isaac Smith" : "Dane Hill"]),
    ),
}));

import { readJobConversationFor } from "../job-conversation-query";

const entry = (id: string, authorId: string, applied: Record<string, unknown>, extra: Partial<JobDiaryEntry> = {}): JobDiaryEntry => ({
  id,
  said: "Get Lyle to order the grilles before lunch",
  day: "2026-10-13",
  at: "10:05 am",
  outcomes: [],
  spoken: false,
  stamp: "2026-10-13 10:05",
  routed: true,
  taskFor: {},
  turns: [
    { who: "you", text: "Get Lyle to order the grilles before lunch" },
    { who: "tiff", text: "Done. A task for Lyle." },
  ],
  undo: true,
  undone: false,
  authorId,
  record: appliedOf(applied),
  ...extra,
});

const read = (staffId: string | null = "s-isaac", undoAny = false) =>
  readJobConversationFor({ orgId: "o1", staffId, jobUuid: "j-3342", tz: "Australia/Sydney", undoAny });

beforeEach(() => {
  calls.length = 0;
  noJobColumn = false;
  entries = [entry("n1", "s-isaac", { v: 2, taskIds: ["t1"], jobNotes: ["Get Lyle to order the grilles before lunch"] })];
  rows = {
    tasks: [
      { id: "t1", title: "Order the grilles", assigned_to: "s-lyle", status: "open", due_date: null, remind_at: null, remind_kind: null },
      { id: "t2", title: "Approve the isolator variation", assigned_to: "s-isaac", status: "open", due_date: null, remind_at: null, remind_kind: null, sm8_job_uuid: "j-3342" },
    ],
  };
});

it("names what a note made, as a card, with what Tiff said back", async () => {
  const r = await read();
  expect(r.notes).toHaveLength(1);
  expect(r.notes[0]!.replies).toEqual([{ who: "tiff", text: "Done. A task for Lyle." }]);
  expect(r.notes[0]!.made).toEqual([{ key: "task:t1", kind: "task", name: "Order the grilles", line: "Lyle" }]);
  expect(r.notes[0]!.authorName).toBe("Isaac Smith");
  expect(r.viewer).toEqual({ id: "s-isaac", name: "Isaac Smith" });
});

it("offers Undo on your own note, and on someone else's only with team", async () => {
  entries = [entry("n1", "s-dane", { v: 2, taskIds: ["t1"] })];
  expect((await read("s-isaac", false)).notes[0]!.undo).toBe(false);
  expect((await read("s-isaac", true)).notes[0]!.undo).toBe(true);
  entries = [entry("n1", "s-isaac", { v: 2, taskIds: ["t1"] }, { undo: false })];
  expect((await read("s-isaac", true)).notes[0]!.undo).toBe(false);
});

it("lists the job's open tasks: the ones its notes made and the ones New › Task put on it", async () => {
  const r = await read();
  expect(r.tasks.map((t) => t.title)).toEqual(["Order the grilles", "Approve the isolator variation"]);
  expect(r.tasks.map((t) => t.line)).toEqual(["Lyle", "You"]);
});

it("lists the tasks its notes made when the job column isn't there yet", async () => {
  noJobColumn = true;
  const r = await read();
  expect(r.tasks.map((t) => t.title)).toEqual(["Order the grilles"]);
});

it("keeps a note Undo took back, with nothing made under it", async () => {
  entries = [
    entry("n1", "s-isaac", { v: 2, taskIds: ["t1"] }, {
      undone: true,
      undo: false,
      turns: [
        { who: "you", text: "Get Lyle to order the grilles" },
        { who: "tiff", text: "1 task taken back." },
      ],
    }),
  ];
  const r = await read();
  expect(r.notes[0]!.undone).toBe(true);
  expect(r.notes[0]!.made).toEqual([]);
  expect(r.notes[0]!.replies).toEqual([{ who: "tiff", text: "1 task taken back." }]);
});
