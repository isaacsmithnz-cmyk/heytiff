/* THE RAIL OF A JOB'S OVERVIEW (v2, step 6, the board JC-1): where it's
   up to, what's to do on the job, and its next visit. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JobRail } from "../job-rail";
import type { RailTask } from "@/lib/jobs/job-conversation";

const tasks: RailTask[] = [
  { id: "t1", title: "Order the grilles", line: "Lyle, today by 12:30 pm", assigneeId: "s-lyle" },
  { id: "t2", title: "Approve the isolator variation", line: "You", assigneeId: "s-isaac" },
];

const draw = (over: Partial<Parameters<typeof JobRail>[0]> = {}) =>
  render(
    <JobRail
      upTo="Day 1 of 1. Both heads in, outdoor on the slab. Commissioning Friday."
      upToOn="2026-10-13"
      upToPending={false}
      tasks={tasks}
      tasksRead
      onTick={jest.fn()}
      next={{ when: "Fri 16 Oct", who: "Lyle Irving", state: { word: "Time to confirm", tone: "look" } }}
      what="Two splits, bedroom and study"
      invoice={null}
      {...over}
    />,
  );

it("says where the job is up to", () => {
  draw();
  const group = screen.getByRole("region", { name: "Where it’s up to" });
  expect(within(group).getByText(/Both heads in/)).toBeInTheDocument();
  expect(within(group).getByText("Written Tue 13 Oct")).toBeInTheDocument();
});

it("lists what's to do on the job, each a tick that closes it", async () => {
  const onTick = jest.fn();
  draw({ onTick });
  const group = screen.getByRole("region", { name: "To do on this job" });
  expect(within(group).getByText("Lyle, today by 12:30 pm")).toBeInTheDocument();
  await userEvent.click(within(group).getByRole("checkbox", { name: /Order the grilles/ }));
  expect(onTick).toHaveBeenCalledWith(tasks[0]);
});

it("says the next visit, with its state word in orange when the time isn't confirmed", () => {
  const { container } = draw();
  const group = screen.getByRole("region", { name: "Next visit" });
  expect(within(group).getByText("Fri 16 Oct, Lyle Irving.")).toBeInTheDocument();
  expect(within(group).getByText("Time to confirm")).toBeInTheDocument();
  expect(container.querySelector('[class*="orange"], [data-tone="look"], .pt-state--look')).not.toBeNull();
});

it("says what's missing where there is nothing", () => {
  draw({ upTo: null, tasks: [], next: null });
  expect(screen.getByText("Nothing written about it yet.")).toBeInTheDocument();
  expect(screen.getByText("Nothing to do on it.")).toBeInTheDocument();
  expect(screen.getByText("Nothing booked.")).toBeInTheDocument();
});

it("waits for the tasks rather than saying there are none", () => {
  draw({ tasks: [], tasksRead: false });
  expect(screen.getByText("Reading the job's tasks")).toBeInTheDocument();
});
