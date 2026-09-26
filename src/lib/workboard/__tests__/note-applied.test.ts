/* What a filed note recorded, read back for Undo and for the doors after
   "Done.". The record is our own JSON, but Undo acts on it — deletes rows,
   rewrites a job's notes — so it is read through a whitelist: a text write
   to a table or column that isn't one a note appends to is dropped, whatever
   the stored record says. */

import { appliedOf, doorsOf, freshIssueIds, takesBack, TEXT_COLUMNS, undoSummary } from "../note-applied";

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
