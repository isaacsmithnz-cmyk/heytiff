import { entryForTask, type JournalEntry, type Outcome } from "../journal";

/* A task finds the entry that made it by looking, not by asking, tested as
   arithmetic. (The old diary's one-line count of what an entry made, and its
   "3 days ago", went with the old Home.) */

const door = (text: string, id: string): Outcome => ({ kind: "todo", text, go: { type: "task", id } });

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
