import { APPLIED_GROUPS, describeApplied, groupByDay, type JournalEntry } from "../journal";

/* The journal reads a table nothing had ever read back to a person:
   `workboard_notes` keeps every transcript verbatim as the evidence for what
   was applied, and `applied` lists the rows the confirmation created. What is
   worth pinning is the two places that can silently drift from the write side
   — the group names and their plurals — and the day grouping, which has to
   survive a timestamp that lands on the far side of midnight in UTC. */

describe("describeApplied", () => {
  it("counts each group in the words the save summary used", () => {
    expect(describeApplied({ taskIds: ["a", "b"], noteLines: ["x"] })).toEqual([
      "2 tasks",
      "1 line kept",
    ]);
  });

  it("keeps applyNote's own singular and plural for every group", () => {
    /* THE PAIRING IS COPIED, NOT SHARED. `applyNote` builds "Saved — 2 tasks ·
       1 line kept" from these same eight keys as it inserts each group, so the
       two lists can drift. If this fails, the write side gained or reworded a
       group and the journal is about to describe it wrongly. */
    expect(APPLIED_GROUPS.map(([k]) => k)).toEqual([
      "taskIds",
      "flagIds",
      "entryIds",
      "entryLines",
      "issueIds",
      "bringItems",
      "kbIds",
      "noteLines",
    ]);
    for (const [key, one, many] of APPLIED_GROUPS) {
      expect(describeApplied({ [key]: ["only"] })).toEqual([`1 ${one}`]);
      expect(describeApplied({ [key]: ["a", "b"] })).toEqual([`2 ${many}`]);
    }
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

const entry = (id: string, day: string, at = "9:00 am"): JournalEntry => ({
  id,
  said: `said ${id}`,
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
