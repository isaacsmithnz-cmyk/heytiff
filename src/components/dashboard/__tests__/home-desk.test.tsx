import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DashboardDesk } from "../home-desk";
import type { DashboardData, HomeRail } from "@/lib/dashboard/page-data";
import type { DashTask } from "@/lib/dashboard/tasks";
import type { JournalEntry } from "@/lib/dashboard/journal";
import type { ScheduleBlock } from "@/lib/workboard/schedule";
import type { AllJobsMirrorJob } from "@/lib/workboard/all-jobs";
import type { HomeListReads } from "@/lib/dashboard/home-list";
import type { TaskDoneLine } from "@/lib/dashboard/task-done-query";
import type { CompanyCalendar } from "@/lib/calendar/items";
import type { DeskDiary } from "@/lib/dashboard/diary-doors";
import { buildConversations, diaryFeed, type MentionNote } from "@/lib/dashboard/diary-feed";

/* THE NEW HOME'S FRAME (H11): the date in the band, "Your day" on every
   face, ONE row of tabs that never moves, and a body that slides in tab
   order. The diary is its own (H16), and today's tasks hold their face for
   now; each has its own suite, so this one is about the frame around them
   — and about the doors between them and the one job card they share. The
   list beside Diary and Tasks (H19) and the Calendar (H21) have their own
   suites too; here each is where it stands, with the doors the list opens
   onto the faces.

   The capture controls and the job card reach server actions, and "use
   server" modules cannot be imported into jsdom: stubbed, as on Home. The
   diary's box is the real one; with no modal host around it, its Tiff
   button carries the capture sheet, stubbed with the rest of note-token. */
jest.mock("@/components/notes/note-token", () => ({
  NoteToken: ({ placeholder }: { placeholder?: string }) => (
    <button aria-label={placeholder ?? "Add to the diary…"} />
  ),
  CaptureSheet: () => null,
}));
jest.mock("@/app/actions/workboard-notes", () => ({
  keepWords: jest.fn(),
  routeNote: jest.fn(),
  applyNote: jest.fn(),
  keepNoteOnJob: jest.fn(),
  keepNoteForMe: jest.fn(),
  answerClarify: jest.fn(),
  dismissNote: jest.fn(),
}));
jest.mock("@/lib/brain/ask-client", () => ({ askBrain: jest.fn() }));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}));
jest.mock("@/components/workboard/board/job-sheet", () => ({
  JobSheet: (p: {
    row: { number: string | null; clientName: string | null };
    scheduleState: { word: string } | null;
    onClose: () => void;
  }) => (
    <div role="dialog" aria-label={`Job ${p.row.number ?? ""}`}>
      {p.row.clientName}, {p.scheduleState?.word ?? "no state"}
      <button onClick={p.onClose}>Close the card</button>
    </div>
  ),
}));
jest.mock("@/app/actions/workboard", () => ({ openMirrorJob: jest.fn(async () => null) }));
jest.mock("@/app/actions/dashboard", () => ({
  completeTask: jest.fn(),
  createTask: jest.fn(),
  reopenTask: jest.fn(),
  deleteTask: jest.fn(),
  setTaskDue: jest.fn(),
  resolveIssue: jest.fn(),
  reopenIssue: jest.fn(),
}));
jest.mock("@/app/actions/workboard-maintenance", () => ({
  placeVisit: jest.fn(),
  clearVisitPlacement: jest.fn(),
}));
jest.mock("@/app/actions/calendar", () => ({ addCalendarEvent: jest.fn() }));
/* Tiff's box has its own suite; the Calendar's toolbar holds it. */
jest.mock("@/components/tiff/modal/tiff-box", () => ({
  TiffBox: ({ placeholder }: { placeholder: string }) => <input aria-label={placeholder} />,
}));

const TODAY = "2026-08-10";

/** The Calendar's reads: the company's twelve months, with nothing on them. */
const cal = (over: Partial<CompanyCalendar> = {}): CompanyCalendar => ({
  today: TODAY,
  windowStart: "2026-08-01",
  windowEnd: "2027-07-31",
  stateName: "NSW",
  items: [],
  warnDays: 30,
  canAdd: true,
  hasSchool: false,
  ...over,
});

/** The list's own reads, as the loader hands them over: nothing won and
    nothing to book, so what the list holds is the page's tasks. */
const reads = (over: Partial<HomeListReads> = {}): HomeListReads => ({
  day: TODAY,
  tz: "Australia/Sydney",
  warnDays: 30,
  caps: { assetsAll: false, placeVisits: false, money: false, sm8: true },
  names: {},
  wins: [],
  visits: [],
  ...over,
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

const mirror = (over: Partial<AllJobsMirrorJob> = {}): AllJobsMirrorJob => ({
  remoteId: "j1",
  jobNumber: "1042",
  status: "Work Order",
  clientName: "Bayview Apartments",
  description: null,
  suburb: "Chatswood",
  categoryName: "Service",
  categoryColour: null,
  date: null,
  quoteDate: null,
  completionDate: null,
  nextBooking: null,
  money: null,
  paidCents: 0,
  ...over,
});

const rail = (over: Partial<HomeRail> = {}): HomeRail => ({
  dayISO: TODAY,
  tz: "Australia/Sydney",
  blocks: [],
  linked: true,
  linkHref: null,
  tasks: [],
  nowMin: null,
  enabled: true,
  jobs: [],
  tracksTime: false,
  manage: false,
  moneyVisible: false,
  connected: true,
  where: {},
  crew: {},
  ...over,
});

const entry = (over: Partial<JournalEntry> = {}): JournalEntry => ({
  id: "e1",
  said: "Order the filters for Bayview before Thursday",
  day: TODAY,
  at: "6:52 am",
  outcomes: [],
  spoken: true,
  ...over,
});

/** The diary as the desk's loader hands it over, from the same entries the
    page's journal holds — the Tasks tab and the list read those, and the
    two are the same rows. */
const diaryOf = (entries: readonly JournalEntry[]): DeskDiary => ({
  feed: diaryFeed({
    entries: entries.map((e) => ({ ...e, stamp: `${e.day} 12:00:00`, routed: true, taskFor: {} })),
    conversations: [],
    day: TODAY,
    mentions: false,
    entriesCut: false,
    syncedAt: null,
  }),
  you: "IS",
  names: {},
});

const data = (over: Partial<DashboardData> = {}): DashboardData => ({
  chips: { self: [], team: [] },
  calendar: { spanStart: "2026-08-03", spanEnd: "2026-11-01", days: [] },
  tasks: { mine: [], team: null, done: [], reported: [], sm8: { lines: {}, sender: null } },
  notices: [],
  journal: [],
  assignable: [],
  jobs: [],
  issues: [],
  canManage: false,
  viewerStaffId: "s1",
  today: TODAY,
  rail: rail(),
  desk: { warnDays: 30, list: reads(), calendar: cal(), diary: diaryOf(over.journal ?? []) },
  ...over,
});

const draw = (over: Partial<DashboardData> = {}) => render(<DashboardDesk data={data(over)} />);
const tab = (name: string) => screen.getByRole("tab", { name });
const face = (key: string) => document.getElementById(`hdsec-${key}`)!;
const main = () => document.querySelector<HTMLElement>(".hd-main")!;
const shownFaces = () => ["diary", "tasks", "calendar"].filter((k) => !face(k).hasAttribute("hidden"));
/** The diary's entries that are lit: saved just now, or asked for by a door. */
const litEntries = () =>
  [...face("diary").querySelectorAll<HTMLElement>("[data-entry]")]
    .filter((li) => li.querySelector(".hd-dy-en")!.hasAttribute("data-lit"))
    .map((li) => li.dataset.entry);

/* A whole face mounts a real list and a real page; generous, as on Home. */
const WHOLE = 20_000;

afterEach(cleanup);

describe("the frame", () => {
  it("is the date in the band every screen wears, not the word Home", () => {
    draw();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("Monday 10 August");
    expect(h1).not.toHaveTextContent("Home");
    expect(h1.closest(".wb2-vtabs")).not.toBeNull();
  });

  it("heads the day \"Your day\", with your day in it as his slanted bar", () => {
    draw({ rail: rail({ blocks: [block()] }) });
    const day = screen.getByRole("region", { name: "Your day" });
    expect(within(day).getByRole("heading", { level: 2 })).toHaveTextContent("Your day");
    expect(within(day).getByRole("button", { name: /^Chatswood, Job 1042, 8–10am/ })).toHaveClass("hd-card");
    // today's band is gone from the desk; the crew's Home keeps it
    expect(document.querySelector(".hm-track")).toBeNull();
  });

  it("says Debrief nowhere", () => {
    draw({ journal: [entry({ said: "Long day, two callouts." })] });
    expect(document.body.textContent).not.toMatch(/debrief/i);
  });
});

describe("the tabs", () => {
  it("are one row, Diary | Tasks | Calendar, and land on Diary", () => {
    draw();
    const row = screen.getByRole("tablist", { name: "Home" });
    expect(within(row).getAllByRole("tab").map((t) => t.getAttribute("id"))).toEqual([
      "hdtab-diary",
      "hdtab-tasks",
      "hdtab-calendar",
    ]);
    expect(tab("Diary")).toHaveAttribute("aria-selected", "true");
    expect(shownFaces()).toEqual(["diary"]);
  });

  it("are wired to the faces they control, with one tab in the tab order", () => {
    draw();
    for (const key of ["diary", "tasks", "calendar"]) {
      expect(document.getElementById(`hdtab-${key}`)).toHaveAttribute("aria-controls", `hdsec-${key}`);
      expect(face(key)).toHaveAttribute("role", "tabpanel");
      expect(face(key)).toHaveAttribute("aria-labelledby", `hdtab-${key}`);
    }
    expect(tab("Diary")).toHaveAttribute("tabindex", "0");
    expect(tab("Tasks")).toHaveAttribute("tabindex", "-1");
  });

  /* The bold word under each name is what keeps the chosen tab from
     nudging the next (home-desk-frame holds its weight to the chosen
     tab's); it must never be said twice. */
  it("each holds its bold word out of sight and out of its name", () => {
    draw();
    for (const name of ["Diary", "Tasks", "Calendar"]) {
      const t = tab(name);
      const held = t.querySelector(".hd-tabw")!;
      expect(held).toHaveAttribute("aria-hidden", "true");
      expect(held.textContent).toBe(name);
      expect(t).toHaveAccessibleName(name);
    }
  });

  it("move the choice and the focus on the arrows, Home and End", async () => {
    const user = userEvent.setup();
    draw();
    tab("Diary").focus();
    await user.keyboard("{ArrowRight}");
    expect(tab("Tasks")).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(tab("Tasks"));
    expect(shownFaces()).toEqual(["tasks"]);
    await user.keyboard("{End}");
    expect(shownFaces()).toEqual(["calendar"]);
    await user.keyboard("{ArrowRight}");
    expect(shownFaces()).toEqual(["diary"]);
    await user.keyboard("{ArrowLeft}");
    expect(shownFaces()).toEqual(["calendar"]);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(tab("Diary"));
  }, WHOLE);

  it("stay one node, outside the body that slides, whichever face is up", async () => {
    const user = userEvent.setup();
    draw();
    const row = screen.getByRole("tablist", { name: "Home" });
    expect(row.closest(".hd-fx")).toBeNull();
    for (const name of ["Tasks", "Calendar", "Diary"]) {
      await user.click(tab(name));
      expect(screen.getByRole("tablist", { name: "Home" })).toBe(row);
    }
  }, WHOLE);
});

describe("the faces", () => {
  it("are all mounted, and a face is the same node when you come back to it", async () => {
    const user = userEvent.setup();
    draw();
    const diary = face("diary");
    const tasks = face("tasks");
    await user.click(tab("Tasks"));
    await user.click(tab("Calendar"));
    await user.click(tab("Diary"));
    expect(face("diary")).toBe(diary);
    expect(face("tasks")).toBe(tasks);
  }, WHOLE);

  it("keep Your day on every face, the Calendar's too", async () => {
    const user = userEvent.setup();
    draw();
    const day = screen.getByRole("region", { name: "Your day" });
    for (const name of ["Tasks", "Calendar"]) {
      await user.click(tab(name));
      expect(screen.getByRole("region", { name: "Your day" })).toBe(day);
      expect(day.closest("[hidden]")).toBeNull();
    }
  }, WHOLE);

  it("give the Calendar the whole body, and Diary takes it back", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(tab("Calendar"));
    expect(main()).toHaveAttribute("hidden");
    expect(shownFaces()).toEqual(["calendar"]);
    await user.click(tab("Diary"));
    expect(main()).not.toHaveAttribute("hidden");
    expect(shownFaces()).toEqual(["diary"]);
  }, WHOLE);

  /* The Calendar's box and its views are the Calendar's own toolbar, under
     the tabs and inside the face that slides: never in the tabs' row, so
     no face can move the tabs (Isaac, 2026-09-25). */
  it("give the Calendar its own page, its toolbar under the tabs and never in their row", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(tab("Calendar"));
    const page = face("calendar").querySelector(".hd-cal")!;
    expect(page).not.toBeNull();
    const views = within(face("calendar")).getByRole("group", { name: "View" });
    expect(within(views).getByRole("button", { name: "4 weeks" })).toHaveAttribute("aria-pressed", "true");
    expect(within(face("calendar")).getByRole("textbox", { name: "Add to the calendar…" })).toBeInTheDocument();
    const row = screen.getByRole("tablist", { name: "Home" });
    expect(row.contains(views)).toBe(false);
    expect(within(row).getAllByRole("tab")).toHaveLength(3);
    // today's calendar face stands nowhere on the desk
    expect(document.querySelector(".hm-cal, .hm-face.one")).toBeNull();
  }, WHOLE);

  it("put Diary and Tasks in the same column", () => {
    draw();
    const col = document.querySelector(".hd-col")!;
    expect(col.contains(face("diary"))).toBe(true);
    expect(col.contains(face("tasks"))).toBe(true);
    expect(main().contains(face("calendar"))).toBe(false);
  });
});

describe("the one door between faces", () => {
  /* The door names the SECOND task, so a face that merely opened on its
     first row cannot pass for one that was shown the door. */
  const wired = () =>
    data({
      journal: [
        entry({
          outcomes: [{ kind: "todo", text: "Order 2× MERV 11 filters", go: { type: "task", id: "t1" } }],
        }),
        entry({ id: "e0", said: "Something older.", day: "2026-08-09", at: "4:10 pm" }),
      ],
      tasks: {
        mine: [task({ id: "t0", title: "Ring the Hilux dealer" }), task()],
        team: null,
        done: [],
        reported: [],
        sm8: { lines: {}, sender: null },
      },
    });

  /* The task is open, so the list beside the diary holds it: the door
     lights its row there, and the diary stays where you are reading. */
  it("lights a diary door's task in the list beside it, and the diary stays", async () => {
    const user = userEvent.setup();
    render(<DashboardDesk data={wired()} />);
    await user.click(within(face("diary")).getByRole("button", { name: "1 task" }));
    expect(tab("Diary")).toHaveAttribute("aria-selected", "true");
    expect(shownFaces()).toEqual(["diary"]);
    const list = screen.getByRole("complementary", { name: "The list" });
    expect(list.querySelector('[data-thing="t1"] .hd-ls-row')).toHaveAttribute("data-lit");
    expect(list.querySelector('[data-thing="t0"] .hd-ls-row')).not.toHaveAttribute("data-lit");
  }, WHOLE);

  /* Ticked off, the task has left the list, and the Tasks tab — which
     keeps what is done — is where it still stands. */
  it("takes a diary door to its task on the Tasks face when the list does not hold it", async () => {
    const user = userEvent.setup();
    const done = task({ status: "done", doneAt: "2026-08-10T01:00:00Z" });
    const tasks = {
      mine: [task({ id: "t0", title: "Ring the Hilux dealer" })],
      team: null,
      done: [done],
      reported: [],
      sm8: { lines: {}, sender: null },
    };
    render(<DashboardDesk data={{ ...wired(), tasks }} />);
    await user.click(within(face("diary")).getByRole("button", { name: "1 task" }));
    expect(tab("Tasks")).toHaveAttribute("aria-selected", "true");
    expect(shownFaces()).toEqual(["tasks"]);
    expect(document.querySelector('[data-task-id="t1"]')).toHaveClass("on");
    expect(document.querySelector('[data-task-id="t0"]')).not.toHaveClass("on");
  }, WHOLE);

  it("takes a task's Open in diary to the entry that made it, and lights that entry alone", async () => {
    const user = userEvent.setup();
    render(<DashboardDesk data={wired()} />);
    expect(litEntries()).toEqual([]);
    await user.click(tab("Tasks"));
    await user.click(within(face("tasks")).getByRole("button", { name: /^Order 2× MERV 11 filters/ }));
    await user.click(screen.getByRole("button", { name: "Open in diary" }));
    expect(shownFaces()).toEqual(["diary"]);
    expect(litEntries()).toEqual(["e1"]);
  }, WHOLE);

  /* The Tasks face goes, and the button with it: the focus lands on the
     entry, not at the top of the document. */
  it("hands the focus to the entry when Open in diary is pressed from the keyboard", async () => {
    const user = userEvent.setup();
    render(<DashboardDesk data={wired()} />);
    await user.click(tab("Tasks"));
    await user.click(within(face("tasks")).getByRole("button", { name: /^Order 2× MERV 11 filters/ }));
    screen.getByRole("button", { name: "Open in diary" }).focus();
    await user.keyboard("{Enter}");
    expect(shownFaces()).toEqual(["diary"]);
    expect(document.activeElement?.closest("[data-entry]")).toBe(face("diary").querySelector('[data-entry="e1"]'));
  }, WHOLE);

  /* A resolved issue and a task ticked off long ago are on neither the
     list nor the Tasks tab, which would otherwise open on its first row
     and show some other task as if it were the one. So they are said,
     not drawn as doors. */
  it("draws no door to what no row on the page holds, so none can open on another row", async () => {
    render(
      <DashboardDesk
        data={data({
          journal: [
            entry({
              outcomes: [
                { kind: "todo", text: "Order 2× MERV 11 filters", go: { type: "task", id: "t-old" } },
                { kind: "todo", text: "Rooftop unit keeps tripping", go: { type: "issue", id: "i-resolved" } },
              ],
            }),
          ],
          tasks: {
            mine: [task({ id: "t0", title: "Ring the Hilux dealer" })],
            team: null,
            done: [],
            reported: [],
            sm8: { lines: {}, sender: null },
          },
        })}
      />,
    );
    const under = face("diary").querySelector<HTMLElement>('[data-entry="e1"] .hd-dy-doors')!;
    expect(within(under).queryByRole("button")).toBeNull();
    expect(within(under).getByText("1 task.")).toHaveClass("hd-dy-note");
    expect(within(under).getByText("Rooftop unit keeps tripping.")).toHaveClass("hd-dy-note");
    expect(tab("Diary")).toHaveAttribute("aria-selected", "true");
  }, WHOLE);
});

/* The bell's door onto a Done that didn't go to ServiceM8 (two-way phase 2,
   PR C) opens /dashboard?task=<id>, and the desk is the owner's Home: it
   opens there on the task, and the task's page says where its Done stands,
   as today's Home does (home-tasks-sm8.test). */
describe("a task the address names", () => {
  const T = "3a3a3a3a-0000-4000-8000-00000000000a";
  const OLD = "00000000-0000-4000-8000-0000000000d1";
  const stillIn: TaskDoneLine = {
    noteId: OLD,
    words: "@lukeingold Done.",
    state: { key: "line.stillIn", text: "Still in ServiceM8.", tone: "bad", acts: ["take_out_again"] },
  };
  const named = () =>
    data({
      tasks: {
        mine: [task({ id: "t0", title: "Ring the Hilux dealer" })],
        team: null,
        done: [task({ id: T, title: "Order the grilles", status: "done", doneAt: "2026-08-10T01:00:00Z", doneByName: "Isaac Smith" })],
        reported: [],
        sm8: { lines: { [T]: [stillIn] }, sender: null },
      },
    });
  const page = () => screen.getByRole("article", { name: "The task" });

  it("(F) opens the desk on Tasks with that task chosen, and its Done's line on its page", () => {
    render(<DashboardDesk data={named()} taskId={T} />);
    expect(tab("Tasks")).toHaveAttribute("aria-selected", "true");
    expect(shownFaces()).toEqual(["tasks"]);
    expect(within(page()).getByText("Order the grilles")).toHaveClass("hm-said");
    expect(page().querySelector(`[data-note-id="${OLD}"]`)).toHaveTextContent("Still in ServiceM8.");
  }, WHOLE);

  it("(F) follows the address when only its search changes, and stays put when it stops naming one", () => {
    const { rerender } = render(<DashboardDesk data={named()} />);
    expect(tab("Diary")).toHaveAttribute("aria-selected", "true");
    rerender(<DashboardDesk data={named()} taskId={T} />);
    expect(tab("Tasks")).toHaveAttribute("aria-selected", "true");
    expect(shownFaces()).toEqual(["tasks"]);
    expect(within(page()).getByText("Order the grilles")).toHaveClass("hm-said");
    rerender(<DashboardDesk data={named()} />);
    expect(tab("Tasks")).toHaveAttribute("aria-selected", "true");
  }, WHOLE);

  it("without one, lands on the Diary as ever", () => {
    render(<DashboardDesk data={named()} />);
    expect(tab("Diary")).toHaveAttribute("aria-selected", "true");
    expect(shownFaces()).toEqual(["diary"]);
  }, WHOLE);
});

describe("the list", () => {
  const theList = () => screen.getByRole("complementary", { name: "The list" });
  const withTasks = (over: Partial<DashboardData> = {}) =>
    data({
      journal: [
        entry({ outcomes: [{ kind: "todo", text: "Order 2× MERV 11 filters", go: { type: "task", id: "t1" } }] }),
        entry({ id: "e0", said: "Something older.", day: "2026-08-09", at: "4:10 pm" }),
      ],
      tasks: {
        mine: [task({ id: "t0", title: "Ring the Hilux dealer", dueDate: "2026-08-07" }), task()],
        team: null,
        done: [],
        reported: [],
        sm8: { lines: {}, sender: null },
      },
      ...over,
    });

  it("stands in the body beside the diary column, and goes with it under the Calendar", async () => {
    const user = userEvent.setup();
    render(<DashboardDesk data={withTasks()} />);
    const list = theList();
    expect(list).toHaveClass("hd-list");
    expect(list.parentElement).toBe(main());
    expect(list.previousElementSibling).toHaveClass("hd-col");
    await user.click(tab("Tasks"));
    expect(theList()).toBe(list);
    expect(list.closest("[hidden]")).toBeNull();
    expect(list).not.toHaveAttribute("inert");
    await user.click(tab("Calendar"));
    expect(main()).toHaveAttribute("hidden");
    expect(list).toHaveAttribute("inert");
  }, WHOLE);

  it("places the page's own tasks on the workspace's day", () => {
    render(<DashboardDesk data={withTasks()} />);
    expect(within(theList()).getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Late 1",
      "No date 1",
    ]);
  });

  it("opens a task's door on the Tasks face, with that task chosen", async () => {
    const user = userEvent.setup();
    render(<DashboardDesk data={withTasks()} />);
    await user.click(within(theList()).getByRole("button", { name: "Ring the Hilux dealer" }));
    expect(tab("Tasks")).toHaveAttribute("aria-selected", "true");
    expect(document.querySelector('[data-task-id="t0"]')).toHaveClass("on");
  }, WHOLE);

  it("opens a diary-born task's door on the entry that made it", async () => {
    const user = userEvent.setup();
    render(<DashboardDesk data={withTasks()} />);
    await user.click(tab("Tasks"));
    await user.click(within(theList()).getByRole("button", { name: "Order 2× MERV 11 filters" }));
    expect(shownFaces()).toEqual(["diary"]);
    expect(litEntries()).toEqual(["e1"]);
  }, WHOLE);

  /* A task one of Luke's asks made (the list reads which, H18) opens the
     conversation it came from: the diary face comes back, and the
     conversation is lit whole and given the focus. */
  it("opens a task an ask made on its conversation in the diary", async () => {
    const user = userEvent.setup();
    const ask: MentionNote = {
      uuid: "n-ask",
      jobUuid: "3f2b8c1e-0d4a-4b6f-9a2e-1c5d7e9f0a11",
      author: "u-luke",
      at: "2026-08-09 13:42:10",
      text: "@isaacsmith Please call Mary to discuss",
    };
    const conversations = buildConversations({
      notes: [ask],
      me: { uuid: "u-isaac", handle: "isaacsmith" },
      people: [
        { uuid: "u-isaac", handle: "isaacsmith", name: "Isaac Smith", first: "Isaac" },
        { uuid: "u-luke", handle: "lukeingold", name: "Luke Ingold", first: "Luke" },
      ],
      jobs: new Map([[ask.jobUuid, { label: "2041 Wollstonecraft", live: true }]]),
      today: TODAY,
    });
    const base = withTasks({
      tasks: {
        mine: [task({ id: "t-mary", title: "Call Mary about 2041 Wollstonecraft" })],
        team: null,
        done: [],
        reported: [],
        sm8: { lines: {}, sender: null },
      },
    });
    const withAsk = {
      ...base,
      desk: {
        ...base.desk!,
        diary: {
          ...base.desk!.diary,
          feed: diaryFeed({ entries: [], conversations, day: TODAY, mentions: true, entriesCut: false, syncedAt: null }),
        },
      },
      mentions: [{ taskId: "t-mary", noteId: "n-ask", asker: "Luke", day: "2026-08-09" }],
    } as DashboardData;
    render(<DashboardDesk data={withAsk} />);
    await user.click(tab("Tasks"));
    await user.click(within(theList()).getByRole("button", { name: "Call Mary about 2041 Wollstonecraft" }));
    expect(shownFaces()).toEqual(["diary"]);
    const talk = face("diary").querySelector<HTMLElement>(`[data-conversation="${ask.jobUuid}:u-luke"] > .hd-dy-en`)!;
    expect(talk).toHaveAttribute("data-lit");
    expect(document.activeElement).toBe(talk);
  }, WHOLE);

  it("opens a won job on the desk's one card", async () => {
    const user = userEvent.setup();
    render(
      <DashboardDesk
        data={data({
          desk: {
            warnDays: 30,
            list: reads({ wins: [{ job: mirror(), wonOn: TODAY }] }),
            calendar: cal(),
            diary: diaryOf([]),
          },
        })}
      />,
    );
    await user.click(within(theList()).getByRole("button", { name: "Job 1042, Chatswood" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Job 1042" })).toHaveTextContent("Bayview Apartments");
  }, WHOLE);
});

describe("the one job card", () => {
  const booked = () => rail({ blocks: [block()], jobs: [mirror()], manage: true });
  const bookingCard = () => screen.getByRole("button", { name: /^Chatswood, Job 1042,/ });
  /* A booking opens from its panel: press the card, then Open job. */
  const openBooking = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(bookingCard());
    await user.click(screen.getByRole("button", { name: "Open job" }));
  };

  it("opens a booking on the day through the desk's card: one card, wearing the day-state", async () => {
    const user = userEvent.setup();
    draw({ rail: rail({ ...booked(), tracksTime: true }) });
    await openBooking(user);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    const card = screen.getByRole("dialog", { name: "Job 1042" });
    expect(card.textContent).toContain("Not started");
    /* the desk's card, not one the day band hosts for itself: the stub
       renders where it is mounted, and the band's own would be inside it */
    expect(card.closest(".hd-day")).toBeNull();
    expect(card.closest(".hd-page")).toBeNull();
  }, WHOLE);

  it("puts focus back on the door it was opened from when the card closes", async () => {
    const user = userEvent.setup();
    draw({ rail: booked() });
    await openBooking(user);
    await user.click(screen.getByRole("button", { name: "Close the card" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open job" }));
  }, WHOLE);
});

/* "if the card is open, they can just close it if they want more space"
   (Isaac, 2026-09-25): the day's open card is not closed by changing face,
   nor by a press in the Calendar, as his prototype leaves it; a press in
   the Diary or Tasks is a click elsewhere and closes it. */
describe("the day's open card", () => {
  const onNow = () => rail({ blocks: [block()], jobs: [mirror()], nowMin: 9 * 60 });
  const isOpen = () => screen.getByRole("button", { name: /^Chatswood, Job 1042,/ }).getAttribute("aria-expanded");

  it("stays open on every face, and for a press on the tabs or in the Calendar", async () => {
    const user = userEvent.setup();
    draw({ rail: onNow() });
    expect(isOpen()).toBe("true");
    const panel = document.querySelector(".hd-pan");
    for (const name of ["Tasks", "Calendar", "Diary", "Calendar"]) {
      await user.click(tab(name));
      expect(isOpen()).toBe("true");
      expect(document.querySelector(".hd-pan")).toBe(panel);
    }
    await user.click(face("calendar"));
    expect(isOpen()).toBe("true");
  }, WHOLE);

  it("closes for a click in the Diary", async () => {
    const user = userEvent.setup();
    draw({ rail: onNow() });
    await user.click(face("diary"));
    expect(isOpen()).toBe("false");
    expect(document.querySelector(".hd-pan")).toBeNull();
  }, WHOLE);
});

/* THE SLIDE. jsdom has no animation API, so it is stubbed: each call is
   recorded with its keyframes, and its `finished` is settled by hand. The
   widths are the body's and the column's, which jsdom does not lay out. */
describe("the slide", () => {
  type Run = {
    el: HTMLElement;
    frames: Keyframe[];
    opts: KeyframeAnimationOptions;
    cancel: jest.Mock;
    finish: () => void;
  };
  let runs: Run[] = [];
  const realAnimate = Element.prototype.animate;
  const realWidth = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth")!;
  let reduced = false;

  beforeEach(() => {
    runs = [];
    reduced = false;
    Element.prototype.animate = function (this: HTMLElement, frames: Keyframe[], opts: KeyframeAnimationOptions) {
      let finish!: () => void;
      let fail!: (e: unknown) => void;
      const finished = new Promise<void>((res, rej) => {
        finish = res;
        fail = rej;
      });
      finished.catch(() => {});
      const cancel = jest.fn(() => fail(new Error("AbortError")));
      runs.push({ el: this, frames, opts, cancel, finish });
      return { finished, cancel } as unknown as Animation;
    } as typeof Element.prototype.animate;
    Object.defineProperty(Element.prototype, "clientWidth", {
      configurable: true,
      get(this: Element) {
        return this.classList.contains("hd-fx") ? 1000 : this.classList.contains("hd-col") ? 600 : 0;
      },
    });
    window.matchMedia = ((q: string) => ({ matches: reduced && q.includes("reduce") })) as typeof window.matchMedia;
  });

  afterEach(() => {
    Element.prototype.animate = realAnimate;
    Object.defineProperty(Element.prototype, "clientWidth", realWidth);
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  const moves = () => runs.map((r) => ({ who: r.el.id || r.el.className, frames: r.frames.map((f) => f.transform) }));
  const settle = async () => {
    await act(async () => {
      for (const r of runs) r.finish();
    });
  };

  it("brings Tasks in from the right across the diary column, in 280 ms", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(tab("Tasks"));
    expect(moves()).toEqual([
      { who: "hdsec-diary", frames: ["translateX(0px)", "translateX(-600px)"] },
      { who: "hdsec-tasks", frames: ["translateX(600px)", "none"] },
    ]);
    expect(runs.every((r) => r.opts.duration === 280 && r.opts.easing === "ease-out")).toBe(true);
  }, WHOLE);

  it("slides the Calendar across the whole body, and Diary back from the left", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(tab("Calendar"));
    expect(moves()).toEqual([
      { who: "hd-main", frames: ["translateX(0px)", "translateX(-1000px)"] },
      { who: "hdsec-calendar", frames: ["translateX(1000px)", "none"] },
    ]);
    await settle();
    runs = [];
    await user.click(tab("Diary"));
    expect(moves()).toEqual([
      { who: "hdsec-calendar", frames: ["translateX(0px)", "translateX(1000px)"] },
      { who: "hd-main", frames: ["translateX(-1000px)", "none"] },
    ]);
  }, WHOLE);

  it("keeps the face on its way out on the page until its slide ends, then lets it go", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(tab("Tasks"));
    expect(shownFaces()).toEqual(["diary", "tasks"]);
    expect(face("diary")).toHaveAttribute("inert");
    await settle();
    expect(shownFaces()).toEqual(["tasks"]);
    // the pose the leaving face held is released once it is hidden
    expect(runs.every((r) => r.cancel.mock.calls.length > 0)).toBe(true);
  }, WHOLE);

  it("carries the column's own face out under the Calendar", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(tab("Tasks"));
    await settle();
    await user.click(tab("Calendar"));
    expect(shownFaces()).toEqual(["tasks", "calendar"]);
    expect(face("diary")).toHaveAttribute("hidden");
  }, WHOLE);

  it("starts a press made mid-slide from where the slide is, and stops the old one", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(tab("Tasks"));
    const first = [...runs];
    await user.click(tab("Calendar"));
    expect(first.every((r) => r.cancel.mock.calls.length > 0)).toBe(true);
    expect(moves().slice(2)).toEqual([
      { who: "hd-main", frames: ["translateX(0px)", "translateX(-1000px)"] },
      { who: "hdsec-calendar", frames: ["translateX(1000px)", "none"] },
    ]);
    expect(tab("Calendar")).toHaveAttribute("aria-selected", "true");
  }, WHOLE);

  /* Diary to Tasks, and back to Diary before Tasks has arrived: Tasks
     leaves from where it had got to, not from rest, and the diary comes
     back from a width away from there. The browser reads the pose as a
     matrix; jsdom has none, so the reader is stubbed. */
  it("sends a face back from where it had got to when the press comes mid-slide", async () => {
    const user = userEvent.setup();
    const real = (window as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly;
    (window as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly = class {
      m41: number;
      constructor(t: string) {
        this.m41 = Number(/^matrix\([^,]+,[^,]+,[^,]+,[^,]+,\s*([-\d.]+)/.exec(t)?.[1] ?? 0);
      }
    };
    try {
      draw();
      await user.click(tab("Tasks"));
      face("tasks").style.transform = "matrix(1, 0, 0, 1, 250, 0)";
      runs = [];
      await user.click(tab("Diary"));
      expect(moves()).toEqual([
        { who: "hdsec-tasks", frames: ["translateX(250px)", "translateX(600px)"] },
        { who: "hdsec-diary", frames: ["translateX(-350px)", "none"] },
      ]);
    } finally {
      (window as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly = real;
    }
  }, WHOLE);

  /* Law 8: no motion on a keyboard-driven action. The arrows, Home and End,
     and a tab pressed with a key change the face at once, and a slide in
     flight stops where it is rather than finish. */
  it("switches at once for a face chosen from the keyboard, and stops a slide in flight", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(tab("Tasks"));
    const flying = [...runs];
    expect(flying).toHaveLength(2);
    runs = [];
    await user.keyboard("{ArrowRight}");
    expect(tab("Calendar")).toHaveAttribute("aria-selected", "true");
    expect(flying.every((r) => r.cancel.mock.calls.length > 0)).toBe(true);
    expect(runs).toEqual([]);
    expect(shownFaces()).toEqual(["calendar"]);
    await user.keyboard("{Home}");
    expect(shownFaces()).toEqual(["diary"]);
    tab("Tasks").focus();
    await user.keyboard("{Enter}");
    expect(tab("Tasks")).toHaveAttribute("aria-selected", "true");
    expect(shownFaces()).toEqual(["tasks"]);
    expect(runs).toEqual([]);
  }, WHOLE);

  /* A door between faces is a way to change face like a tab: pressed with a
     pointer its face slides in, and pressed from the keyboard it is simply
     there (law 8) — both ways, the diary's door to a task and the task's
     Open in diary. The task is ticked off, so the list does not hold it and
     the diary's door goes to the Tasks tab. */
  it("slides a face in for a door pressed with the pointer, and not for one pressed from the keyboard", async () => {
    const user = userEvent.setup();
    render(
      <DashboardDesk
        data={data({
          journal: [
            entry({ outcomes: [{ kind: "todo", text: "Order 2× MERV 11 filters", go: { type: "task", id: "t1" } }] }),
          ],
          tasks: {
            mine: [],
            team: null,
            done: [task({ status: "done", doneAt: "2026-08-10T01:00:00Z" })],
            reported: [],
            sm8: { lines: {}, sender: null },
          },
        })}
      />,
    );
    const door = () => within(face("diary")).getByRole("button", { name: "1 task" });
    const back = () => within(face("tasks")).getByRole("button", { name: "Open in diary" });
    const toTasks = [
      { who: "hdsec-diary", frames: ["translateX(0px)", "translateX(-600px)"] },
      { who: "hdsec-tasks", frames: ["translateX(600px)", "none"] },
    ];
    await user.click(door());
    expect(moves()).toEqual(toTasks);
    await settle();
    runs = [];
    back().focus();
    await user.keyboard("{Enter}");
    expect(shownFaces()).toEqual(["diary"]);
    expect(runs).toEqual([]);
    door().focus();
    await user.keyboard("{Enter}");
    expect(shownFaces()).toEqual(["tasks"]);
    expect(document.querySelector('[data-task-id="t1"]')).toHaveClass("on");
    expect(runs).toEqual([]);
    await user.click(back());
    expect(moves()).toEqual([
      { who: "hdsec-tasks", frames: ["translateX(0px)", "translateX(600px)"] },
      { who: "hdsec-diary", frames: ["translateX(-600px)", "none"] },
    ]);
  }, WHOLE);

  /* The press travels with the door to the face that shows it: a diary
     door's rows come into view in the list smoothly for a pointer and at
     once for a key, and so does the entry a task's Open in diary names —
     law 8 all the way, not only at the slide. */
  it("scrolls what a door names smoothly only for a door a pointer pressed", async () => {
    const user = userEvent.setup();
    const rows: (ScrollBehavior | undefined)[] = [];
    const entries: (ScrollBehavior | undefined)[] = [];
    const realInto = Element.prototype.scrollIntoView;
    const realTo = Element.prototype.scrollTo;
    Element.prototype.scrollIntoView = function (arg?: boolean | ScrollIntoViewOptions) {
      rows.push(typeof arg === "object" ? arg.behavior : undefined);
    };
    Element.prototype.scrollTo = function (this: Element, arg?: number | ScrollToOptions) {
      if (this.id === "hdsec-diary") entries.push(typeof arg === "object" ? arg.behavior : undefined);
    } as typeof Element.prototype.scrollTo;
    try {
      render(
        <DashboardDesk
          data={data({
            journal: [
              entry({ outcomes: [{ kind: "todo", text: "Order 2× MERV 11 filters", go: { type: "task", id: "t1" } }] }),
            ],
            tasks: { mine: [task()], team: null, done: [], reported: [], sm8: { lines: {}, sender: null } },
          })}
        />,
      );
      const door = () => within(face("diary")).getByRole("button", { name: "1 task" });
      await user.click(door());
      door().focus();
      await user.keyboard("{Enter}");
      expect(rows).toEqual(["smooth", "auto"]);

      await user.click(tab("Tasks"));
      await settle();
      await user.click(within(face("tasks")).getByRole("button", { name: /^Order 2× MERV 11 filters/ }));
      within(face("tasks")).getByRole("button", { name: "Open in diary" }).focus();
      await user.keyboard("{Enter}");
      await user.click(tab("Tasks"));
      await settle();
      await user.click(within(face("tasks")).getByRole("button", { name: "Open in diary" }));
      expect(entries).toEqual(["auto", "smooth"]);
    } finally {
      Element.prototype.scrollIntoView = realInto;
      Element.prototype.scrollTo = realTo;
    }
  }, WHOLE);

  /* The day's panel stands above the body: opening it pushes the body
     down, and closing it lets the body back up — travelling there on
     `--t-move` rather than jumping. jsdom lays nothing out, so the body's
     place is stood in for: lower by the panel's height while it is up. */
  it("moves the body under the day as the day's panel closes, rather than jumping it", async () => {
    const user = userEvent.setup();
    const realRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const top = this.classList.contains("hd-body") ? 300 + (document.querySelector(".hd-pan") ? 120 : 0) : 0;
      return { left: 0, top, width: 0, height: 0, x: 0, y: top, right: 0, bottom: top, toJSON() {} } as DOMRect;
    };
    try {
      draw({ rail: rail({ blocks: [block()], jobs: [mirror()], nowMin: 9 * 60 }) });
      await user.click(within(document.querySelector(".hd-panw")!).getByRole("button", { name: "Close" }));
      expect(moves()).toContainEqual({ who: "hd-body", frames: ["translateY(120px)", "translateY(0px)"] });
      const lift = runs.find((r) => r.el.classList.contains("hd-body"))!;
      expect(lift.opts).toEqual({ duration: 200, easing: "ease-out" });
    } finally {
      Element.prototype.getBoundingClientRect = realRect;
    }
  }, WHOLE);

  it("does not slide at all under reduced motion: the face is simply there", async () => {
    const user = userEvent.setup();
    reduced = true;
    draw();
    await user.click(tab("Calendar"));
    expect(runs).toEqual([]);
    expect(shownFaces()).toEqual(["calendar"]);
  }, WHOLE);
});

it("switches at once, and throws nothing, where the browser has no animation API", async () => {
  const user = userEvent.setup();
  expect(typeof Element.prototype.animate).not.toBe("function");
  draw();
  await user.click(tab("Tasks"));
  expect(shownFaces()).toEqual(["tasks"]);
}, WHOLE);
