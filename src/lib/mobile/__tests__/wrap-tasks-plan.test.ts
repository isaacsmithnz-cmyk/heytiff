import { everyTask, fromQuote, tasksToTick, visitDays, visitOn, type WrapTask } from "../wrap-tasks-plan";

/* 2845, 7 Cutler Rd: the quote's tasks by visit, and how far it is by quoted hours. */
const t = (id: string, stage: WrapTask["stage"], visit: number | null, hours: number | null, progress = 0): WrapTask => ({ id, name: id, stage, visit, hours, progress });
const TASKS = [
  t("pen", "Rough-in", 1, 10),
  t("pipe", "Rough-in", 1, 20),
  t("drain", "Rough-in", 2, 30),
  t("hang", "Install", 3, 40),
  t("units", "Install", null, null),
];

it("counts the visit by the days booked up to it", () => {
  expect(visitOn(["2026-11-03 07:00:00", "2026-11-03 07:00:00", "2026-11-04 07:00:00", "2026-11-09 07:00:00"], "2026-11-04")).toBe(2);
  expect(visitOn([], "2026-11-04")).toBeNull();
});

it("ticks the visit's own and what's left from before", () => {
  const done1 = TASKS.map((x) => (x.id === "pen" ? { ...x, progress: 100 } : x));
  expect(tasksToTick(done1, 2).map((x) => x.id)).toEqual(["pipe", "drain"]);
});

it("with no visit, ticks the first stage not finished", () => {
  expect(tasksToTick(TASKS, null).map((x) => x.id)).toEqual(["pen", "pipe", "drain"]);
});

it("says how far by quoted hours, the stage and the job", () => {
  const some = TASKS.map((x) => (x.id === "pen" ? { ...x, progress: 100 } : x.id === "pipe" ? { ...x, progress: 50 } : x));
  expect(fromQuote(some, 2, tasksToTick(some, 2))).toEqual({ stage: "Rough-in", stageDone: 20, stageQuoted: 60, jobDone: 20, jobQuoted: 100, visit: 2, visits: 3 });
  expect(fromQuote([t("x", "Install", 1, null)], 1, [])).toBeNull();
});

describe("every task, by day (the job card's All)", () => {
  it("lists day 1's, then day 2's, a task on no day last, each day as the job lists it", () => {
    const tasks = [t("b", "Install", 2, null), t("x", "Install", null, null), t("a", "Install", 1, null), t("c", "Fit-off", 2, null)];
    expect(everyTask(tasks).map((x) => x.id)).toEqual(["a", "b", "c", "x"]);
  });

  it("names each visit's day once, visit 1 first", () => {
    expect(visitDays(["2026-11-17", "2026-11-16", "2026-11-16", "2026-11-18T07:00"])).toEqual(["2026-11-16", "2026-11-17", "2026-11-18"]);
  });
});
