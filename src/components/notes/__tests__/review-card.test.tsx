import { act, cleanup, render, screen } from "@testing-library/react";
import { ReviewRows, blockers, toConfirmed, toDraft, type Draft } from "../review-card";
import type { NoteProposal } from "@/lib/workboard/note-brain";

/* THE CARD THAT REFUSED TO SAVE A REMINDER.

   Isaac dictated "…remind me to do that on Monday morning" and the review card
   showed a well-titled task, the right Monday, an empty "Assign to…" and an
   amber bar reading "One task still needs a person on it". Underneath, the
   cascade said "No tasks for anyone" while the task sat on screen a centimetre
   above — because `toConfirmed` drops a task with no assignee, and everything
   downstream counts what survives that.

   The router's half of the fix is pinned in note-brain's suite. This is the
   card's half: that a task with a person on it stops blocking, that a time of
   day survives the round trip out to `applyNote`, and that a time never
   travels without the day it belongs to. None of it had any coverage before —
   `toDraft`, `toConfirmed` and `blockers` are the three pure functions the
   whole review runs through and no test named any of them. */

const EMPTY: NoteProposal = {
  tasks: [],
  bringItems: [],
  flags: [],
  progressBullets: [],
  commissioningEntries: [],
  issueEntries: [],
  kbEntries: [],
  noteLines: [],
  plainNote: "",
  clarify: null,
};

const proposal = (task: Partial<NoteProposal["tasks"][number]> = {}): NoteProposal => ({
  ...EMPTY,
  tasks: [
    {
      title: "Check with Luke about quote to Chris from Scott Group",
      detail: "Did the quote go out?",
      assigneeId: "s-isaac",
      assigneeHint: "me",
      dueHint: "Monday morning",
      dueDate: "2026-08-24",
      remindTime: "06:30",
      remindKind: "at" as const,
      ...task,
    },
  ],
});

afterEach(cleanup);

describe("the screenshot, as a test", () => {
  it("stops blocking once the task has a person on it", () => {
    expect(blockers(toDraft(proposal()), false)).toEqual([]);
  });

  it("still blocks when nobody could be resolved — that rule is unchanged", () => {
    /* The bar was RIGHT; what was wrong was that "me" could never satisfy it.
       Assigning real work to nobody is still the failure this refuses. */
    expect(blockers(toDraft(proposal({ assigneeId: null })), false)).toEqual([
      "One task still needs a person on it — assign it, or untick it.",
    ]);
  });

  it("counts the task in the cascade instead of saying there are none", () => {
    // "2 tasks — onto their dashboard" is driven by this number
    expect(toConfirmed(toDraft(proposal())).tasks).toHaveLength(1);
    expect(toConfirmed(toDraft(proposal({ assigneeId: null }))).tasks).toHaveLength(0);
  });
});

describe("carrying the time out to the server", () => {
  it("keeps the day and the time the note asked for", () => {
    expect(toConfirmed(toDraft(proposal())).tasks[0]).toMatchObject({
      dueDate: "2026-08-24",
      remindTime: "06:30",
    });
  });

  it("sends no time for an ordinary task", () => {
    expect(toConfirmed(toDraft(proposal({ remindTime: "" }))).tasks[0].remindTime).toBeNull();
  });

  it("never sends a time without the day it belongs to", () => {
    /* A time with no date is not a moment. `remindAtFrom` would refuse it
       server-side anyway, so sending it would put a value in the payload that
       cannot become anything — and would look, in the database, like a
       reminder that simply never fired. */
    const d = toDraft(proposal({ dueDate: "" }));
    expect(d.tasks[0].remindTime).toBe("06:30"); // the draft still remembers it
    expect(toConfirmed(d).tasks[0].remindTime).toBeNull(); // the wire does not
  });
});

describe("the control on the row", () => {
  const draw = (p: NoteProposal, patch = jest.fn()) => {
    const draft = toDraft(p);
    render(
      <ReviewRows
        draft={draft}
        staff={[{ id: "s-isaac", fullName: "Isaac Smith" }]}
        patch={patch}
        dayStart="06:30"
      />,
    );
    return { draft, patch };
  };

  const remindBtn = () => document.querySelector(".wb2-remind") as HTMLButtonElement | null;

  it("shows the time a reminder is set for, not a raw 24-hour clock", () => {
    draw(proposal());
    expect(remindBtn()?.textContent).toContain("6:30 AM");
  });

  it("offers to add one where there is a day and no time", () => {
    draw(proposal({ remindTime: "" }));
    expect(remindBtn()?.textContent).toContain("Remind");
    expect(remindBtn()?.className).not.toContain("on");
  });

  it("is absent where there is no day to hang it off", () => {
    draw(proposal({ dueDate: "", remindTime: "" }));
    expect(remindBtn()).toBeNull();
  });

  it("names the task it belongs to, so a column of them is not one button", () => {
    draw(proposal());
    expect(remindBtn()?.getAttribute("aria-label")).toBe(
      "Reminder at 6:30 AM — Check with Luke about quote to Chris from Scott Group",
    );
  });

  it("SETS the time when opened rather than showing one it hasn't set", () => {
    /* A wheel sitting on 6:30 while the task carries no reminder is the card
       saying something that isn't true — and it is the shape people press once,
       see a time, and walk away from believing they are covered. */
    const { patch } = draw(proposal({ remindTime: "" }));
    act(() => {
      remindBtn()!.click();
    });
    expect(patch).toHaveBeenCalledTimes(1);

    const draft = toDraft(proposal({ remindTime: "" }));
    patch.mock.calls[0][0](draft);
    expect(draft.tasks[0].remindTime).toBe("06:30");
  });

  it("opens the wheel, and offers a way back to no reminder at all", () => {
    draw(proposal());
    expect(document.querySelector(".wb2-remindbox")).toBeNull();
    act(() => {
      remindBtn()!.click();
    });
    expect(document.querySelector(".wb2-remindbox")).not.toBeNull();
    expect(screen.getByText("No reminder — just the day")).toBeTruthy();
  });

  it("shows one wheel at a time", () => {
    /* Three scrolling wheels stacked inside a card that already scrolls is a
       card nobody can read. */
    const p: NoteProposal = { ...EMPTY, tasks: [...proposal().tasks, ...proposal().tasks] };
    const draft = toDraft(p);
    render(
      <ReviewRows draft={draft} staff={[]} patch={jest.fn()} dayStart="06:30" />,
    );
    const btns = Array.from(document.querySelectorAll(".wb2-remind")) as HTMLButtonElement[];
    expect(btns).toHaveLength(2);
    act(() => btns[0].click());
    act(() => btns[1].click());
    expect(document.querySelectorAll(".wb2-remindbox")).toHaveLength(1);
  });
});

/* A draft the tests above never build by hand — proof that `blockers` reads the
   TICKED rows, not every row, so unticking an unassignable task clears the bar
   exactly as the message says it will. */
it("lets you untick the task instead of assigning it", () => {
  const d: Draft = toDraft(proposal({ assigneeId: null }));
  expect(blockers(d, false)).toHaveLength(1);
  d.tasks[0].on = false;
  expect(blockers(d, false)).toEqual([]);
});
