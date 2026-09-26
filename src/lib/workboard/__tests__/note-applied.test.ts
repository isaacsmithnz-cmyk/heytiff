/* What a filed note recorded, read back for Undo and for the doors after
   "Done.". The record is our own JSON, but Undo acts on it — deletes rows,
   rewrites a job's notes — so it is read through a whitelist: a text write
   to a table or column that isn't one a note appends to is dropped, whatever
   the stored record says. */

import {
  appliedOf,
  doorsOf,
  freshIssueIds,
  stillThere,
  takesBack,
  TEXT_COLUMNS,
  textKey,
  undoBlocked,
  undoSummary,
  type FiledNow,
} from "../note-applied";

describe("appliedOf", () => {
  it("reads every group, and nothing that isn't one", () => {
    const a = appliedOf({
      v: 2,
      taskIds: ["t-1", 3, ""],
      issueIds: ["i-1", "i-2"],
      issueBumps: [{ id: "i-1", occurrences: 2, lastSeen: "2026-09-01" }, { id: "i-x" }, "junk"],
      textWrites: [
        { table: "maintenance_visits", id: "v-1", column: "notes", before: null, after: "Belts swapped" },
        { table: "staff_profiles", id: "s-1", column: "notes", before: null, after: "x" },
        { table: "maintenance_visits", id: "v-1", column: "status", before: "open", after: "done" },
        { table: "maintenance_agreements", id: "a-1", column: "bring_list", before: "ladder", after: 4 },
      ],
      somethingElse: ["x"],
    });
    expect(a.v).toBe(2);
    expect(a.taskIds).toEqual(["t-1"]);
    expect(a.issueBumps).toEqual([{ id: "i-1", occurrences: 2, lastSeen: "2026-09-01" }]);
    expect(a.textWrites).toEqual([
      { table: "maintenance_visits", id: "v-1", column: "notes", before: null, after: "Belts swapped" },
    ]);
    expect(a).not.toHaveProperty("somethingElse");
  });

  it("reads a v1 record, and nothing at all, as empty groups", () => {
    expect(appliedOf({ taskIds: ["t-1"] }).v).toBeNull();
    const none = appliedOf(null);
    expect(none.v).toBeNull();
    expect(none.taskIds).toEqual([]);
  });

  it("restores only the columns a note appends to", () => {
    expect(TEXT_COLUMNS).toEqual({
      projects: ["notes"],
      maintenance_visits: ["notes"],
      maintenance_agreements: ["notes", "bring_list"],
    });
  });
});

describe("freshIssueIds", () => {
  it("is every issue the note touched except the ones it bumped", () => {
    const a = appliedOf({ issueIds: ["i-old", "i-new"], issueBumps: [{ id: "i-old", occurrences: 2, lastSeen: null }] });
    expect(freshIssueIds(a)).toEqual(["i-new"]);
  });
});

describe("doorsOf — the lines after Done.", () => {
  it("counts what landed, in the spec's words", () => {
    const doors = doorsOf(
      appliedOf({
        taskIds: ["t-1", "t-2"],
        flagIds: ["f-1"],
        issueIds: ["i-1"],
        bringItems: ["coil cleaner", "ladder"],
        checklistIds: ["c-1", "c-2"],
        entryIds: ["e-1"],
        entryLines: ["Belts swapped"],
        jobNotes: ["the words"],
      }),
    );
    expect(doors.map((d) => [d.kind, d.label, d.ids])).toEqual([
      ["tasks", "2 tasks filed", ["t-1", "t-2"]],
      ["flags", "1 flag raised", ["f-1"]],
      ["issues", "1 issue logged", ["i-1"]],
      ["bring", "2 things to bring", ["c-1", "c-2"]],
      ["lines", "2 lines on the job", ["e-1"]],
    ]);
  });

  it("has no door for a note that filed nothing but its words", () => {
    expect(doorsOf(appliedOf({ jobNotes: ["the words"] }))).toEqual([]);
  });
});

describe("undoSummary", () => {
  it("says what was taken back", () => {
    expect(undoSummary(appliedOf({ taskIds: ["t-1", "t-2"] }))).toBe("2 tasks taken back.");
    expect(undoSummary(appliedOf({ taskIds: ["t-1"], flagIds: ["f-1"] }))).toBe("1 task and 1 flag taken back.");
    expect(undoSummary(appliedOf({}))).toBe("Taken back.");
  });
});

describe("takesBack — whether Undo has anything to reach", () => {
  it("is a row the note made, an issue it counted, or words it added to a row", () => {
    expect(takesBack(appliedOf({ v: 2, taskIds: ["t-1"] }))).toBe(true);
    expect(takesBack(appliedOf({ v: 2, flagIds: ["f-1"] }))).toBe(true);
    expect(takesBack(appliedOf({ v: 2, issueIds: ["i-1"], issueBumps: [{ id: "i-1", occurrences: 2 }] }))).toBe(true);
    expect(takesBack(appliedOf({ v: 2, checklistIds: ["c-1"] }))).toBe(true);
    // a project entry alone, and a thing to bring alone, are each enough
    expect(takesBack(appliedOf({ v: 2, entryIds: ["e-1"] }))).toBe(true);
    expect(takesBack(appliedOf({ v: 2, picklistIds: ["p-1"] }))).toBe(true);
    expect(
      takesBack(
        appliedOf({
          v: 2,
          textWrites: [{ table: "maintenance_visits", id: "v-1", column: "notes", before: null, after: "Filters" }],
        }),
      ),
    ).toBe(true);
    expect(takesBack(appliedOf({ v: 2, kbIds: ["k-1"] }))).toBe(true);
  });

  it("is nothing for words kept in your notes or on a job, or a record with nothing in it", () => {
    expect(takesBack(appliedOf({ v: 2, noteLines: ["the words"], jobNotes: ["the words"] }))).toBe(false);
    expect(takesBack(appliedOf({}))).toBe(false);
  });
});

/* ── the one rule for Undo: undoNote refuses on it, the diary draws by it ── */

const nothingNow = (): FiledNow => ({
  tasks: new Map(),
  taskHistory: new Set(),
  flags: new Map(),
  issues: new Map(),
  checklist: new Map(),
  picklist: new Map(),
  entries: new Set(),
  kb: new Set(),
  text: new Map(),
});
const rows = (...r: [string, Record<string, unknown>][]) => new Map(r);

describe("undoBlocked — whether someone has acted on a row the note filed", () => {
  const filed = appliedOf({
    v: 2,
    taskIds: ["t-1"],
    flagIds: ["f-1"],
    issueIds: ["i-old", "i-new"],
    issueBumps: [{ id: "i-old", occurrences: 2 }],
    checklistIds: ["c-1"],
    picklistIds: ["p-1"],
    textWrites: [{ table: "maintenance_visits", id: "v-1", column: "notes", before: null, after: "Belts swapped" }],
  });
  const untouched = (): FiledNow => ({
    ...nothingNow(),
    tasks: rows(["t-1", { status: "open", acknowledged_at: null }]),
    flags: rows(["f-1", { active: true }]),
    issues: rows(["i-old", { occurrences: 3, resolved: false }], ["i-new", { occurrences: 1, resolved: false }]),
    checklist: rows(["c-1", { done: false }]),
    picklist: rows(["p-1", { picked: false }]),
    text: rows([textKey("maintenance_visits", "v-1"), { notes: "Belts swapped" }]),
  });

  it("is nothing while every row is as the note left it", () => {
    expect(undoBlocked(filed, untouched())).toBeNull();
  });

  it.each<[string, (n: FiledNow) => FiledNow]>([
    ["a task given, moved or reopened", (n) => ({ ...n, taskHistory: new Set(["t-1"]) })],
    ["a task answered Got it", (n) => ({ ...n, tasks: rows(["t-1", { status: "open", acknowledged_at: "2026-09-25" }]) })],
    ["a flag cleared", (n) => ({ ...n, flags: rows(["f-1", { active: false }]) })],
    ["a bumped issue counted again", (n) => ({ ...n, issues: rows(["i-old", { occurrences: 4 }], ["i-new", { occurrences: 1 }]) })],
    ["a fresh issue counted again", (n) => ({ ...n, issues: rows(["i-old", { occurrences: 3 }], ["i-new", { occurrences: 2 }]) })],
    [
      "a fresh issue resolved",
      (n) => ({ ...n, issues: rows(["i-old", { occurrences: 3 }], ["i-new", { occurrences: 1, resolved: true }]) }),
    ],
    ["a line ticked on the checklist", (n) => ({ ...n, checklist: rows(["c-1", { done: true }]) })],
    ["a material picked", (n) => ({ ...n, picklist: rows(["p-1", { picked: true }]) })],
  ])("is somebody acting: %s", (_label, change) => {
    expect(undoBlocked(filed, change(untouched()))).toEqual({ why: "acted" });
  });

  it("names the task ticked off first, so the sentence can say by whom", () => {
    expect(undoBlocked(filed, { ...untouched(), tasks: rows(["t-1", { status: "done" }]) })).toEqual({
      why: "ticked",
      taskId: "t-1",
    });
  });

  it("is the job's notes, when the column no longer says what the note wrote", () => {
    const edited = rows([textKey("maintenance_visits", "v-1"), { notes: "edited" }]);
    expect(undoBlocked(filed, { ...untouched(), text: edited })).toEqual({ why: "text" });
    // and when the row it wrote to has gone with its words
    expect(undoBlocked(filed, { ...untouched(), text: new Map() })).toEqual({ why: "text" });
  });

  it("is not stopped by a row somebody deleted since, nor by another note's rows", () => {
    const gone: FiledNow = {
      ...untouched(),
      tasks: rows(["t-other", { status: "done" }]),
      flags: rows(["f-other", { active: false }]),
      issues: new Map(),
      checklist: new Map(),
      picklist: new Map(),
      taskHistory: new Set(["t-other"]),
    };
    expect(undoBlocked(filed, gone)).toBeNull();
  });
});

describe("stillThere — what Undo would take back now", () => {
  it("is the record less every row deleted since, and Undo says only that", () => {
    const a = appliedOf({
      v: 2,
      taskIds: ["t-1", "t-2"],
      flagIds: ["f-1"],
      issueIds: ["i-1"],
      entryIds: ["e-1"],
      kbIds: ["k-1"],
    });
    const left = stillThere(a, { ...nothingNow(), tasks: rows(["t-2", { status: "open" }]), kb: new Set(["k-1"]) });
    expect(left).toMatchObject({ taskIds: ["t-2"], flagIds: [], issueIds: [], entryIds: [], kbIds: ["k-1"] });
    expect(undoSummary(left)).toBe("1 task and 1 library entry taken back.");
    expect(takesBack(left)).toBe(true);
    expect(takesBack(stillThere(a, nothingNow()))).toBe(false);
  });

  it("counts a bring-item that became a row by its row, and one that became words by the words", () => {
    const madeRows = appliedOf({ v: 2, bringItems: ["coil cleaner", "1060 grille"], picklistIds: ["p-1", "p-2"] });
    const left = stillThere(madeRows, { ...nothingNow(), picklist: rows(["p-2", { picked: false }]) });
    expect(left.bringItems).toEqual(["1060 grille"]);
    const words = appliedOf({
      v: 2,
      bringItems: ["coil cleaner"],
      textWrites: [
        { table: "maintenance_agreements", id: "a-1", column: "bring_list", before: null, after: "coil cleaner" },
      ],
    });
    expect(stillThere(words, nothingNow()).bringItems).toEqual(["coil cleaner"]);
    expect(takesBack(stillThere(words, nothingNow()))).toBe(true);
  });
});
