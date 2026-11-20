import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { FeedItem } from "@/lib/dashboard/your-feed";
import userEvent from "@testing-library/user-event";
import { HomeScreen } from "../home";
import { HomeTodo } from "../home-todo";
import { TiffContext, type TiffApi } from "@/components/tiff/modal/tiff-context";
import { WindowsContext, type WindowsApi } from "@/components/records/records-context";
import { TODO_HOME_CAP, type TodoRow } from "@/lib/dashboard/todo";
import type { TodayRow, TodayView } from "@/lib/dashboard/home-today";
import type { TeamDay, TeamJob } from "@/lib/dashboard/team-day";

/* HOME, v2, on screen: Tiff's mark over her box, Today, and To do, with
   each To do row's one button doing its thing. The rows themselves are
   worked out in lib/dashboard (home-today, todo), pinned there; here they
   are handed in as the page hands them. Every server action is a stub. */

const refresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: jest.fn() }),
  usePathname: () => "/dashboard",
}));
const completeTask = jest.fn(async (..._a: unknown[]) => ({ ok: true as const }));
const reopenTask = jest.fn(async (..._a: unknown[]) => ({ ok: true as const }));
jest.mock("@/app/actions/dashboard", () => ({
  completeTask: (...a: unknown[]) => completeTask(...a),
  reopenTask: (...a: unknown[]) => reopenTask(...a),
  /* the task's own form, which a row of new work opens */
  taskPeople: jest.fn(async () => ({ people: [], me: null })),
  readTaskForEdit: jest.fn(() => new Promise(() => {})),
}));
const snoozeReminder = jest.fn(async (..._a: unknown[]) => ({ ok: true as const }));
jest.mock("@/app/actions/job-note-sm8", () => ({ replyToJobNote: jest.fn() }));
jest.mock("@/app/actions/reminders", () => ({ snoozeReminder: (...a: unknown[]) => snoozeReminder(...a) }));
const acknowledgeTask = jest.fn(async (..._a: unknown[]) => ({ ok: true as const }));
jest.mock("@/app/actions/assignments", () => ({ acknowledgeTask: (...a: unknown[]) => acknowledgeTask(...a) }));
/* a won job's Book in is the Visit form, over Home */
const readBookInContext = jest.fn(async (..._a: unknown[]) => ({ ok: false as const, error: "Not in a test." }));
jest.mock("@/app/actions/booking-sm8", () => ({
  readBookInContext: (...a: unknown[]) => readBookInContext(...a),
  bookJobIn: jest.fn(),
  takeBackBooking: jest.fn(),
}));
/* the microphone's engine: its start is all a test can press */
const startDictation = jest.fn();
jest.mock("@/components/notes/dictation", () => {
  const actual = jest.requireActual("@/components/notes/dictation");
  return {
    ...actual,
    useDictation: () => ({
      recording: false,
      arming: false,
      transcribing: false,
      seconds: 0,
      interim: "",
      barsRef: { current: null },
      bindQuiet: jest.fn(),
      keepListening: jest.fn(),
      start: startDictation,
      stop: jest.fn(),
      handOver: jest.fn(),
      cancel: jest.fn(),
      restart: jest.fn(),
    }),
  };
});
/* the conversation on the page, as a stub: its words, and Back */
jest.mock("@/components/tiff/modal/tiff-inline", () => ({
  TiffInline: ({ words, onBack }: { words: string; onBack: () => void }) => (
    <section aria-label="Talking to Tiff">
      <p>{words}</p>
      <button type="button" onClick={onBack}>
        Back to Home
      </button>
    </section>
  ),
}));
const open = jest.fn((..._a: unknown[]) => true);
const toast = jest.fn();
const tiff: TiffApi = { open: (o) => open(o), openedBy: null, isOpen: false, landed: null };
const windows = { toast } as unknown as WindowsApi;

const job = (over: Partial<TodayRow> = {}): TodayRow => ({
  key: "job:a1",
  kind: "job",
  time: "7:30 to 8:30",
  hue: "green",
  name: "Kingsford Bakery, Job 2380",
  line: "Service, you",
  state: { tone: "good", word: "Done" },
  href: "/dashboard/jobs/j-2380",
  taskId: null,
  ...over,
});

const timed: TodayRow = {
  key: "task:t1",
  kind: "task",
  time: "By 12:30",
  hue: null,
  name: "Order the grilles",
  line: "Task",
  state: null,
  href: null,
  taskId: "t1",
};

const today = (over: Partial<TodayView> = {}): TodayView => ({
  rows: [job(), job({ key: "job:a2", time: "9:00 to 11:30", hue: "blue", name: "Bellevue Hill, Job 3342", line: "Installation, with Lyle and Callum", state: { tone: "good", word: "On now" }, href: "/dashboard/jobs/j-3342" }), timed],
  summary: "2 jobs and a task",
  empty: { what: "Nothing booked for you today", line: null, action: null },
  schedule: true,
  ...over,
});

const link = (key: string, name: string, label: string, href: string, over: Partial<TodoRow> = {}): TodoRow => ({
  key,
  source: "alert",
  tone: "look",
  name,
  line: "A line",
  lineTone: false,
  tick: null,
  act: { kind: "link", label, href },
  ...over,
});

const ROWS: TodoRow[] = [
  link("chip:rego", "Hilux, XQG41B", "Renew", "/dashboard/assets?v=v1&screen=rego", { tone: "wrong", line: "Rego ran out Sun 20 Sept", lineTone: true }),
  { key: "reminder:t9", source: "reminder", tone: "look", name: "Ring the Hilux dealer", line: "Reminder, now", lineTone: false, tick: "t9", act: { kind: "later", taskId: "t9" } },
  { key: "assignment:a1", source: "assignment", tone: "look", name: "Measure up Rozelle", line: "From Lyle", lineTone: false, tick: "a1", act: { kind: "gotit", taskId: "a1" } },
  link("task:m1", "Which fans for Rozelle?", "Reply", "/dashboard/desk?ask=n-77", { source: "list", tick: "m1" }),
  link("timesheets", "Timesheets", "Review", "/dashboard/timepay", { source: "timesheets", line: "4 to approve" }),
  link("notice:n1", "Toolbox talk", "Open", "/dashboard/notices", { source: "notice", tone: "info" }),
];

const draw = (view: TodayView = today(), rows: TodoRow[] = ROWS, feed: FeedItem[] = [], team: TeamDay | null = null) =>
  render(
    <WindowsContext.Provider value={windows}>
      <TiffContext.Provider value={tiff}>
        <HomeScreen
          today={view}
          todo={rows}
          feed={feed}
          team={team}
          days={team ? [{ day: team.day, label: "Today" }, { day: "2026-11-18", label: "Wed 18" }] : []}
          voice
        />
      </TiffContext.Provider>
    </WindowsContext.Provider>,
  );

const section = (name: string) => screen.getByRole("heading", { name }).closest("section")!;
const rowOf = (name: string) => screen.getByText(name).closest("li")!;
/* the Activity feed is a tab of Home's card now, found by its panel */
const feedPanel = () => document.getElementById("hm-panel-feed")!;
const tj = (over: Partial<TeamJob> = {}): TeamJob => ({
  id: "j-3479",
  number: "3479",
  client: "Dan Brad",
  suburb: "Glebe",
  kind: "Install",
  hue: "purple",
  people: ["Ryan", "Sam"],
  mine: false,
  startMin: 420,
  time: "7:00",
  state: { tone: "good", word: "On site" },
  done: false,
  at: { lat: -33.88, lng: 151.186 },
  here: ["Ryan", "Sam"],
  href: "/dashboard/jobs/j-3479",
  ...over,
});
const TEAM: TeamDay = {
  day: "2026-11-17",
  today: true,
  linked: true,
  free: ["Nathan", "Mia"],
  live: [{ name: "Josh", at: { lat: -33.882, lng: 151.2 }, mins: 3 }],
  jobs: [
    tj(),
    tj({ id: "j-3432", number: "3432", client: "Sutcliffe, Will", suburb: "Paddington", hue: "orange", people: ["Daniel"], state: { tone: "good", word: "Done" }, done: true, here: [], at: { lat: -33.884, lng: 151.227 }, href: "/dashboard/jobs/j-3432" }),
    tj({ id: "j-2359", number: "2359", client: "Dryridge Estate", suburb: "Megalong Valley", kind: "Service call", hue: "pink", people: ["you"], mine: true, startMin: 720, time: "12:00", state: { tone: "info", word: "Booked" }, here: [], at: { lat: -33.726, lng: 150.238 }, href: "/dashboard/jobs/j-2359" }),
  ],
};

afterEach(cleanup);
beforeEach(() => {
  /* the feed's view is kept on the device: each test starts on All */
  localStorage.clear();
  [completeTask, reopenTask, snoozeReminder, acknowledgeTask, open, toast, refresh, startDictation].forEach((m) => m.mockClear());
});

describe("the box", () => {
  it("(F) is Tiff's box under her mark: the words, the microphone and Send", () => {
    draw();
    expect(screen.getByRole("img", { name: "Tiff" })).toBeInTheDocument();
    const field = screen.getByRole("textbox", { name: "What's happening on site?" });
    expect(field).toHaveAttribute("placeholder", "What's happening on site?");
    expect(screen.getByRole("button", { name: "Speak instead of typing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send to Tiff" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("(F) her mark is three times the size and alive at rest", () => {
    draw();
    const mark = screen.getByRole("img", { name: "Tiff" });
    expect(mark).toHaveClass("tiffmk", "alive");
    expect(mark.style.getPropertyValue("--tb")).toBe("96px");
  });

  it("(F) the microphone records in the box, and no window opens", async () => {
    draw();
    await userEvent.click(screen.getByRole("button", { name: "Speak instead of typing" }));
    expect(startDictation).toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("(F) Send with nothing typed does nothing", async () => {
    draw();
    await userEvent.click(screen.getByRole("button", { name: "Send to Tiff" }));
    expect(open).not.toHaveBeenCalled();
  });

  it("(F) Send starts the conversation on the page, in place of the columns, and no window opens", async () => {
    draw();
    await userEvent.type(screen.getByRole("textbox", { name: "What's happening on site?" }), "Finished the Rifkin install");
    await userEvent.click(screen.getByRole("button", { name: "Send to Tiff" }));
    const chat = screen.getByRole("region", { name: "Talking to Tiff" });
    expect(chat).toHaveTextContent("Finished the Rifkin install");
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByRole("tab", { name: "Activity feed" })).toBeNull();
  });

  it("(F) Back to Home brings the box and the columns back, the box empty", async () => {
    draw();
    await userEvent.type(screen.getByRole("textbox", { name: "What's happening on site?" }), "Two filters for 3342{Enter}");
    expect(screen.getByRole("region", { name: "Talking to Tiff" })).toHaveTextContent("Two filters for 3342");
    await userEvent.click(screen.getByRole("button", { name: "Back to Home" }));
    expect(screen.getByRole("tab", { name: "Activity feed" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "What's happening on site?" })).toHaveValue("");
  });
});

/* Isaac, 17 November 2026: one card with two tabs, Schedule and the
   Activity feed, each tab's controls on the line under them; the Schedule
   the team's day by default, You for your own */
describe("the card's two tabs", () => {
  const timesheets: FeedItem = { key: "timesheets", filter: "approvals", who: { name: "Timesheets", sm8: false }, what: "3 to approve", said: null, yours: null, when: "", at: "2026-10-20 13:00:00", unread: false, act: { kind: "link", label: "Review", href: "/dashboard/team?view=timesheets" }, reply: null, open: { href: "/dashboard/team?view=timesheets" } };

  it("(F) opens on Schedule, with the Activity feed beside it as a tab, and keeps the one you leave it on", async () => {
    draw(today(), [], [], TEAM);
    const tabs = within(screen.getByRole("tablist", { name: "Home" })).getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Schedule", "Activity feed"]);
    expect(within(screen.getByRole("tablist", { name: "Day" })).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Today", "Wed 18"]);
    expect(screen.getByRole("tab", { name: "Schedule" })).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById("hm-panel-schedule")).not.toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: "Activity feed" }));
    expect(feedPanel()).not.toBeNull();
    expect(document.getElementById("hm-panel-schedule")).toBeNull();
    cleanup();
    draw(today(), [], [], TEAM);
    expect(screen.getByRole("tab", { name: "Activity feed" })).toHaveAttribute("aria-selected", "true");
  });

  it("(F) is the Activity feed alone for someone who may not see the crew's bookings", () => {
    draw(today(), []);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Activity feed"]);
    expect(screen.queryByRole("heading", { name: "Today" })).toBeNull();
  });

  it("(F) puts To do in the Activity feed, what's due today among it", () => {
    draw(today(), [link("chip:rego", "Hilux, XQG41B", "Renew", "/r", { col: "today", tone: "wrong" }), link("k1", "Price the Truecut quote", "Open", "/q")], [timesheets]);
    const feed = feedPanel();
    expect(within(feed).getByRole("heading", { name: "To do" })).toBeInTheDocument();
    expect(within(feed).getByText("Hilux, XQG41B")).toBeInTheDocument();
    expect(within(feed).getByText("Price the Truecut quote")).toBeInTheDocument();
    expect(within(feed).getByText("Timesheets")).toBeInTheDocument();
  });

  it("(F) offers the views All, To do, To you, Jobs and Approvals on the line under the tabs; To do shows only what waits", async () => {
    draw(today(), [link("k1", "Price the Truecut quote", "Open", "/q")], [timesheets]);
    const tray = within(feedPanel().querySelector(".hm-sub") as HTMLElement).getByRole("radiogroup", { name: "Show" });
    expect(within(tray).getAllByRole("radio").map((r) => r.textContent)).toEqual(["All", "To do", "To you", "Jobs", "Approvals"]);
    await userEvent.click(within(tray).getByRole("radio", { name: "To do" }));
    expect(within(feedPanel()).getByText("Price the Truecut quote")).toBeInTheDocument();
    expect(within(feedPanel()).queryByText("Timesheets")).toBeNull();
  });

  it("(F) lists the team's jobs today: the number in its colour, the client, the suburb and who's on it, the start and where it's up to; a done one grey", () => {
    draw(today(), [], [], TEAM);
    const panel = document.getElementById("hm-panel-schedule")!;
    expect(within(panel).getByText("Nathan and Mia are free all day.")).toBeInTheDocument();
    const rows = within(panel).getByRole("list", { name: "Jobs today" });
    const glebe = within(rows).getByRole("link", { name: /Dan Brad/ });
    expect(glebe).toHaveAttribute("href", "/dashboard/jobs/j-3479");
    expect(glebe.closest("li")).toHaveClass("hm-jc--purple");
    expect(glebe.querySelector(".hm-jc-n")).toHaveTextContent("3479");
    expect(glebe).toHaveTextContent("Glebe, with Ryan and Sam");
    expect(glebe).toHaveTextContent("7:00");
    expect(glebe).toHaveTextContent("On site");
    const done = within(rows).getByRole("link", { name: /Sutcliffe/ }).closest("li")!;
    expect(done).toHaveClass("hm-jc--grey");
    expect(done).toHaveClass("hm-sd-item--done");
    expect(within(rows).getAllByRole("listitem")).toHaveLength(3);
  });

  it("(F) puts the jobs on the map: a pin for each still to do, a dot for a done one, who's there beside theirs, and a far one on the edge", () => {
    draw(today(), [], [], TEAM);
    const map = screen.getByRole("group", { name: "Map of the day's jobs" });
    expect(within(map).getByRole("link", { name: "3479, Dan Brad" })).toHaveAttribute("href", "/dashboard/jobs/j-3479");
    expect(within(map).getByLabelText("Ryan, Sam on site")).toHaveTextContent("2");
    expect(map.querySelectorAll(".hm-map-dot")).toHaveLength(1);
    const far = within(map).getByRole("button", { name: /2359/ });
    expect(far).toHaveTextContent("Megalong Valley");
    expect(far).toHaveTextContent(/km/);
    expect(within(map).getByRole("img", { name: "Josh, 3 min ago" })).toHaveTextContent("J");
    expect(within(map).getByRole("button", { name: "Show all" })).toBeInTheDocument();
    expect(within(map).getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
  });

  it("(F) narrows to your own jobs on You, and keeps it", async () => {
    draw(today(), [], [], TEAM);
    const tray = screen.getByRole("radiogroup", { name: "Whose day" });
    expect(within(tray).getByRole("radio", { name: "Team" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(within(tray).getByRole("radio", { name: "You" }));
    const rows = screen.getByRole("list", { name: "Jobs today" });
    expect(within(rows).getAllByRole("listitem")).toHaveLength(1);
    expect(within(rows).getByRole("link", { name: /Dryridge Estate/ })).toHaveTextContent("Service call, Megalong Valley");
    expect(screen.queryByText("Nathan and Mia are free all day.")).toBeNull();
    expect(screen.queryByRole("img", { name: /Josh/ })).toBeNull();
    cleanup();
    draw(today(), [], [], TEAM);
    expect(screen.getByRole("radio", { name: "You" })).toHaveAttribute("aria-checked", "true");
  });

  it("(F) reads another day when it's pressed, in the same place", async () => {
    const wed: TeamDay = { ...TEAM, day: "2026-11-18", today: false, free: [], jobs: [tj({ id: "j-3095", number: "3095", client: "Kogan, Daniel", suburb: "Randwick", people: ["Alex", "Callum"], state: null, here: [], href: "/dashboard/jobs/j-3095" })] };
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => wed }));
    const was = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      draw(today(), [], [], TEAM);
      await userEvent.click(screen.getByRole("tab", { name: "Wed 18" }));
      expect(fetchMock).toHaveBeenCalledWith("/api/home/team-day?day=2026-11-18", { cache: "no-store" });
      const rows = await screen.findByRole("list", { name: "Jobs on Wed 18" });
      const row = within(rows).getByRole("link", { name: /Kogan/ });
      expect(row).toHaveTextContent("Randwick, with Alex and Callum");
      expect(row).toHaveTextContent("Install");
    } finally {
      global.fetch = was;
    }
  });

  it("(F) says whose birthday it is over today's jobs, and nothing when nobody shares one", () => {
    draw(today({ birthdays: ["It’s Oleksii’s birthday", "Leo turns 30 today"] }), [], [], TEAM);
    const list = screen.getByRole("list", { name: "Birthdays" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["It’s Oleksii’s birthday", "Leo turns 30 today"]);
    cleanup();
    draw(today(), [], [], TEAM);
    expect(screen.queryByRole("list", { name: "Birthdays" })).toBeNull();
  });

  it("(F) says each day once over its items, and only the time on an item", () => {
    const at = (key: string, stamp: string, when: string): FeedItem => ({ ...timesheets, key, who: { name: key, sm8: true }, at: stamp, when });
    render(
      <WindowsContext.Provider value={windows}>
        <TiffContext.Provider value={tiff}>
          <HomeScreen today={today()} todo={[]} day="2026-11-17" feed={[at("Now a work order", "2026-11-17 09:12:00", "9:12 am"), at("New job", "2026-11-16 15:00:00", "Mon 16 Nov, 3:00 pm"), at("Photos", "2026-11-12 08:00:00", "Thu 12 Nov, 8:00 am")]} />
        </TiffContext.Provider>
      </WindowsContext.Provider>,
    );
    const feed = feedPanel();
    expect(within(feed).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Today", "Yesterday", "Thu 12 Nov"]);
    const yesterday = within(feed).getByRole("list", { name: "Activity feed, Yesterday" });
    expect(within(yesterday).getByText("3:00 pm")).toBeInTheDocument();
    expect(within(yesterday).queryByText(/Mon 16 Nov/)).toBeNull();
  });

  it("says nothing is new in the Activity feed when nothing is", () => {
    draw(today(), []);
    expect(within(feedPanel()).getByText("Nothing new")).toBeInTheDocument();
  });
});

describe("To do's Reply, on Home", () => {
  const NOTE = "01a10eef-eecb-7c94-9d9a-7d44b2e4b19b";
  const mention = (n: number): FeedItem => ({
    key: `talk:${n}`,
    filter: "you",
    who: { name: n === 0 ? "Luke Parker" : `Person ${n}`, sm8: false },
    what: "mentioned you",
    said: "can you order two grille filters?",
    yours: null,
    when: "",
    at: "2026-10-20 12:00:00",
    unread: false,
    act: null,
    reply: { jobUuid: "job-1", sourceNoteUuid: `n${n}`, closesTaskId: null },
    open: null,
    notes: n === 0 ? [NOTE] : [`other-${n}`],
  });

  /* Isaac, 25 October 2026: on Home "if you click any of the buttons…
     they don't do anything". The Reply was a link to Home itself: seconds
     of nothing, then the box under the fold. */
  it("(F) opens the mention's box in Your feed at once, first, without reading Home again", async () => {
    const feed = [...Array.from({ length: 10 }, (_, i) => mention(i + 1)), mention(0)];
    draw(today(), [link("task:m1", "Which fans for Rozelle?", "Reply", `/dashboard?reply=${NOTE}`, { source: "list" })], feed);
    const todo = section("To do");
    expect(within(todo).queryByRole("link", { name: /Rozelle/ })).toBeNull();
    /* the row itself is the Reply (Isaac, 5 November 2026) */
    await userEvent.click(within(todo).getByRole("button", { name: "Which fans for Rozelle?" }));
    const items = within(screen.getByRole("list", { name: "Activity feed" })).getAllByRole("listitem");
    expect(within(items[0]).getByRole("textbox", { name: "Reply to Luke Parker" })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("To do", () => {
  it("(F) has no count, and no buttons: each row goes where its button went (Isaac, 5 November 2026)", () => {
    draw();
    const s = section("To do");
    expect(within(s).queryByText(String(ROWS.length))).toBeNull();
    expect(within(s).getByRole("link", { name: "Hilux, XQG41B" })).toHaveAttribute("href", "/dashboard/assets?v=v1&screen=rego");
    expect(within(s).getByRole("link", { name: "Which fans for Rozelle?" })).toHaveAttribute("href", "/dashboard/desk?ask=n-77");
    expect(within(s).getByRole("link", { name: "Timesheets" })).toHaveAttribute("href", "/dashboard/timepay");
    expect(within(s).getByRole("link", { name: "Toolbox talk" })).toHaveAttribute("href", "/dashboard/notices");
    expect(within(s).queryByRole("link", { name: /^(Renew|Reply|Review|Open), / })).toBeNull();
    expect(within(s).queryByRole("button", { name: /^(Got it|Open|Book in), / })).toBeNull();
    /* a reminder keeps Later, the one thing nothing else does */
    expect(within(s).getByRole("button", { name: "Later, Ring the Hilux dealer" })).toBeInTheDocument();
  });

  /* in the Activity feed a row leads with the job feed's checklist disc,
     where an item's face goes, or its tick; the trouble stays in its colour */
  it("(F) leads each row with the checklist disc or its tick, and says the trouble in its colour", () => {
    draw();
    expect(rowOf("Hilux, XQG41B").querySelector(".hm-feed-av--thing")).not.toBeNull();
    expect(rowOf("Hilux, XQG41B").querySelector(".pt-dot")).toBeNull();
    expect(within(rowOf("Hilux, XQG41B")).getByText("Rego ran out Sun 20 Sept")).toHaveClass("hm-line--wrong");
    expect(within(rowOf("Ring the Hilux dealer")).getByRole("checkbox", { name: "Done, Ring the Hilux dealer" })).toBeInTheDocument();
  });

  it("(F) Later offers the bell's three and puts the reminder off", async () => {
    draw();
    await userEvent.click(screen.getByRole("button", { name: "Later, Ring the Hilux dealer" }));
    const menu = screen.getByRole("menu", { name: "Remind me" });
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["An hour", "Tomorrow", "Next week"]);
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Tomorrow" }));
    expect(snoozeReminder).toHaveBeenCalledWith("t9", "tomorrow");
    expect(screen.queryByText("Ring the Hilux dealer")).toBeNull();
  });

  it("(F) opening new work says you've seen it", async () => {
    const asked = jest.fn();
    window.addEventListener("heytiff:bell-refresh", asked);
    draw();
    await act(async () => {
      fireEvent.click(within(section("To do")).getByRole("button", { name: "Measure up Rozelle" }));
    });
    expect(acknowledgeTask).toHaveBeenCalledWith("a1");
    expect(completeTask).not.toHaveBeenCalled();
    // the sidebar's count asks again, and the page reads again
    expect(asked).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    window.removeEventListener("heytiff:bell-refresh", asked);
  });

  it("(F) a won job's row opens Book in over Home with the job filled in", async () => {
    const won: TodoRow = {
      key: "job:j1",
      source: "list",
      tone: "look",
      name: "Job 2380, Kingsford",
      line: "Won today. No day yet",
      lineTone: false,
      tick: null,
      act: { kind: "bookIn", label: "Book in", jobUuid: "j1", href: "/dashboard/jobs/j1?tab=on-site" },
    };
    draw(today(), [won]);
    expect(within(rowOf("Job 2380, Kingsford")).queryByRole("link")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Job 2380, Kingsford" }));
    });
    const form = screen.getByRole("dialog", { name: "Book a visit" });
    expect(within(form).getByText("Job 2380, Kingsford")).toBeInTheDocument();
    expect(readBookInContext).toHaveBeenCalledWith(expect.objectContaining({ jobUuid: "j1" }));
    await userEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Book a visit" })).toBeNull();
  });

  it("(F) a task's tick finishes it from To do", async () => {
    draw();
    await act(async () => {
      fireEvent.click(within(rowOf("Ring the Hilux dealer")).getByRole("checkbox", { name: "Done, Ring the Hilux dealer" }));
    });
    expect(completeTask).toHaveBeenCalledWith("t9", { postDone: true });
  });

  it("(F) shows the first few, with Show all to the rest; none when it is all of it", () => {
    const many = Array.from({ length: TODO_HOME_CAP + 3 }, (_, i) => link(`k${i}`, `Thing ${i}`, "Open", "/x"));
    draw(today(), many);
    const s = section("To do");
    expect(within(s).getAllByRole("listitem")).toHaveLength(TODO_HOME_CAP);
    expect(within(s).getByRole("link", { name: "Show all" })).toHaveAttribute("href", "/dashboard/todo");
    cleanup();
    draw(today(), many.slice(0, TODO_HOME_CAP));
    expect(within(section("To do")).queryByRole("link", { name: "Show all" })).toBeNull();
  });

  it("says nothing is waiting, with no button, when nothing is", async () => {
    draw(today(), []);
    await userEvent.click(screen.getByRole("radio", { name: "To do" }));
    expect(within(feedPanel()).getByText("Nothing is waiting on you")).toBeInTheDocument();
  });

  it("(F) Show all's page is every row, under its own title", () => {
    const many = Array.from({ length: TODO_HOME_CAP + 3 }, (_, i) => link(`k${i}`, `Thing ${i}`, "Open", "/x"));
    render(
      <WindowsContext.Provider value={windows}>
        <HomeTodo rows={many} all headingLevel={1} />
      </WindowsContext.Provider>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "To do" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(many.length);
    expect(screen.queryByRole("link", { name: "Show all" })).toBeNull();
  });
});
