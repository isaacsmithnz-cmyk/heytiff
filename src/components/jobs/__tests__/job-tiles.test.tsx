import { render, screen, within } from "@testing-library/react";
import { JobTiles } from "../job-tiles";

/* The Overview's four tiles (Isaac, 22 October 2026). To do holds what's
   open on the job, an ask in a note, above its tasks, and counts both. */

const base = {
  what: "Supply and install a ducted system",
  next: null,
  onVisits: jest.fn(),
  tasks: [{ id: "t1", title: "Order the grille", line: "Luke, today", assigneeId: null }],
  tasksRead: true,
  onTick: jest.fn(),
};

const todo = () => within(screen.getByRole("region", { name: "To do" }));

it("puts what's open on the job at the head of To do and counts it with the tasks", () => {
  render(<JobTiles {...base} open={<p>Michael wants a bar grille</p>} openCount={1} />);
  expect(todo().getByText("Michael wants a bar grille")).toBeInTheDocument();
  expect(todo().getByText("Order the grille")).toBeInTheDocument();
  expect(todo().getByText("2")).toHaveClass("jt-count");
});

it("says there's nothing to do only when nothing is open and no task is", () => {
  const { unmount } = render(<JobTiles {...base} tasks={[]} open={<p>Michael wants a bar grille</p>} openCount={1} />);
  expect(todo().queryByText("Nothing to do on it.")).toBeNull();
  unmount();
  render(<JobTiles {...base} tasks={[]} />);
  expect(todo().getByText("Nothing to do on it.")).toBeInTheDocument();
  expect(todo().queryByText(/^\d+$/)).toBeNull();
});
