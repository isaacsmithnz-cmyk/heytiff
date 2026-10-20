import { andList, clock, todayRows, todaySummary, type TodayRow } from "../home-today";
import { todayView } from "../home-view";
import type { HomeRail } from "../page-data";
import type { ScheduleBlock } from "@/lib/workboard/schedule";
import type { RailTask } from "../day-rail";

/* HOME › TODAY: the viewer's own bookings and timed tasks, one row each, in
   time order (rule 39), read off the same rail the old day bar drew. */

const block = (over: Partial<ScheduleBlock> = {}): ScheduleBlock => ({
  key: "a1",
  remoteId: "j-2380",
  jobNumber: "2380",
  clientName: "Kingsford Bakery",
  suburb: "Kingsford",
  status: "Work Order",
  categoryName: "Service",
  categoryColour: "#22C55E",
  tracked: null,
  onSite: false,
  closure: "open",
  startMin: 7 * 60 + 30,
  endMin: 8 * 60 + 30,
  start: "2026-10-13 07:30:00",
  end: "2026-10-13 08:30:00",
  ...over,
});

const task = (over: Partial<RailTask> = {}): RailTask => ({
  id: "t1",
  title: "Order the grilles",
  atMin: 12 * 60 + 30,
  kind: "by",
  overdue: false,
  ...over,
});

const rail = (over: Partial<HomeRail> = {}): HomeRail => ({
  dayISO: "2026-10-13",
  tz: "Australia/Sydney",
  blocks: [],
  linked: true,
  linkHref: null,
  tasks: [],
  nowMin: 10 * 60 + 5,
  enabled: true,
  jobs: [],
  tracksTime: false,
  manage: false,
  moneyVisible: false,
  connected: true,
  where: {},
  crew: {},
  next: null,
  ...over,
});

describe("clock and lists", () => {
  it("says a time with no am or pm, as a day reads", () => {
    expect(clock(7 * 60 + 30)).toBe("7:30");
    expect(clock(12 * 60 + 45)).toBe("12:45");
    expect(clock(13 * 60 + 45)).toBe("1:45");
    expect(clock(0)).toBe("12:00");
  });
  it("joins names the way they are said", () => {
    expect(andList(["Lyle"])).toBe("Lyle");
    expect(andList(["Lyle", "Callum"])).toBe("Lyle and Callum");
    expect(andList(["Lyle", "Callum", "Dan"])).toBe("Lyle, Callum and Dan");
  });
});

describe("todayRows", () => {
  it("(F) draws a booking as the board does: its time, its colour, its name and job, its kind and who", () => {
    const [row] = todayRows(rail({ blocks: [block()] }));
    expect(row).toEqual<TodayRow>({
      key: "job:a1",
      kind: "job",
      time: "7:30 to 8:30",
      hue: "green",
      name: "Kingsford, Job 2380",
      line: "Service, you",
      state: { tone: "good", word: "Done" },
      href: "/dashboard/jobs/j-2380",
      taskId: null,
    });
  });

  it("(F) says who else is on it, On now while it runs, and nothing before it starts", () => {
    const rows = todayRows(
      rail({
        blocks: [
          block({ key: "a2", remoteId: "j-3342", jobNumber: "3342", suburb: "Bellevue Hill", categoryName: "Installation", categoryColour: "#2563EB", startMin: 9 * 60, endMin: 11 * 60 + 30 }),
          block({ key: "a3", remoteId: "j-3361", jobNumber: "3361", suburb: "Riverview", categoryName: "Quote", categoryColour: "#F97316", startMin: 12 * 60 + 45, endMin: 13 * 60 + 45 }),
        ],
        crew: { "j-3342": ["Lyle", "Callum"] },
      }),
    );
    expect(rows.map((r) => [r.time, r.name, r.line, r.hue, r.state?.word ?? null])).toEqual([
      ["9:00 to 11:30", "Bellevue Hill, Job 3342", "Installation, with Lyle and Callum", "blue", "On now"],
      ["12:45 to 1:45", "Riverview, Job 3361", "Quote, you", "orange", null],
    ]);
  });

  it("(F) leads a task with its moment and a tick, says Late once it has passed, and opens nothing", () => {
    const rows = todayRows(rail({ tasks: [task(), task({ id: "t2", title: "Ring Dan", atMin: 9 * 60, kind: "at", overdue: true })] }));
    expect(rows.map((r) => [r.time, r.kind, r.taskId, r.hue, r.href, r.state])).toEqual([
      ["9:00", "task", "t2", null, null, { tone: "wrong", word: "Late" }],
      ["By 12:30", "task", "t1", null, null, null],
    ]);
  });

  it("puts bookings and tasks in one time order", () => {
    const rows = todayRows(rail({ blocks: [block(), block({ key: "a9", startMin: 13 * 60, endMin: 14 * 60 })], tasks: [task()] }));
    expect(rows.map((r) => r.key)).toEqual(["job:a1", "task:t1", "job:a9"]);
  });

  it("reds an Unsuccessful job and marks a booking past a closed job", () => {
    const [bad] = todayRows(rail({ nowMin: 0, blocks: [block({ status: "Unsuccessful" })] }));
    expect(bad.hue).toBe("red");
    const [stale] = todayRows(rail({ nowMin: 0, blocks: [block({ closure: "stale" })] }));
    expect(stale.state).toEqual({ tone: "look", word: "Job closed" });
  });
});

describe("todaySummary", () => {
  it("(F) counts jobs, not bookings, and tasks", () => {
    const blocks = [block(), block({ key: "a2" }), block({ key: "a3", remoteId: "j-2" }), block({ key: "a4", remoteId: "j-3" }), block({ key: "a5", remoteId: "j-4" })];
    const rows = todayRows(rail({ blocks, tasks: [task()] }));
    expect(todaySummary(rows, blocks)).toBe("4 jobs and a task");
    expect(todaySummary(todayRows(rail({ tasks: [task(), task({ id: "t2" })] })), [])).toBe("2 tasks");
    expect(todaySummary([], [block()])).toBe("A job");
    expect(todaySummary([], [])).toBe("Nothing booked");
  });
});

describe("todayView's empty day", () => {
  it("says the next booked day when there is one", () => {
    const v = todayView(rail({ next: { dayISO: "2026-10-15", blocks: [], jobs: [], where: {}, crew: {} } }));
    expect(v.rows).toEqual([]);
    expect(v.empty).toEqual({ what: "Nothing booked for you today", line: "Next booked Thu 15 Oct", action: null });
    expect(v.schedule).toBe(true);
  });

  it("says ServiceM8 can't tell who you are, and offers the owner the fix", () => {
    expect(todayView(rail({ linked: false, linkHref: "/dashboard/admin/integrations/servicem8" })).empty).toMatchObject({
      action: { label: "Link yourself", href: "/dashboard/admin/integrations/servicem8" },
    });
    expect(todayView(rail({ linked: false })).empty.action).toBeNull();
  });

  it("offers no Schedule to someone without the Workboard", () => {
    expect(todayView(rail({ enabled: false })).schedule).toBe(false);
  });
});
