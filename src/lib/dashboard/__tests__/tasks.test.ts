import { dueLabel, sortNotices, sortTasks, unreadCount, type DashTask, type NoticeWithRead } from "../tasks";

const TODAY = "2026-07-20";

const task = (over: Partial<DashTask>): DashTask => ({
  id: "t1",
  title: "Do the thing",
  detail: null,
  assigneeId: "s1",
  assigneeName: "Jordan",
  dueDate: null,
  status: "open",
  createdBy: null,
  createdAt: "2026-07-01T00:00:00Z",
  ...over,
});

describe("dueLabel", () => {
  it("is null with no due date", () => {
    expect(dueLabel(null, TODAY)).toBeNull();
  });

  it("is bad and counts days when overdue", () => {
    expect(dueLabel("2026-07-16", TODAY)).toEqual({ label: "Overdue 4d", state: "bad" });
  });

  it("says due today", () => {
    expect(dueLabel(TODAY, TODAY)).toEqual({ label: "Due today", state: "warn" });
  });

  it("warns within the soon window", () => {
    expect(dueLabel("2026-07-27", TODAY)).toEqual({ label: "Due in 7d", state: "warn" });
  });

  it("is calm and dated beyond the window", () => {
    expect(dueLabel("2026-08-15", TODAY)).toEqual({ label: "Due 15 Aug", state: "ok" });
  });
});

describe("sortTasks", () => {
  it("puts dated tasks first (soonest, incl. overdue), undated last", () => {
    const sorted = sortTasks([
      task({ id: "none-old", dueDate: null, createdAt: "2026-07-01T00:00:00Z" }),
      task({ id: "later", dueDate: "2026-08-01" }),
      task({ id: "overdue", dueDate: "2026-07-10" }),
      task({ id: "none-new", dueDate: null, createdAt: "2026-07-05T00:00:00Z" }),
      task({ id: "soon", dueDate: "2026-07-21" }),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(["overdue", "soon", "later", "none-new", "none-old"]);
  });

  it("does not mutate its input", () => {
    const input = [task({ id: "a", dueDate: "2026-08-01" }), task({ id: "b", dueDate: "2026-07-01" })];
    const copy = [...input];
    sortTasks(input);
    expect(input).toEqual(copy);
  });
});

describe("sortNotices", () => {
  const n = (id: string, pinned: boolean, createdAt: string) => ({ id, pinned, createdAt });

  it("floats pinned notices, then orders each group newest-first", () => {
    const sorted = sortNotices([
      n("a", false, "2026-07-10T00:00:00Z"),
      n("b", true, "2026-07-01T00:00:00Z"),
      n("c", false, "2026-07-15T00:00:00Z"),
      n("d", true, "2026-07-05T00:00:00Z"),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["d", "b", "c", "a"]);
  });
});

describe("unreadCount", () => {
  const notice = (id: string, read: boolean): NoticeWithRead => ({
    id,
    title: id,
    body: null,
    pinned: false,
    postedByName: null,
    createdAt: "2026-07-01T00:00:00Z",
    read,
  });

  it("counts only unread notices", () => {
    expect(unreadCount([notice("a", true), notice("b", false), notice("c", false)])).toBe(2);
    expect(unreadCount([])).toBe(0);
  });
});
