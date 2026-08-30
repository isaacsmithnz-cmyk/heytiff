import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeTasks } from "../home-tasks";
import type { DashTask } from "@/lib/dashboard/tasks";

const deleteTask = jest.fn(async () => ({ ok: true as const }));

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("@/app/actions/dashboard", () => ({
  completeTask: jest.fn(),
  createTask: jest.fn(),
  reopenTask: jest.fn(),
  deleteTask: (...a: unknown[]) => deleteTask(...(a as [])),
}));

/* Deleting is the one task action with no undo — completing leaves a row to
   reopen, deleting leaves nothing — so the ✕ never fires the action: it swaps
   the row into a confirm. And it belongs to the CREATOR (or a manager), never
   the assignee alone: finishing your assignment is yours, erasing the record
   of its being assigned is not. */

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
  ...over,
});

function renderTasks(over: Partial<Parameters<typeof HomeTasks>[0]> = {}) {
  render(
    <HomeTasks
      today="2026-08-12"
      mine={[task()]}
      team={null}
      done={[]}
      reported={[]}
      viewerStaffId="s1"
      canManage={false}
      assignable={[]}
      {...over}
    />,
  );
  return userEvent.setup();
}

const delBtn = () => screen.queryByRole("button", { name: 'Delete "Order 2× MERV 11 filters"' });

beforeEach(() => deleteTask.mockClear());

it("the creator deletes in two steps — the ✕ only opens the confirm", async () => {
  const user = renderTasks();

  await user.click(delBtn()!);
  expect(screen.getByText("Delete for good?")).toBeInTheDocument();
  expect(deleteTask).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Delete" }));
  expect(deleteTask).toHaveBeenCalledWith("t1");
});

it("Keep backs out without deleting", async () => {
  const user = renderTasks();

  await user.click(delBtn()!);
  await user.click(screen.getByRole("button", { name: "Keep" }));

  expect(screen.queryByText("Delete for good?")).not.toBeInTheDocument();
  expect(delBtn()).toBeInTheDocument();
  expect(deleteTask).not.toHaveBeenCalled();
});

it("the assignee alone gets no delete control", () => {
  renderTasks({ mine: [task({ createdBy: "s2" })] });
  expect(delBtn()).not.toBeInTheDocument();
});

it("an ownerless task never reads as the viewer's own (null === null)", () => {
  renderTasks({ mine: [task({ createdBy: null })], viewerStaffId: null });
  expect(delBtn()).not.toBeInTheDocument();
});

it("a manager may delete anyone's, including in the team lane", async () => {
  const user = renderTasks({
    mine: [],
    team: [task({ assigneeId: "s2", assigneeName: "Jordan Mills", createdBy: "s1" })],
    viewerStaffId: "s9",
    canManage: true,
  });

  await user.click(delBtn()!);
  await user.click(screen.getByRole("button", { name: "Delete" }));
  expect(deleteTask).toHaveBeenCalledWith("t1");
});
