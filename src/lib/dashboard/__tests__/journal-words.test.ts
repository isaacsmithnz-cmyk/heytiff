import { agoLabel, entryForTask, type JournalEntry, type Outcome } from "../journal";

/* How long ago, in whole units; and a task finds the entry that made it by
   looking, not by asking. Two derivations, tested as arithmetic. (The old
   diary's one-line count of what an entry made went with the old Home.) */

const door = (text: string, id: string): Outcome => ({ kind: "todo", text, go: { type: "task", id } });

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
