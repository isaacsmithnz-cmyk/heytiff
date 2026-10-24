import { act, render } from "@testing-library/react";
import { sayTasksChanged, useTasksChanged } from "../changed";

/* A task made from New on a job's page never reached the job's own To do
   until a reload (Isaac's walk, 25 October 2026): the form says so, and the
   job's Overview listens. */
function Listener({ read }: { read: () => void }) {
  useTasksChanged(read);
  return null;
}

it("tells whoever listens that a task changed, and stops when they go", () => {
  const read = jest.fn();
  const { unmount } = render(<Listener read={read} />);
  act(() => sayTasksChanged());
  expect(read).toHaveBeenCalledTimes(1);
  unmount();
  act(() => sayTasksChanged());
  expect(read).toHaveBeenCalledTimes(1);
});
