/* Resolving the chips. The stored `applied` is a bag of ids and nothing has
   ever read them back, so this is where the two things that can go wrong live:
   asking the database once per chip (sixty entries would be sixty round trips
   to paint one panel), and trusting an id whose row has since been deleted. */

type Call = { table: string; columns?: string; eq: Record<string, unknown>; in?: [string, string[]] };

let rows: Record<string, Record<string, unknown>[]> = {};
const calls: Call[] = [];

const table = (name: string) => {
  const call: Call = { table: name, eq: {} };
  calls.push(call);
  const chain: Record<string, unknown> = {};
  chain.select = (cols: string) => {
    call.columns = cols;
    return chain;
  };
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
  chain.then = (res: (v: { data: unknown }) => unknown) =>
    Promise.resolve({ data: rows[name] ?? [] }).then(res);
  return chain;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (n: string) => table(n) } }));

import { listJournal } from "../journal-query";

const note = (id: string, applied: unknown) => ({
  id,
  transcript: `said ${id}`,
  source: "voice",
  applied,
  // 8:00am Sydney — the AU anchor is tested in journal.test.ts, this just has
  // to be a real timestamp
  created_at: "2026-08-11T22:00:00Z",
});

beforeEach(() => {
  rows = {};
  calls.length = 0;
});

const of = (t: string) => calls.filter((c) => c.table === t);
const chips = (entries: Awaited<ReturnType<typeof listJournal>>, i = 0) =>
  entries[i].outcomes.map((o) => [o.text, o.go?.type ?? null]);

it("resolves every chip on the page in one read per kind", async () => {
  rows.workboard_notes = [
    note("e1", { taskIds: ["t1", "t2"], kbIds: ["k1"] }),
    note("e2", { taskIds: ["t3"], noteLines: ["a", "b"] }),
  ];
  rows.tasks = [
    { id: "t1", title: "Order 2× MERV 11 filters" },
    { id: "t2", title: "Book the tail lift service" },
    { id: "t3", title: "Chase the Daikin warranty claim" },
  ];
  rows.kb_documents = [{ id: "k1", title: "Daikin VRV commissioning notes" }];
  rows.staff_notes = [{ id: "n1", source_note_id: "e2" }];

  const out = await listJournal("org-1", "s1");

  // three entries' worth of ids, three queries — not one per chip
  expect(of("tasks")).toHaveLength(1);
  expect(of("kb_documents")).toHaveLength(1);
  expect(of("staff_notes")).toHaveLength(1);
  expect(of("tasks")[0].in).toEqual(["id", ["t1", "t2", "t3"]]);

  expect(chips(out, 0)).toEqual([
    ["Order 2× MERV 11 filters", "task"],
    ["Book the tail lift service", "task"],
    ["Daikin VRV commissioning notes", "kb"],
  ]);
  expect(chips(out, 1)).toEqual([
    ["Chase the Daikin warranty claim", "task"],
    ["2 lines kept", "note"],
  ]);
});

it("shows what the keep-rungs did, not only what applyNote made", async () => {
  /* THE TWO ENDINGS THIS PANEL USED TO BE BLIND TO. Both are successes, both
     file the words as they were said, and neither goes through `applyNote` —
     they used to share `dismissNote`'s status, so choosing "Keep it in my
     notes" left the record saying you never said it. */
  rows.workboard_notes = [
    note("e1", { jobNotes: ["Gate code is 4821 after hours."] }),
    note("e2", { noteLines: ["Ring the wholesaler back about pricing."] }),
  ];
  rows.staff_notes = [{ id: "n1", source_note_id: "e2" }];

  const out = await listJournal("org-1", "s1");
  // the job's own notes are text in somebody else's column — counted, no door
  expect(chips(out, 0)).toEqual([["1 note on the job", null]]);
  // kept for yourself opens on the row it wrote
  expect(chips(out, 1)).toEqual([["1 line kept", "note"]]);
});

it("lists what was filed and leaves abandonments out", async () => {
  /* The status IS the distinction between the four endings now, so the filter
     is load-bearing: widen it and Escape starts looking like filing. */
  rows.workboard_notes = [note("e1", { jobNotes: ["said and kept"] })];
  await listJournal("org-1", "s1");
  expect(of("workboard_notes")[0].eq.status).toBe("applied");
});

it("scopes every read to the org, and the notes to the person too", async () => {
  rows.workboard_notes = [note("e1", { taskIds: ["t1"], kbIds: ["k1"], noteLines: ["a"] })];
  await listJournal("org-1", "s1");

  for (const t of ["tasks", "kb_documents", "staff_notes"]) expect(of(t)[0].eq.org_id).toBe("org-1");
  // staff_notes is somebody's own notebook — the door opens onto the reader's
  expect(of("staff_notes")[0].eq.staff_id).toBe("s1");
  expect(of("staff_notes")[0].in).toEqual(["source_note_id", ["e1"]]);
});

it("counts a row that has been deleted since instead of linking to it", async () => {
  rows.workboard_notes = [note("e1", { taskIds: ["t1", "gone"], noteLines: ["a"] })];
  rows.tasks = [{ id: "t1", title: "Order 2× MERV 11 filters" }];
  rows.staff_notes = []; // the grouped note was deleted from my-notes

  const out = await listJournal("org-1", "s1");
  expect(chips(out)).toEqual([
    ["Order 2× MERV 11 filters", "task"],
    ["1 task removed", null],
    ["1 line kept", null],
  ]);
});

it("asks for nothing when there is nothing to resolve", async () => {
  rows.workboard_notes = [note("e1", { flagIds: ["f1"] })];
  const out = await listJournal("org-1", "s1");

  // a page of flags must not send three empty `in ()` queries
  expect(of("tasks")).toHaveLength(0);
  expect(of("kb_documents")).toHaveLength(0);
  expect(of("staff_notes")).toHaveLength(0);
  expect(chips(out)).toEqual([["1 flag", null]]);
});

it("reads nothing at all for an empty journal", async () => {
  rows.workboard_notes = [];
  expect(await listJournal("org-1", "s1")).toEqual([]);
  expect(calls.map((c) => c.table)).toEqual(["workboard_notes"]);
});
