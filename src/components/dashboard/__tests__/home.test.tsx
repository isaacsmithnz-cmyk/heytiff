import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DashboardHome } from "../home";
import type { DashboardData, HomeRail } from "@/lib/dashboard/page-data";
import type { ActionChip } from "@/lib/dashboard/chips";
import type { DashTask } from "@/lib/dashboard/tasks";
import type { JournalEntry } from "@/lib/dashboard/journal";
import type { ScheduleBlock } from "@/lib/workboard/schedule";

/* Home as one card with three rooms: the day across the top, a rail of four
   faces, the face's list, and the page the chosen row opens onto.

   The capture controls reach the note flow and its server actions, and
   "use server" modules cannot be imported into jsdom. Stubbed by posture so
   this suite stays about the page; each control has its own suite. */
jest.mock("@/components/notes/note-token", () => ({
  NoteToken: ({ as, cta, placeholder }: { as: string; cta?: string; placeholder?: string }) => (
    <button aria-label={as === "debrief" ? "Debrief" : (placeholder ?? "Add to the diary…")}>
      {cta}
    </button>
  ),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("@/app/actions/dashboard", () => ({
  completeTask: jest.fn(),
  createTask: jest.fn(),
  reopenTask: jest.fn(),
  deleteTask: jest.fn(),
  setTaskDue: jest.fn(),
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
  remindKind: "at" as const,
  ...over,
});

const block = (over: Partial<ScheduleBlock> = {}): ScheduleBlock => ({
  key: "b1",
  remoteId: "j1",
  jobNumber: "1042",
  clientName: "Bayview Apartments",
  suburb: "Chatswood",
  status: "Work Order",
  categoryName: "Service",
  categoryColour: null,
  tracked: null,
  onSite: false,
  closure: "open",
  startMin: 8 * 60,
  endMin: 10 * 60,
  start: `${TODAY}T08:00:00Z`,
  end: `${TODAY}T10:00:00Z`,
  ...over,
});

const rail = (over: Partial<HomeRail> = {}): HomeRail => ({
  dayISO: TODAY,
  tz: "Australia/Brisbane",
  blocks: [],
  linked: true,
  linkHref: "/dashboard/admin/integrations/servicem8",
  tasks: [],
  nowMin: null,
  enabled: true,
  ...over,
});

const entry = (over: Partial<JournalEntry> = {}): JournalEntry => ({
  id: "e1",
  said: "Order the filters for Bayview before Thursday",
  day: TODAY,
  at: "6:52 am",
  outcomes: [],
  spoken: true,
  isDebrief: false,
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
const band = () => document.querySelector(".hm-band")!;

afterEach(cleanup);

describe("the card", () => {
  it("lands on Diary — the record is what Home is for", () => {
    draw();
    expect(tab(/^Diary/)).toHaveAttribute("aria-selected", "true");
    expect(panel("diary")).not.toHaveAttribute("hidden");
  });

  it("shows exactly ONE face at a time, chosen on the rail", async () => {
    const user = userEvent.setup();
    draw();
    const shown = () =>
      ["diary", "tasks", "debrief", "calendar"].filter((k) => !panel(k).hasAttribute("hidden"));
    expect(shown()).toEqual(["diary"]);
    await user.click(tab(/^Tasks/));
    expect(shown()).toEqual(["tasks"]);
    await user.click(tab(/^Calendar/));
    expect(shown()).toEqual(["calendar"]);
  });

  it("stands the faces in a vertical rail wired to the panels they control", () => {
    draw();
    const list = screen.getByRole("tablist", { name: "Home" });
    expect(list).toHaveAttribute("aria-orientation", "vertical");
    for (const key of ["diary", "tasks", "debrief", "calendar"]) {
      const t = document.getElementById(`hmtab-${key}`)!;
      expect(t).toHaveAttribute("aria-controls", `hmsec-${key}`);
      expect(panel(key)).toHaveAttribute("aria-labelledby", `hmtab-${key}`);
    }
  });

  it("moves between faces with the arrow keys", async () => {
    const user = userEvent.setup();
    draw();
    tab(/^Diary/).focus();
    await user.keyboard("{ArrowDown}");
    expect(panel("tasks")).not.toHaveAttribute("hidden");
    await user.keyboard("{ArrowUp}");
    expect(panel("diary")).not.toHaveAttribute("hidden");
  });
});

describe("the badges", () => {
  it("counts the viewer's open tasks, so a hidden face still says how much is on", () => {
    draw({ tasks: { mine: [task(), task({ id: "t2" })], team: null, done: [], reported: [] } });
    expect(within(tab(/^Tasks/)).getByText("2")).toBeInTheDocument();
  });

  it("turns red and counts the overdue ones once anything is past its date", () => {
    draw({
      tasks: {
        mine: [task({ dueDate: "2026-08-01" }), task({ id: "t2" }), task({ id: "t3" })],
        team: null,
        done: [],
        reported: [],
      },
    });
    const n = within(tab(/^Tasks/)).getByText("1");
    expect(n).toHaveClass("bad");
    // the colour is said in words for anyone who cannot see it
    expect(n).toHaveAttribute("aria-label", "1 past its date");
  });

  it("is absent on a clear day rather than showing a grey 0", () => {
    draw();
    expect(within(tab(/^Tasks/)).queryByText("0")).toBeNull();
  });
});

describe("the doors at the rail's foot", () => {
  it("adds the two dated states into ONE number, and points at the screen holding them", () => {
    draw({
      chips: { self: [chip("bad", "a"), chip("warn", "b")], team: [chip("warn", "c")] },
    });
    const door = screen.getByRole("link", { name: /action required/i });
    expect(door).toHaveAttribute("href", "/dashboard/action-required");
    expect(door.textContent).toContain("3");
    expect(door).toHaveAccessibleName("Action required, 3 need attention");
    expect(screen.queryByText(/coming up/)).toBeNull();
  });

  it("keeps the severity on the number's colour, not in a second number", () => {
    draw({ chips: { self: [chip("bad", "a")], team: [chip("warn", "b")] } });
    expect(document.querySelector(".hm-raildoors .hm-rln")).toHaveClass("bad");
    cleanup();
    draw({ chips: { self: [chip("warn", "a")], team: [] } });
    expect(document.querySelector(".hm-raildoors .hm-rln")).toHaveClass("warn");
  });

  it("says it in the singular for one", () => {
    draw({ chips: { self: [chip("warn", "a")], team: [] } });
    expect(screen.getByRole("link", { name: "Action required, 1 needs attention" })).toBeInTheDocument();
  });

  it("is absent entirely on a clear day — nothing there IS the statement", () => {
    draw();
    expect(document.querySelector(".hm-raildoors")).toBeNull();
    expect(screen.queryByRole("link", { name: /noticeboard/i })).toBeNull();
  });
});

describe("the page head", () => {
  it("is the date, not the word Home — the shell's rail already says that", () => {
    /* It formats the SERVER's `today` (fmtAuWeekdayDateLong), because a
       Date.now() in a render body is the hydration failure
       project_hydration_clock_trap documents. TODAY is 2026-08-10, a Monday. */
    draw();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("Monday 10 August");
    expect(h1).not.toHaveTextContent("Home");
    expect(band().contains(h1)).toBe(true);
  });

  it("has no Tiff button of its own — the frame's is one press away", () => {
    draw();
    expect(screen.queryByLabelText("Ask or tell Tiff")).toBeNull();
  });
});

describe("the debrief", () => {
  it("keeps only the debriefs — not the whole diary", async () => {
    const user = userEvent.setup();
    draw({
      journal: [
        entry({ id: "j1", said: "Board corroded, replaced it.", isDebrief: false }),
        entry({ id: "j2", said: "Long day, two callouts.", at: "5:02 pm", isDebrief: true }),
      ],
    });
    await user.click(tab(/^Debrief/));
    const face = panel("debrief");
    expect(face.textContent).toContain("Long day, two callouts.");
    expect(face.textContent).not.toContain("Board corroded");
  });

  it("wears a dot until something is in today's record, then takes it off", () => {
    draw({ journal: [] });
    expect(tab(/^Debrief/).querySelector(".hm-rldot")).not.toBeNull();
    cleanup();
    draw({ journal: [entry()] });
    expect(tab(/^Debrief/).querySelector(".hm-rldot")).toBeNull();
  });
});

describe("the day, across the top", () => {
  const timed = () =>
    rail({
      tasks: [{ id: "t9", title: "Hilux 60,000km service", atMin: 7 * 60 + 30, kind: "at", overdue: false }],
    });

  it("draws the day inside the band under the date", () => {
    draw({ rail: rail({ blocks: [block()] }) });
    expect(band().querySelector(".hm-track")).not.toBeNull();
    expect(band().querySelector(".hm-job")!.textContent).toContain("Bayview Apartments");
  });

  it("still draws your timed work when the viewer may not see the bookings", () => {
    draw({ rail: { ...timed(), enabled: false } });
    expect(band().querySelector(".hm-tsk")!.textContent).toContain("Hilux 60,000km service");
    expect(band().textContent).toMatch(/workboard/i);
  });

  it("still draws your timed work for someone ServiceM8 does not know", () => {
    draw({ rail: { ...timed(), linked: false } });
    expect(band().querySelector(".hm-tsk")!.textContent).toContain("Hilux 60,000km service");
    expect(band().textContent).toMatch(/linked to your account/i);
  });

  it("NEVER calls a half-read day an empty one", () => {
    draw({ rail: rail({ linked: false }) });
    expect(band().textContent).toMatch(/linked to your account/i);
    expect(band().textContent).not.toMatch(/nothing on your day/i);
  });

  it("says the empty day is YOURS once the picture is complete", () => {
    draw({ rail: rail() });
    expect(band().textContent).toMatch(/nothing on your day/i);
  });

  it("offers the door only to someone who can walk through it", () => {
    draw({ rail: rail({ linked: false }) });
    expect(screen.getByRole("link", { name: /link yourself/i })).toHaveAttribute(
      "href",
      "/dashboard/admin/integrations/servicem8",
    );
    cleanup();
    draw({ rail: rail({ linked: false, linkHref: null }) });
    expect(screen.queryByRole("link", { name: /link yourself/i })).toBeNull();
    expect(band().textContent).toMatch(/linked to your account/i);
  });

  it("writes a booking's span on the pill, the meridiem once", () => {
    draw({
      rail: rail({
        blocks: [
          block({ key: "a", startMin: 7 * 60, endMin: 15 * 60 }),
          block({ key: "b", jobNumber: "1043", clientName: "Northgate", startMin: 11 * 60, endMin: 11 * 60 + 15 }),
        ],
      }),
    });
    const spans = [...document.querySelectorAll(".hm-jobsp")].map((s) => s.textContent);
    expect(spans).toEqual(["7–3pm", "11–11:15am"]);
  });

  it("stretches the day to reach the hour it is now", () => {
    draw({ rail: rail({ nowMin: 18 * 60 + 7 }) });
    const hours = [...document.querySelectorAll(".hm-hour")].map((h) => h.textContent);
    expect(hours[0]).toBe("7 am");
    expect(hours[hours.length - 1]).toBe("7 pm");
  });

  it("stacks two bookings that would be drawn on top of each other", () => {
    draw({
      rail: rail({
        blocks: [
          block({ key: "a", startMin: 8 * 60, endMin: 10 * 60 }),
          block({ key: "b", clientName: "Northgate Realty", startMin: 9 * 60, endMin: 11 * 60 }),
        ],
      }),
    });
    const tops = [...document.querySelectorAll<HTMLElement>(".hm-job")].map((p) => p.style.top);
    expect(new Set(tops).size).toBe(2);
  });

  it("keeps a timed task ticked from the band on the same action as the list", () => {
    draw({ rail: timed() });
    expect(screen.getByRole("button", { name: 'Mark "Hilux 60,000km service" done' })).toBeInTheDocument();
  });
});

/* These two render the whole card and walk three faces with real clicks —
   the heaviest thing in this file by far. Under the pre-push hook, with the
   box carrying other worktrees' suites, they ran past jest's five-second
   default; the room is the machine's, not the test's. */
const WHOLE_CARD = 20_000;

describe("the rooms talk to each other", () => {
  const wired = () =>
    data({
      journal: [
        entry({
          outcomes: [{ kind: "todo", text: "Order 2× MERV 11 filters", go: { type: "task", id: "t1" } }],
        }),
        entry({ id: "e0", said: "Something older.", day: "2026-08-09", at: "4:10 pm" }),
      ],
      tasks: { mine: [task()], team: null, done: [], reported: [] },
    });

  it("a diary door opens the task on the Tasks face", async () => {
    const user = userEvent.setup();
    render(<DashboardHome data={wired()} />);
    await user.click(screen.getByRole("button", { name: /Order 2× MERV 11 filters/ }));
    expect(panel("tasks")).not.toHaveAttribute("hidden");
    expect(document.querySelector('[data-task-id="t1"]')).toHaveClass("on");
  }, WHOLE_CARD);

  it("a task's Open in diary lands on the entry that made it", async () => {
    const user = userEvent.setup();
    render(<DashboardHome data={wired()} />);
    // read the older entry first, so the move is a real one
    await user.click(screen.getByRole("button", { name: /Something older/ }));
    await user.click(tab(/^Tasks/));
    expect(panel("tasks").textContent).toContain("Order the filters for Bayview before Thursday");
    await user.click(screen.getByRole("button", { name: "Open in diary" }));
    expect(panel("diary")).not.toHaveAttribute("hidden");
    expect(panel("diary").querySelector(".hm-said")!.textContent).toBe(
      "Order the filters for Bayview before Thursday",
    );
  }, WHOLE_CARD);
});
