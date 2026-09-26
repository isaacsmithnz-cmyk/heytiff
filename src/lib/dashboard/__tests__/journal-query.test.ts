/* Resolving the chips. The stored `applied` is a bag of ids and nothing has
   ever read them back, so this is where the two things that can go wrong live:
   asking the database once per chip (sixty entries would be sixty round trips
   to paint one panel), and trusting an id whose row has since been deleted. */

import fs from "node:fs";
import path from "node:path";

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
  /* a note somebody took back isn't on anybody's journal (two-way phase 2) */
  chain.is = (col: string, val: unknown) => {
    call.eq[`${col} is`] = val;
    return chain;
  };
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.then = (res: (v: { data: unknown }) => unknown) =>
    Promise.resolve({ data: rows[name] ?? [] }).then(res);
  return chain;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (n: string) => table(n) } }));

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
    // built on the journal's column list, so the two can't drift apart
    expect(read.columns).toBe("id, transcript, source, applied, created_at, proposal, status, turns");
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
    // and whether each is still open, which Undo needs (below)
    expect(of("tasks")[0].columns).toBe("id, title, assigned_to, status");
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
    const out = await listDiaryEntries("org-1", "s1", null);
    expect(Object.fromEntries(out.map((e) => [e.id, e.undo]))).toEqual({
      // a task somebody deleted since is simply gone, and stops nothing
      open: true,
      // one ticked off ends it: Undo would refuse the lot
      ticked: false,
      // a flag Undo checks when pressed, like the rest of a row's state
      flag: true,
      // filed before Undo existed
      v1: false,
      // words kept in your notes are nothing Undo reaches
      nothing: false,
      saved: false,
    });
    expect(out.every((e) => e.undone === false)).toBe(true);
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
});
