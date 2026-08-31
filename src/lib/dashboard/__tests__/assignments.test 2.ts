import {
  assignmentLine,
  assignmentsNotAlreadyDue,
  type NewAssignment,
} from "@/lib/dashboard/assignments";

const day = (iso: string) => `on ${iso}`;

const a = (over: Partial<NewAssignment> = {}): NewAssignment => ({
  taskId: "t-1",
  title: "Order the return air box",
  detail: null,
  fromName: "Luke Ingold",
  dueDate: "2026-09-04",
  createdAt: "2026-08-28T09:00:00.000Z",
  ...over,
});

describe("assignmentLine", () => {
  it("names who gave it to you and when it is wanted", () => {
    expect(assignmentLine(a(), day)).toBe("From Luke Ingold · Due on 2026-09-04");
  });

  it("reads correctly with no due date — an ordinary task, not a broken one", () => {
    expect(assignmentLine(a({ dueDate: null }), day)).toBe("From Luke Ingold");
  });

  it("falls back to the date alone when the giver can't be named", () => {
    /* Their staff card has gone, or was never readable. The work is real
       either way, so the row keeps whatever it does know. */
    expect(assignmentLine(a({ fromName: null }), day)).toBe("Due on 2026-09-04");
  });

  it("says NOTHING when it knows neither — the heading already said it", () => {
    /* "Assigned to you" under a group headed "Somebody gave you this" is the
       same sentence twice, which is a design bug wearing a caption. */
    expect(assignmentLine(a({ fromName: null, dueDate: null }), day)).toBeNull();
  });
});

describe("assignmentsNotAlreadyDue", () => {
  it("drops one whose own reminder has already come due", () => {
    /* Somebody gave it to you this morning and set a nudge for lunchtime.
       One job, one row — two would be the badge counting it twice. */
    expect(assignmentsNotAlreadyDue([a({ taskId: "t-1" })], ["t-1"])).toEqual([]);
  });

  it("keeps the ones nothing else is showing", () => {
    const kept = assignmentsNotAlreadyDue([a({ taskId: "t-1" }), a({ taskId: "t-2" })], ["t-2"]);
    expect(kept.map((x) => x.taskId)).toEqual(["t-1"]);
  });

  it("is a no-op with no reminders at all", () => {
    const all = [a({ taskId: "t-1" }), a({ taskId: "t-2" })];
    expect(assignmentsNotAlreadyDue(all, [])).toHaveLength(2);
  });
});
