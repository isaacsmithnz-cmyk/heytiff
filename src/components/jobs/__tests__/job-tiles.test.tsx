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

/* 25 October 2026, walking job 3440 from the Schedule: Next visit said
   "Nothing booked" while it read, then "Tomorrow, 7:30 am" */
it("says it is reading the visits until they are read, and offers Book a visit only once it knows there is none", () => {
  const onBook = jest.fn();
  const visit = () => within(screen.getByRole("region", { name: "Next visit" }));
  const { unmount } = render(<JobTiles {...base} nextRead={false} onBook={onBook} />);
  expect(visit().getByText("Reading the visits")).toBeInTheDocument();
  expect(visit().queryByText("Nothing booked")).toBeNull();
  expect(visit().queryByRole("button", { name: "Book a visit" })).toBeNull();
  unmount();
  render(<JobTiles {...base} nextRead onBook={onBook} />);
  expect(visit().getByText("Nothing booked")).toBeInTheDocument();
  expect(visit().getByRole("button", { name: "Book a visit" })).toBeInTheDocument();
});
