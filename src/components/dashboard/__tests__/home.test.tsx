import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { FeedItem } from "@/lib/dashboard/your-feed";
import userEvent from "@testing-library/user-event";
import { HomeScreen } from "../home";
import { HomeTodo } from "../home-todo";
import { TiffContext, type TiffApi } from "@/components/tiff/modal/tiff-context";
import { WindowsContext, type WindowsApi } from "@/components/records/records-context";
import { TODO_HOME_CAP, type TodoRow } from "@/lib/dashboard/todo";
import type { TodayRow, TodayView } from "@/lib/dashboard/home-today";

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

const draw = (view: TodayView = today(), rows: TodoRow[] = ROWS, feed: FeedItem[] = []) =>
  render(
    <WindowsContext.Provider value={windows}>
      <TiffContext.Provider value={tiff}>
        <HomeScreen today={view} todo={rows} feed={feed} voice />
      </TiffContext.Provider>
    </WindowsContext.Provider>,
  );

const section = (name: string) => screen.getByRole("heading", { name }).closest("section")!;
const rowOf = (name: string) => screen.getByText(name).closest("li")!;

afterEach(cleanup);
beforeEach(() => {
  [completeTask, reopenTask, snoozeReminder, acknowledgeTask, open, toast, refresh, startDictation].forEach((m) => m.mockClear());
});

describe("the box", () => {
  it("(F) is Tiff's box under her mark: the words, the microphone and Send", () => {
    draw();
    expect(screen.getByRole("img", { name: "Tiff" })).toBeInTheDocument();
    const field = screen.getByRole("textbox", { name: "What's happening on site?" });
    expect(field).toHaveAttribute("placeholder", "What's happening on site?");
    expect(screen.getByRole("button", { name: "Speak instead of typing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("(F) her mark is three times the size and turns at rest, in her colours", () => {
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
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(open).not.toHaveBeenCalled();
  });

  it("(F) Send starts the conversation on the page, in place of the columns, and no window opens", async () => {
    draw();
    await userEvent.type(screen.getByRole("textbox", { name: "What's happening on site?" }), "Finished the Rifkin install");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    const chat = screen.getByRole("region", { name: "Talking to Tiff" });
    expect(chat).toHaveTextContent("Finished the Rifkin install");
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Today" })).toBeNull();
  });

  it("(F) Back to Home brings the box and the columns back, the box empty", async () => {
    draw();
    await userEvent.type(screen.getByRole("textbox", { name: "What's happening on site?" }), "Two filters for 3342{Enter}");
    expect(screen.getByRole("region", { name: "Talking to Tiff" })).toHaveTextContent("Two filters for 3342");
    await userEvent.click(screen.getByRole("button", { name: "Back to Home" }));
    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "What's happening on site?" })).toHaveValue("");
  });
});

describe("the three columns", () => {
  /* Activity became Your feed (Isaac, 20 October 2026) */
  it("(F) puts what is due today under Today, what comes to you in Your feed, and the rest under To do", () => {
    draw(
      today(),
      [link("chip:rego", "Hilux, XQG41B", "Renew", "/r", { col: "today", tone: "wrong" }), link("k1", "Price the Truecut quote", "Open", "/q")],
      [{ key: "timesheets", filter: "approvals", who: { name: "Timesheets", sm8: false }, what: "3 to approve", said: null, yours: null, when: "", at: "2026-10-20 13:00:00", unread: false, act: { kind: "link", label: "Review", href: "/dashboard/team?view=timesheets" }, reply: null, open: { href: "/dashboard/team?view=timesheets" } }],
    );
    expect(within(section("Today")).getByText("Hilux, XQG41B")).toBeInTheDocument();
    expect(within(section("Your feed")).getByText("Timesheets")).toBeInTheDocument();
    expect(within(section("To do")).getByText("Price the Truecut quote")).toBeInTheDocument();
    expect(within(section("To do")).queryByText("Timesheets")).toBeNull();
  });

  it("(F) heads each column with a solid block of its colour", () => {
    draw();
    for (const [name, hue] of [["Today", "purple"], ["To do", "yellow"], ["Your feed", "green"]] as const) {
      const head = screen.getByRole("heading", { name }).parentElement!;
      expect(head.querySelector(".hm-blk")).toHaveClass(`hm-blk--${hue}`);
    }
  });

  it("says nothing is new in Your feed when nothing is", () => {
    draw(today(), []);
    expect(within(section("Your feed")).getByText("Nothing new")).toBeInTheDocument();
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
    expect(within(todo).queryByRole("link", { name: /Reply/ })).toBeNull();
    await userEvent.click(within(todo).getByRole("button", { name: "Reply, Which fans for Rozelle?" }));
    const items = within(screen.getByRole("list", { name: "Your feed" })).getAllByRole("listitem");
    expect(within(items[0]).getByRole("textbox", { name: "Reply to Luke Parker" })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("To do", () => {
  it("(F) has no count, and every row has one button that goes where it should", () => {
    draw();
    const s = section("To do");
    expect(within(s).queryByText(String(ROWS.length))).toBeNull();
    expect(within(s).getByRole("link", { name: "Renew, Hilux, XQG41B" })).toHaveAttribute("href", "/dashboard/assets?v=v1&screen=rego");
    expect(within(s).getByRole("link", { name: "Reply, Which fans for Rozelle?" })).toHaveAttribute("href", "/dashboard/desk?ask=n-77");
    expect(within(s).getByRole("link", { name: "Review, Timesheets" })).toHaveAttribute("href", "/dashboard/timepay");
    expect(within(s).getByRole("link", { name: "Open, Toolbox talk" })).toHaveAttribute("href", "/dashboard/notices");
    expect(within(s).getByRole("button", { name: "Later, Ring the Hilux dealer" })).toBeInTheDocument();
    expect(within(s).getByRole("button", { name: "Got it, Measure up Rozelle" })).toBeInTheDocument();
  });

  it("(F) says each row's state with its dot, and the trouble in its colour", () => {
    draw();
    expect(rowOf("Hilux, XQG41B").querySelector(".pt-dot--red")).not.toBeNull();
    expect(within(rowOf("Hilux, XQG41B")).getByText("Rego ran out Sun 20 Sept")).toHaveClass("hm-line--wrong");
    expect(rowOf("Ring the Hilux dealer").querySelector(".pt-dot--orange")).not.toBeNull();
    expect(rowOf("Toolbox talk").querySelector(".pt-dot--grey")).not.toBeNull();
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

  it("(F) Got it says you've seen it, and the row goes", async () => {
    const asked = jest.fn();
    window.addEventListener("heytiff:bell-refresh", asked);
    draw();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Got it, Measure up Rozelle" }));
    });
    expect(acknowledgeTask).toHaveBeenCalledWith("a1");
    expect(completeTask).not.toHaveBeenCalled();
    expect(screen.queryByText("Measure up Rozelle")).toBeNull();
    // the sidebar's count asks again, and the page reads again
    expect(asked).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    window.removeEventListener("heytiff:bell-refresh", asked);
  });

  it("(F) a won job's Book in opens the Visit form over Home with the job filled in, and its row still opens the job", async () => {
    const won: TodoRow = {
      key: "job:j1",
      source: "list",
      tone: "look",
      name: "Job 2380, Kingsford",
      line: "Won today. No day yet",
      lineTone: false,
      tick: null,
      act: { kind: "bookIn", label: "Book in", jobUuid: "j1", href: "/dashboard/jobs/j1?tab=visits" },
    };
    draw(today(), [won]);
    expect(within(rowOf("Job 2380, Kingsford")).getAllByRole("link")[0]).toHaveAttribute("href", "/dashboard/jobs/j1?tab=visits");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Book in, Job 2380, Kingsford" }));
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

  it("says nothing is waiting, with no button, when nothing is", () => {
    draw(today(), []);
    expect(within(section("To do")).getByText("Nothing is waiting on you")).toBeInTheDocument();
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
