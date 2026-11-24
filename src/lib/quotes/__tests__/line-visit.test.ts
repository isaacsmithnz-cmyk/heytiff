import { keepPeoplesTasks, systemRowWords, visitDays, visitName, visitOf, visitSummary, withHours, withoutTask, withTask, type LineVisit } from "../line-visit";

/* A labour line's tasks (slice 8.2): the visit Tiff worked out, kept on the
   line for a person to change, and what they change kept when she works it
   out again. */

const t = (task: string, hours: number) => ({ task, hours, was: null, byHand: false });
const rough: LineVisit = { stage: "Rough-in", people: 2, dayHours: 8, tasks: [t("Travel and setup", 5), t("Sandstone core hole", 4), t("Drains", 3)] };

it("makes a visit safe: quarter hours, a crew of 1 to 12, no task without hours", () => {
  expect(visitOf({ ...rough, tasks: [t("Core", 0.33), t("", 2), t("Nothing", 0)] })).toEqual({ ...rough, tasks: [t("Core", 0.25)] });
  expect(visitOf({ ...rough, people: 0 })).toBeNull();
  expect(visitOf({ ...rough, tasks: [] })).toBeNull();
  expect(visitOf({ ...rough, dayHours: 0 })!.dayHours).toBeNull();
});

it("names the crew and its days, to the half day", () => {
  expect(visitDays(rough)).toBe(1);
  expect(visitName(rough)).toBe("Rough-in: 2 people, 1 day");
  expect(visitName({ ...rough, tasks: [t("Drains", 3)] })).toBe("Rough-in: 2 people, half a day");
  expect(visitSummary({ ...rough, tasks: [t("All of it", 57)] })).toBe("57 h, 2 people for 3.5 days");
  expect(visitName({ ...rough, dayHours: null })).toBe("Rough-in: 2 people");
  expect(visitSummary({ ...rough, dayHours: null })).toBe("12 h, 2 people");
});

it("an hour a person changes keeps what Tiff had, the first time only", () => {
  const once = withHours(rough, 1, 6);
  expect(once.tasks[1]).toEqual({ task: "Sandstone core hole", hours: 6, was: 4, byHand: true });
  expect(withHours(once, 1, 7).tasks[1]).toEqual({ task: "Sandstone core hole", hours: 7, was: 4, byHand: true });
  expect(withHours(rough, 0, 5)).toEqual(rough);
});

it("a task added is the person's; a task taken off is gone", () => {
  expect(withTask(rough, "Scaffold", 3).tasks.at(-1)).toEqual({ task: "Scaffold", hours: 3, was: null, byHand: true });
  expect(withoutTask(rough, 0).tasks.map((x) => x.task)).toEqual(["Sandstone core hole", "Drains"]);
});

it("worked out again, a person's hours and added tasks stay", () => {
  const theirs = withTask(withHours(rough, 1, 6), "Scaffold", 3);
  const again: LineVisit[] = [
    { ...rough, tasks: [t("Travel and setup", 5), t("Sandstone core hole", 5), t("Drains", 3)] },
    { stage: "Install", people: 2, dayHours: 8, tasks: [t("Commission", 3)] },
  ];
  const kept = keepPeoplesTasks(again, [theirs]);
  expect(kept[0]!.tasks).toEqual([t("Travel and setup", 5), { task: "Sandstone core hole", hours: 6, was: 5, byHand: true }, t("Drains", 3), { task: "Scaffold", hours: 3, was: null, byHand: true }]);
  expect(kept[1]).toEqual(again[1]);
  /* a stage that's gone: its added task goes to the first visit */
  expect(keepPeoplesTasks([again[1]!], [theirs])[0]!.tasks.map((x) => x.task)).toEqual(["Commission", "Scaffold"]);
});

/* bug 80, Luke, 24 November 2026, on 3594: the tasks Tiff priced the job
   on sat shut in a row named "Quote", after System 1 and System 2 */
describe("the row with no system, named for what it holds", () => {
  const task = (t: string, hours: number) => ({ task: t, hours, was: null, byHand: false });
  const visit = (n: number) => ({ stage: "Install", people: 2, dayHours: 8, tasks: Array.from({ length: n }, (_, i) => task(`Task ${i + 1}`, 2)) });
  const labour = (qty: number, n: number) => ({ kind: "labour", group: "Labour", qty, visit: visit(n) });
  const unit = { kind: "unit", group: "Units", qty: 2 };

  it("is Labour, its hours and its tasks under it", () => {
    expect(systemRowWords("", [labour(100, 30), labour(19, 4)], true)).toEqual({ name: "Labour", under: "119 hours, 34 tasks" });
    expect(systemRowWords("", [labour(1, 1)], false)).toEqual({ name: "Labour", under: "1 hour, 1 task" });
    expect(systemRowWords("", [{ kind: "labour", group: "Labour", qty: 8 }], true)).toEqual({ name: "Labour", under: "8 hours" });
  });

  it("is the whole job's with more than labour beside systems, the quote's with none", () => {
    expect(systemRowWords("", [labour(10, 3), { kind: "material", group: "Sundries", qty: 1 }], true)).toEqual({ name: "Whole job", under: "Labour, 10 hours, 3 tasks, Sundries" });
    expect(systemRowWords("", [unit, labour(10, 3)], false)).toEqual({ name: "Quote", under: "Units, Labour, 10 hours, 3 tasks" });
  });

  it("keeps a system's own name", () => {
    expect(systemRowWords("System 1", [unit, labour(4, 2)], true)).toEqual({ name: "System 1", under: "Units, Labour, 4 hours, 2 tasks" });
  });
});
