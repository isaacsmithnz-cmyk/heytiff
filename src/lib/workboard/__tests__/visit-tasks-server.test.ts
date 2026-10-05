/**
 * @jest-environment node
 */
import type Anthropic from "@anthropic-ai/sdk";

jest.mock("server-only", () => ({}));

/* a chainable stand-in: each table answers from `tables`, and every insert
   and update is kept to look at */
type Call = { table: string; op: string; row?: unknown; filters: [string, unknown][] };
const calls: Call[] = [];
let tables: Record<string, { count?: number; rows?: unknown[]; one?: unknown }> = {};
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const call: Call = { table, op: "select", filters: [] };
      const q: Record<string, unknown> = {};
      const answer = () => {
        const t = tables[table] ?? {};
        return Promise.resolve({ data: t.rows ?? [], count: t.count ?? 0, error: null });
      };
      q.select = () => q;
      q.eq = (c: string, v: unknown) => (call.filters.push([c, v]), q);
      q.order = () => q;
      q.maybeSingle = () => Promise.resolve({ data: (tables[table] ?? {}).one ?? null, error: null });
      q.insert = (row: unknown) => {
        calls.push({ ...call, op: "insert", row });
        return {
          select: () => ({ single: async () => ({ data: { id: "upd-1" }, error: null }) }),
          then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
        };
      };
      q.update = (row: unknown) => (calls.push({ ...call, op: "update", row }), q);
      q.delete = () => (calls.push({ ...call, op: "delete" }), q);
      q.then = (res: (v: unknown) => unknown) => answer().then(res);
      return q;
    },
  },
}));
const readStoredProposal = jest.fn();
jest.mock("@/lib/quotes/proposal-writer", () => ({ MODEL: "claude-opus-5-5", readStoredProposal: (...a: unknown[]) => readStoredProposal(...a) }));
jest.mock("@/lib/quotes/quote-labour-server", () => ({ readQuoteLabour: jest.fn(async () => ({ brief: null, typical: null, dayHours: 8 })) }));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: jest.fn(async () => "Australia/Sydney") }));
jest.mock("@/lib/workboard/dates", () => ({ todayInZone: () => "2026-10-08" }));

import { normaliseDraft } from "@/lib/quotes/proposal";
import { applyTaskEdit, editOf, makeTasksFromQuote } from "../visit-tasks-server";

const ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

const draft = normaliseDraft({
  options: [
    {
      name: "Ducted",
      lines: ["A 10 kW ducted system."],
      units: [{ role: "indoor", room: "Hallway", capacity: "10 kW", type: "Ducted", model: "PEA-M100", qty: 1, system: 0 }],
      labour: { visits: [{ stage: "Install", people: 2, days: 2 }], from: "you" },
    },
  ],
  accepted: [0],
})!;

const clientSaying = (body: unknown) => {
  const create = jest.fn(async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(body) }] }));
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
};

beforeEach(() => {
  calls.length = 0;
  tables = {};
  readStoredProposal.mockReset().mockResolvedValue({ draft, brief: "", changes: [], updatedAt: "x", cardId: "job-1" });
});

describe("an edit as the browser sent it", () => {
  it("keeps only what it can read", () => {
    expect(editOf({ kind: "progress", id: ID, to: 85.4, note: "  Bedroom 1 riser done.  " })).toEqual({ kind: "progress", id: ID, to: 85, note: "Bedroom 1 riser done." });
    expect(editOf({ kind: "progress", id: ID, to: 120 })).toBeNull();
    expect(editOf({ kind: "progress", id: "not-a-uuid", to: 50 })).toBeNull();
    expect(editOf({ kind: "visit", id: ID, visit: 0 })).toEqual({ kind: "visit", id: ID, visit: null });
    expect(editOf({ kind: "add", name: "  Flush the old pipe  ", stage: "Rough-in", taskKind: "progress", visit: 2 })).toEqual({
      kind: "add",
      name: "Flush the old pipe",
      stage: "Rough-in",
      taskKind: "progress",
      visit: 2,
    });
    expect(editOf({ kind: "add", name: "x", stage: "Cleanup" })).toBeNull();
    expect(editOf({ kind: "drop table" })).toBeNull();
  });
});

describe("making the tasks from the quote", () => {
  it("writes Tiff's list onto the job, each unit with its task, planned on the quote's visits", async () => {
    const { client, create } = clientSaying({
      tasks: [
        { name: "Rough-in the duct and pipe", stage: "Install", kind: "progress", unit: 0, visit: 1 },
        { name: "Hang the Hallway unit", stage: "Install", kind: "unit", unit: 1, visit: 2 },
      ],
    });
    const res = await makeTasksFromQuote("org-1", "user-1", "job-1", client);
    expect(res).toEqual({ ok: true, made: 2 });
    const turn = (create.mock.calls[0] as unknown as [{ messages: { content: string }[] }])[0].messages[0].content;
    expect(turn).toContain("1. Install, 2 people");
    expect(turn).toContain("2. Install, 2 people");
    const insert = calls.find((c) => c.table === "job_tasks" && c.op === "insert")!.row as { name: string; kind: string; visit: number; unit: unknown; org_id: string }[];
    expect(insert.map((r) => [r.name, r.kind, r.visit, r.org_id])).toEqual([
      ["Rough-in the duct and pipe", "progress", 1, "org-1"],
      ["Hang the Hallway unit", "unit", 2, "org-1"],
    ]);
    expect(insert[1]!.unit).toMatchObject({ room: "Hallway", model: "PEA-M100" });
  });

  it("costs no call on a job that has its tasks, or a quote with nothing accepted", async () => {
    const { client, create } = clientSaying({ tasks: [] });
    tables.job_tasks = { count: 3 };
    expect(await makeTasksFromQuote("org-1", "user-1", "job-1", client)).toEqual({ ok: false, reason: "This job already has its tasks." });
    tables.job_tasks = { count: 0 };
    readStoredProposal.mockResolvedValue({ draft: { ...draft, accepted: [], options: [...draft.options, draft.options[0]!] }, brief: "", changes: [], updatedAt: "x", cardId: "job-1" });
    expect(await makeTasksFromQuote("org-1", "user-1", "job-1", client)).toEqual({ ok: false, reason: "No option is marked accepted on the quote yet." });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("a day's work on a task", () => {
  it("moves the task on and logs the day: how far from, how far to, the note, who", async () => {
    tables.job_tasks = { one: { id: ID, progress: 70 } };
    const res = await applyTaskEdit("org-1", "job-1", { userId: "user-1", name: "Alex Morozoff" }, { kind: "progress", id: ID, to: 85, note: "Bedroom 1 riser done." });
    expect(res).toEqual({ ok: true });
    expect(calls.find((c) => c.table === "job_tasks" && c.op === "update")!.row).toMatchObject({ progress: 85, done_at: null, done_by: null });
    expect(calls.find((c) => c.table === "job_task_updates" && c.op === "insert")!.row).toMatchObject({
      task_id: ID,
      sm8_job_uuid: "job-1",
      day: "2026-10-08",
      pct_from: 70,
      pct_to: 85,
      note: "Bedroom 1 riser done.",
      by_name: "Alex Morozoff",
    });
  });

  it("marks a task done with who did it, and says so when the task isn't on this job", async () => {
    tables.job_tasks = { one: { id: ID, progress: 0 } };
    await applyTaskEdit("org-1", "job-1", { userId: "user-1", name: "Callum Vrieze" }, { kind: "progress", id: ID, to: 100, note: "" });
    expect(calls.find((c) => c.op === "update")!.row).toMatchObject({ progress: 100, done_by: "Callum Vrieze" });
    tables.job_tasks = {};
    expect(await applyTaskEdit("org-1", "job-1", { userId: "u", name: null }, { kind: "remove", id: ID })).toEqual({ ok: false, reason: "That task isn't on this job any more." });
  });
});
