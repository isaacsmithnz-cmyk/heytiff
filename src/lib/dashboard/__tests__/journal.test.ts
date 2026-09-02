import { canPageDays, APPLIED_GROUPS, CHIP_TITLE_MAX, describeApplied, describeAppliedResolved, groupByDay, type JournalEntry, topDayAt } from "../journal";

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
       the six `applyNote` groups first, then the two endings that file the
       words as they were said — the job, then yourself. */
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
    // linking a flag or an issue to "the workboard, roughly" would be a lie
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

const entry = (id: string, day: string, at = "9:00 am"): JournalEntry => ({
  id,
  said: `said ${id}`,
  isDebrief: false,
  day,
  at,
  outcomes: [],
  spoken: false,
});

// the real formatter is `fmtAuWeekdayDayMonth`; the grouping doesn't care
const fmt = (iso: string) => `on ${iso}`;

describe("groupByDay", () => {
  const TODAY = "2026-08-10";

  it("names today and yesterday, and dates everything older", () => {
    const days = groupByDay(
      [entry("a", "2026-08-10"), entry("b", "2026-08-09"), entry("c", "2026-08-07")],
      TODAY,
      fmt,
    );
    expect(days.map((d) => d.label)).toEqual(["Today", "Yesterday", "on 2026-08-07"]);
  });

  it("crosses a month boundary to find yesterday", () => {
    // the 1st's yesterday is the 31st of the month before, not the 0th
    const days = groupByDay([entry("a", "2026-07-31")], "2026-08-01", fmt);
    expect(days[0].label).toBe("Yesterday");
  });

  it("keeps every entry, newest first, in one group per day", () => {
    const days = groupByDay(
      [
        entry("a", "2026-08-10", "11:30 am"),
        entry("b", "2026-08-10", "6:52 am"),
        entry("c", "2026-08-09"),
      ],
      TODAY,
      fmt,
    );
    expect(days).toHaveLength(2);
    expect(days[0].entries.map((e) => e.id)).toEqual(["a", "b"]);
    expect(days[1].entries.map((e) => e.id)).toEqual(["c"]);
  });

  it("has nothing to group when there is nothing", () => {
    expect(groupByDay([], TODAY, fmt)).toEqual([]);
  });
});

describe("topDayAt — which day the diary is showing", () => {
  /* The page-turner's label reads from this. It is pure because the rule it
     replaced was WRONG on real data and could only be caught by scrolling a
     real browser — and both browser surfaces available here report their tab
     as hidden, which freezes requestAnimationFrame and makes rAF-throttled
     behaviour unverifiable by looking. Arithmetic belongs in a suite. */

  const order = ["2026-09-01", "2026-08-31", "2026-08-28", "2026-08-22"];
  /* Each day's offsetTop inside the scroller — a tall list, one day per
     screenful. */
  const tall = new Map([
    ["2026-09-01", 0],
    ["2026-08-31", 200],
    ["2026-08-28", 400],
    ["2026-08-22", 600],
  ]);

  it("is the newest day before anything has scrolled", () => {
    expect(topDayAt(order, tall, 0)).toBe("2026-09-01");
  });

  it("moves to a day the moment its block passes the fold", () => {
    /* The fold is 44px — the band the sticky heading occupies — so the day
       becomes current exactly when its heading becomes the stuck one. */
    expect(topDayAt(order, tall, 155)).toBe("2026-09-01"); // 200 > 155+44
    expect(topDayAt(order, tall, 156)).toBe("2026-08-31"); // 200 <= 200
    expect(topDayAt(order, tall, 400)).toBe("2026-08-28");
    expect(topDayAt(order, tall, 600)).toBe("2026-08-22");
  });

  it("REPORTS A LATER DAY ON A SHORT LIST, which is the bug it exists for", () => {
    /* THE FAILURE THAT SHIPPED. Three days in a scroller barely taller than
       its content: the old rule asked "which is the newest day still
       intersecting", every day intersected at once, so the answer was pinned
       to the newest and the label never moved — Isaac scrolled to the bottom
       of his own diary and it still said the top day.

       Geometry has no such tie: at the bottom of a short list a later day HAS
       passed the fold, so it wins. */
    const short = new Map([
      ["2026-09-01", 0],
      ["2026-08-31", 60],
      ["2026-08-28", 118],
    ]);
    const shortOrder = ["2026-09-01", "2026-08-31", "2026-08-28"];
    expect(topDayAt(shortOrder, short, 0)).toBe("2026-09-01");
    expect(topDayAt(shortOrder, short, 40)).toBe("2026-08-31"); // 60 <= 84
    /* 118 is the third day's top, so it arrives at scrollTop 74 (74+44) and
       not a pixel before — checked both sides, because an off-by-one here is
       a label that changes a scroll-tick early or late and looks like drift. */
    expect(topDayAt(shortOrder, short, 73)).toBe("2026-08-31"); // 118 > 117
    expect(topDayAt(shortOrder, short, 74)).toBe("2026-08-28"); // 118 <= 118
  });

  it("holds at the newest when NO day can reach the fold", () => {
    /* A list that does not scroll at all. The newest day is the only one at
       the top, and saying so is not a fallback — it is the answer. */
    const one = new Map([["2026-09-01", 0]]);
    expect(topDayAt(["2026-09-01"], one, 0)).toBe("2026-09-01");
  });

  it("has nothing to say about an empty record", () => {
    expect(topDayAt([], new Map(), 0)).toBeNull();
  });

  it("skips a day whose node has not been measured rather than guessing", () => {
    /* A ref can be null for a frame. A missing offset means "unknown", and an
       unknown day must not silently read as offset 0 and win. */
    const gappy = new Map([
      ["2026-09-01", 0],
      ["2026-08-28", 400],
    ]);
    expect(topDayAt(order, gappy, 400)).toBe("2026-08-28");
  });
});

describe("canPageDays — whether the stepper earns its place", () => {
  /* Found on prod: the whole three-day record fitted the card, so nothing
     scrolled and "the day before" was a control that did nothing at all. The
     first fix asked "does it scroll", which is not the same question — a list
     can scroll 57px and still never bring its second day to the fold. */

  const order = ["2026-09-01", "2026-08-31", "2026-08-28"];

  it("is false when the record fits and nothing scrolls", () => {
    const offs = new Map([["2026-09-01", 6], ["2026-08-31", 149], ["2026-08-28", 291]]);
    expect(canPageDays(order, offs, 0)).toBe(false);
  });

  it("is FALSE when it scrolls but not far enough to reach the second day", () => {
    /* THE CASE THE CRUDE VERSION GOT WRONG. 57px of travel against a second
       day at 149: the page moves, the answer never changes, and the arrow is
       still furniture. */
    const offs = new Map([["2026-09-01", 6], ["2026-08-31", 149], ["2026-08-28", 291]]);
    expect(canPageDays(order, offs, 57)).toBe(false);
  });

  it("is true the moment the second day can reach the fold", () => {
    const offs = new Map([["2026-09-01", 6], ["2026-08-31", 149], ["2026-08-28", 291]]);
    /* 149 <= 104 + 44 exactly — checked on both sides, because this decides
       whether a control exists at all. */
    expect(canPageDays(order, offs, 104)).toBe(false);
    expect(canPageDays(order, offs, 105)).toBe(true);
    expect(canPageDays(order, offs, 484)).toBe(true);
  });

  it("is false for a record of one day, however tall", () => {
    /* Nowhere to step, whatever the geometry says. */
    expect(canPageDays(["2026-09-01"], new Map([["2026-09-01", 6]]), 9999)).toBe(false);
    expect(canPageDays([], new Map(), 9999)).toBe(false);
  });

  it("is false when the second day has not been measured", () => {
    /* A ref can be null for a frame. Unknown is not "yes". */
    const gappy = new Map([["2026-09-01", 6], ["2026-08-28", 291]]);
    expect(canPageDays(order, gappy, 9999)).toBe(false);
  });
});
