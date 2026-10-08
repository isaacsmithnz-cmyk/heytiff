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
      q.upsert = (row: unknown) => (calls.push({ ...call, op: "upsert", row }), Promise.resolve({ error: null }));
      q.update = (row: unknown) => (calls.push({ ...call, op: "update", row }), q);
      q.delete = () => (calls.push({ ...call, op: "delete" }), q);
      q.then = (res: (v: unknown) => unknown) => answer().then(res);
      return q;
    },
  },
}));
const readStoredProposal = jest.fn();
jest.mock("@/lib/quotes/proposal-writer", () => ({ MODEL: "claude-opus-5-5" }));
/* the quote as the job reads it: Tiff's proposal, or a switched quote's lines */
const linesQuote = jest.fn();
jest.mock("@/lib/quotes/lines-job-server", () => ({
  readJobQuote: async (...a: unknown[]) => {
    const lines = linesQuote();
    if (lines) return lines;
    const p = await readStoredProposal(...a);
    return p ? { draft: p.draft, lines: null } : null;
  },
}));
jest.mock("@/lib/quotes/quote-labour-server", () => ({ readQuoteLabour: jest.fn(async () => ({ brief: null, typical: null, dayHours: 8 })) }));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: jest.fn(async () => "Australia/Sydney") }));
jest.mock("@/lib/workboard/dates", () => ({ todayInZone: () => "2026-10-08" }));
jest.mock("@/lib/images/for-claude", () => ({ imageForClaude: jest.fn() }));
jest.mock("@/lib/documents/query", () => ({ DOCUMENTS_BUCKET: "documents", signMany: jest.fn(async () => new Map()) }));

import { normaliseDraft } from "@/lib/quotes/proposal";
import { linesDraft } from "@/lib/quotes/lines-job";
import type { QuoteLine } from "@/lib/quotes/lines";
import { readQuoteLabour } from "@/lib/quotes/quote-labour-server";
import { applyTaskEdit, editOf, makeTasksFromQuote, quotePlan, quotedHours, serialsWith } from "../visit-tasks-server";

const ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const DOC = "7a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4c";
const onThisJob = { kind: "job_document", sm8_job_uuid: "job-1", uploaded_at: "2026-10-08T01:00:00Z", storage_ref: "org-1/plate.jpg", mime_type: "image/jpeg" };

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
  linesQuote.mockReset();
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

/* Isaac, 2026-10-06: "snap the photo of that particular unit, and serial
   numbers etc. can be read from there using photos" */
describe("a unit's photo", () => {

  it("keeps a plate's photo on the task and reads its model and serial onto it", async () => {
    tables.job_tasks = { one: { id: ID, progress: 0 } };
    tables.documents = { one: onThisJob };
    const read = jest.fn(async () => ({ model: "PEFY-P25VMX-A", serial: "52X04417" }));
    const res = await applyTaskEdit("org-1", "job-1", { userId: "user-1", name: "Alex" }, { kind: "photo", id: ID, documentId: DOC, role: "plate" }, read);
    expect(res).toEqual({ ok: true });
    expect(read).toHaveBeenCalledWith("org-1/plate.jpg", "image/jpeg");
    expect(calls.find((c) => c.table === "job_task_photos" && c.op === "upsert")!.row).toMatchObject({ task_id: ID, document_id: DOC, role: "plate" });
    expect(calls.find((c) => c.table === "job_tasks" && c.op === "update")!.row).toMatchObject({ model_read: "PEFY-P25VMX-A", serial: "52X04417" });
  });

  it("refuses a photo that isn't on this job, and says so when the plate can't be read", async () => {
    tables.job_tasks = { one: { id: ID, progress: 0 } };
    tables.documents = { one: { kind: "job_document", sm8_job_uuid: "another-job", uploaded_at: "x", storage_ref: "r", mime_type: null } };
    const read = jest.fn(async () => null);
    expect(await applyTaskEdit("org-1", "job-1", { userId: "u", name: null }, { kind: "photo", id: ID, documentId: DOC, role: "plate" }, read)).toEqual({
      ok: false,
      reason: "That photo didn't land on this job.",
    });
    tables.documents = { one: onThisJob };
    expect(await applyTaskEdit("org-1", "job-1", { userId: "u", name: null }, { kind: "photo", id: ID, documentId: DOC, role: "plate" }, read)).toEqual({
      ok: true,
      note: "The plate couldn't be read from that photo. Type the model and serial instead.",
    });
    /* the photo is kept all the same */
    expect(calls.filter((c) => c.table === "job_task_photos" && c.op === "upsert")).toHaveLength(1);
  });

  it("takes a person's own model and serial as printed codes", () => {
    expect(editOf({ kind: "plate", id: ID, model: " pefy-p25vmx-a", serial: "52x04417 " })).toEqual({ kind: "plate", id: ID, model: "PEFY-P25VMX-A", serial: "52X04417" });
    expect(editOf({ kind: "photo", id: ID, documentId: "nope", role: "plate" })).toBeNull();
  });
});

describe("a plate read onto a task", () => {

  it("writes only what the plate gave, so a serial typed in stays", async () => {
    tables.job_tasks = { one: { id: ID, progress: 0, unit: { qty: 1 }, serial: "TYPED-1", model_read: null } };
    tables.documents = { one: onThisJob };
    await applyTaskEdit("org-1", "job-1", { userId: "u", name: null }, { kind: "photo", id: ID, documentId: DOC, role: "plate" }, jest.fn(async () => ({ model: "MSZ-AP35VG", serial: "" })));
    const update = calls.find((c) => c.table === "job_tasks" && c.op === "update")!.row as Record<string, unknown>;
    expect(update.model_read).toBe("MSZ-AP35VG");
    expect("serial" in update).toBe(false);
  });

  it("says so when a row already has all its serials, rather than drop the read", async () => {
    tables.job_tasks = { one: { id: ID, progress: 0, unit: { qty: 2 }, serial: "A1, B2" } };
    tables.documents = { one: onThisJob };
    const res = await applyTaskEdit("org-1", "job-1", { userId: "u", name: null }, { kind: "photo", id: ID, documentId: DOC, role: "plate" }, jest.fn(async () => ({ model: "", serial: "B3" })));
    expect(res).toEqual({ ok: true, note: "This row has its 2 serials. Change what was read to replace one with B3." });
    expect(calls.find((c) => c.table === "job_tasks" && c.op === "update")).toBeUndefined();
  });

  it("collects one serial a unit on a row of several, never twice", () => {
    expect(serialsWith(null, "A1", 2)).toEqual({ serials: "A1", full: false });
    expect(serialsWith("A1", "B2", 2)).toEqual({ serials: "A1, B2", full: false });
    expect(serialsWith("A1, B2", "B2", 2)).toEqual({ serials: "A1, B2", full: false });
    expect(serialsWith("A1, B2", "B3", 2)).toEqual({ serials: "A1, B2", full: true });
    expect(serialsWith("A1", "B2", 1)).toEqual({ serials: "B2", full: false });
  });
});

describe("the hours quoted", () => {
  it("is the accepted option's own labour at the business's day, with its crew and visits", async () => {
    expect(quotedHours(await quotePlan("org-1", "job-1"))).toEqual({ hours: 32, people: 2, visits: 2 });
  });

  it("is each accepted option's own labour, else the brief's, added up as the price is", async () => {
    const two = normaliseDraft({
      options: [
        { name: "Upstairs", lines: ["A split."], labour: { visits: [{ stage: "Install", people: 1, days: 1 }], from: "you" } },
        { name: "Downstairs", lines: ["A split."] },
      ],
      pricingMode: "optional",
      accepted: [0, 1],
    })!;
    readStoredProposal.mockResolvedValue({ draft: two, brief: "", changes: [], updatedAt: "x", cardId: "job-1" });
    (readQuoteLabour as jest.Mock).mockResolvedValueOnce({
      brief: { visits: [{ stage: "Install", people: 2, days: 1, hours: 16 }], personHours: 16, personDays: 2, said: ["2 pax 1 day"] },
      typical: null,
      dayHours: 8,
    });
    expect(quotedHours(await quotePlan("org-1", "job-1"))).toEqual({ hours: 24, people: 2, visits: 2 });
  });

  it("is nothing on a quote with nothing accepted", async () => {
    readStoredProposal.mockResolvedValue({ draft: { ...draft, accepted: [], options: [draft.options[0]!, draft.options[0]!] }, brief: "", changes: [], updatedAt: "x", cardId: "job-1" });
    expect(quotedHours(await quotePlan("org-1", "job-1"))).toBeNull();
  });

  it("is the accepted option's labour lines as typed, on a quote built by hand", async () => {
    const line = (o: Partial<QuoteLine>): QuoteLine => ({
      id: "x", version: 1, updatedAt: "", updatedBy: "", optionIndex: 0, system: "", group: "Labour", position: 0, name: "Install",
      code: null, supplierKey: null, kind: "labour", qty: 1, unit: "h", costCents: 0, sellCents: null, source: "by_hand", why: "", duct: false, ...o,
    });
    const lines = [
      line({ id: "a", name: "Rough-in: 2 people", qty: 12.5 }),
      line({ id: "b", name: "Install", qty: 7 }),
      line({ id: "c", optionIndex: 1, qty: 40 }),
    ];
    linesQuote.mockReturnValue({ draft: linesDraft(lines, [], { accepted: [0], names: [], loading: {}, compare: {}, supplier: null, proposal: null }, new Map(), 8)!, lines });
    expect(quotedHours(await quotePlan("org-1", "job-1"))).toEqual({ hours: 19.5, people: 2, visits: 2 });
  });
});
