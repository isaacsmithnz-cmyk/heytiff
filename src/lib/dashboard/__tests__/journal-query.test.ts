/* Resolving the chips. The stored `applied` is a bag of ids and nothing has
   ever read them back, so this is where the two things that can go wrong live:
   asking the database once per chip (sixty entries would be sixty round trips
   to paint one panel), and trusting an id whose row has since been deleted. */

import fs from "node:fs";
import path from "node:path";

type Call = {
  table: string;
  columns?: string;
  eq: Record<string, unknown>;
  in?: [string, string[]];
  /** Every `.in` in order, where a read has more than one. */
  ins: [string, string[]][];
};

let rows: Record<string, Record<string, unknown>[]> = {};
/** Tables whose read answers with an error. */
const failing = new Set<string>();
const calls: Call[] = [];

const table = (name: string) => {
  const call: Call = { table: name, eq: {}, ins: [] };
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
    call.in ??= [col, vals];
    call.ins.push([col, vals]);
    return chain;
  };
  /* a note somebody took back isn't on anybody's journal (two-way phase 2) */
  chain.is = (col: string, val: unknown) => {
    call.eq[`${col} is`] = val;
    return chain;
  };
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.then = (res: (v: { data: unknown; error?: unknown }) => unknown) =>
    Promise.resolve(
      failing.has(name) ? { data: null, error: { message: "unreachable" } } : { data: rows[name] ?? [] },
    ).then(res);
  return chain;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (n: string) => table(n) } }));

/* Where a reply of yours stands with ServiceM8 is read as you: the
   workspace's sending state and who you are there (two-way phase 2). */
const mockWriteState = jest.fn();
const mockSender = jest.fn();
jest.mock("@/lib/integrations/sm8-writes", () => ({
  readSm8WriteState: (...a: unknown[]) => mockWriteState(...a),
}));
jest.mock("@/lib/integrations/links", () => ({
  ...jest.requireActual("@/lib/integrations/links"),
  sm8NoteSender: (...a: unknown[]) => mockSender(...a),
}));

import { listDiaryEntries, listJournal } from "../journal-query";

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
  failing.clear();
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

it("names an issue's door from one read, resolved or not", async () => {
  rows.workboard_notes = [note("e1", { issueIds: ["i1", "i-gone"] }), note("e2", { issueIds: ["i2"] })];
  rows.workboard_issues = [
    { id: "i1", summary: "Middle rooftop unit has tripped again" },
    { id: "i2", summary: "Compressor short-cycling" },
  ];
  const entries = await listJournal("org-1", "staff-1");
  expect(of("workboard_issues")).toHaveLength(1);
  expect(of("workboard_issues")[0].eq).toEqual({ org_id: "org-1" });
  expect(of("workboard_issues")[0].in).toEqual(["id", ["i1", "i-gone", "i2"]]);
  expect(chips(entries, 0)).toEqual([
    ["Middle rooftop unit has tripped again", "issue"],
    ["1 issue removed", null],
  ]);
  expect(chips(entries, 1)).toEqual([["Compressor short-cycling", "issue"]]);
});

/* THE DROP ORDER, HELD. PostgREST fails the WHOLE select on a column that
   isn't there, and this is the select every diary is built from, so a
   migration that drops a column this read still names would empty every diary
   on the day it was applied. The migrations are read from the folder rather
   than restated here, so the file that would do it is the thing that fails. */
it("reads no column that a migration drops from workboard_notes", async () => {
  rows.workboard_notes = [note("e1", {})];
  await listJournal("org-1", "s1");
  const read = (of("workboard_notes")[0].columns ?? "").split(",").map((c) => c.trim());
  // not vacuous: an empty capture would pass the comparison below
  expect(read).toEqual(expect.arrayContaining(["id", "transcript", "applied"]));

  const dir = path.join(process.cwd(), "docs", "migrations");
  const dropped = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .flatMap((file) => {
      const sql = fs.readFileSync(path.join(dir, file), "utf8").replace(/--.*$/gm, "");
      const alters = sql.matchAll(
        /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?workboard_notes\b([^;]*);/gi,
      );
      return [...alters].flatMap((m) =>
        [...m[1].matchAll(/drop\s+column\s+(?:if\s+exists\s+)?"?([a-z_]+)"?/gi)].map((d) => ({
          file,
          column: d[1].toLowerCase(),
        })),
      );
    });
  expect(dropped.filter((d) => read.includes(d.column))).toEqual([]);
});

/* THE DEBRIEF'S COLUMN, OUT OF THE READ. H3 drops `is_debrief` once THIS
   change is live, as a migration and nothing else. If the read still named
   it, that drop would empty every diary the moment it ran, whatever the tree
   holds — the test above only sees a drop that sits beside the read. So the
   read must not name it, and an old Debrief row must not need it: the row is
   an applied note like any other, and its grouped note's door comes from
   `applied.noteLines`. */
describe("the Debrief's column", () => {
  it("is not in the diary's read", async () => {
    rows.workboard_notes = [note("e1", {})];
    await listJournal("org-1", "s1");
    const read = (of("workboard_notes")[0].columns ?? "").split(",").map((c) => c.trim());
    expect(read).toEqual(expect.arrayContaining(["id", "transcript", "applied"]));
    expect(read).not.toContain("is_debrief");
  });

  it("is not needed for an old Debrief row to keep its place and its door", async () => {
    rows.workboard_notes = [
      { ...note("e1", { taskIds: ["t1"], noteLines: ["Long day.", "Two callouts."] }), is_debrief: true },
      note("e2", { taskIds: ["t2"] }),
    ];
    rows.tasks = [
      { id: "t1", title: "Chase the Daikin warranty claim" },
      { id: "t2", title: "Order 2× MERV 11 filters" },
    ];
    rows.staff_notes = [{ id: "n1", source_note_id: "e1" }];

    const out = await listJournal("org-1", "s1");
    expect(out.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(chips(out, 0)).toEqual([
      ["Chase the Daikin warranty claim", "task"],
      ["2 lines kept", "note"],
    ]);
    expect(out[0].outcomes.find((o) => o.go?.type === "note")?.go).toEqual({ type: "note", id: "n1" });
    // and nothing on the entry says which door the words came through
    expect(out[0]).not.toHaveProperty("isDebrief");
    expect(out[0]).toEqual(expect.objectContaining({ said: "said e1", spoken: true }));
  });
});

/* ── the new Home's diary: the same read, three more facts ── */

describe("listDiaryEntries", () => {
  it("reads the journal's own rows and person, what Undo took back too, plus the proposal, status and turns", async () => {
    rows.workboard_notes = [note("e1", {})];
    await listDiaryEntries("org-1", "s1", null);
    const [read] = of("workboard_notes");
    // and, as on the journal, never a note somebody took back (two-way phase 2)
    expect(read.eq).toEqual({ org_id: "org-1", author_id: "s1", "removed_at is": null });
    // what was filed, and what was filed and then taken back: never a note
    // still mid-conversation, nor one set aside
    expect(read.in).toEqual(["status", ["applied", "undone"]]);
    // built on the journal's column list, so the two can't drift apart, and
    // with the columns that say ServiceM8 holds a note too (the diary's Edit)
    expect(read.columns).toBe(
      "id, transcript, source, applied, created_at, proposal, status, turns, target_kind, reply_to_sm8_note_uuid, is_task_done",
    );
  });

  /* "you should only be able to delete your own entries or edit" (Isaac,
     2026-09-26) — and an edit is refused for a note ServiceM8 holds too,
     so the diary offers Edit only where it wouldn't be. */
  it("says which entries ServiceM8 holds too, by the rule an edit is refused on", async () => {
    rows.workboard_notes = [
      { ...note("plain", {}), target_kind: "none" },
      { ...note("on-job", {}), target_kind: "job" },
      { ...note("queued", {}), target_kind: "job" },
      { ...note("reply", {}), target_kind: "job", reply_to_sm8_note_uuid: "sm8-1" },
      { ...note("done", {}), target_kind: "job", is_task_done: true },
    ];
    rows.sm8_writes = [{ note_id: "queued" }];
    const out = await listDiaryEntries("org-1", "s1", null);
    expect(Object.fromEntries(out.map((e) => [e.id, e.inSm8]))).toEqual({
      plain: false,
      "on-job": false,
      queued: true,
      reply: true,
      done: true,
    });
    // one read, of the job notes alone
    const [writes] = of("sm8_writes");
    expect(writes.in).toEqual(["note_id", ["on-job", "queued", "reply", "done"]]);
    expect(of("sm8_writes")).toHaveLength(1);
  });

  it("holds every job note as ServiceM8's when that read fails, and reads nothing with no job notes", async () => {
    rows.workboard_notes = [{ ...note("plain", {}), target_kind: "none" }];
    await listDiaryEntries("org-1", "s1", null);
    expect(of("sm8_writes")).toHaveLength(0);

    rows.workboard_notes = [
      { ...note("plain", {}), target_kind: "none" },
      { ...note("on-job", {}), target_kind: "job" },
    ];
    failing.add("sm8_writes");
    const out = await listDiaryEntries("org-1", "s1", null);
    expect(Object.fromEntries(out.map((e) => [e.id, e.inSm8]))).toEqual({ plain: false, "on-job": true });
  });

  it("says when on the account's clock, so an entry sorts beside a ServiceM8 note", async () => {
    // 2026-08-11T22:00Z is 8:00 am on the 12th in Sydney, and 6:00 am in Perth
    rows.workboard_notes = [note("e1", {})];
    // ICU may put a narrow space before "am"; the words are what matter
    const words = (s: string) => s.replace(/\s/g, " ");
    const [sydney] = await listDiaryEntries("org-1", "s1", null);
    expect(sydney).toMatchObject({ stamp: "2026-08-12 08:00", day: "2026-08-12" });
    expect(words(sydney.at)).toBe("8:00 am");

    const [perth] = await listDiaryEntries("org-1", "s1", "Australia/Perth");
    expect(perth).toMatchObject({ stamp: "2026-08-12 06:00", day: "2026-08-12" });
    expect(words(perth.at)).toBe("6:00 am");

    // and late at night the zone decides the DAY, not just the hour
    rows.workboard_notes = [{ ...note("e2", {}), created_at: "2026-08-11T15:30:00Z" }];
    const [lateSydney] = await listDiaryEntries("org-1", "s1", null);
    const [latePerth] = await listDiaryEntries("org-1", "s1", "Australia/Perth");
    expect(lateSydney.day).toBe("2026-08-12");
    expect(latePerth.day).toBe("2026-08-11");
  });

  it("tells a Save from an entry Tiff read that filed nothing", async () => {
    rows.workboard_notes = [
      { ...note("routed", {}), proposal: { actions: [] } },
      { ...note("saved", {}), proposal: null },
    ];
    const out = await listDiaryEntries("org-1", "s1", null);
    expect(out.map((e) => [e.id, e.routed])).toEqual([
      ["routed", true],
      ["saved", false],
    ]);
  });

  it("says who each task is on, for the tasks that are still there", async () => {
    rows.workboard_notes = [note("e1", { taskIds: ["t-luke", "t-mine", "t-nobody", "t-gone"] })];
    rows.tasks = [
      { id: "t-luke", title: "Call Mary", assigned_to: "s-luke" },
      { id: "t-mine", title: "Order the grille", assigned_to: "s1" },
      { id: "t-nobody", title: "Chase the warranty", assigned_to: null },
    ];
    const [entry] = await listDiaryEntries("org-1", "s1", null);
    // and whether anyone has acted on each, which Undo needs (below)
    expect(of("tasks")[0].columns).toBe("id, title, assigned_to, status, acknowledged_at");
    expect(entry.taskFor).toEqual({ "t-luke": "s-luke", "t-mine": "s1", "t-nobody": null });
    // the removed one is still counted where it always was
    expect(chips([entry])).toContainEqual(["1 task removed", null]);
  });

  it("leaves the old journal's entries as they were", async () => {
    rows.workboard_notes = [note("e1", { taskIds: ["t1"] })];
    rows.tasks = [{ id: "t1", title: "Call Mary", assigned_to: "s-luke" }];
    const [entry] = await listJournal("org-1", "s1");
    for (const added of ["stamp", "routed", "taskFor", "turns", "undo", "undone"]) expect(entry).not.toHaveProperty(added);
    const [read] = of("workboard_notes");
    expect(read.columns).not.toContain("proposal");
    expect(read.columns).not.toContain("turns");
    // the old Home still reads only what is filed, and asks no task its state
    expect(read.eq.status).toBe("applied");
    expect(read.in).toBeUndefined();
    expect(of("tasks")[0].columns).toBe("id, title, assigned_to");
    expect(of("task_events")).toHaveLength(0);
  });
});

/* ── what the Tiff modal left on the row (H23) ── */

describe("listDiaryEntries: Tiff's line, Undo, and what Undo took back", () => {
  const at = "2026-09-25T00:00:00.000Z";
  const t = (who: "you" | "tiff", text: string) => ({ who, text, at });
  /** A note the modal filed: the record Undo reads, and the conversation. */
  const filed = (id: string, applied: Record<string, unknown>, turns: unknown = [], status = "applied") => ({
    ...note(id, applied),
    proposal: { tasks: [] },
    status,
    turns,
  });

  it("carries the conversation as the modal said it: the plan's line goes where Done says it again", async () => {
    rows.workboard_notes = [
      filed("e1", { v: 2, taskIds: [] }, [
        t("you", "Callum grabs the filters from Reece"),
        t("tiff", "A task for Callum: the filters from Reece."),
        t("tiff", "Done. A task for Callum: the filters from Reece."),
      ]),
    ];
    const [entry] = await listDiaryEntries("org-1", "s1", null);
    expect(entry.turns).toEqual([
      { who: "you", text: "Callum grabs the filters from Reece" },
      { who: "tiff", text: "Done. A task for Callum: the filters from Reece." },
    ]);
  });

  it("has no conversation where Tiff never answered: a Save, the review card, before the modal", async () => {
    rows.workboard_notes = [
      { ...filed("saved", {}, [t("you", "Ring the wholesaler")]), proposal: null },
      filed("card", { taskIds: ["t1"] }, []),
      { ...note("old", { taskIds: [] }), proposal: { tasks: [] }, status: "applied" },
    ];
    const out = await listDiaryEntries("org-1", "s1", null);
    expect(out.map((e) => [e.id, e.turns])).toEqual([
      ["saved", []],
      ["card", []],
      ["old", []],
    ]);
  });

  it("offers Undo on a filed record that made something, while none of its tasks is ticked off", async () => {
    rows.workboard_notes = [
      filed("open", { v: 2, taskIds: ["t-open", "t-gone"] }),
      filed("ticked", { v: 2, taskIds: ["t-open", "t-done"] }),
      filed("flag", { v: 2, flagIds: ["f1"] }),
      filed("v1", { taskIds: ["t-open"] }),
      filed("nothing", { v: 2, taskIds: [], noteLines: ["kept"] }),
      { ...filed("saved", {}), proposal: null },
    ];
    rows.tasks = [
      { id: "t-open", title: "Call Mary", assigned_to: "s-luke", status: "open" },
      { id: "t-done", title: "Order filters", assigned_to: "s-luke", status: "done" },
    ];
    rows.workboard_flags = [{ id: "f1", active: true }];
    const out = await listDiaryEntries("org-1", "s1", null);
    expect(Object.fromEntries(out.map((e) => [e.id, e.undo]))).toEqual({
      // a task somebody deleted since is simply gone, and stops nothing
      open: true,
      // one ticked off ends it: Undo would refuse the lot
      ticked: false,
      // a flag still up
      flag: true,
      // filed before Undo existed
      v1: false,
      // words kept in your notes are nothing Undo reaches
      nothing: false,
      saved: false,
    });
    expect(out.every((e) => e.undone === false)).toBe(true);
  });

  /* THE REST OF "SOMEONE ACTED ON A ROW IT FILED", known before the press:
     Undo is drawn by the rule `undoNote` refuses on, so it is never offered
     where pressing it could only say "Someone has already acted on one of
     those" — after a reload as much as before. */
  it("offers no Undo once a flag it raised is cleared, an issue counted again, a line bought or the job's notes edited", async () => {
    const visit = (id: string, after: string) => ({
      table: "maintenance_visits",
      id,
      column: "notes",
      before: null,
      after,
    });
    rows.workboard_notes = [
      filed("flag-up", { v: 2, flagIds: ["f-up"] }),
      filed("flag-cleared", { v: 2, flagIds: ["f-cleared"] }),
      filed("counted", { v: 2, issueIds: ["i-counted"] }),
      filed("resolved", { v: 2, issueIds: ["i-resolved"] }),
      filed("bumped-again", { v: 2, issueIds: ["i-old"], issueBumps: [{ id: "i-old", occurrences: 2 }] }),
      filed("ticked-line", { v: 2, bringItems: ["coil cleaner"], checklistIds: ["c-done"] }),
      filed("picked", { v: 2, bringItems: ["1060 grille"], picklistIds: ["p-picked"] }),
      filed("notes-as-left", { v: 2, textWrites: [visit("v-same", "Belts swapped")] }),
      filed("notes-edited", { v: 2, textWrites: [visit("v-edited", "Belts swapped")] }),
    ];
    rows.workboard_flags = [
      { id: "f-up", active: true },
      { id: "f-cleared", active: false },
    ];
    rows.workboard_issues = [
      { id: "i-counted", summary: "Rattle", occurrences: 2, resolved: false },
      { id: "i-resolved", summary: "Leak", occurrences: 1, resolved: true },
      { id: "i-old", summary: "Tripped", occurrences: 4, resolved: false },
    ];
    rows.project_checklist_items = [{ id: "c-done", done: true }];
    rows.job_picklist_items = [{ id: "p-picked", picked: true }];
    rows.maintenance_visits = [
      { id: "v-same", notes: "Belts swapped" },
      { id: "v-edited", notes: "Belts swapped\nLuke: done" },
    ];
    const out = await listDiaryEntries("org-1", "s1", null);
    expect(Object.fromEntries(out.map((e) => [e.id, e.undo]))).toEqual({
      "flag-up": true,
      "flag-cleared": false,
      counted: false,
      resolved: false,
      "bumped-again": false,
      "ticked-line": false,
      picked: false,
      "notes-as-left": true,
      "notes-edited": false,
    });
  });

  it("reads what only Undo needs once per kind for the page, org-scoped, and only from records Undo reads", async () => {
    rows.workboard_notes = [
      filed("a", {
        v: 2,
        flagIds: ["f1"],
        checklistIds: ["c1"],
        picklistIds: ["p1"],
        entryIds: ["e1"],
        textWrites: [
          { table: "maintenance_agreements", id: "a1", column: "bring_list", before: null, after: "ladder" },
        ],
      }),
      filed("b", { v: 2, flagIds: ["f2"], entryIds: ["e2"] }),
      // a record from before Undo: nothing it names is read for Undo
      filed("old", { flagIds: ["f-old"], entryIds: ["e-old"] }),
    ];
    await listDiaryEntries("org-1", "s1", null);
    const one = (t: string) => {
      expect(of(t)).toHaveLength(1);
      expect(of(t)[0].eq).toEqual({ org_id: "org-1" });
      return of(t)[0];
    };
    expect(one("workboard_flags")).toMatchObject({ columns: "id, active", in: ["id", ["f1", "f2"]] });
    expect(one("project_checklist_items")).toMatchObject({ columns: "id, done", in: ["id", ["c1"]] });
    expect(one("job_picklist_items")).toMatchObject({ columns: "id, picked", in: ["id", ["p1"]] });
    expect(one("project_entries")).toMatchObject({ columns: "id", in: ["id", ["e1", "e2"]] });
    expect(one("maintenance_agreements")).toMatchObject({ columns: "id, notes, bring_list", in: ["id", ["a1"]] });
    // no text written to a visit or a project: neither is asked
    expect(of("maintenance_visits")).toHaveLength(0);
    expect(of("projects")).toHaveLength(0);
  });

  it("asks nothing more of a page whose records Undo does not read", async () => {
    rows.workboard_notes = [filed("old", { taskIds: ["t1"], flagIds: ["f1"] })];
    await listDiaryEntries("org-1", "s1", null);
    for (const t of ["task_events", "workboard_flags", "project_checklist_items", "job_picklist_items", "project_entries"])
      expect(of(t)).toHaveLength(0);
  });

  /* Undo lasts days, so it meets rows somebody deleted in between. A note
     whose every row has gone has nothing left for Undo to take, and one
     that still has some says only those when pressed (undoNote). */
  it("offers no Undo once everything it made has been deleted since", async () => {
    rows.workboard_notes = [
      filed("all-gone", { v: 2, taskIds: ["t-gone"], flagIds: ["f-gone"], kbIds: ["k-gone"] }),
      filed("one-left", { v: 2, taskIds: ["t-gone", "t-open"] }),
      filed("library", { v: 2, kbIds: ["k-field"] }),
      filed("not-hers", { v: 2, kbIds: ["k-manual"] }),
    ];
    rows.tasks = [{ id: "t-open", title: "Call Mary", assigned_to: "s-luke", status: "open" }];
    rows.kb_documents = [
      { id: "k-field", title: "Clearing an E6", category: "field" },
      { id: "k-manual", title: "Daikin manual", category: "install" },
    ];
    const out = await listDiaryEntries("org-1", "s1", null);
    expect(Object.fromEntries(out.map((e) => [e.id, e.undo]))).toEqual({
      "all-gone": false,
      "one-left": true,
      library: true,
      "not-hers": false,
    });
  });

  /* Open is not untouched: a task given on, moved, ticked and reopened, or
     answered "Got it" has been acted on, and Undo would refuse the lot, so
     it is not offered. The history is one read for the page, org-scoped,
     for the kinds that are somebody acting. */
  it("offers no Undo once anybody has acted on a task it made, though the task is still open", async () => {
    rows.workboard_notes = [
      filed("untouched", { v: 2, taskIds: ["t-open"] }),
      filed("given", { v: 2, taskIds: ["t-given"] }),
      filed("gotit", { v: 2, taskIds: ["t-ack"] }),
    ];
    rows.tasks = [
      { id: "t-open", title: "Call Mary", assigned_to: "s-luke", status: "open", acknowledged_at: null },
      { id: "t-given", title: "Order filters", assigned_to: "s-callum", status: "open", acknowledged_at: null },
      { id: "t-ack", title: "Book 3323", assigned_to: "s-luke", status: "open", acknowledged_at: "2026-09-25T02:00:00Z" },
    ];
    rows.task_events = [{ task_id: "t-given" }];
    const out = await listDiaryEntries("org-1", "s1", null);
    expect(Object.fromEntries(out.map((e) => [e.id, e.undo]))).toEqual({ untouched: true, given: false, gotit: false });
    const [events] = of("task_events");
    expect(events.columns).toBe("task_id");
    expect(events.eq).toEqual({ org_id: "org-1" });
    expect(events.ins).toEqual([
      ["task_id", ["t-open", "t-given", "t-ack"]],
      ["kind", ["due", "given", "done", "reopened"]],
    ]);
  });

  it("keeps an entry Undo took back: your words, Tiff saying so, and nothing looked up for what went", async () => {
    rows.workboard_notes = [
      filed(
        "back",
        { v: 2, taskIds: ["t1"] },
        [t("you", "Luke books 3323"), t("tiff", "Done. Luke books 3323."), t("tiff", "1 task taken back.")],
        "undone",
      ),
    ];
    const [entry] = await listDiaryEntries("org-1", "s1", null);
    expect(entry).toMatchObject({ said: "said back", undone: true, undo: false, outcomes: [], taskFor: {} });
    expect(entry.turns.at(-1)).toEqual({ who: "tiff", text: "1 task taken back." });
    // its task has gone: there is nothing to resolve
    expect(of("tasks")).toHaveLength(0);
  });

  /* A NOTE QUEUED FOR SERVICEM8 (two-way phase 2) is taken back from the
     job's diary, not by Undo: undoNote refuses it while something of it can
     still go or may be in ServiceM8. So the diary does not offer Undo on
     one, by the same rule (sm8-note-plan's `undoHeldBySm8`); only where the
     deployment sends notes, so production makes no new read; and a read
     that fails holds every Undo, as it holds the press. */
  describe("on a note queued for ServiceM8", () => {
    const had = process.env.SM8_WRITES;
    afterEach(() => {
      if (had === undefined) delete process.env.SM8_WRITES;
      else process.env.SM8_WRITES = had;
    });
    const create = (noteId: string, over: Record<string, unknown> = {}) => ({
      id: `w-${noteId}`,
      note_id: noteId,
      status: "queued",
      remote_uuid: `r-${noteId}`,
      lease_until: null,
      maybe_landed: false,
      verify_uuids: [],
      taken_back_at: null,
      ...over,
    });
    const page = () => {
      rows.workboard_notes = [
        filed("queued", { v: 2, flagIds: ["f1"] }),
        filed("sent", { v: 2, flagIds: ["f1"] }),
        filed("cancelled", { v: 2, flagIds: ["f1"] }),
        filed("taken-back", { v: 2, flagIds: ["f1"] }),
        filed("never-sent", { v: 2, flagIds: ["f1"] }),
        filed("v1", { flagIds: ["f1"] }),
      ];
      rows.workboard_flags = [{ id: "f1", active: true }];
      rows.sm8_writes = [
        create("queued"),
        create("sent", { status: "sent" }),
        create("cancelled", { status: "cancelled" }),
        create("taken-back", { status: "sent", taken_back_at: "2026-09-25T03:00:00Z" }),
      ];
    };
    const undos = (out: Awaited<ReturnType<typeof listDiaryEntries>>) =>
      Object.fromEntries(out.map((e) => [e.id, e.undo]));

    it("offers no Undo while something of it can still go or may be there, in one read for the page", async () => {
      process.env.SM8_WRITES = "attachment,note";
      page();
      expect(undos(await listDiaryEntries("org-1", "s1", null))).toEqual({
        queued: false,
        sent: false,
        // cancelled before anything went, or taken back from the job's diary
        cancelled: true,
        "taken-back": true,
        "never-sent": true,
        v1: false,
      });
      const [read] = of("sm8_writes");
      expect(of("sm8_writes")).toHaveLength(1);
      expect(read.eq).toEqual({ org_id: "org-1", kind: "note", op: "create" });
      // only the records Undo reads
      expect(read.in).toEqual(["note_id", ["queued", "sent", "cancelled", "taken-back", "never-sent"]]);
    });

    it("holds every Undo when that read fails", async () => {
      process.env.SM8_WRITES = "note";
      page();
      failing.add("sm8_writes");
      const out = await listDiaryEntries("org-1", "s1", null);
      expect(out.every((e) => e.undo === false)).toBe(true);
    });

    it("makes no queue read where the deployment sends files only (production today)", async () => {
      process.env.SM8_WRITES = "1";
      page();
      expect(undos(await listDiaryEntries("org-1", "s1", null))).toMatchObject({ queued: true, sent: true });
      delete process.env.SM8_WRITES;
      await listDiaryEntries("org-1", "s1", null);
      expect(of("sm8_writes")).toHaveLength(0);
    });
  });
});

/* YOUR REPLIES (two-way phase 2): a reply sent from a job card, and a
   task's Done, are rows of yours the diary draws in the conversation
   holding the note each answers (diary-reply). The read says which rows
   they are, what they answer, and where each stands with ServiceM8 in the
   job card's own line — and, where the deployment sends files only, is
   the read it always was. */
describe("listDiaryEntries: your replies to ServiceM8 notes", () => {
  const had = process.env.SM8_WRITES;
  afterEach(() => {
    if (had === undefined) delete process.env.SM8_WRITES;
    else process.env.SM8_WRITES = had;
  });
  const STATE = {
    readable: true,
    kinds: ["attachment", "note"],
    deployment: true,
    mode: "live",
    modeStored: "live",
    pausedReason: null,
    pausedAt: null,
    linked: true,
    connected: true,
    tenantId: "vendor-1",
    granted: ["attachment", "note"],
    refused: [],
    timezoneName: null,
    ownerKinds: ["attachment", "note"],
    ownerKindsRead: true,
  };
  const READY = { state: "ready", staffUuid: "u-isaac", remoteId: "u-isaac", sm8Name: "Isaac Smith", handle: "isaacsmith" };
  const answer = (id: string, to: string, job: string, kept: string, said: string) => ({
    ...note(id, { jobNotes: [kept], sm8Text: said }),
    transcript: said,
    proposal: null,
    status: "applied",
    turns: [],
    target_id: job,
    reply_to_sm8_note_uuid: to,
    sm8_refusal: null,
  });
  const create = (noteId: string, over: Record<string, unknown>) => ({
    id: `w-${noteId}`,
    note_id: noteId,
    op: "create",
    depends_on: null,
    requested_by: "s1",
    status: "queued",
    lease_until: null,
    remote_uuid: `r-${noteId}`,
    maybe_landed: false,
    verify_uuids: [],
    taken_back_at: null,
    last_error: null,
    attempts: 0,
    ...over,
  });
  const page = () => {
    rows.workboard_notes = [
      // said in Portuguese; the diary keeps the English, with the handle
      answer("wn-reply", "n-ask", "j-2041", "@lukeingold on my way", "@lukeingold a caminho"),
      answer("wn-done", "n-grilles", "j-3294", "@lukeingold Done.", "@lukeingold Done."),
      // refused at the press, before anything was queued: the link waited on your answer
      { ...answer("wn-asked", "n-quote", "j-2041", "@lukeingold quote's done", "@lukeingold quote's done"), sm8_refusal: "confirm" },
      { ...note("e-plain", {}), proposal: null, status: "applied", turns: [] },
    ];
    rows.sm8_writes = [
      create("wn-reply", { status: "failed", last_error: "ServiceM8 refused the note." }),
      create("wn-done", { status: "sent" }),
    ];
  };
  const byId = (out: Awaited<ReturnType<typeof listDiaryEntries>>) => Object.fromEntries(out.map((e) => [e.id, e]));

  beforeEach(() => {
    mockWriteState.mockReset().mockResolvedValue(STATE);
    mockSender.mockReset().mockResolvedValue(READY);
  });

  it("says what each answers, its words in English with the handle, and where it stands, as the job card says it", async () => {
    process.env.SM8_WRITES = "attachment,note";
    page();
    const out = byId(await listDiaryEntries("org-1", "s1", null));

    // the diary's own columns (the ones that say ServiceM8 holds a note
    // too, for the diary's Edit), and a reply's, the note it answers once
    expect(of("workboard_notes")[0].columns).toBe(
      "id, transcript, source, applied, created_at, proposal, status, turns, target_kind, reply_to_sm8_note_uuid, is_task_done, target_id, sm8_refusal",
    );
    expect(out["wn-reply"].reply).toEqual({
      to: "n-ask",
      jobUuid: "j-2041",
      words: "@lukeingold on my way",
      line: {
        text: "Not sent to ServiceM8. ServiceM8 refused the note.",
        tone: "bad",
        again: { act: "send_again", label: "Try again" },
        ask: null,
      },
    });
    expect(out["wn-done"].reply).toEqual({
      to: "n-grilles",
      jobUuid: "j-3294",
      words: "@lukeingold Done.",
      line: { text: "In ServiceM8", tone: "ok", again: null, ask: null },
    });
    // yours, so its doors are yours: answered since, it simply goes again
    expect(out["wn-asked"].reply?.line).toEqual({
      text: "Not sent to ServiceM8. Is Isaac Smith you?",
      tone: "bad",
      again: { act: "send_again", label: "Try again" },
      ask: null,
    });
    expect(out["e-plain"]).not.toHaveProperty("reply");
    // read as the one who sent them, on the account connected now
    expect(mockSender).toHaveBeenCalledWith("org-1", "s1", "vendor-1");
    // their queue rows, in one read
    const queue = of("sm8_writes");
    expect(queue).toHaveLength(1);
    expect(queue[0].ins).toEqual([
      ["op", ["create", "delete"]],
      ["note_id", ["wn-reply", "wn-done", "wn-asked"]],
    ]);
  });

  it("reads nothing more for a diary with no reply in it", async () => {
    process.env.SM8_WRITES = "attachment,note";
    rows.workboard_notes = [{ ...note("e-plain", {}), proposal: null, status: "applied", turns: [] }];
    await listDiaryEntries("org-1", "s1", null);
    expect(mockWriteState).not.toHaveBeenCalled();
    expect(mockSender).not.toHaveBeenCalled();
    expect(of("sm8_writes")).toHaveLength(0);
  });

  it("keeps the reply, saying nothing about ServiceM8, when where it stands can't be read", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    process.env.SM8_WRITES = "attachment,note";
    page();
    failing.add("sm8_writes");
    const out = byId(await listDiaryEntries("org-1", "s1", null));
    expect(out["wn-reply"].reply).toMatchObject({ to: "n-ask", line: null });
    // and says so in the log
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("is the read it always was where the deployment sends files only (production today)", async () => {
    for (const writes of ["1", undefined]) {
      if (writes === undefined) delete process.env.SM8_WRITES;
      else process.env.SM8_WRITES = writes;
      calls.length = 0;
      page();
      const out = await listDiaryEntries("org-1", "s1", null);
      expect(of("workboard_notes")[0].columns).toBe(
        "id, transcript, source, applied, created_at, proposal, status, turns, target_kind, reply_to_sm8_note_uuid, is_task_done",
      );
      // the reply stays an entry like any other: nothing says it is one
      expect(out.map((e) => e.id)).toEqual(["wn-reply", "wn-done", "wn-asked", "e-plain"]);
      expect(out.some((e) => "reply" in e)).toBe(false);
      expect(of("sm8_writes")).toHaveLength(0);
      expect(of("staff_profiles")).toHaveLength(0);
    }
    expect(mockWriteState).not.toHaveBeenCalled();
    expect(mockSender).not.toHaveBeenCalled();
  });
});
