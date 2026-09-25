/* The Tasks face's words about one task: the due word, where it came from,
   the caption over their words, the facts, the history and what the viewer
   may do. Pure, so every sentence is pinned here without a screen. */

import {
  clock12,
  dueWord,
  factsOf,
  historyOf,
  isLate,
  jobLabelOf,
  momentOf,
  powersOf,
  sm8Moment,
  sourceLine,
  typedAbout,
  wordsCaption,
  type RecordTask,
  type TaskAbout,
  type TaskEvent,
} from "../task-record";

/* Thursday. Sydney is on AEST (UTC+10) until the first Sunday of October,
   so 03:42Z is 1:42 pm. */
const TODAY = "2026-09-24";
const ME = "s-isaac";
const LUKE = "s-luke";
const LEO = "s-leo";
const people = { [ME]: "Isaac Smith", [LUKE]: "Luke Ingold", [LEO]: "Leo Park" };

const task = (over: Partial<RecordTask> = {}): RecordTask => ({
  id: "t1",
  title: "Order the grilles",
  detail: null,
  assigneeId: ME,
  assigneeName: "Isaac Smith",
  dueDate: null,
  status: "open",
  createdBy: ME,
  createdAt: "2026-09-18T03:42:00Z",
  doneAt: null,
  doneByName: null,
  remindAt: null,
  remindKind: "at",
  createdByName: "Isaac Smith",
  doneById: null,
  acknowledgedAt: null,
  ...over,
});

const event = (over: Partial<TaskEvent> & Pick<TaskEvent, "kind" | "at">): TaskEvent => ({
  by: ME,
  dueFrom: null,
  dueTo: null,
  from: null,
  to: null,
  ...over,
});

const diary = (over: Partial<TaskAbout> = {}): TaskAbout => ({
  ...typedAbout(),
  source: "diary",
  noteId: "n1",
  authorId: ME,
  spoken: true,
  said: { day: "2026-08-22", time: "11:42 pm" },
  words: "Luke to order the grilles by Friday",
  ...over,
});

const sm8 = (over: Partial<TaskAbout> = {}): TaskAbout => ({
  ...typedAbout(),
  source: "sm8",
  sm8NoteUuid: "note-1",
  askerName: "Luke Ingold",
  said: { day: "2026-09-21", time: "1:42 pm" },
  words: "@isaacsmith can you order the grilles",
  job: { label: "2041 Wollstonecraft", uuid: "job-1" },
  ...over,
});

const texts = (lines: { text: string }[]) => lines.map((l) => l.text);

describe("dueWord", () => {
  it("says how late, today, tomorrow, or the day", () => {
    expect(dueWord(task({ dueDate: "2026-09-23" }), TODAY)).toEqual({ text: "1 day late", state: "bad" });
    expect(dueWord(task({ dueDate: "2026-08-25" }), TODAY)).toEqual({ text: "30 days late", state: "bad" });
    expect(dueWord(task({ dueDate: TODAY }), TODAY)).toEqual({ text: "Today", state: "today" });
    expect(dueWord(task({ dueDate: "2026-09-25" }), TODAY)).toEqual({ text: "Tomorrow", state: null });
    expect(dueWord(task({ dueDate: "2026-10-02" }), TODAY)).toEqual({ text: "Fri 2 Oct", state: null });
    expect(dueWord(task({ dueDate: null }), TODAY)).toBeNull();
  });

  it("writes the year only when it is not this one", () => {
    expect(dueWord(task({ dueDate: "2027-01-08" }), TODAY)?.text).toBe("Fri 8 Jan 2027");
  });

  it("dates a done row by the day it was done, and it is never late", () => {
    const done = task({ status: "done", dueDate: "2026-08-25", doneAt: "2026-09-24T01:00:00Z" });
    expect(dueWord(done, TODAY)).toEqual({ text: "Today", state: null });
    expect(dueWord({ ...done, doneAt: "2026-09-21T03:42:00Z" }, TODAY)).toEqual({ text: "Mon 21 Sept", state: null });
  });
});

describe("isLate", () => {
  /* The rail's red count is `dueDate !== null && dueDate < today` over the
     viewer's OPEN tasks; the face's late rows must be exactly that set. */
  const railCount = (ts: RecordTask[]) => ts.filter((t) => t.dueDate !== null && t.dueDate < TODAY).length;
  const open = [
    task({ id: "a", dueDate: "2026-09-23" }),
    task({ id: "b", dueDate: TODAY }),
    task({ id: "c", dueDate: "2026-09-25" }),
    task({ id: "d", dueDate: null }),
    task({ id: "e", dueDate: "2026-01-02" }),
  ];

  it("agrees with the rail badge on the same tasks", () => {
    expect(open.filter((t) => isLate(t, TODAY)).map((t) => t.id)).toEqual(["a", "e"]);
    expect(open.filter((t) => isLate(t, TODAY))).toHaveLength(railCount(open));
  });

  it("never calls a finished task late", () => {
    expect(isLate(task({ status: "done", dueDate: "2026-09-01" }), TODAY)).toBe(false);
  });
});

describe("sourceLine", () => {
  it("names the diary it came from", () => {
    expect(sourceLine(diary(), task(), ME, TODAY, people)).toBe("Your diary, Sat 22 Aug.");
    expect(sourceLine(diary(), task({ assigneeId: LUKE }), LUKE, TODAY, people)).toBe("Isaac's diary, Sat 22 Aug.");
    expect(sourceLine(diary({ authorId: null }), task(), LUKE, TODAY, people)).toBe("A diary entry, Sat 22 Aug.");
  });

  it("says who asked, and whether it was you they asked", () => {
    expect(sourceLine(sm8(), task(), ME, TODAY, people)).toBe("Luke asked you, Mon 21 Sept.");
    expect(sourceLine(sm8(), task({ assigneeId: LEO }), ME, TODAY, people)).toBe("Luke asked, Mon 21 Sept.");
    expect(sourceLine(sm8({ askerName: null }), task(), ME, TODAY, people)).toBe("Someone asked you, Mon 21 Sept.");
  });

  it("names the project a defects task belongs to", () => {
    const about = { ...typedAbout(), source: "project" as const, project: "Harbour St fit-out" };
    expect(sourceLine(about, task(), ME, TODAY, people)).toBe("From Harbour St fit-out's defects period.");
  });

  it("says when you added your own", () => {
    expect(sourceLine(typedAbout(), task(), ME, TODAY, people)).toBe("Added Fri 18 Sept.");
    expect(sourceLine(typedAbout(), task({ createdAt: "2026-09-24T01:00:00Z" }), ME, TODAY, people)).toBe(
      "Added today.",
    );
  });

  it("says who gave it to whom, from the viewer's side", () => {
    const given = task({ assigneeId: LUKE, assigneeName: "Luke Ingold" });
    expect(sourceLine(typedAbout(), given, LUKE, TODAY, people)).toBe("Isaac gave it to you, Fri 18 Sept.");
    expect(sourceLine(typedAbout(), given, ME, TODAY, people)).toBe("You gave it to Luke, Fri 18 Sept.");
    expect(sourceLine(typedAbout(), given, LEO, TODAY, people)).toBe("Isaac gave it to Luke, Fri 18 Sept.");
  });

  it("follows the latest hand-over, not the first", () => {
    const about = typedAbout([
      event({ kind: "created", at: "2026-09-18T03:42:00Z", to: LUKE }),
      event({ kind: "given", at: "2026-09-21T03:42:00Z", from: LUKE, to: LEO }),
    ]);
    const t = task({ assigneeId: LEO, assigneeName: "Leo Park" });
    expect(sourceLine(about, t, LEO, TODAY, people)).toBe("Isaac gave it to you, Mon 21 Sept.");
    expect(sourceLine(about, t, ME, TODAY, people)).toBe("You gave it to Leo, Mon 21 Sept.");
  });

  it("says who ticked a done row off", () => {
    const done = task({ status: "done", doneAt: "2026-09-21T03:42:00Z", doneById: LUKE });
    expect(sourceLine(typedAbout(), done, ME, TODAY, people)).toBe("Luke ticked it off.");
    expect(sourceLine(typedAbout(), { ...done, doneById: ME }, ME, TODAY, people)).toBe("You ticked it off.");
  });
});

describe("wordsCaption", () => {
  it("says how you told Tiff, and when", () => {
    expect(wordsCaption(diary(), TODAY)).toEqual({ strong: "You said", rest: ", Sat 22 Aug, 11:42 pm" });
    expect(wordsCaption(diary({ spoken: false }), TODAY)).toEqual({ strong: "You typed", rest: ", Sat 22 Aug, 11:42 pm" });
  });

  it("names the ServiceM8 writer and the job", () => {
    expect(wordsCaption(sm8(), TODAY)).toEqual({ strong: "Luke Ingold", rest: " wrote, in a job note on 2041 Wollstonecraft" });
    expect(wordsCaption(sm8({ job: null }), TODAY)).toEqual({ strong: "Luke Ingold", rest: " wrote, in a job note" });
  });

  it("captions nothing when there are no words to read", () => {
    expect(wordsCaption(diary({ words: null }), TODAY)).toBeNull();
    expect(wordsCaption(typedAbout(), TODAY)).toBeNull();
  });
});

describe("factsOf", () => {
  it("says who it is for, when it is due and the job", () => {
    expect(factsOf(task({ dueDate: "2026-10-02" }), sm8(), ME, TODAY, null)).toEqual([
      { label: "For", value: "You" },
      { label: "Due", value: "Fri 2 Oct" },
      { label: "Job", value: "2041 Wollstonecraft", job: "job-1" },
    ]);
  });

  it("dates a late task and says how late", () => {
    const facts = factsOf(task({ dueDate: "2026-08-25", assigneeId: LUKE, assigneeName: "Luke Ingold" }), typedAbout(), ME, TODAY, null);
    expect(facts).toEqual([
      { label: "For", value: "Luke Ingold" },
      { label: "Due", value: "Tue 25 Aug, 30 days late", late: true },
    ]);
  });

  it("says No date, and Done once finished", () => {
    expect(factsOf(task(), typedAbout(), ME, TODAY, null)[1]).toEqual({ label: "Due", value: "No date" });
    expect(factsOf(task({ status: "done", doneAt: "2026-09-21T03:42:00Z" }), typedAbout(), ME, TODAY, null)[1]).toEqual({
      label: "Done",
      value: "Mon 21 Sept",
    });
  });

  it("gives a Time only when the task named an hour, in the workspace's zone", () => {
    // 06:00Z is 4:00 pm in Sydney and 2:00 pm in Perth
    const timed = task({ dueDate: "2026-09-25", remindAt: "2026-09-25T06:00:00Z", remindKind: "by" });
    expect(factsOf(timed, typedAbout(), ME, TODAY, "Australia/Sydney")).toContainEqual({ label: "Time", value: "by 4:00 pm" });
    expect(factsOf({ ...timed, remindKind: "at" }, typedAbout(), ME, TODAY, "Australia/Perth")).toContainEqual({
      label: "Time",
      value: "at 2:00 pm",
    });
    expect(factsOf(task({ dueDate: "2026-09-25" }), typedAbout(), ME, TODAY, null).map((f) => f.label)).not.toContain("Time");
  });

  it("gives a visit its words and no door", () => {
    const about = diary({ job: { label: "Job 1042, Bayview Apartments", uuid: null } });
    expect(factsOf(task(), about, ME, TODAY, null)).toContainEqual({
      label: "Job",
      value: "Job 1042, Bayview Apartments",
      job: null,
    });
  });
});

describe("historyOf", () => {
  it("says how each kind of task was made", () => {
    expect(texts(historyOf(task(), diary(), people, ME, TODAY))).toEqual(["Tiff made it from your diary."]);
    expect(texts(historyOf(task({ assigneeId: LUKE, createdBy: ME }), diary(), people, LUKE, TODAY))).toEqual([
      "Tiff made it from Isaac's diary.",
      "Tiff gave it to you.",
    ]);
    expect(texts(historyOf(task({ createdBy: null }), sm8(), people, ME, TODAY))).toEqual([
      "Tiff made it from Luke Ingold's note in ServiceM8.",
      "Tiff gave it to you.",
    ]);
    expect(texts(historyOf(task(), sm8({ actedBy: ME }), people, ME, TODAY))).toEqual([
      "You made it from Luke Ingold's note in ServiceM8.",
    ]);
    expect(texts(historyOf(task(), typedAbout(), people, ME, TODAY))).toEqual(["You typed it."]);
    expect(texts(historyOf(task(), typedAbout(), people, LUKE, TODAY))).toEqual(["Isaac typed it."]);
    const project = { ...typedAbout(), source: "project" as const, project: "Harbour St fit-out" };
    expect(texts(historyOf(task(), project, people, ME, TODAY))).toEqual(["Made from Harbour St fit-out's defects period."]);
  });

  it("dates every line from its own moment", () => {
    const [made] = historyOf(task({ createdAt: "2026-09-21T03:42:00Z" }), typedAbout(), people, ME, TODAY);
    expect(made).toEqual({ iso: "2026-09-21T03:42:00Z", at: "Mon 21 Sept, 1:42 pm", text: "You typed it." });
    const [today] = historyOf(task({ createdAt: "2026-09-24T03:42:00Z" }), typedAbout(), people, ME, TODAY);
    expect(today.at).toBe("Today, 1:42 pm");
  });

  it("says Got it only on work someone was given", () => {
    const given = task({ assigneeId: LUKE, acknowledgedAt: "2026-09-19T00:00:00Z" });
    expect(texts(historyOf(given, typedAbout(), people, ME, TODAY))).toEqual([
      "You typed it.",
      "You gave it to Luke.",
      "Luke said Got it.",
    ]);
    // your own to-do has nobody to say it to
    const own = task({ acknowledgedAt: "2026-09-19T00:00:00Z" });
    expect(texts(historyOf(own, typedAbout(), people, ME, TODAY))).toEqual(["You typed it."]);
  });

  it("puts the logged changes in time order, saying who when it was not you", () => {
    const about = typedAbout([
      event({ kind: "created", at: "2026-09-18T03:42:00Z", to: ME }),
      event({ kind: "due", at: "2026-09-21T03:42:00Z", dueFrom: "2026-09-25", dueTo: "2026-10-02", by: LUKE }),
      event({ kind: "due", at: "2026-09-19T03:42:00Z", dueFrom: null, dueTo: "2026-09-25" }),
      event({ kind: "due", at: "2026-09-22T03:42:00Z", dueFrom: "2026-10-02", dueTo: null }),
    ]);
    // handed in out of order on purpose: the lines come back in time order
    expect(texts(historyOf(task(), about, people, ME, TODAY))).toEqual([
      "You typed it.",
      "Due set for Fri 25 Sept.",
      "Due moved to Fri 2 Oct by Luke.",
      "Due date taken off.",
    ]);
  });

  it("says who a hand-over went to, and who it started with", () => {
    const about = typedAbout([
      event({ kind: "created", at: "2026-09-18T03:42:00Z", to: LUKE }),
      event({ kind: "given", at: "2026-09-21T03:42:00Z", from: LUKE, to: LEO }),
    ]);
    const t = task({ assigneeId: LEO });
    expect(texts(historyOf(t, about, people, ME, TODAY))).toEqual([
      "You typed it.",
      "You gave it to Luke.",
      "Given to Leo.",
    ]);
    expect(texts(historyOf(t, about, people, LEO, TODAY)).at(-1)).toBe("Given to you.");
  });

  it("knows the first holder from the first hand-over when the task predates `created`", () => {
    const about = typedAbout([event({ kind: "given", at: "2026-09-21T03:42:00Z", from: LUKE, to: LEO })]);
    expect(texts(historyOf(task({ assigneeId: LEO }), about, people, ME, TODAY))).toEqual([
      "You typed it.",
      "You gave it to Luke.",
      "Given to Leo.",
    ]);
  });

  it("says a hand-over went to someone who has left when their card is gone", () => {
    const about = typedAbout([event({ kind: "given", at: "2026-09-21T03:42:00Z", from: ME, to: null })]);
    expect(texts(historyOf(task({ assigneeId: LEO }), about, people, ME, TODAY)).at(-1)).toBe(
      "Given to someone who has left.",
    );
  });

  it("logs every completion and reopening", () => {
    const about = typedAbout([
      event({ kind: "done", at: "2026-09-20T03:42:00Z", by: LUKE }),
      event({ kind: "reopened", at: "2026-09-21T03:42:00Z" }),
      event({ kind: "done", at: "2026-09-22T03:42:00Z" }),
    ]);
    const t = task({ status: "done", doneAt: "2026-09-22T03:42:00Z", doneById: ME });
    expect(texts(historyOf(t, about, people, ME, TODAY))).toEqual([
      "You typed it.",
      "Done. Luke ticked it off.",
      "Not done yet. Back on the list.",
      "Done. You ticked it off.",
    ]);
  });

  it("derives Done from the row only when no logged completion follows the last reopening", () => {
    const done = task({ status: "done", doneAt: "2026-09-22T03:42:00Z", doneById: LUKE });
    // finished before task_events existed: the row is the only witness
    expect(texts(historyOf(done, typedAbout(), people, ME, TODAY))).toEqual([
      "You typed it.",
      "Done. Luke ticked it off.",
    ]);
    // reopened and finished again with the second completion unlogged
    const after = typedAbout([
      event({ kind: "done", at: "2026-09-20T03:42:00Z", by: LUKE }),
      event({ kind: "reopened", at: "2026-09-21T03:42:00Z" }),
    ]);
    expect(texts(historyOf(done, after, people, ME, TODAY))).toEqual([
      "You typed it.",
      "Done. Luke ticked it off.",
      "Not done yet. Back on the list.",
      "Done. Luke ticked it off.",
    ]);
    // an open task has no Done line, whatever its events said
    expect(texts(historyOf(task(), after, people, ME, TODAY))).not.toContain("Done.");
  });
});

describe("powersOf", () => {
  const theirs = task({ assigneeId: LUKE, createdBy: ME });

  it("lets the assignee or a manager finish it, and never the creator alone", () => {
    expect(powersOf(theirs, LUKE, false).finish).toBe(true);
    expect(powersOf(theirs, ME, false).finish).toBe(false);
    expect(powersOf(theirs, LEO, true).finish).toBe(true);
  });

  it("lets the assignee, the creator or a manager move an open one", () => {
    expect(powersOf(theirs, LUKE, false).move).toBe(true);
    expect(powersOf(theirs, ME, false).move).toBe(true);
    expect(powersOf(theirs, LEO, false).move).toBe(false);
    expect(powersOf({ ...theirs, status: "done" }, LUKE, true).move).toBe(false);
  });

  it("lets only a manager give an open one away", () => {
    expect(powersOf(theirs, ME, false).give).toBe(false);
    expect(powersOf(theirs, LUKE, false).give).toBe(false);
    expect(powersOf(theirs, LEO, true).give).toBe(true);
    expect(powersOf({ ...theirs, status: "done" }, LEO, true).give).toBe(false);
  });

  it("lets the creator or a manager delete it", () => {
    expect(powersOf(theirs, ME, false).remove).toBe(true);
    expect(powersOf(theirs, LUKE, false).remove).toBe(false);
    expect(powersOf(theirs, LUKE, true).remove).toBe(true);
  });

  it("never reads an ownerless task as yours when you have no staff card", () => {
    expect(powersOf(task({ createdBy: null }), null, false)).toEqual({
      finish: false,
      move: false,
      give: false,
      remove: false,
    });
  });
});

describe("moments and labels", () => {
  it("reads a timestamp on the AU anchor", () => {
    expect(momentOf("2026-09-21T03:42:00Z")).toEqual({ day: "2026-09-21", time: "1:42 pm" });
    // 23:30Z is half past nine the NEXT morning in the yard
    expect(momentOf("2026-09-20T23:30:00Z")).toEqual({ day: "2026-09-21", time: "9:30 am" });
    expect(momentOf("not a date")).toBeNull();
  });

  it("reads ServiceM8's stamp as written, and its empty date as none", () => {
    expect(sm8Moment("2026-09-21 13:42:10")).toEqual({ day: "2026-09-21", time: "1:42 pm" });
    expect(sm8Moment("2026-09-21")).toEqual({ day: "2026-09-21", time: null });
    expect(sm8Moment("0000-00-00 00:00:00")).toBeNull();
    expect(sm8Moment(null)).toBeNull();
  });

  it("writes a clock with its minutes", () => {
    expect(clock12(0)).toBe("12:00 am");
    expect(clock12(16 * 60)).toBe("4:00 pm");
    expect(clock12(12 * 60 + 5)).toBe("12:05 pm");
  });

  it("names a job by its number and its suburb", () => {
    expect(jobLabelOf("2041", "Wollstonecraft")).toBe("2041 Wollstonecraft");
    expect(jobLabelOf("2041", null)).toBe("Job 2041");
    expect(jobLabelOf(null, "Wollstonecraft")).toBe("Wollstonecraft");
    expect(jobLabelOf(" ", "")).toBeNull();
  });
});
