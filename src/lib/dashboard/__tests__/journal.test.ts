import { APPLIED_GROUPS, CHIP_TITLE_MAX, describeApplied, describeAppliedResolved, entryForDoor } from "../journal";

/* The journal reads a table nothing had ever read back to a person:
   `workboard_notes` keeps every transcript verbatim as the evidence for what
   was applied, and `applied` lists the rows the confirmation created. What is
   worth pinning is the two places that can silently drift from the write side
   — the group names and their plurals — and the day grouping, which has to
   survive a timestamp that lands on the far side of midnight in UTC. */

describe("describeApplied", () => {
  it("counts each group in the words the save summary used", () => {
    expect(describeApplied({ taskIds: ["a", "b"], noteLines: ["x"] })).toEqual([
      { kind: "todo", text: "2 tasks" },
      { kind: "kept", text: "1 line kept" },
    ]);
  });

  it("keeps the write side's own singular and plural for every group", () => {
    /* THE PAIRING IS COPIED, NOT SHARED, and `journal-groups.test.ts` is what
       actually reads `actions/workboard-notes.ts` to check it. This list is
       the order the chips come out in, which that scan says nothing about:
       the writer's groups first (the Library's among them, which a press
       appends), then the two that keep the words as they were said — the
       job, then the kept lines of rows from before. */
    expect(APPLIED_GROUPS.map(([k]) => k)).toEqual([
      "taskIds",
      "flagIds",
      "entryIds",
      "entryLines",
      "issueIds",
      "bringItems",
      "kbIds",
      "jobNotes",
      "noteLines",
    ]);
    for (const [key, one, many, kind] of APPLIED_GROUPS) {
      expect(describeApplied({ [key]: ["only"] })).toEqual([{ kind, text: `1 ${one}` }]);
      expect(describeApplied({ [key]: ["a", "b"] })).toEqual([{ kind, text: `2 ${many}` }]);
    }
  });

  it("sorts every group into one of exactly two glyphs", () => {
    /* Eight glyphs would be a vocabulary to learn; the split that matters is
       the one the reader acts on. If a new group arrives, it has to choose a
       side here rather than quietly inventing a third. */
    expect(new Set(APPLIED_GROUPS.map(([, , , kind]) => kind))).toEqual(
      new Set(["todo", "kept"]),
    );
    const todo = APPLIED_GROUPS.filter(([, , , k]) => k === "todo").map(([key]) => key);
    expect(todo).toEqual(["taskIds", "flagIds", "issueIds", "bringItems"]);
  });

  it("reports nothing for a capture that produced nothing", () => {
    // untick every line and you have still said the thing: the row renders
    // with the words and no outcomes, rather than disappearing
    expect(describeApplied({})).toEqual([]);
    expect(describeApplied(null)).toEqual([]);
    expect(describeApplied(undefined)).toEqual([]);
  });

  it("ignores a shape it did not write rather than inventing a number", () => {
    expect(describeApplied({ taskIds: "two" })).toEqual([]);
    expect(describeApplied({ taskIds: 2 })).toEqual([]);
    expect(describeApplied("nonsense")).toEqual([]);
    // an unknown key is not guessed at either
    expect(describeApplied({ somethingNew: ["a"] })).toEqual([]);
  });
});

describe("describeAppliedResolved", () => {
  const tasks = new Map([
    ["t1", "Order 2× MERV 11 filters"],
    ["t2", "Book the tail lift service"],
  ]);
  const kb = new Map([["k1", "Daikin VRV commissioning notes"]]);

  it("gives every task and knowledge entry its own title and a door", () => {
    expect(
      describeAppliedResolved({ taskIds: ["t1", "t2"], kbIds: ["k1"] }, { tasks, kb }),
    ).toEqual([
      { kind: "todo", text: "Order 2× MERV 11 filters", go: { type: "task", id: "t1" } },
      { kind: "todo", text: "Book the tail lift service", go: { type: "task", id: "t2" } },
      { kind: "kept", text: "Daikin VRV commissioning notes", go: { type: "kb", id: "k1" } },
    ]);
  });

  it("counts what has been deleted since instead of linking to nothing", () => {
    // t9 was applied and has since been removed — the capture really did make
    // it, and it really isn't there any more; both halves stay true
    expect(describeAppliedResolved({ taskIds: ["t1", "t9"] }, { tasks })).toEqual([
      { kind: "todo", text: "Order 2× MERV 11 filters", go: { type: "task", id: "t1" } },
      { kind: "todo", text: "1 task removed" },
    ]);
    expect(describeAppliedResolved({ taskIds: ["t8", "t9"] }, { tasks: new Map() })).toEqual([
      { kind: "todo", text: "2 tasks removed" },
    ]);
    // an id that isn't even a string was never a row we wrote
    expect(describeAppliedResolved({ kbIds: [7] }, { kb })).toEqual([
      { kind: "kept", text: "1 knowledge entry removed" },
    ]);
  });

  it("cuts a long title to the chip's width", () => {
    const long = "Order replacement filters for every plant room on the Clyde site";
    const [chip] = describeAppliedResolved(
      { taskIds: ["long"] },
      { tasks: new Map([["long", long]]) },
    );
    // never longer than the cap, and a cut landing on a space doesn't leave
    // the space dangling in front of the ellipsis
    expect(chip.text.length).toBeLessThanOrEqual(CHIP_TITLE_MAX);
    expect(chip.text.endsWith("…")).toBe(true);
    expect(chip.text).not.toMatch(/\s…$/);
    expect(long.startsWith(chip.text.slice(0, -1))).toBe(true);
    // a title that fits is left exactly as it is
    expect(describeAppliedResolved({ taskIds: ["t1"] }, { tasks })[0].text).toBe(
      "Order 2× MERV 11 filters",
    );
  });

  it("keeps kept lines as one chip, and only opens it when the note is there", () => {
    /* The debrief files every ticked line as ONE grouped staff_note, so there
       is nothing per-line to open — and if that note has since been deleted
       from my-notes the chip must stop being a door. */
    expect(describeAppliedResolved({ noteLines: ["a", "b"] }, { noteId: "n1" })).toEqual([
      { kind: "kept", text: "2 lines kept", go: { type: "note", id: "n1" } },
    ]);
    expect(describeAppliedResolved({ noteLines: ["a", "b"] }, { noteId: null })).toEqual([
      { kind: "kept", text: "2 lines kept" },
    ]);
  });

  it("leaves the groups with nowhere to go as plain counts", () => {
    // linking a flag or a bring-item to "the workboard, roughly" would be a
    // lie; an issue stays a count too until it is handed the lookup below
    const applied = { flagIds: ["f1"], entryIds: ["e1", "e2"], issueIds: ["i1"], bringItems: ["b"] };
    const out = describeAppliedResolved(applied, { tasks, kb, noteId: "n1" });
    expect(out.every((o) => o.go === undefined)).toBe(true);
    expect(out.map((o) => o.text)).toEqual(["1 flag", "2 entries", "1 issue", "1 bring-item"]);
  });

  it("is exactly describeApplied when nothing was looked up", () => {
    // the old counts are not a separate code path that can drift — they are
    // this function with no lookups
    const applied = { taskIds: ["t1", "t2"], kbIds: ["k1"], noteLines: ["x"] };
    expect(describeAppliedResolved(applied)).toEqual(describeApplied(applied));
    expect(describeApplied(applied).map((o) => o.text)).toEqual([
      "2 tasks",
      "1 knowledge entry",
      "1 line kept",
    ]);
  });

  it("keeps the order the groups were applied in", () => {
    const out = describeAppliedResolved(
      { taskIds: ["t1"], flagIds: ["f"], kbIds: ["k1"], noteLines: ["x"] },
      { tasks, kb, noteId: "n1" },
    );
    expect(out.map((o) => o.kind)).toEqual(["todo", "todo", "kept", "kept"]);
    expect(out.map((o) => o.go?.type)).toEqual(["task", undefined, "kb", "note"]);
  });
});

describe("an issue's door (2026-09-15, since Home lists issues)", () => {
  it("wears the issue's own words and lands on its row", () => {
    const out = describeAppliedResolved(
      { issueIds: ["i1", "i2"] },
      { issues: new Map([["i1", "Middle rooftop unit has tripped again"]]) },
    );
    expect(out).toEqual([
      {
        kind: "todo",
        text: "Middle rooftop unit has tripped again",
        go: { type: "issue", id: "i1" },
      },
      // the row that is gone is counted, never a dead door
      { kind: "todo", text: "1 issue removed" },
    ]);
  });

  it("finds the entry behind a door of any kind", () => {
    const entries = [
      {
        id: "e1",
        said: "words",
        day: "2026-09-14",
        at: "7:12 am",
        outcomes: [{ kind: "todo" as const, text: "x", go: { type: "issue" as const, id: "i1" } }],
        spoken: true,
      },
    ];
    expect(entryForDoor(entries, "issue", "i1")?.id).toBe("e1");
    expect(entryForDoor(entries, "task", "i1")).toBeNull();
  });
});
