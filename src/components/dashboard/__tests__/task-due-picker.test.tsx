import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TasksSection } from "../tasks-section";

const createTask = jest.fn(async () => ({ ok: true as const }));

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("@/app/actions/dashboard", () => ({
  completeTask: jest.fn(),
  createTask: (...a: unknown[]) => createTask(...(a as [])),
  reopenTask: jest.fn(),
}));

/* A due date is optional here, which is the interesting bit: the picker has to
   be able to say "none" as clearly as it says a date, and what reaches the
   action is ISO either way. */

const TODAY = "2026-07-25";

function setup() {
  render(
    <TasksSection
      today={TODAY}
      mine={[]}
      team={[]}
      done={[]}
      reported={[]}
      viewerStaffId="s1"
      canManage
      assignable={[{ id: "s2", name: "Jordan Mills" }]}
    />,
  );
  return userEvent.setup();
}

const due = () => screen.getByLabelText("Due (optional)");

it("assigns with an ISO due date picked off the calendar", async () => {
  const user = setup();
  await user.click(screen.getByRole("button", { name: /assign a task/i }));
  await user.type(screen.getByPlaceholderText(/Renew the WHS induction/), "Service the ute");

  expect(document.querySelectorAll('input[type="date"]')).toHaveLength(0);
  expect(due()).toHaveTextContent("No date");

  await user.click(due());
  await user.click(screen.getByRole("button", { name: "Next month" }));
  await user.click(screen.getByRole("button", { name: "Thursday 6 August 2026" }));
  expect(due()).toHaveTextContent("06/08/2026");

  await user.click(screen.getByRole("button", { name: /^assign$/i }));
  expect(createTask).toHaveBeenCalledWith({
    assignedTo: "s2",
    title: "Service the ute",
    detail: undefined,
    dueDate: "2026-08-06",
  });
});

it("leaves the due date out entirely when it is cleared", async () => {
  const user = setup();
  await user.click(screen.getByRole("button", { name: /assign a task/i }));
  await user.type(screen.getByPlaceholderText(/Renew the WHS induction/), "Tidy the yard");

  await user.click(due());
  await user.click(screen.getByRole("button", { name: "Today" }));
  await user.click(due());
  await user.click(screen.getByRole("button", { name: "Clear" }));
  expect(due()).toHaveTextContent("No date");

  await user.click(screen.getByRole("button", { name: /^assign$/i }));
  expect(createTask).toHaveBeenLastCalledWith(
    expect.objectContaining({ title: "Tidy the yard", dueDate: undefined }),
  );
});
