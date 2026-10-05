import { placeTasks, taskRows, visitOfDay, visitSlots, type JobTask, type TaskUpdate } from "../visit-tasks";

/* Isaac, 2026-10-06: "tasks can move across visits as they are not
   completed on that day" — 2905's rough-in, 50% on visit 1, 70% on visit 2,
   on visit 3 today */

const task = (id: string, name: string, over: Partial<JobTask> = {}): JobTask => ({
  id,
  name,
  stage: "Rough-in",
  kind: "tick",
  unit: null,
  visit: 1,
  sort: 0,
  progress: 0,
  serial: null,
  modelRead: null,
  source: "quote",
  ...over,
});
const up = (taskId: string, day: string, from: number, to: number, note = "", by = "Callum Vrieze"): TaskUpdate => ({
  id: `${taskId}-${day}`,
  taskId,
  day,
  from,
  to,
  note,
  by,
  at: `${day}T15:00:00Z`,
});
const slotsOn = (today: string, planned = 4) =>
  visitSlots({
    /* the days worked so far, and the days booked from today on */
    days: [...["2026-05-26", "2026-10-06", "2026-10-07"].filter((d) => d <= today), ...["2026-10-08", "2026-10-12"].filter((d) => d >= today)],
    today,
    from: "2026-09-29 00:00:00",
    planned,
  });

describe("the visits", () => {
  it("counts days on site from the work order, then the booked days, then the quote's visits not booked yet", () => {
    const slots = slotsOn("2026-10-08", 6);
    expect(slots.map((s) => [s.n, s.day, s.state])).toEqual([
      [1, "2026-10-06", "done"],
      [2, "2026-10-07", "done"],
      [3, "2026-10-08", "today"],
      [4, "2026-10-12", "booked"],
      [5, null, "planned"],
      [6, null, "planned"],
    ]);
  });

  it("puts a day's work on the visit that day, or the last one before it", () => {
    const slots = slotsOn("2026-10-08");
    expect(visitOfDay(slots, "2026-10-07")).toBe(2);
    expect(visitOfDay(slots, "2026-10-09")).toBe(3);
    expect(visitOfDay(slots, "2026-10-01")).toBeNull();
  });
});

describe("a task carried across visits", () => {
  const rough = task("rough", "Rough-in pipe and cable", { kind: "progress", progress: 70 });
  const ups = [up("rough", "2026-10-06", 0, 50, "Roughed in to the third indoor unit."), up("rough", "2026-10-07", 50, 70, "Level 3 risers in.", "Alex Morozoff")];

  it("shows what each visit did, and where it went next", () => {
    const { visits } = placeTasks([rough], ups, slotsOn("2026-10-08"));
    const line = (n: number) => visits.find((v) => v.slot.n === n)!.lines[0];
    expect(line(1)).toMatchObject({ mark: "part", pctWords: "50%", meta: "Carried to visit 2", note: { by: "Callum Vrieze", text: "Roughed in to the third indoor unit." } });
    expect(line(2)).toMatchObject({ pctWords: "70%", meta: "Up 20% from visit 1, carried to visit 3", note: { by: "Alex Morozoff" } });
    expect(line(3)).toMatchObject({ mark: "part", pctWords: "70%", meta: "From visit 2", note: null });
    expect(visits.find((v) => v.slot.n === 4)!.lines).toEqual([]);
  });

  it("stays on today's visit once it's been worked on today", () => {
    const { visits } = placeTasks([{ ...rough, progress: 85 }], [...ups, up("rough", "2026-10-08", 70, 85)], slotsOn("2026-10-08"));
    const today = visits.find((v) => v.slot.n === 3)!.lines;
    expect(today).toHaveLength(1);
    expect(today[0]).toMatchObject({ pctWords: "85%", meta: "Up 15% from visit 2" });
  });

  it("a tick taken back the same visit leaves no trail", () => {
    const hang = task("hang", "Hang the Bedroom 3 unit", { visit: 4 });
    const ups = [up("hang", "2026-10-08", 0, 100), up("hang", "2026-10-08", 100, 0)];
    const { visits } = placeTasks([hang], ups, slotsOn("2026-10-08"));
    expect(visits.find((v) => v.slot.n === 3)!.lines).toEqual([]);
    expect(visits.find((v) => v.slot.n === 4)!.lines[0]).toMatchObject({ mark: "open", meta: null });
    expect(taskRows([hang], ups, slotsOn("2026-10-08"), (d) => d)[0]!.rows[0]!.visits).toBe("Visit 4");
  });

  it("a task finished on a visit is ticked on that visit's card and nowhere after", () => {
    const done = task("pen", "Garage penetrations", { progress: 100 });
    const { visits, unplaced } = placeTasks([done], [up("pen", "2026-10-06", 0, 100)], slotsOn("2026-10-08"));
    expect(visits[0]!.lines[0]).toMatchObject({ mark: "done", meta: null });
    expect(visits.slice(1).every((v) => v.lines.length === 0)).toBe(true);
    expect(unplaced).toEqual([]);
  });

  it("a task its visit passed without touching carries to the first visit to come", () => {
    const drains = task("drains", "Drains for Level 3", { visit: 2 });
    const { visits } = placeTasks([drains], [], slotsOn("2026-10-08"));
    expect(visits.find((v) => v.slot.n === 3)!.lines[0]).toMatchObject({ mark: "open", meta: "From visit 2" });
    expect(visits.find((v) => v.slot.n === 2)!.lines).toEqual([]);
  });

  it("a task planned for a visit not booked yet waits on that visit; one on no visit waits underneath", () => {
    const later = task("comm", "Commission the system", { visit: 6, stage: "Commissioning" });
    const loose = task("warranty", "Register the warranty", { visit: null });
    const { visits, unplaced } = placeTasks([later, loose], [], slotsOn("2026-10-08", 6));
    expect(visits.find((v) => v.slot.n === 6)!.lines.map((l) => l.task.id)).toEqual(["comm"]);
    expect(unplaced.map((l) => l.task.id)).toEqual(["warranty"]);
  });

  it("with no visit left to come, a carried task waits underneath, saying where from", () => {
    const { unplaced } = placeTasks([rough], ups, slotsOn("2026-10-13", 0).filter((s) => s.state === "done"));
    expect(unplaced[0]).toMatchObject({ meta: "From visit 2" });
  });
});

describe("the whole list", () => {
  it("groups by the quote's stages and says which visits each is on and where it stands", () => {
    const tasks = [
      task("rough", "Rough-in pipe and cable", { kind: "progress", progress: 70, sort: 1 }),
      task("pen", "Garage penetrations", { progress: 100, sort: 0 }),
      task("hang", "Hang the Level 2 Bedroom 3 unit", { stage: "Install", kind: "unit", visit: 3, sort: 2 }),
      task("grille", "Kitchen grille", { stage: "Install", visit: 4, sort: 3 }),
      task("comm", "Commission", { stage: "Commissioning", visit: null, sort: 4 }),
    ];
    const ups = [up("pen", "2026-10-06", 0, 100), up("rough", "2026-10-06", 0, 50), up("rough", "2026-10-07", 50, 70, "Level 3 risers in.")];
    const groups = taskRows(tasks, ups, slotsOn("2026-10-08"), (d) => (d === "2026-10-12" ? "Mon 12 Oct" : d));
    expect(groups.map((g) => g.stage)).toEqual(["Rough-in", "Install", "Commissioning"]);
    expect(groups[0]!.rows.map((r) => [r.task.id, r.visits, r.status])).toEqual([
      ["pen", "Visit 1", { text: "Done", tone: "ok" }],
      ["rough", "Visits 1, 2 and 3", { text: "70%", tone: "ink" }],
    ]);
    expect(groups[1]!.rows.map((r) => [r.visits, r.status?.text])).toEqual([
      ["Visit 3", "Today"],
      ["Visit 4", "Mon 12 Oct"],
    ]);
    expect(groups[2]!.rows[0]).toMatchObject({ visits: null, status: null });
  });

});
