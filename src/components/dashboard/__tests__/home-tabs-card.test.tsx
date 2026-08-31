import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DashboardHome } from "../home";
import type { DashboardData, HomeRail } from "@/lib/dashboard/page-data";
import type { ActionChip } from "@/lib/dashboard/chips";
import type { DashTask } from "@/lib/dashboard/tasks";

/* Home as two rooms: the day down the left, one card with four faces on the
   right.

   The capture controls reach the note flow and its server actions, and
   "use server" modules cannot be imported into jsdom. Stubbed by posture so
   this suite stays about the page; each control has its own suite. */
jest.mock("@/components/notes/note-token", () => ({
  NoteToken: ({ as, cta }: { as: string; cta?: string }) => (
    <button aria-label={as === "debrief" ? "Debrief" : "Add to the diary"}>{cta}</button>
  ),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("@/app/actions/dashboard", () => ({
  completeTask: jest.fn(),
  createTask: jest.fn(),
  reopenTask: jest.fn(),
}));

const TODAY = "2026-08-10";

const chip = (state: "bad" | "warn", key: string): ActionChip => ({
  key,
  kind: "rego",
  state,
  label: state === "bad" ? "Rego expired 4 days ago" : "Rego expires in 2 weeks",
  subject: "Hilux ute",
  href: "/dashboard/assets",
  urgency: state === "bad" ? -4 : 10_014,
});

const task = (over: Partial<DashTask> = {}): DashTask => ({
  id: "t1",
  title: "Order 2× MERV 11 filters",
  detail: null,
  assigneeId: "s1",
  assigneeName: "Isaac Smith",
  dueDate: null,
  status: "open",
  createdBy: "s1",
  createdAt: "2026-08-01T00:00:00Z",
  doneAt: null,
  doneByName: null,
  remindAt: null,
  ...over,
});

const rail = (over: Partial<HomeRail> = {}): HomeRail => ({
  dayISO: TODAY,
  tz: "Australia/Brisbane",
  blocks: [],
  tasks: [],
  nowMin: null,
  enabled: true,
  ...over,
});

const data = (over: Partial<DashboardData> = {}): DashboardData => ({
  chips: { self: [], team: [] },
  calendar: { spanStart: "2026-08-03", spanEnd: "2026-11-01", days: [] },
  tasks: { mine: [], team: null, done: [], reported: [] },
  notices: [],
  journal: [],
  assignable: [],
  jobs: [],
  canManage: false,
  viewerStaffId: "s1",
  today: TODAY,
  rail: rail(),
  phase: "midday",
  ...over,
});

const draw = (over: Partial<DashboardData> = {}) => render(<DashboardHome data={data(over)} />);
const tab = (name: RegExp) => screen.getByRole("tab", { name });
const panel = (key: string) => document.getElementById(`hmsec-${key}`)!;

describe("the card", () => {
  it("lands on Diary — the record is what Home is for", () => {
    draw();
    expect(tab(/Diary/)).toHaveAttribute("aria-selected", "true");
    expect(panel("diary")).not.toHaveAttribute("hidden");
  });

  it("shows exactly ONE panel at a time", async () => {
    /* THE BUG THIS EXISTS FOR. `.wb2-urbody.twocol` sets `display:grid` and is
       (0,2,0); a plain `.wb2-body[hidden]` is (0,2,0) too and loses on source
       order, so a panel stayed painted underneath whichever tab was open. The
       stylesheet answers that at (0,3,0); this pins the markup side — every
       non-active panel carries `hidden`, so nothing but CSS specificity could
       ever put two on screen. */
    const user = userEvent.setup();
    const keys = ["diary", "tasks", "debrief", "calendar"];
    const shown = () => keys.filter((k) => !panel(k).hasAttribute("hidden"));

    draw();
    expect(shown()).toEqual(["diary"]);

    await user.click(tab(/Tasks/));
    expect(shown()).toEqual(["tasks"]);

    await user.click(tab(/Debrief/));
    expect(shown()).toEqual(["debrief"]);

    await user.click(tab(/Calendar/));
    expect(shown()).toEqual(["calendar"]);
  });

  it("wires each tab to the panel it controls", () => {
    draw();
    for (const k of ["diary", "tasks", "debrief", "calendar"]) {
      const t = document.getElementById(`hmtab-${k}`)!;
      expect(t).toHaveAttribute("aria-controls", `hmsec-${k}`);
      expect(panel(k)).toHaveAttribute("aria-labelledby", `hmtab-${k}`);
    }
  });
});

describe("the badges", () => {
  it("counts the viewer's open tasks, so a hidden face still says how much is on", () => {
    draw({ tasks: { mine: [task(), task({ id: "t2" })], team: null, done: [], reported: [] } });
    expect(within(tab(/Tasks/)).getByText("2")).toBeInTheDocument();
  });

  it("turns red and counts the overdue ones once anything is past its date", () => {
    /* Red on this app means something is wrong, and a task past its date is
       exactly that. Six open with two late reads as a red 2, not a grey 6. */
    draw({
      tasks: {
        mine: [task({ dueDate: "2026-08-01" }), task({ id: "t2" }), task({ id: "t3" })],
        team: null,
        done: [],
        reported: [],
      },
    });
    expect(within(tab(/Tasks/)).getByText("1")).toBeInTheDocument();
    expect(tab(/Tasks/).textContent).toContain("past its date");
  });

  it("is absent on a clear day rather than showing a grey 0", () => {
    draw();
    for (const name of [/Diary/, /Tasks/, /Debrief/, /Calendar/]) {
      expect(tab(name).querySelector(".wb2-vtn")).toBeNull();
    }
  });
});

describe("the glance", () => {
  /* Urgent and Needs attention were faces of this card. They are chips in the
     page head now — and they are DOORS, because the screens behind them say
     more than a panel ever did. */
  it("carries the counts and points at the screens that hold them", () => {
    draw({
      chips: { self: [chip("bad", "a"), chip("warn", "b"), chip("warn", "c")], team: [] },
    });
    const glance = document.querySelector(".hm-glance")!;
    expect(glance.textContent).toContain("1");
    expect(glance.textContent).toContain("past its date");
    expect(glance.textContent).toContain("2");
    expect(glance.textContent).toContain("coming up");
    expect(
      screen.getByRole("link", { name: /past its date/ }),
    ).toHaveAttribute("href", "/dashboard/action-required");
  });

  it("is absent entirely on a clear day — the empty head IS the statement", () => {
    draw();
    expect(document.querySelector(".hm-glance")).toBeNull();
  });
});

describe("the day rail", () => {
  it("stands beside the card, not behind a tab", () => {
    draw();
    expect(document.querySelector(".hm-day")).not.toBeNull();
  });

  it("does NOT name who is off — leave belongs to the Calendar face", () => {
    /* The rail is where you have to BE. A colleague's leave is not an
       appointment of yours, and it already has a home one tab across, where
       four weeks of it read downward. Isaac has said so twice (2026-08-31):
       one fact, one home — two would eventually disagree. */
    draw({
      calendar: {
        spanStart: "2026-08-03",
        spanEnd: "2026-11-01",
        days: [
          {
            iso: TODAY,
            holiday: null,
            mine: null,
            others: [
              {
                staffId: "s2",
                name: "Lorenz Weber",
                firstName: "Lorenz",
                initials: "LW",
                label: "Annual leave",
              },
            ],
          },
        ],
      },
    });
    expect(document.querySelector(".hm-day")!.textContent).not.toContain("Lorenz");
    expect(document.querySelector("#hmsec-calendar")!.textContent).toContain("Lorenz");
  });

  it("says so plainly when the viewer may not see the bookings", () => {
    draw({ rail: rail({ enabled: false }) });
    expect(document.querySelector(".hm-day")!.textContent).toMatch(/workboard/i);
  });
});

describe("the page head", () => {
  it("names the screen — Home was the only one that didn't", () => {
    draw();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Home");
  });

  it("carries the date from the loader, never the client clock", () => {
    /* It formats the SERVER's `today` (fmtAuWeekdayDateLong), because a
       Date.now() in a render body is the hydration failure
       project_hydration_clock_trap documents. TODAY is 2026-08-10, a Monday. */
    draw();
    expect(document.querySelector(".hm-phead")!.textContent).toContain("Monday 10 August");
  });

  it("says the date ONCE — the diary's header gave it up to the head", () => {
    draw();
    expect(document.querySelector(".hm-head")!.textContent).not.toContain("Monday");
    expect(screen.queryByText("Say the day")).toBeNull();
  });

  it("puts the tab strip INSIDE the card — the join cannot be glass", () => {
    /* The board's strip welds the active tab's thumb to the card's top edge,
       which only works while both are opaque: translucent, the 1px weld
       double-paints into a dark band, the corner flares cannot carry the
       card's blur, and the card's top border cuts the seam. */
    draw();
    expect(document.querySelector(".hm-card")!.querySelector('[role="tablist"]')).not.toBeNull();
  });

  it("keeps the card as the material, not a band inside a band", () => {
    draw();
    expect(document.querySelector(".hm-comp")).toBeNull();
  });
});

describe("Tiff", () => {
  it("has no button of its own — the frame's is the same control, one press away", () => {
    /* One sat in the tab row's cap so a debrief was "one press from every
       face". The topbar's is one press from every SCREEN, and the two were
       identical 44px glass circles 167px apart in the same corner.

       The cap itself is allowed — it carries the day the card is showing —
       so what this pins is that nothing PRESSABLE goes back into it. */
    draw();
    const cap = document.querySelector(".wb2-vtcap");
    expect(cap?.querySelector("button")).toBeFalsy();
    expect(screen.queryByLabelText("Ask or tell Tiff")).toBeNull();
  });

  it("dots the Debrief tab on a day nothing has been written", () => {
    draw({ journal: [] });
    expect(tab(/Debrief/).querySelector(".wb2-vtdot")).not.toBeNull();
  });

  it("takes the dot off once something is in today's record", () => {
    draw({
      journal: [
        { id: "j1", said: "Board corroded.", day: TODAY, at: "11:47", outcomes: [], spoken: true },
      ],
    });
    expect(tab(/Debrief/).querySelector(".wb2-vtdot")).toBeNull();
  });

  it("says which day the card is showing, in the strip's cap", () => {
    draw();
    expect(document.querySelector(".hm-cardday")!.textContent).toContain("Mon");
  });

  it("keeps the debrief, on its own face, asking the hour's question", async () => {
    /* It was a dark bar at the top of the record it produces. As a face it is
       what it always was — a room you go into to talk — and the same control
       is a brief at dawn and a debrief at knock-off. */
    const user = userEvent.setup();
    draw({ phase: "morning" });
    await user.click(tab(/Debrief/));
    expect(within(panel("debrief")).getByLabelText("Debrief")).toBeInTheDocument();
    expect(panel("debrief").textContent).toContain("What’s on today?");
    expect(panel("debrief").textContent).toContain("Start the brief");
  });

  it("gives the diary its own way in, and it is not the debrief", () => {
    /* A record you cannot add to from where you read it sends you elsewhere to
       write. The row drops the debrief flag: one thought is one note. */
    draw();
    expect(within(panel("diary")).getByLabelText("Add to the diary")).toBeInTheDocument();
  });
});

describe("the calendar face", () => {
  it("is where being off lives, four weeks of it", async () => {
    /* The grid was deleted with the six-tab card and had nowhere to go for a
       round; this is its home (Isaac, 2026-08-30). A list, not a fortnight of
       squares — the tab answers "who is off, from here on". */
    const user = userEvent.setup();
    draw({
      calendar: {
        spanStart: "2026-08-03",
        spanEnd: "2026-11-01",
        days: [
          {
            iso: TODAY,
            holiday: null,
            mine: null,
            others: [
              {
                staffId: "s2",
                name: "Lorenz Weber",
                firstName: "Lorenz",
                initials: "LW",
                label: "Annual leave",
              },
            ],
          },
        ],
      },
    });
    await user.click(tab(/Calendar/));
    expect(panel("calendar").textContent).toContain("Lorenz");
  });
});

describe("payroll", () => {
  it("is not on Home at all — it belongs to the pay screens", () => {
    /* It was a quiet strip under the card. Home carries the day, the record
       and the work you owe; a pay-run status is none of those (Isaac,
       2026-08-30). The loader's money read went with the strip, so there is
       no longer a field to hand this component either. */
    draw();
    expect(document.querySelector(".hm-strip")).toBeNull();
    expect(screen.queryByText(/Pay run/)).toBeNull();
  });
});
