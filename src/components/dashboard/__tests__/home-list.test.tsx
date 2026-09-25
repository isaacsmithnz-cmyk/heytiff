import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FLASH_MS, FOLD_MS, HOLD_MS, HomeList } from "../home-list";
import { issueSeenWords } from "../home-list-issue";
import { DeskJobHost } from "../home-job-sheet";
import {
  LIST_EMPTY,
  placeList,
  type HomeList as HomeListData,
  type ListCaps,
  type ListInput,
} from "@/lib/dashboard/home-list";
import { vehicleChips } from "@/lib/dashboard/chips";
import type { DeskFocus } from "@/lib/dashboard/desk-focus";
import type { DashTask } from "@/lib/dashboard/tasks";
import type { JournalEntry } from "@/lib/dashboard/journal";
import type { HomeIssue } from "@/lib/dashboard/issues";
import type { AllJobsMirrorJob } from "@/lib/workboard/all-jobs";
import type { VehicleWithFacts } from "@/components/fleet/logic";

/* THE NEW HOME'S LIST, ON SCREEN (H19). The rules and the words are
   lib/dashboard/home-list's and have their own suite; every list here is
   placed by them, so what is pinned is what the screen does with a row:
   the groups it draws, the door each row opens, what a tick, a resolve
   and a booking say and undo, and a list that holds still until the row
   it was pressed on has folded away.

   The actions are server functions ("use server" cannot load in jsdom) and
   the job card is the board's: stubbed, as on the desk. */
const mockRouter = { refresh: jest.fn(), push: jest.fn() };
jest.mock("next/navigation", () => ({ useRouter: () => mockRouter }));
jest.mock("@/components/workboard/board/job-sheet", () => ({
  JobSheet: (p: { row: { number: string | null; clientName: string | null }; onClose: () => void }) => (
    <div role="dialog" aria-label={`Job ${p.row.number ?? ""}`}>
      {p.row.clientName}
      <button onClick={p.onClose}>Close the card</button>
    </div>
  ),
}));
const mockOpenMirrorJob = jest.fn();
jest.mock("@/app/actions/workboard", () => ({ openMirrorJob: (id: string) => mockOpenMirrorJob(id) }));
jest.mock("@/app/actions/dashboard", () => ({
  completeTask: jest.fn(),
  reopenTask: jest.fn(),
  resolveIssue: jest.fn(),
  reopenIssue: jest.fn(),
}));
jest.mock("@/app/actions/workboard-maintenance", () => ({
  placeVisit: jest.fn(),
  clearVisitPlacement: jest.fn(),
}));

import { completeTask, reopenIssue, reopenTask, resolveIssue } from "@/app/actions/dashboard";
import { clearVisitPlacement, placeVisit } from "@/app/actions/workboard-maintenance";

const DAY = "2026-09-25"; // a Friday
const ALL: ListCaps = { assetsAll: true, placeVisits: true, money: true, sm8: true };

const input = (over: Partial<ListInput> = {}): ListInput => ({
  day: DAY,
  tz: "Australia/Sydney",
  warnDays: 30,
  viewerStaffId: "me",
  names: { me: "Isaac", s3: "Leo" },
  tasks: [],
  journal: [],
  chips: [],
  issues: [],
  wins: [],
  visits: [],
  caps: ALL,
  ...over,
});
const place = (over: Partial<ListInput> = {}) => placeList(input(over));

const task = (over: Partial<DashTask> = {}): DashTask => ({
  id: "t1",
  title: "Ring the Hilux dealer",
  detail: null,
  assigneeId: "me",
  assigneeName: "Isaac Smith",
  dueDate: "2026-09-20",
  status: "open",
  createdBy: "me",
  createdAt: "2026-09-15T01:00:00Z",
  doneAt: null,
  doneByName: null,
  remindAt: null,
  remindKind: "at",
  ...over,
});

const entry = (id: string, taskIds: string[] = [], issueIds: string[] = []): JournalEntry => ({
  id,
  said: "Order filters for the next job",
  day: "2026-09-14",
  at: "8:42 pm",
  outcomes: [
    ...taskIds.map((t) => ({ kind: "todo" as const, text: "a task", go: { type: "task" as const, id: t } })),
    ...issueIds.map((i) => ({ kind: "kept" as const, text: "an issue", go: { type: "issue" as const, id: i } })),
  ],
  spoken: false,
});

const job = (over: Partial<AllJobsMirrorJob> = {}): AllJobsMirrorJob => ({
  remoteId: "j1",
  jobNumber: "3323",
  status: "Work Order",
  clientName: "Coogee Strata",
  description: null,
  suburb: "Randwick",
  categoryName: null,
  categoryColour: null,
  date: "2026-09-20 09:00:00",
  quoteDate: null,
  completionDate: null,
  nextBooking: null,
  money: { valueCents: 847_000, invoiced: null, invoicedOn: null, quoteSent: null, quoteSentOn: null, paid: false, paidOn: null },
  paidCents: 0,
  ...over,
});

const issue = (over: Partial<HomeIssue> = {}): HomeIssue => ({
  id: "i1",
  summary: "Rooftop unit keeps tripping",
  equipmentRef: null,
  occurrences: 1,
  firstSeen: "2026-07-30",
  lastSeen: "2026-09-14",
  targetKind: "none",
  targetId: null,
  where: null,
  ...over,
});

const vehicle = (over: Partial<VehicleWithFacts> = {}): VehicleWithFacts => ({
  id: "v1",
  name: "Spare van",
  make: "Toyota",
  model: "Hiace",
  year: 2019,
  plate: "CY14FE",
  plateState: "NSW",
  status: "active",
  odometer: 90_000,
  regoDays: 200,
  insuranceDays: 200,
  ctpDays: 200,
  serviceIntervalKm: 10_000,
  lastServiceOdo: 88_000,
  serviceIntervalMonths: null,
  serviceDays: null,
  motorised: true,
  ...over,
});
const van = (over: Partial<VehicleWithFacts>) =>
  vehicleChips(vehicle(over), { subject: over.name ?? "Spare van", href: "/dashboard/my-vehicle", warnDays: 30, today: DAY });

const visit = { id: "vis1", clientName: "Bayview Apartments", label: "annual service", dueDate: "2026-09-25" };

/* ── drawing it ── */

function draw(list: HomeListData, props: { flash?: DeskFocus | null; onFlashDone?: () => void; inert?: boolean } = {}) {
  const onShow = jest.fn();
  const tree = (l: HomeListData) => (
    <DeskJobHost manage={false} moneyVisible={false}>
      <HomeList list={l} onShow={onShow} {...props} />
    </DeskJobHost>
  );
  const view = render(tree(list));
  return { onShow, rerender: (next: HomeListData) => view.rerender(tree(next)) };
}

/** The four seconds and the fold on a clock the test holds. */
const clock = () => jest.useFakeTimers();
/** Let an action's answer land. It is a few awaits deep, and the pointer's
    own zero-length waits are on the held clock too, so the clock is let
    run by nothing at all between them, inside act. */
const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await jest.advanceTimersByTimeAsync(0);
  });
const heads = () => screen.queryAllByRole("heading", { level: 2 }).map((h) => h.textContent);
const rowOf = (title: string) => screen.getByText(title).closest("li")!;
const lineOf = (title: string) => rowOf(title).querySelector<HTMLElement>(".hd-ls-row")!;

beforeEach(() => {
  jest.clearAllMocks();
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("the groups", () => {
  it("are Late, Today, Jobs to book, No date and Later, each counting the things in it", () => {
    draw(
      place({
        tasks: [
          task({ id: "a", title: "Late one", dueDate: "2026-09-20" }),
          task({ id: "b", title: "Today one", dueDate: DAY }),
          task({ id: "c", title: "Undated one", dueDate: null }),
          task({ id: "d", title: "Later one", dueDate: "2026-10-20" }),
        ],
        wins: [
          { job: job({ remoteId: "j1" }), wonOn: "2026-09-24" },
          { job: job({ remoteId: "j2", jobNumber: "3050", suburb: "Oatley" }), wonOn: "2026-07-01" },
          { job: job({ remoteId: "j3", jobNumber: "3100", suburb: "Kogarah" }), wonOn: "2026-08-01" },
        ],
      }),
    );
    // "Jobs to book" holds one roll-up of two jobs: it says 2
    expect(heads()).toEqual(["Late 1", "Today 2", "Jobs to book 2", "No date 1", "Later 1"]);
  });

  it("put Late in the late red and Today in the teal, and the count quiet beside the title", () => {
    draw(place({ tasks: [task({ id: "a", dueDate: "2026-09-20" }), task({ id: "b", title: "Today one", dueDate: DAY })] }));
    const late = screen.getByRole("heading", { name: "Late 1" });
    const today = screen.getByRole("heading", { name: "Today 1" });
    expect(late).toHaveClass("hd-ls-grp", "late");
    expect(today).toHaveClass("hd-ls-grp", "today");
    expect(late.querySelector(".hd-ls-n")).toHaveTextContent("1");
  });

  it("leave nothing but one line when nothing is waiting", () => {
    draw(place());
    expect(heads()).toEqual([]);
    expect(screen.getByText(LIST_EMPTY)).toBeInTheDocument();
  });

  it("put a task before the alerts under it", () => {
    draw(place({ tasks: [task({ dueDate: "2026-09-20" })], chips: van({ regoDays: -8 }) }));
    const rows = screen.getByRole("heading", { name: "Late 2" }).nextElementSibling!.children;
    expect(rows[0]!.querySelector('[role="checkbox"]')).not.toBeNull();
    expect(rows[1]!.querySelector(".hd-ls-dot")).toHaveAttribute("data-dot", "late");
  });

  it("tag someone else's task with their first name, and yours with nothing", () => {
    draw(
      place({
        tasks: [
          task({ id: "t1", title: "Mine" }),
          task({ id: "t2", title: "Leo's", assigneeId: "s3", assigneeName: "Leo Marsh" }),
        ],
      }),
    );
    expect(within(rowOf("Leo's")).getByText("Leo")).toHaveClass("hd-ls-tag");
    expect(rowOf("Mine").querySelector(".hd-ls-tag")).toBeNull();
  });

  it("stand still to the keyboard and the reader while the Calendar is over them", () => {
    draw(place(), { inert: true });
    expect(screen.getByRole("complementary", { name: "The list" })).toHaveAttribute("inert");
  });
});

describe("ticking a task", () => {
  const two = () =>
    place({ tasks: [task({ id: "t1", title: "Ring the Hilux dealer" }), task({ id: "t2", title: "Order the filters", dueDate: "2026-09-21" })] });
  const onlyT2 = () => place({ tasks: [task({ id: "t2", title: "Order the filters", dueDate: "2026-09-21" })] });

  it("says Done. with Undo, holds the list still for four seconds, then folds the row away and counts again", async () => {
    clock();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    (completeTask as jest.Mock).mockResolvedValue({ ok: true });
    const { rerender } = draw(two());

    await user.click(within(rowOf("Ring the Hilux dealer")).getByRole("checkbox", { name: "Tick it off" }));
    await flush();
    expect(completeTask).toHaveBeenCalledWith("t1");
    expect(within(rowOf("Ring the Hilux dealer")).getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
    expect(lineOf("Ring the Hilux dealer").querySelector(".hd-ls-sub")).toHaveTextContent("Done. Undo");
    expect(mockRouter.refresh).toHaveBeenCalled();

    // the page comes back without it: the list holds the one it was pressed on
    rerender(onlyT2());
    expect(screen.getByText("Ring the Hilux dealer")).toBeInTheDocument();
    expect(heads()).toEqual(["Late 2"]);

    act(() => jest.advanceTimersByTime(HOLD_MS - 1));
    expect(rowOf("Ring the Hilux dealer")).not.toHaveAttribute("data-leaving");
    act(() => jest.advanceTimersByTime(1));
    expect(rowOf("Ring the Hilux dealer")).toHaveAttribute("data-leaving");
    expect(within(rowOf("Ring the Hilux dealer")).queryByRole("button", { name: "Undo" })).toBeNull();
    act(() => jest.advanceTimersByTime(FOLD_MS));
    expect(screen.queryByText("Ring the Hilux dealer")).toBeNull();
    expect(heads()).toEqual(["Late 1"]);
  });

  it("puts the row back as it was on Undo, and folds nothing", async () => {
    clock();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    (completeTask as jest.Mock).mockResolvedValue({ ok: true });
    (reopenTask as jest.Mock).mockResolvedValue({ ok: true });
    const { rerender } = draw(two());
    await user.click(within(rowOf("Ring the Hilux dealer")).getByRole("checkbox", { name: "Tick it off" }));
    await flush();
    rerender(onlyT2());
    await user.click(within(rowOf("Ring the Hilux dealer")).getByRole("button", { name: "Undo" }));
    await flush();
    expect(reopenTask).toHaveBeenCalledWith("t1");
    /* Taken back while the page's list is still the one without it: the row
       stands as it was rather than blinking out until the fresh one comes. */
    expect(within(rowOf("Ring the Hilux dealer")).getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
    expect(heads()).toEqual(["Late 2"]);
    // reopened, the page has it again — and whatever else is new on it, at once
    rerender(
      place({
        tasks: [
          task({ id: "t1", title: "Ring the Hilux dealer" }),
          task({ id: "t2", title: "Order the filters", dueDate: "2026-09-21" }),
          task({ id: "t9", title: "Just added", dueDate: "2026-09-22" }),
        ],
      }),
    );
    expect(heads()).toEqual(["Late 3"]);
    act(() => jest.advanceTimersByTime(HOLD_MS + FOLD_MS));
    const row = rowOf("Ring the Hilux dealer");
    expect(row).not.toHaveAttribute("data-leaving");
    expect(within(row).getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
    expect(row.querySelector(".hd-ls-sub")).toHaveTextContent("Due Sun 20 Sept.");
  });

  it("unticks the box and says the action's own words when it fails, and holds nothing", async () => {
    clock();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    (completeTask as jest.Mock).mockResolvedValue({ ok: false, error: "That task isn't yours to complete." });
    const { rerender } = draw(two());
    await user.click(within(rowOf("Ring the Hilux dealer")).getByRole("checkbox", { name: "Tick it off" }));
    await flush();
    const sub = lineOf("Ring the Hilux dealer").querySelector(".hd-ls-sub")!;
    expect(sub).toHaveTextContent("That task isn't yours to complete.");
    expect(sub).toHaveClass("late");
    expect(within(rowOf("Ring the Hilux dealer")).getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
    expect(mockRouter.refresh).not.toHaveBeenCalled();
    // nothing is held: the next list is the one on screen
    rerender(onlyT2());
    expect(screen.queryByText("Ring the Hilux dealer")).toBeNull();
  });

  it("says its own words when the action cannot be reached at all", async () => {
    const user = userEvent.setup();
    (completeTask as jest.Mock).mockRejectedValue(new Error("offline"));
    draw(two());
    await user.click(within(rowOf("Ring the Hilux dealer")).getByRole("checkbox", { name: "Tick it off" }));
    expect(lineOf("Ring the Hilux dealer").querySelector(".hd-ls-sub")).toHaveTextContent("Couldn't complete that task.");
  });
});

describe("a row's door", () => {
  it("opens a diary-born task's entry, and any other task on the Tasks face", async () => {
    const user = userEvent.setup();
    const { onShow } = draw(
      place({
        tasks: [task({ id: "t1", title: "From the diary" }), task({ id: "t2", title: "Typed straight in" })],
        journal: [entry("e1", ["t1"])],
      }),
    );
    await user.click(screen.getByRole("button", { name: "From the diary" }));
    expect(onShow).toHaveBeenLastCalledWith({ face: "diary", kind: "entry", ids: ["e1"] }, true);
    await user.click(screen.getByRole("button", { name: "Typed straight in" }));
    expect(onShow).toHaveBeenLastCalledWith({ face: "tasks", kind: "task", ids: ["t2"] }, true);
  });

  it("opens a mention's task on its conversation", async () => {
    const user = userEvent.setup();
    const { onShow } = draw(
      place({ tasks: [task({ id: "t1", title: "Call Mary" })], mentions: [{ taskId: "t1", noteId: "n1", asker: "Luke", day: "2026-09-21" }] }),
    );
    await user.click(screen.getByRole("button", { name: "Call Mary" }));
    expect(onShow).toHaveBeenLastCalledWith({ face: "diary", kind: "conversation", ids: ["n1"] }, true);
  });

  it("says whether a pointer or a key pressed it, so the face slides only for a pointer", async () => {
    const user = userEvent.setup();
    const { onShow } = draw(place({ tasks: [task({ title: "Typed straight in" })] }));
    screen.getByRole("button", { name: "Typed straight in" }).focus();
    await user.keyboard("{Enter}");
    expect(onShow).toHaveBeenLastCalledWith({ face: "tasks", kind: "task", ids: ["t1"] }, false);
  });

  it("is the whole row's: a press on its words goes through the title", async () => {
    const user = userEvent.setup();
    const { onShow } = draw(place({ tasks: [task({ title: "Typed straight in" })] }));
    await user.click(lineOf("Typed straight in").querySelector(".hd-ls-sub")!);
    expect(onShow).toHaveBeenCalledWith({ face: "tasks", kind: "task", ids: ["t1"] }, true);
  });

  it("is not the box's, nor the verb's", async () => {
    const user = userEvent.setup();
    (completeTask as jest.Mock).mockResolvedValue({ ok: true });
    mockOpenMirrorJob.mockResolvedValue({ id: "j7", number: "1042", clientName: "Bayview Apartments" });
    const { onShow } = draw(
      place({
        tasks: [task({ title: "Typed straight in" })],
        issues: [issue({ targetKind: "job", targetId: "j7", where: "Job 1042, Bayview Apartments" })],
      }),
    );
    await user.click(within(rowOf("Typed straight in")).getByRole("checkbox"));
    expect(onShow).not.toHaveBeenCalled();
    const issueTitle = screen.getByRole("button", { name: "Rooftop unit keeps tripping" });
    await user.click(within(rowOf("Rooftop unit keeps tripping")).getByRole("button", { name: "Create job" }));
    expect(issueTitle).toHaveAttribute("aria-expanded", "false");
    expect(await screen.findByRole("dialog", { name: "Job 1042" })).toBeInTheDocument();
  });

  it("follows a vehicle to its card on the register, and Renew to its renewal", () => {
    draw(place({ chips: van({ regoDays: -8 }) }));
    const row = rowOf("Spare van, CY14FE");
    expect(within(row).getByRole("link", { name: "Spare van, CY14FE" })).toHaveAttribute("href", "/dashboard/assets?v=v1");
    expect(within(row).getByRole("link", { name: "Renew" })).toHaveAttribute("href", "/dashboard/assets?v=v1&screen=rego");
    expect(row.querySelector(".hd-ls-sub")).toHaveClass("late");
  });

  it("opens a won job on the desk's one card, with Book in on the Schedule and its value beside it", async () => {
    const user = userEvent.setup();
    draw(place({ wins: [{ job: job(), wonOn: "2026-09-24" }] }));
    const row = rowOf("Job 3323, Randwick");
    expect(within(row).getByRole("link", { name: "Book in" })).toHaveAttribute("href", "/dashboard/workboard?job=j1");
    expect(row.querySelector(".hd-ls-fig")).toHaveTextContent("$8,470");
    await user.click(within(row).getByRole("button", { name: "Job 3323, Randwick" }));
    // the row the list carries, not a second read of the mirror
    expect(screen.getByRole("dialog", { name: "Job 3323" })).toHaveTextContent("Coogee Strata");
    expect(mockOpenMirrorJob).not.toHaveBeenCalled();
  });
});

describe("what opens in place", () => {
  const wins = () =>
    place({
      wins: [
        { job: job({ remoteId: "j2", jobNumber: "3050", suburb: "Oatley" }), wonOn: "2026-07-01" },
        { job: job({ remoteId: "j3", jobNumber: "3100", suburb: "Kogarah" }), wonOn: "2026-08-01" },
      ],
    });

  it("lists a roll-up's jobs under it, each its own row, and folds them back", async () => {
    const user = userEvent.setup();
    draw(wins());
    const title = screen.getByRole("button", { name: "2 won jobs with no day" });
    expect(title).toHaveAttribute("aria-expanded", "false");
    expect(within(rowOf("2 won jobs with no day")).getByText("3050 Oatley").tagName).toBe("B");
    await user.click(title);
    expect(title).toHaveAttribute("aria-expanded", "true");
    const members = document.getElementById(title.getAttribute("aria-controls")!)!;
    expect(within(members).getByRole("button", { name: "Job 3050, Oatley" })).toBeInTheDocument();
    expect(within(members).getAllByRole("link", { name: "Book in" })).toHaveLength(2);
    await user.click(title);
    expect(screen.queryByRole("button", { name: "Job 3050, Oatley" })).toBeNull();
  });

  /* Law 8: what a pointer opens grows open; what a key opens is simply
     there. jsdom has no animation API, which is also how the list knows
     motion is off, so the pointer's case stands one up. */
  it("grows open for a pointer, and not for a key", async () => {
    const user = userEvent.setup();
    const realAnimate = Element.prototype.animate;
    Element.prototype.animate = jest.fn() as unknown as typeof Element.prototype.animate;
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
    try {
      draw(wins());
      const title = screen.getByRole("button", { name: "2 won jobs with no day" });
      await user.click(title);
      expect(document.getElementById(title.getAttribute("aria-controls")!)).toHaveAttribute("data-grow");
      await user.click(title);
      title.focus();
      await user.keyboard("{Enter}");
      expect(document.getElementById(title.getAttribute("aria-controls")!)).not.toHaveAttribute("data-grow");
    } finally {
      Element.prototype.animate = realAnimate;
      delete (window as { matchMedia?: unknown }).matchMedia;
    }
  });

  it("opens an issue on its facts, the diary entry that raised it, and Mark resolved", async () => {
    const user = userEvent.setup();
    const { onShow } = draw(place({ issues: [issue()], journal: [entry("e9", [], ["i1"])] }));
    const title = screen.getByRole("button", { name: "Rooftop unit keeps tripping" });
    await user.click(title);
    expect(title).toHaveAttribute("aria-expanded", "true");
    const facts = document.getElementById(title.getAttribute("aria-controls")!)!;
    expect(within(facts).getByText("Not on a job")).toHaveClass("unset");
    expect(within(facts).getByText("Not named")).toHaveClass("unset");
    expect(within(facts).getByText("Once, on Mon 14 Sept.")).toBeInTheDocument();
    await user.click(within(facts).getByRole("button", { name: "Open in diary" }));
    expect(onShow).toHaveBeenLastCalledWith({ face: "diary", kind: "entry", ids: ["e9"] }, true);
  });

  it("resolves an issue with Resolved. and Undo, and Undo reopens it", async () => {
    const user = userEvent.setup();
    (resolveIssue as jest.Mock).mockResolvedValue({ ok: true });
    (reopenIssue as jest.Mock).mockResolvedValue({ ok: true });
    draw(place({ issues: [issue()] }));
    await user.click(screen.getByRole("button", { name: "Rooftop unit keeps tripping" }));
    await user.click(screen.getByRole("button", { name: "Mark resolved" }));
    expect(resolveIssue).toHaveBeenCalledWith("i1");
    const row = rowOf("Rooftop unit keeps tripping");
    expect(row.querySelector(".hd-ls-sub")).toHaveTextContent("Resolved. Undo");
    expect(screen.queryByRole("button", { name: "Mark resolved" })).toBeNull();
    await user.click(within(row).getByRole("button", { name: "Undo" }));
    expect(reopenIssue).toHaveBeenCalledWith("i1");
    expect(row.querySelector(".hd-ls-sub")).toHaveTextContent("Open since Thu 30 July.");
  });

  it("books a visit on the day picked in its row, and Undo takes it off again", async () => {
    const user = userEvent.setup();
    (placeVisit as jest.Mock).mockResolvedValue({ ok: true });
    (clearVisitPlacement as jest.Mock).mockResolvedValue({ ok: true });
    draw(place({ visits: [visit] }));
    const row = rowOf("Bayview Apartments, annual service");
    const bookIn = within(row).getByRole("button", { name: "Book in" });
    await user.click(bookIn);
    expect(bookIn).toHaveAttribute("aria-expanded", "true");
    const field = within(document.getElementById(bookIn.getAttribute("aria-controls")!)!).getByRole("button", {
      name: "The day to book it in",
    });
    expect(document.activeElement).toBe(field);
    await user.click(field);
    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(placeVisit).toHaveBeenCalledWith("vis1", DAY);
    expect(row.querySelector(".hd-ls-sub")).toHaveTextContent("Booked for Fri 25 Sept. Undo");
    expect(within(row).queryByRole("button", { name: "Book in" })).toBeNull();
    await user.click(within(row).getByRole("button", { name: "Undo" }));
    expect(clearVisitPlacement).toHaveBeenCalledWith("vis1");
    expect(within(row).getByRole("button", { name: "Book in" })).toBeInTheDocument();
  });

  it("words how often an issue was seen", () => {
    expect(issueSeenWords({ occurrences: 1, firstSeen: "2026-07-30", lastSeen: "2026-07-30" })).toBe("Once, on Thu 30 July.");
    expect(issueSeenWords({ occurrences: 3, firstSeen: "2026-07-30", lastSeen: "2026-09-14" })).toBe(
      "3 times, first Thu 30 July, last Mon 14 Sept.",
    );
  });
});

describe("a door that asks for rows", () => {
  it("brings the first into view and lights them once, then hands the door back", () => {
    clock();
    const scrolled: Element[] = [];
    const real = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      const onFlashDone = jest.fn();
      const flash: DeskFocus = { face: "diary", kind: "rows", ids: ["t2", "i1"] };
      draw(
        place({
          tasks: [task({ id: "t1", title: "Not asked for" }), task({ id: "t2", title: "Asked for", dueDate: "2026-09-21" })],
          issues: [issue()],
        }),
        { flash, onFlashDone },
      );
      expect(lineOf("Asked for")).toHaveAttribute("data-lit");
      expect(lineOf("Rooftop unit keeps tripping")).toHaveAttribute("data-lit");
      expect(lineOf("Not asked for")).not.toHaveAttribute("data-lit");
      expect(scrolled).toEqual([rowOf("Asked for")]);
      act(() => jest.advanceTimersByTime(FLASH_MS));
      expect(onFlashDone).toHaveBeenCalledTimes(1);
      expect(lineOf("Asked for")).not.toHaveAttribute("data-lit");
    } finally {
      Element.prototype.scrollIntoView = real;
    }
  });

  it("is not a door of any other kind", () => {
    draw(place({ tasks: [task({ title: "Asked for" })] }), { flash: { face: "tasks", kind: "task", ids: ["t1"] } });
    expect(lineOf("Asked for")).not.toHaveAttribute("data-lit");
  });
});
