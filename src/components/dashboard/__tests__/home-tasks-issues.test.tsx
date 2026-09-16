import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeTasks } from "../home-tasks";
import type { DashTask } from "@/lib/dashboard/tasks";
import type { HomeIssue } from "@/lib/dashboard/issues";
import type { JournalEntry } from "@/lib/dashboard/journal";

const resolveIssue = jest.fn(async () => ({ ok: true as const }));

jest.mock("@/components/notes/note-token", () => ({ NoteToken: () => <div /> }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("@/app/actions/dashboard", () => ({
  completeTask: jest.fn(),
  createTask: jest.fn(),
  reopenTask: jest.fn(),
  deleteTask: jest.fn(),
  setTaskDue: jest.fn(),
  resolveIssue: (...a: unknown[]) => resolveIssue(...(a as [])),
}));

/* ISSUES ON THE TASKS FACE. An issue is not a task — no assignee, no date,
   nothing to tick — so it has its own group, a dot where the checkbox would
   be, and one action. What is pinned here is the shape a reader meets: the
   words on the row, the words on the page, and that resolving is the only
   thing you can do to one. */

const TODAY = "2026-09-15";

const task = (over: Partial<DashTask> = {}): DashTask => ({
  id: "t1",
  title: "Order 2× MERV 11 filters",
  detail: null,
  assigneeId: "s1",
  assigneeName: "Isaac Smith",
  dueDate: null,
  status: "open",
  createdBy: "s1",
  createdAt: "2026-09-01T00:00:00Z",
  doneAt: null,
  doneByName: null,
  remindAt: null,
  remindKind: "at" as const,
  ...over,
});

const issue = (over: Partial<HomeIssue> = {}): HomeIssue => ({
  id: "i1",
  summary: "Middle rooftop unit has tripped again",
  equipmentRef: "the middle rooftop one",
  occurrences: 3,
  firstSeen: "2026-07-30",
  lastSeen: "2026-09-14",
  targetKind: "visit",
  targetId: "v1",
  where: "Job 1042, Bayview Apartments",
  ...over,
});

function draw(over: Partial<Parameters<typeof HomeTasks>[0]> = {}) {
  render(
    <HomeTasks
      today={TODAY}
      mine={[task()]}
      team={null}
      done={[]}
      reported={[]}
      issues={[issue()]}
      viewerStaffId="s1"
      canManage={false}
      assignable={[]}
      {...over}
    />,
  );
  return userEvent.setup();
}

const pane = () => document.querySelector<HTMLElement>(".hm-read")!;
const row = (id: string) => document.querySelector<HTMLElement>(`[data-task-id="${id}"]`)!;

beforeEach(() => resolveIssue.mockClear());

describe("the row", () => {
  it("stands in its own group, counted, after the open work", () => {
    draw();
    const labels = [...document.querySelectorAll(".hm-tgrp > span:first-child")].map((s) => s.textContent);
    expect(labels).toEqual(["Open", "Issues"]);
    expect(screen.getByText("1 open, 1 issue")).toBeInTheDocument();
  });

  it("wears a dot where a task wears a checkbox, and says so", () => {
    draw();
    expect(within(row("i1")).getByRole("img", { name: "Open issue" })).toHaveClass("hm-idot");
    expect(within(row("i1")).queryByRole("button", { name: /Mark ".*" done/ })).toBeNull();
  });

  it("says where it is and how often, in two sentences", () => {
    draw();
    expect(row("i1").querySelector(".hm-tm")!.textContent).toBe(
      "Job 1042, Bayview Apartments. Seen 3 times, last 14 Sept.",
    );
  });

  it("says once, and not on a job, when that is the truth", () => {
    draw({ issues: [issue({ occurrences: 1, where: null, targetKind: "none", targetId: null })] });
    expect(row("i1").querySelector(".hm-tm")!.textContent).toBe("Not on a job. Seen once, last 14 Sept.");
  });

  it("is absent, group and count, when there are none", () => {
    draw({ issues: [] });
    expect(screen.queryByText("Issues")).toBeNull();
    expect(screen.getByText("1 open")).toBeInTheDocument();
  });
});

describe("the page", () => {
  it("reads the issue with its state as an amber word, then how often", async () => {
    const user = draw();
    await user.click(within(row("i1")).getByRole("button", { name: /Middle rooftop/ }));
    expect(pane().querySelector(".hm-said")!.textContent).toBe("Middle rooftop unit has tripped again");
    const state = pane().querySelector(".hm-when")!;
    expect(state.querySelector("b")).toHaveClass("warn");
    expect(state.textContent).toBe("Open issue. Seen 3 times, first Thu 30 July, last Mon 14 Sept.");
  });

  /* "Seen: 3 times" was the sentence above it, under a label — and the
     sentence carries the dates the row could not. */
  it("gives the facts the sentence above cannot: where, and the equipment", async () => {
    const user = draw();
    await user.click(within(row("i1")).getByRole("button", { name: /Middle rooftop/ }));
    const facts = [...pane().querySelectorAll(".hm-facts div")].map(
      (d) => `${d.querySelector("dt")!.textContent}: ${d.querySelector("dd")!.textContent}`,
    );
    expect(facts).toEqual([
      "Where: Job 1042, Bayview Apartments",
      "Equipment: the middle rooftop one",
    ]);
    expect(pane().querySelector(".hm-when")!.textContent).toContain("Seen 3 times");
  });

  it("says what it does not know as unset, never as a guess", async () => {
    const user = draw({ issues: [issue({ where: null, equipmentRef: null, occurrences: 1 })] });
    await user.click(within(row("i1")).getByRole("button", { name: /Middle rooftop/ }));
    const unset = [...pane().querySelectorAll(".hm-facts dd.unset")].map((d) => d.textContent);
    expect(unset).toEqual(["Not on a job", "Not named"]);
    expect(pane().querySelector(".hm-when")!.textContent).toBe("Open issue. Seen once, on Mon 14 Sept.");
  });

  it("has one action, Mark resolved, and no date or delete", async () => {
    const user = draw();
    await user.click(within(row("i1")).getByRole("button", { name: /Middle rooftop/ }));
    const acts = pane().querySelector<HTMLElement>(".hm-acts")!;
    expect(within(acts).getAllByRole("button").map((b) => b.textContent)).toEqual(["Mark resolved"]);
    expect(screen.queryByLabelText("Due date")).toBeNull();
    await user.click(within(acts).getByRole("button", { name: "Mark resolved" }));
    expect(resolveIssue).toHaveBeenCalledWith("i1");
  });

  it("finds the note that raised it, by the issue's own door", async () => {
    const journal: JournalEntry[] = [
      {
        id: "e3",
        said: "Luke needs to order some grilles and the middle rooftop unit has tripped again",
        day: "2026-07-30",
        at: "7:10 am",
        outcomes: [
          { kind: "todo", text: "Order grilles", go: { type: "task", id: "t4" } },
          { kind: "todo", text: "Middle rooftop unit has tripped again", go: { type: "issue", id: "i1" } },
        ],
        spoken: false,
        isDebrief: false,
      },
    ];
    const onOpenEntry = jest.fn();
    const user = draw({ journal, onOpenEntry });
    await user.click(within(row("i1")).getByRole("button", { name: /Middle rooftop/ }));
    /* The note is printed in full below, with its own date under it — saying
       which note this came from in the line above put one date on the page
       three times. */
    expect(pane().querySelector(".hm-when")!.textContent).not.toContain("note.");
    expect(pane().querySelector(".hm-quote")!.textContent).toContain("tripped again");
    expect(pane().querySelector(".hm-qm")!.textContent).toContain("Thu 30 July");
    await user.click(screen.getByRole("button", { name: "Open in diary" }));
    expect(onOpenEntry).toHaveBeenCalledWith("e3");
  });

  it("is chosen by a diary door naming it, like a task", () => {
    draw({ focusTaskId: "i1" });
    expect(row("i1")).toHaveClass("on");
    expect(pane().querySelector(".hm-said")!.textContent).toBe("Middle rooftop unit has tripped again");
  });
});
