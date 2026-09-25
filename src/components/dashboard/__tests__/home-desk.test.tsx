import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DashboardDesk } from "../home-desk";
import type { DashboardData, HomeRail } from "@/lib/dashboard/page-data";
import type { DashTask } from "@/lib/dashboard/tasks";
import type { JournalEntry } from "@/lib/dashboard/journal";
import type { ScheduleBlock } from "@/lib/workboard/schedule";
import type { AllJobsMirrorJob } from "@/lib/workboard/all-jobs";

/* THE NEW HOME'S FRAME (H11): the date in the band, "Your day" on every
   face, ONE row of tabs that never moves, and a body that slides in tab
   order. The faces hold today's diary, tasks and calendar for now; each has
   its own suite, so this one is about the frame around them — and about the
   doors between them and the one job card they share.

   The capture controls and the job card reach server actions, and "use
   server" modules cannot be imported into jsdom: stubbed, as on Home. */
jest.mock("@/components/notes/note-token", () => ({
  NoteToken: ({ placeholder }: { placeholder?: string }) => (
    <button aria-label={placeholder ?? "Add to the diary…"} />
  ),
}));
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
}));

const TODAY = "2026-08-10";

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
  issues: [],
  canManage: false,
  viewerStaffId: "s1",
  today: TODAY,
  rail: rail(),
  desk: { warnDays: 30 },
  ...over,
});

const draw = (over: Partial<DashboardData> = {}) => render(<DashboardDesk data={data(over)} />);
const tab = (name: string) => screen.getByRole("tab", { name });
const face = (key: string) => document.getElementById(`hdsec-${key}`)!;
const main = () => document.querySelector<HTMLElement>(".hd-main")!;
const shownFaces = () => ["diary", "tasks", "calendar"].filter((k) => !face(k).hasAttribute("hidden"));

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
    draw({ journal: [entry({ said: "Long day, two callouts.", isDebrief: true })] });
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
      },
    });

  it("takes a diary door to its task on the Tasks face", async () => {
    const user = userEvent.setup();
    render(<DashboardDesk data={wired()} />);
    await user.click(screen.getByRole("button", { name: /Order 2× MERV 11 filters/ }));
    expect(tab("Tasks")).toHaveAttribute("aria-selected", "true");
    expect(shownFaces()).toEqual(["tasks"]);
    expect(document.querySelector('[data-task-id="t1"]')).toHaveClass("on");
    expect(document.querySelector('[data-task-id="t0"]')).not.toHaveClass("on");
  }, WHOLE);

  it("takes a task's Open in diary to the entry that made it", async () => {
    const user = userEvent.setup();
    render(<DashboardDesk data={wired()} />);
    await user.click(screen.getByRole("button", { name: /Something older/ }));
    await user.click(tab("Tasks"));
    await user.click(within(face("tasks")).getByRole("button", { name: /^Order 2× MERV 11 filters/ }));
    await user.click(screen.getByRole("button", { name: "Open in diary" }));
    expect(shownFaces()).toEqual(["diary"]);
    expect(face("diary").querySelector(".hm-said")!.textContent).toBe(
      "Order the filters for Bayview before Thursday",
    );
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
