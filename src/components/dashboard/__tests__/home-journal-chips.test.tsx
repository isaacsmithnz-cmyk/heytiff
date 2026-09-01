import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeJournal } from "../home-journal";
import { navHref } from "@/components/shell/nav";
import type { JournalEntry, Outcome } from "@/lib/dashboard/journal";

jest.mock("@/components/notes/note-token", () => ({ NoteToken: () => <div /> }));

/* The chips are the payoff of the journal, and the point of resolving them is
   that pressing one goes where it says. What matters here is which ELEMENT a
   chip becomes: a task is a row on the tab next door (a button that moves the
   card), a knowledge entry and a kept note are pages (real links), and
   anything with nowhere to go must not look pressable at all. */

const TODAY = "2026-08-12";

const entry = (outcomes: Outcome[], id = "e1"): JournalEntry => ({
  id,
  said: "Ordered the filters and flagged the leaking coil",
  day: TODAY,
  at: "6:52 am",
  outcomes,
  spoken: true, isDebrief: false,
});

const renderJournal = (outcomes: Outcome[], onOpenTask?: (id: string) => void) =>
  render(<HomeJournal entries={[entry(outcomes)]} today={TODAY} onOpenTask={onOpenTask} />);

it("makes a task chip a button that opens the task, not a link", async () => {
  const onOpenTask = jest.fn();
  const user = userEvent.setup();
  renderJournal(
    [{ kind: "todo", text: "Order 2× MERV 11 filters", go: { type: "task", id: "t1" } }],
    onOpenTask,
  );

  const chip = screen.getByRole("button", { name: /Order 2× MERV 11 filters/ });
  await user.click(chip);
  expect(onOpenTask).toHaveBeenCalledWith("t1");
});

/* THE ROUTES ARE ASKED FOR, NOT SPELLED OUT — here as well as in the
   component. Writing the literal path in the assertion would make a perfectly
   correct rename fail this test, which teaches the next person to edit the
   expectation until it passes. What is worth pinning is the SHAPE: that the
   chip goes to the screen the nav names, carrying the id. That a screen still
   exists at that path is a different question, answered against the
   filesystem in journal-chip-destinations. */
it("sends a knowledge chip to that document's own page", () => {
  renderJournal([
    { kind: "kept", text: "Daikin VRV commissioning notes", go: { type: "kb", id: "k 1" } },
  ]);
  expect(screen.getByRole("link", { name: /Daikin VRV commissioning notes/ })).toHaveAttribute(
    "href",
    // the id rides the query string, so it is encoded going in
    `${navHref("tiffkb")}?doc=k%201`,
  );
});

it("sends a kept-lines chip to my notes", () => {
  renderJournal([{ kind: "kept", text: "2 lines kept", go: { type: "note", id: "n1" } }]);
  expect(screen.getByRole("link", { name: /2 lines kept/ })).toHaveAttribute(
    "href",
    navHref("mynotes"),
  );
});

it("leaves a chip with nowhere to go unpressable", () => {
  renderJournal([
    { kind: "todo", text: "1 flag" },
    { kind: "todo", text: "1 task removed" },
  ]);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.getByText("1 task removed")).toBeInTheDocument();
});

it("does not offer a task door when Home hasn't wired one", () => {
  // rendered without onOpenTask: the chip stays a plain chip rather than a
  // button that does nothing
  renderJournal([{ kind: "todo", text: "Order filters", go: { type: "task", id: "t1" } }]);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.getByText("Order filters")).toBeInTheDocument();
});

it("no longer counts the debriefs in the day header", () => {
  // the entries are right under it, each with its own time — Isaac, 2026-08-12
  render(
    <HomeJournal entries={[entry([], "e1"), entry([], "e2")]} today={TODAY} />,
  );
  expect(screen.getByText("Today")).toBeInTheDocument();
  expect(screen.queryByText(/debriefs?$/)).not.toBeInTheDocument();
});
