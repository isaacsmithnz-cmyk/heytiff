import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JobSummary } from "../job-summary";
import { JobTodo } from "../job-todo";

/* ONE SECTION RECIPE (Isaac, 25 October 2026, "Yes, build the refined
   Overview A"): a solid block of the section's colour and its icon, the
   title at 16, at most one button on its right, then rows. */

const head = (name: string) => {
  const region = screen.getByRole("region", { name });
  return region.querySelector(".jov-head") as HTMLElement;
};

describe("the Summary", () => {
  it("is pink with a file, and its one button is quiet", () => {
    render(<JobSummary fromQuote={[{ key: "q:a", title: "Upstairs", rows: [{ key: "q:0", thing: "Ducted indoor", detail: "PEAD-M71JAAD" }] }]} description="Ducted upstairs" read />);
    expect(head("Summary").querySelector(".hm-blk")).toHaveClass("hm-blk--pink");
    expect(within(head("Summary")).getByRole("heading", { level: 2 })).toHaveTextContent("Summary");
    expect(within(head("Summary")).getByRole("button", { name: "Show the full description" })).toHaveClass("pt-btn--quiet");
  });

  it("draws the quote's groups under their subheadings, the thing on the left and its model number on the right", async () => {
    render(<JobSummary fromQuote={[{ key: "q:a", title: "Upstairs", rows: [{ key: "q:0", thing: "Ducted indoor", detail: "PEAD-M71JAAD" }] }]} description="Ducted upstairs" read />);
    const s = within(screen.getByRole("region", { name: "Summary" }));
    expect(s.getByRole("heading", { level: 3 })).toHaveTextContent("Upstairs");
    const row = s.getByText("Ducted indoor").closest("li") as HTMLElement;
    expect(within(row).getByText("PEAD-M71JAAD")).toHaveClass("jov-detail");
    /* the description, as the office wrote it, on a press */
    expect(s.queryByText("Ducted upstairs")).toBeNull();
    await userEvent.click(s.getByRole("button", { name: "Show the full description" }));
    expect(s.getByText("Ducted upstairs")).toHaveClass("jov-words");
  });

  it("falls back to the description's lines as plain rows, with no subheading, when nothing gives groups", () => {
    render(<JobSummary fromQuote={null} description={"mitsubishi 7kw ducted\nwill require 2 x site visits"} read />);
    const s = within(screen.getByRole("region", { name: "Summary" }));
    expect(s.queryByRole("heading", { level: 3 })).toBeNull();
    expect(s.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["mitsubishi 7kw ducted", "will require 2 x site visits"]);
    /* nothing held back, so nothing more to show */
    expect(s.queryByRole("button", { name: "Show the full description" })).toBeNull();
  });

  /* the walk of 25 October 2026, job 3385: four rows a group, then Show N more */
  it("shows four rows a group, then a quiet Show N more that opens that group alone, and no head button for a description", async () => {
    const pick = "Pick List\nUpstairs\n* One\n* Two\n* Three\n* Four\n* Five\n* Six\nDownstairs\n* Indoor MSZ-AP25VGKD2-A2\n* B\n* C\n* D\n* E";
    render(<JobSummary fromQuote={null} description={pick} read />);
    const s = within(screen.getByRole("region", { name: "Summary" }));
    expect(s.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Upstairs", "Downstairs"]);
    expect(s.queryByRole("button", { name: /full description/ })).toBeNull();
    expect(s.getAllByRole("listitem")).toHaveLength(8);
    const more = s.getByRole("button", { name: "Show 2 more" });
    expect(more).toHaveClass("pt-btn--quiet");
    expect(s.getByRole("button", { name: "Show 1 more" })).toBeInTheDocument();
    await userEvent.click(more);
    expect(s.getByText("Six")).toBeInTheDocument();
    expect(s.queryByRole("button", { name: "Show 2 more" })).toBeNull();
    /* the other group stays as it was */
    expect(s.queryByText("E")).toBeNull();
    expect(within(s.getByText("Indoor").closest("li") as HTMLElement).getByText("MSZ-AP25VGKD2-A2")).toHaveClass("jov-detail");
  });

  it("says nothing is written, and waits for the quote before reading the description", () => {
    const { rerender } = render(<JobSummary fromQuote={null} description="Ducted upstairs" read={false} />);
    expect(screen.getByText("Reading the job")).toBeInTheDocument();
    expect(screen.queryByText("Ducted upstairs")).toBeNull();
    rerender(<JobSummary fromQuote={null} description="" read />);
    expect(screen.getByText("Nothing written about the job.")).toBeInTheDocument();
  });
});

describe("To do", () => {
  const task = { id: "t1", title: "Order the grille", line: "Luke, today", assigneeId: null };

  it("is yellow with a tick, and its one button is the second button Add task", async () => {
    const onAddTask = jest.fn();
    render(<JobTodo tasks={[task]} tasksRead onTick={jest.fn()} onAddTask={onAddTask} />);
    expect(head("To do").querySelector(".hm-blk")).toHaveClass("hm-blk--yellow");
    const add = within(head("To do")).getByRole("button", { name: "Add task" });
    expect(add).toHaveClass("pt-btn--second");
    await userEvent.click(add);
    expect(onAddTask).toHaveBeenCalled();
    /* no count beside the title (rule 29) */
    expect(within(head("To do")).queryByText(/^\d+$/)).toBeNull();
  });

  it("puts what's open on the job at the head of To do, above its tasks", () => {
    render(<JobTodo tasks={[task]} tasksRead onTick={jest.fn()} open={<p>Michael wants a bar grille</p>} openCount={1} />);
    const rows = within(screen.getByRole("region", { name: "To do" })).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(["Michael wants a bar grille", expect.stringContaining("Order the grille")]);
  });

  it("says there's nothing to do only when nothing is open and no task is", () => {
    const { unmount } = render(<JobTodo tasks={[]} tasksRead onTick={jest.fn()} open={<p>Michael wants a bar grille</p>} openCount={1} />);
    expect(screen.queryByText("Nothing to do on it.")).toBeNull();
    unmount();
    render(<JobTodo tasks={[]} tasksRead onTick={jest.fn()} />);
    expect(screen.getByText("Nothing to do on it.")).toHaveClass("jov-row");
  });
});
