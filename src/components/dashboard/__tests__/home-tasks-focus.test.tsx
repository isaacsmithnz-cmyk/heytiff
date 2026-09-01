import { act, render, screen } from "@testing-library/react";
import { HomeTasks } from "../home-tasks";
import type { DashTask } from "@/lib/dashboard/tasks";

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("@/app/actions/dashboard", () => ({
  completeTask: jest.fn(),
  createTask: jest.fn(),
  reopenTask: jest.fn(),
  deleteTask: jest.fn(),
}));

/* Arriving from a journal chip. The tab has just changed under the reader, so
   the row has to say "this one" — and then stop saying it, and hand the focus
   back, or pressing the same chip twice would do nothing the second time. */

const task = (over: Partial<DashTask> = {}): DashTask => ({
  id: "t1",
  title: "Order 2× MERV 11 filters",
  detail: null,
  assigneeId: "s1",
  assigneeName: "Isaac Smith",
  dueDate: null,
  status: "open",
  createdBy: "s1",
  createdAt: "2026-08-10T00:00:00Z",
  doneAt: null,
  doneByName: null,
  remindAt: null,
  remindKind: "at" as const,
  ...over,
});

function renderTasks(over: Partial<Parameters<typeof HomeTasks>[0]> = {}) {
  return render(
    <HomeTasks
      today="2026-08-12"
      mine={[task(), task({ id: "t2", title: "Book the tail lift service" })]}
      team={null}
      done={[]}
      reported={[]}
      viewerStaffId="s1"
      canManage={false}
      assignable={[]}
      {...over}
    />,
  );
}

const rowFor = (id: string) => document.querySelector(`[data-task-id="${id}"]`);

beforeEach(() => jest.useFakeTimers({ advanceTimers: true }));
afterEach(() => jest.useRealTimers());

it("every row can be found by the id a chip would name", () => {
  renderTasks({ done: [task({ id: "t3", status: "done", doneAt: "2026-08-11T02:00:00Z" })] });
  expect(rowFor("t1")).toBeInTheDocument();
  expect(rowFor("t2")).toBeInTheDocument();
  // recently-done rows too: a debrief's task may already be ticked off
  expect(rowFor("t3")).toBeInTheDocument();
});

it("marks the named row, then releases it and hands the focus back", () => {
  const onFocusHandled = jest.fn();
  renderTasks({ focusTaskId: "t2", onFocusHandled });

  expect(rowFor("t2")).toHaveClass("hm-tkfl");
  expect(rowFor("t1")).not.toHaveClass("hm-tkfl");
  expect(onFocusHandled).not.toHaveBeenCalled();

  act(() => void jest.advanceTimersByTime(2000));
  expect(rowFor("t2")).not.toHaveClass("hm-tkfl");
  expect(onFocusHandled).toHaveBeenCalledTimes(1);
});

/* The mark is derived from `focusTaskId` rather than stored, so the thing that
   can go wrong is the component remembering a spent id and refusing to mark it
   twice. Pressing the same chip again is the whole reason `onFocusHandled`
   exists, so it is worth a test of its own. */
it("marks the row again when the same chip is pressed a second time", () => {
  const onFocusHandled = jest.fn();
  const at = (focusTaskId: string | null) => (
    <HomeTasks
      today="2026-08-12"
      mine={[task(), task({ id: "t2", title: "Book the tail lift service" })]}
      team={null}
      done={[]}
      reported={[]}
      viewerStaffId="s1"
      canManage={false}
      assignable={[]}
      focusTaskId={focusTaskId}
      onFocusHandled={onFocusHandled}
    />
  );

  const { rerender } = render(at("t2"));
  expect(rowFor("t2")).toHaveClass("hm-tkfl");

  act(() => void jest.advanceTimersByTime(2000));
  expect(rowFor("t2")).not.toHaveClass("hm-tkfl");
  expect(onFocusHandled).toHaveBeenCalledTimes(1);

  // the parent hands the id back as null, then the reader presses it again
  rerender(at(null));
  rerender(at("t2"));
  expect(rowFor("t2")).toHaveClass("hm-tkfl");
});

it("marks nothing when no chip sent us here", () => {
  renderTasks();
  expect(document.querySelectorAll(".hm-tkfl")).toHaveLength(0);
});

it("still switches cleanly when the task isn't on any lane", () => {
  // someone else's task, or one older than the done window: the tab change is
  // the whole journey, and nothing here may throw looking for the row
  const onFocusHandled = jest.fn();
  expect(() => renderTasks({ focusTaskId: "gone", onFocusHandled })).not.toThrow();
  expect(screen.getByText("Order 2× MERV 11 filters")).toBeInTheDocument();
  act(() => void jest.advanceTimersByTime(2000));
  expect(onFocusHandled).toHaveBeenCalledTimes(1);
});
