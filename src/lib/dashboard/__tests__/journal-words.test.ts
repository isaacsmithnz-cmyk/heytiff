import { agoLabel, entryForTask, outcomeSummary, type JournalEntry, type Outcome } from "../journal";

/* The diary's list row has one quiet line for what an entry made; the pane
   says when it was made as a sentence; and a task finds the entry that made
   it by looking, not by asking. Three derivations, tested as arithmetic. */

const door = (text: string, id: string): Outcome => ({ kind: "todo", text, go: { type: "task", id } });

describe("outcomeSummary", () => {
  it("counts the doors by what they open and keeps the counts as they were said", () => {
    expect(
      outcomeSummary([
        door("Order 2× MERV 11 filters", "t1"),
        door("Hire a scissor lift", "t2"),
        { kind: "kept", text: "Daikin VRV notes", go: { type: "kb", id: "k1" } },
        { kind: "todo", text: "1 flag" },
        { kind: "kept", text: "1 line kept", go: { type: "note", id: "n1" } },
        { kind: "todo", text: "Middle rooftop unit has tripped again", go: { type: "issue", id: "i1" } },
      ]),
    ).toBe("2 tasks, 1 issue, 1 knowledge entry, 1 flag, 1 line kept");
  });

  it("speaks in the singular for one", () => {
    expect(outcomeSummary([door("Order grilles", "t4")])).toBe("1 task");
  });

  it("is empty for an entry that made nothing — a real outcome, not an error", () => {
    expect(outcomeSummary([])).toBe("");
  });

  it("reads a removed task as the count the resolver already made of it", () => {
    expect(outcomeSummary([{ kind: "todo", text: "1 task removed" }, { kind: "todo", text: "1 issue" }])).toBe(
      "1 task removed, 1 issue",
    );
  });
});

describe("agoLabel", () => {
  const today = "2026-09-14";
  it.each([
    ["2026-09-14", "today"],
    ["2026-09-13", "yesterday"],
    ["2026-09-08", "6 days ago"],
    ["2026-09-01", "13 days ago"],
    ["2026-08-31", "2 weeks ago"],
    ["2026-08-22", "3 weeks ago"],
    ["2026-07-30", "7 weeks ago"],
    ["2026-07-14", "2 months ago"],
    ["2026-08-14", "4 weeks ago"],
    ["2026-07-16", "2 months ago"],
    ["2026-06-14", "3 months ago"],
  ])("%s reads as %s", (day, label) => {
    expect(agoLabel(day, today)).toBe(label);
  });

  it("never says the future, and never says nothing for a bad date", () => {
    expect(agoLabel("2026-09-20", today)).toBe("today");
    expect(agoLabel("not a day", today)).toBe("");
  });
});

describe("entryForTask", () => {
  const entry = (id: string, outcomes: Outcome[]): JournalEntry => ({
    id,
    said: "words",
    day: "2026-09-14",
    at: "7:12 am",
    outcomes,
    spoken: true,
    isDebrief: false,
  });

  it("finds the entry whose door names the task", () => {
    const entries = [entry("e1", [door("A", "t1")]), entry("e2", [door("B", "t2"), door("C", "t3")])];
    expect(entryForTask(entries, "t3")?.id).toBe("e2");
    expect(entryForTask(entries, "t1")?.id).toBe("e1");
  });

  it("is null for a task typed straight in, which no entry made", () => {
    expect(entryForTask([entry("e1", [door("A", "t1")])], "t9")).toBeNull();
    expect(entryForTask([], "t1")).toBeNull();
  });

  it("does not mistake a knowledge door for a task's", () => {
    const entries = [entry("e1", [{ kind: "kept", text: "K", go: { type: "kb", id: "t1" } }])];
    expect(entryForTask(entries, "t1")).toBeNull();
  });
});
