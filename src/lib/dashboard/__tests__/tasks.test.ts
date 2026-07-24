import {
  dueLabel,
  noticeReadState,
  sortNotices,
  sortTasks,
  unreadCount,
  type DashTask,
  type NoticeWithRead,
} from "../tasks";

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

describe("noticeReadState", () => {
  it("is unread when never acknowledged", () => {
    expect(noticeReadState(1, null)).toBe("unread");
  });

  it("is read when the acked revision matches", () => {
    expect(noticeReadState(1, 1)).toBe("read");
    expect(noticeReadState(3, 3)).toBe("read");
  });

  it("is stale when they only acked an earlier wording", () => {
    expect(noticeReadState(2, 1)).toBe("stale");
    expect(noticeReadState(5, 2)).toBe("stale");
  });

  it("treats an ack ahead of the revision as read, never stale", () => {
    // shouldn't happen, but a stale-looking ack must never be invented
    expect(noticeReadState(1, 2)).toBe("read");
  });
});

describe("unreadCount", () => {
  const notice = (
    id: string,
    over: Partial<NoticeWithRead> = {},
  ): NoticeWithRead => ({
    id,
    title: id,
    body: null,
    pinned: false,
    postedById: null,
    postedByName: null,
    createdAt: "2026-07-01T00:00:00Z",
    revision: 1,
    editedAt: null,
    ackedRevision: null,
    state: "unread",
    mine: false,
    readBy: 0,
    audience: 0,
    ...over,
  });

  it("counts notices never read", () => {
    expect(unreadCount([notice("a", { state: "read" }), notice("b"), notice("c")])).toBe(2);
    expect(unreadCount([])).toBe(0);
  });

  it("counts a stale ack as still wanting attention", () => {
    expect(unreadCount([notice("a", { state: "stale", ackedRevision: 1, revision: 2 })])).toBe(1);
  });

  it("never counts your own notices — you wrote them", () => {
    expect(unreadCount([notice("a", { mine: true }), notice("b", { mine: true, state: "stale" })])).toBe(0);
  });
});
