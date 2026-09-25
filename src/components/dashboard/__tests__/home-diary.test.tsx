import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeDiary } from "../home-diary";
import { navHref } from "@/components/shell/nav";
import type { JournalEntry, Outcome } from "@/lib/dashboard/journal";

jest.mock("@/components/notes/note-token", () => ({ NoteToken: () => <div /> }));

/* The diary is a list beside a page. The list is the index — the day, the
   time, two lines of the words, one line of what they made — and the page
   reads the chosen entry in full with its outcomes as doors. What matters
   about a door is which ELEMENT it becomes: a task is a row on the face next
   door (a button that moves the card), a knowledge entry and a kept note are
   pages (real links), and anything with nowhere to go is a word. */

const TODAY = "2026-08-12";

const entry = (over: Partial<JournalEntry> = {}): JournalEntry => ({
  id: "e1",
  said: "Ordered the filters and flagged the leaking coil",
  day: TODAY,
  at: "6:52 am",
  outcomes: [],
  spoken: true,
  ...over,
});

const draw = (
  entries: JournalEntry[],
  over: Partial<Parameters<typeof HomeDiary>[0]> = {},
) =>
  render(
    <HomeDiary
      entries={entries}
      today={TODAY}
      selectedId={null}
      onSelect={() => {}}
      {...over}
    />,
  );

const pane = () => document.querySelector<HTMLElement>(".hm-read")!;
const withOutcomes = (outcomes: Outcome[]) => [entry({ outcomes })];

describe("the doors", () => {
  it("makes a task door a button that opens the task, not a link", async () => {
    const onOpenTask = jest.fn();
    const user = userEvent.setup();
    draw(
      withOutcomes([{ kind: "todo", text: "Order 2× MERV 11 filters", go: { type: "task", id: "t1" } }]),
      { onOpenTask },
    );
    await user.click(within(pane()).getByRole("button", { name: /Order 2× MERV 11 filters/ }));
    expect(onOpenTask).toHaveBeenCalledWith("t1");
  });

  /* THE ROUTES ARE ASKED FOR, NOT SPELLED OUT: what is worth pinning is that
     the door goes to the screen the nav names, carrying the id. That a screen
     still exists at that path is answered against the filesystem in
     journal-chip-destinations. */
  it("sends a knowledge door to that document's own page", () => {
    draw(withOutcomes([{ kind: "kept", text: "Daikin VRV commissioning notes", go: { type: "kb", id: "k 1" } }]));
    expect(screen.getByRole("link", { name: /Daikin VRV commissioning notes/ })).toHaveAttribute(
      "href",
      `${navHref("tiffkb")}?doc=k%201`,
    );
  });

  it("sends a kept-lines door to my notes", () => {
    draw(withOutcomes([{ kind: "kept", text: "2 lines kept", go: { type: "note", id: "n1" } }]));
    expect(screen.getByRole("link", { name: /2 lines kept/ })).toHaveAttribute("href", navHref("mynotes"));
  });

  it("leaves an outcome with nowhere to go as a word", () => {
    draw(withOutcomes([{ kind: "todo", text: "1 flag" }, { kind: "todo", text: "1 task removed" }]));
    expect(within(pane()).queryByRole("button")).toBeNull();
    expect(within(pane()).queryByRole("link")).toBeNull();
    expect(within(pane()).getByText("1 task removed")).toHaveClass("hm-word");
  });

  it("makes an issue door a button too, on the same face as a task", async () => {
    const onOpenIssue = jest.fn();
    const user = userEvent.setup();
    draw(withOutcomes([{ kind: "todo", text: "Middle rooftop unit has tripped again", go: { type: "issue", id: "i1" } }]), {
      onOpenIssue,
    });
    const door = within(pane()).getByRole("button", { name: /Middle rooftop/ });
    expect(door.querySelector(".hm-idot")).not.toBeNull();
    await user.click(door);
    expect(onOpenIssue).toHaveBeenCalledWith("i1");
  });

  it("does not offer a task door when Home hasn't wired one", () => {
    draw(withOutcomes([{ kind: "todo", text: "Order filters", go: { type: "task", id: "t1" } }]));
    expect(within(pane()).queryByRole("button")).toBeNull();
    expect(within(pane()).getByText("Order filters")).toBeInTheDocument();
  });
});

describe("the list and the page", () => {
  const two = () => [
    entry({
      outcomes: [
        { kind: "todo", text: "Order 2× MERV 11 filters", go: { type: "task", id: "t1" } },
        { kind: "kept", text: "1 line kept", go: { type: "note", id: "n1" } },
      ],
    }),
    entry({ id: "e0", said: "Kawana quote is at 3:30.", day: "2026-08-11", at: "7:12 am", spoken: false }),
  ];

  it("reads the newest entry until one is chosen", () => {
    draw(two());
    expect(pane().querySelector(".hm-said")!.textContent).toBe(
      "Ordered the filters and flagged the leaking coil",
    );
    expect(screen.getByRole("button", { name: /Ordered the filters/ })).toHaveAttribute("aria-current", "true");
  });

  it("reads the chosen entry, and a row press chooses it", async () => {
    const onSelect = jest.fn();
    const user = userEvent.setup();
    draw(two(), { selectedId: "e0", onSelect });
    expect(pane().querySelector(".hm-said")!.textContent).toBe("Kawana quote is at 3:30.");
    await user.click(screen.getByRole("button", { name: /Ordered the filters/ }));
    expect(onSelect).toHaveBeenCalledWith("e1");
  });

  it("says when, under the words, as a sentence with its figures", () => {
    draw(two());
    expect(pane().querySelector(".hm-when")!.textContent).toBe(
      "Wednesday 12 August at 6:52 am, today. Spoken.",
    );
    // and nothing tracked or capitalised sits over the words
    expect(pane().firstElementChild).toHaveClass("hm-said");
  });

  it("names a typed entry as typed", () => {
    draw(two(), { selectedId: "e0" });
    expect(pane().querySelector(".hm-when")!.textContent).toBe(
      "Tuesday 11 August at 7:12 am, yesterday. Typed.",
    );
  });

  it("gives a row one quiet line of what it made, in words", () => {
    draw(two());
    const row = screen.getByRole("button", { name: /Ordered the filters/ });
    expect(row.querySelector(".hm-rowo")!.textContent).toBe("1 task, 1 line kept");
    expect(row.textContent).toContain("Today");
    expect(row.textContent).toContain("6:52 am");
    // an entry that made nothing has no line, not an empty one
    expect(screen.getByRole("button", { name: /Kawana quote/ }).querySelector(".hm-rowo")).toBeNull();
  });

  it("counts the entries beside the heading", () => {
    draw(two());
    expect(screen.getByText("2 entries")).toBeInTheDocument();
  });

  it("says the record is empty in the trade's words, with no page to read", () => {
    draw([]);
    expect(screen.getByText(/Nothing yet/)).toBeInTheDocument();
    expect(pane().querySelector(".hm-said")).toBeNull();
  });
});
