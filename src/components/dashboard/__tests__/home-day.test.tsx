import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { HomeDay } from "../home-day";
import { canvasMeasure } from "../home-day-bar";
import { DeskJobHost } from "../home-job-sheet";
import type { HomeRail } from "@/lib/dashboard/page-data";
import type { RailTask } from "@/lib/dashboard/day-rail";
import type { ScheduleBlock } from "@/lib/workboard/schedule";
import type { AllJobsMirrorJob } from "@/lib/workboard/all-jobs";
import { dayStateOfBlock } from "@/lib/workboard/focus";

/* YOUR DAY (H12): his slanted bar and the panel under it, still.

   The arithmetic — what folds, how wide, what colour — is day-bar's and has
   its own suite. This one is the section a person uses: which card is open
   on the first paint, what the panel says and does, every way it closes and
   every way it must NOT, the folded block, the notes above the bar, and the
   first paint matching the server's.

   The job card is the board's own and has its own suite: here it is a
   dialog that says what it was opened on, rendered by the desk's host
   OUTSIDE the page, as the real one is portalled to <body>. "use server"
   modules cannot be imported into jsdom, so the actions are stubbed. */
const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh, push: jest.fn() }),
}));
jest.mock("@/components/workboard/board/job-sheet", () => ({
  JobSheet: (p: {
    row: { number: string | null; clientName: string | null };
    scheduleState: { word: string } | null;
    onClose: () => void;
  }) => (
    <div role="dialog" aria-modal="true" aria-label={`Job ${p.row.number ?? ""}`}>
      {p.row.clientName}, {p.scheduleState?.word ?? "no state"}
      <button onClick={p.onClose}>Close the card</button>
    </div>
  ),
}));
jest.mock("@/app/actions/workboard", () => ({ openMirrorJob: jest.fn(async () => null) }));
const mockComplete = jest.fn(async (id: string) => void id);
jest.mock("@/app/actions/dashboard", () => ({
  completeTask: (id: string) => mockComplete(id),
}));

/* Never the browser's own date, so the browser's clock (useNowMin) stays
   out of it and the loader's `nowMin` is the time: 4:55pm, his walk. */
const DAY = "2026-08-10";
const hm = (h: number, m = 0) => h * 60 + m;

const block = (over: Partial<ScheduleBlock> = {}): ScheduleBlock => ({
  key: "a",
  remoteId: "j3342",
  jobNumber: "3342",
  clientName: "Bayview Apartments",
  suburb: "Sydney",
  status: "Work Order",
  categoryName: "Maintenance",
  categoryColour: "#b7e6c8",
  tracked: null,
  onSite: false,
  closure: "open",
  startMin: hm(8),
  endMin: hm(9),
  start: `${DAY} 08:00:00`,
  end: `${DAY} 09:00:00`,
  ...over,
});

const mirror = (remoteId: string, jobNumber: string, over: Partial<AllJobsMirrorJob> = {}): AllJobsMirrorJob => ({
  remoteId,
  jobNumber,
  status: "Work Order",
  clientName: `Client ${jobNumber}`,
  description: null,
  suburb: null,
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

const task = (over: Partial<RailTask> = {}): RailTask => ({
  id: "t1",
  title: "Call Reece about the filters",
  atMin: hm(15),
  kind: "at",
  overdue: false,
  ...over,
});

const rail = (over: Partial<HomeRail> = {}): HomeRail => ({
  dayISO: DAY,
  tz: "Australia/Sydney",
  blocks: [],
  linked: true,
  linkHref: null,
  tasks: [],
  nowMin: hm(16, 55),
  enabled: true,
  jobs: [],
  tracksTime: false,
  manage: true,
  moneyVisible: false,
  connected: true,
  where: {},
  crew: {},
  ...over,
});

/* HIS REAL THURSDAY: six bookings, 3342 twice, the evening overlapping. */
const THURSDAY = [
  { key: "a", no: "3342", place: "Sydney", from: hm(6, 30), to: hm(9) },
  { key: "b", no: "2313", place: "Darlinghurst", from: hm(9, 15), to: hm(10, 15) },
  { key: "c", no: "2587", place: "Lilli Pilli", from: hm(11, 30), to: hm(12, 30) },
  { key: "d", no: "3342", place: "Sydney", from: hm(16, 45), to: hm(17, 45) },
  { key: "e", no: "3315", place: "Willoughby East", from: hm(17), to: hm(18) },
  { key: "f", no: "1377", place: "Cremorne", from: hm(17, 45), to: hm(18, 45) },
];
const thursday = (over: Partial<HomeRail> = {}) =>
  rail({
    blocks: THURSDAY.map((t) =>
      block({ key: t.key, remoteId: `j${t.no}`, jobNumber: t.no, suburb: t.place, startMin: t.from, endMin: t.to }),
    ),
    jobs: [...new Set(THURSDAY.map((t) => t.no))].map((no) =>
      mirror(`j${no}`, no, no === "3342" ? { description: "Service AC units" } : {}),
    ),
    where: { j3342: "Carrington St, Sydney" },
    crew: { j3315: ["Luke", "Callum"] },
    ...over,
  });

/* Ten 45-minute bookings on the hour from 7am; at 4:30pm nine are done. */
const busy = (over: Partial<HomeRail> = {}) =>
  rail({
    blocks: Array.from({ length: 10 }, (_, i) =>
      block({ key: `k${i}`, remoteId: `j${i}`, jobNumber: String(1000 + i), suburb: "Ryde", startMin: hm(7 + i), endMin: hm(7 + i, 45) }),
    ),
    nowMin: hm(16, 30),
    ...over,
  });

const tree = (r: HomeRail) => (
  <DeskJobHost manage moneyVisible={false}>
    <div className="hd-page">
      <HomeDay rail={r} />
      <p>Elsewhere on the page</p>
      <div data-day-keep="">
        <button type="button">A tab</button>
      </div>
      <input aria-label="A face's box" />
    </div>
    <button type="button">Outside the page</button>
  </DeskJobHost>
);
const draw = (r: HomeRail) => render(tree(r));

const card = (name: string | RegExp) => screen.getByRole("button", { name });
const panel = () => document.querySelector<HTMLElement>(".hd-panw")!;
const isOpen = () => !panel().hidden && panel().querySelector(".hd-pan") !== null;
const LIVE = /^Sydney, Job 3342, 4:45–5:45pm/;

afterEach(() => {
  cleanup();
  mockRefresh.mockClear();
  mockComplete.mockClear();
});

describe("on the first paint", () => {
  it("is headed Your day, and draws your day in time order, each card named aloud whole", () => {
    draw(thursday());
    const day = screen.getByRole("region", { name: "Your day" });
    expect(within(day).getByRole("heading", { level: 2 })).toHaveTextContent("Your day");
    const names = [...document.querySelectorAll(".hd-card")].map((c) => c.getAttribute("aria-label"));
    expect(names).toEqual([
      "Sydney, Job 3342, 6:30–9am, Finished",
      "Darlinghurst, Job 2313, 9:15–10:15am, Finished",
      "Lilli Pilli, Job 2587, 11:30–12:30pm, Finished",
      "Sydney, Job 3342, 4:45–5:45pm, On now, 17%",
      "Willoughby East, Job 3315, 5–6pm, To come",
      "Cremorne, Job 1377, 5:45–6:45pm, To come",
    ]);
  });

  it("opens on the job on now, and the panel says what it is", () => {
    draw(thursday());
    const live = card(LIVE);
    expect(live).toHaveAttribute("aria-expanded", "true");
    expect(live).toHaveAttribute("data-live");
    expect(live.getAttribute("aria-controls")).toBe(panel().id);
    expect(isOpen()).toBe(true);
    const p = within(panel());
    expect(p.getByRole("heading", { level: 3 })).toHaveTextContent("Sydney");
    expect(panel().querySelector(".hd-pno")).toHaveTextContent("Job 3342");
    expect(panel().querySelector(".hd-chip")).toHaveTextContent("On now, 17%");
    expect(panel().querySelector(".hd-ps")).toHaveTextContent("Service AC units");
    const facts = [...panel().querySelectorAll(".hd-px > div")].map((d) => d.textContent);
    // alone on it: no With, and never "Solo"
    expect(facts).toEqual(["Time4:45–5:45pm", "WhereCarrington St, Sydney"]);
    expect(p.getByRole("button", { name: "Open job" })).toBeInTheDocument();
    expect(p.getByRole("button", { name: "Close" })).toBeInTheDocument();
    // his panel has one thing to do and the cross; no Directions
    expect(p.getAllByRole("button")).toHaveLength(2);
  });

  it("says who else is on a job, and the street it is in", async () => {
    const user = userEvent.setup();
    draw(thursday());
    await user.click(card(/^Willoughby East/));
    const facts = [...panel().querySelectorAll(".hd-px > div")].map((d) => d.textContent);
    expect(facts).toEqual(["Time5–6pm", "WhereWilloughby East", "WithLuke and Callum"]);
  });

  it("opens nothing when nothing is on", () => {
    draw(thursday({ nowMin: hm(14) }));
    expect(isOpen()).toBe(false);
    expect(panel().hidden).toBe(true);
    for (const c of document.querySelectorAll(".hd-card")) expect(c).toHaveAttribute("aria-expanded", "false");
  });

  it("fills the job on now to how far it has run; finished work has its tick, and nothing else does", () => {
    draw(thursday());
    const cards = [...document.querySelectorAll<HTMLElement>(".hd-card")];
    expect(cards.map((c) => c.style.getPropertyValue("--hd-p"))).toEqual(["0", "0", "0", String(10 / 60), "0", "0"]);
    expect(cards.map((c) => c.querySelector(".hd-tick") !== null)).toEqual([true, true, true, false, false, false]);
    expect(cards.map((c) => c.dataset.state)).toEqual(["done", "done", "done", "live", "todo", "todo"]);
  });

  /* The loader's clock, not the browser's: the server rendered at one
     minute, the browser hydrates at the next, and the two must still be
     one page — nothing in the first render may read the clock. */
  it("hydrates to exactly what the server drew, a minute later", async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date(`${DAY}T16:55:30`));
      const r = thursday();
      const html = renderToString(tree(r));
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.appendChild(host);
      jest.setSystemTime(new Date(`${DAY}T16:56:10`));
      const errors = jest.spyOn(console, "error").mockImplementation(() => {});
      const recovered: unknown[] = [];
      let root: ReturnType<typeof hydrateRoot> | null = null;
      try {
        await act(async () => {
          root = hydrateRoot(host, tree(r), { onRecoverableError: (e) => recovered.push(e) });
        });
        expect(recovered).toEqual([]);
        expect(errors).not.toHaveBeenCalled();
        // and then the browser's clock takes over, a minute on
        expect(host.querySelector(".hd-chip")).toHaveTextContent("On now, 18%");
      } finally {
        await act(async () => root?.unmount());
        errors.mockRestore();
        host.remove();
      }
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("closing the card", () => {
  it("closes on a second press of its own card", async () => {
    const user = userEvent.setup();
    draw(thursday());
    await user.click(card(LIVE));
    expect(isOpen()).toBe(false);
    expect(card(LIVE)).toHaveAttribute("aria-expanded", "false");
    await user.click(card(LIVE));
    expect(isOpen()).toBe(true);
  });

  it("moves to another card when that one is pressed", async () => {
    const user = userEvent.setup();
    draw(thursday());
    await user.click(card(/^Cremorne/));
    expect(card(/^Cremorne/)).toHaveAttribute("aria-expanded", "true");
    expect(card(LIVE)).toHaveAttribute("aria-expanded", "false");
    expect(panel().querySelector(".hd-chip")).toHaveTextContent("To come");
  });

  it("closes on the cross, and puts focus back on the card", async () => {
    const user = userEvent.setup();
    draw(thursday());
    await user.click(within(panel()).getByRole("button", { name: "Close" }));
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(card(LIVE));
  });

  it("closes on Escape in the day, or with nothing focused, and puts focus back on the card", async () => {
    const user = userEvent.setup();
    draw(thursday());
    within(panel()).getByRole("button", { name: "Open job" }).focus();
    await user.keyboard("{Escape}");
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(card(LIVE));

    await user.click(card(LIVE));
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    await user.keyboard("{Escape}");
    expect(isOpen()).toBe(false);
  });

  it("leaves Escape to a face's own box, and to a dialog that is up", async () => {
    const user = userEvent.setup();
    draw(thursday());
    screen.getByRole("textbox", { name: "A face's box" }).focus();
    await user.keyboard("{Escape}");
    expect(isOpen()).toBe(true);

    await user.click(within(panel()).getByRole("button", { name: "Open job" }));
    const sheet = screen.getByRole("dialog", { name: "Job 3342" });
    (document.activeElement as HTMLElement).blur();
    await user.keyboard("{Escape}");
    expect(sheet).toBeInTheDocument();
    expect(isOpen()).toBe(true);
  });

  it("closes on a click anywhere else on the page", async () => {
    const user = userEvent.setup();
    draw(thursday());
    await user.click(screen.getByText("Elsewhere on the page"));
    expect(isOpen()).toBe(false);
  });

  it("stays open for a click on the bar, in the panel, on what keeps it, or off the page", async () => {
    const user = userEvent.setup();
    draw(thursday());
    await user.click(within(panel()).getByRole("heading", { level: 3 }));
    await user.click(document.querySelector(".hd-bar")!);
    await user.click(screen.getByRole("button", { name: "A tab" }));
    await user.click(screen.getByRole("button", { name: "Outside the page" }));
    expect(isOpen()).toBe(true);
    // the card the desk opens is off the page too, as the real one is portalled
    await user.click(within(panel()).getByRole("button", { name: "Open job" }));
    await user.click(screen.getByRole("dialog", { name: "Job 3342" }));
    expect(isOpen()).toBe(true);
  });
});

describe("the panel's one thing to do", () => {
  it("opens the desk's job card on the job's row, wearing the day's state, and gives focus back on close", async () => {
    const user = userEvent.setup();
    draw(thursday({ tracksTime: true }));
    const open = within(panel()).getByRole("button", { name: "Open job" });
    await user.click(open);
    const sheet = screen.getByRole("dialog", { name: "Job 3342" });
    expect(sheet.textContent).toContain("Client 3342");
    // the state the board gives this booking at this minute, on this crew's habit
    const b = thursday().blocks.find((x) => x.key === "d")!;
    const state = dayStateOfBlock(b, { dayISO: DAY, today: DAY, nowMin: hm(16, 55), tracksTime: true });
    expect(state?.word).toBeTruthy();
    expect(sheet.textContent).toContain(state!.word);
    expect(sheet.closest(".hd-page")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Close the card" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(open);
  });

  /* Not every browser focuses a button it presses (Safari does not), so the
     door names itself to the card rather than trusting focus to say it. */
  it("gives focus back to Open job even when the press did not focus it", async () => {
    const user = userEvent.setup();
    draw(thursday());
    screen.getByRole("textbox", { name: "A face's box" }).focus();
    fireEvent.click(within(panel()).getByRole("button", { name: "Open job" }));
    await user.click(screen.getByRole("button", { name: "Close the card" }));
    expect(document.activeElement).toBe(within(panel()).getByRole("button", { name: "Open job" }));
  });

  it("offers nothing to open for a booking the mirror could not name — only the cross", () => {
    draw(thursday({ jobs: [] }));
    expect(isOpen()).toBe(true);
    expect(within(panel()).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual([
      "Close",
    ]);
  });

  it("marks a task done, then refreshes the page", async () => {
    const user = userEvent.setup();
    draw(rail({ tasks: [task()], nowMin: hm(14) }));
    await user.click(card("Task, Call Reece about the filters, 3pm, To come"));
    expect(panel().querySelector(".hd-pno")).toHaveTextContent("Task");
    await user.click(within(panel()).getByRole("button", { name: "Mark done" }));
    expect(mockComplete).toHaveBeenCalledWith("t1");
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockComplete.mock.invocationCallOrder[0]).toBeLessThan(mockRefresh.mock.invocationCallOrder[0]!);
  });

  it("says a task past its time is late, in the late red's chip", async () => {
    const user = userEvent.setup();
    draw(rail({ tasks: [task({ kind: "by", atMin: hm(16) })] }));
    await user.click(card(/^Task, Call Reece/));
    expect(panel().querySelector(".hd-chip")).toHaveTextContent("Late");
    expect(panel().querySelector(".hd-chip")).toHaveAttribute("data-state", "late");
    expect(panel().querySelector(".hd-px")).toHaveTextContent("Timeby 4pm");
  });
});

describe("an open card at an end of the bar", () => {
  it("has the bar close its outline down that square end", async () => {
    const user = userEvent.setup();
    draw(thursday());
    const bar = document.querySelector(".hd-bar")!;
    expect(bar).not.toHaveAttribute("data-sel-end");
    await user.click(card(/^Cremorne/));
    expect(bar).toHaveAttribute("data-sel-end", "last");
    await user.click(card(/^Sydney, Job 3342, 6:30/));
    expect(bar).toHaveAttribute("data-sel-end", "first");
    await user.click(card(/^Sydney, Job 3342, 6:30/));
    expect(bar).not.toHaveAttribute("data-sel-end");
  });

  it("closes both ends when it is the only card", () => {
    draw(rail({ blocks: [block({ startMin: hm(16), endMin: hm(18) })], jobs: [mirror("j3342", "3342")] }));
    expect(document.querySelector(".hd-bar")).toHaveAttribute("data-sel-end", "first last");
    expect(document.querySelector(".hd-card")).toHaveAttribute("data-end", "first last");
  });
});

describe("a crowded bar", () => {
  it("folds finished work into one block, which opens out on a press with focus on its first card", async () => {
    const user = userEvent.setup();
    draw(busy());
    const block9 = card("Show 9 finished jobs");
    expect(block9).toHaveAttribute("title", "9 finished");
    expect(block9).not.toHaveAttribute("aria-expanded");
    expect(document.querySelectorAll(".hd-card")).toHaveLength(2);
    await user.click(block9);
    expect(document.querySelectorAll(".hd-card")).toHaveLength(10);
    expect(document.activeElement).toBe(card(/^Ryde, Job 1000,/));
  });

  /* The job on now finishes while it is open; closing it folds it in with
     the rest, and focus goes to the block it went into, not to nothing. */
  it("gives focus to the block a card folds into as it closes", () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date(`${DAY}T16:50:00`));
      // open on 4pm's job by the loader's 4:30; the browser's clock says 4:50
      draw(busy());
      const last = card(/^Ryde, Job 1009,/);
      expect(last).toHaveAttribute("aria-expanded", "true");
      expect(last.getAttribute("aria-label")).toMatch(/Finished$/);
      last.focus();
      fireEvent.keyDown(last, { key: "Escape" });
      expect(screen.queryByRole("button", { name: /^Ryde, Job 1009,/ })).toBeNull();
      expect(document.activeElement).toBe(card("Show 10 finished jobs"));
    } finally {
      jest.useRealTimers();
    }
  });

  it("folds up again on a click elsewhere on the page, but not on the bar", async () => {
    const user = userEvent.setup();
    draw(busy());
    await user.click(card("Show 9 finished jobs"));
    await user.click(document.querySelector(".hd-bar")!);
    expect(document.querySelectorAll(".hd-card")).toHaveLength(10);
    await user.click(screen.getByText("Elsewhere on the page"));
    expect(document.querySelectorAll(".hd-card")).toHaveLength(2);
  });

  /* React reads enter and leave off the `mouseout` of the element the
     pointer left and its related target, so the path is spelled out: from
     the row onto the first card, off it back onto the row, and off the bar
     onto the page. */
  it("keeps the card under the pointer out of the fold until the pointer leaves the bar", () => {
    draw(busy({ nowMin: hm(9, 50) }));
    const row = document.querySelector(".hd-row")!;
    const away = screen.getByText("Elsewhere on the page");
    // 7, 8 and 9 are done and fold; open them out to point at the first
    fireEvent.click(card("Show 3 finished jobs"));
    const first = card(/^Ryde, Job 1000,/);
    fireEvent.mouseOut(row, { relatedTarget: first });
    fireEvent.pointerDown(away);
    // folded again, all but the card under the pointer, which splits the run
    expect(card(/^Ryde, Job 1000,/)).toBe(first);
    expect(card("Show 2 finished jobs")).toBeInTheDocument();
    // off the card, still on the bar: it stays out
    fireEvent.mouseOut(first, { relatedTarget: row });
    expect(card(/^Ryde, Job 1000,/)).toBe(first);
    // off the bar: it folds in with the rest
    fireEvent.mouseOut(row, { relatedTarget: away });
    expect(screen.queryByRole("button", { name: /^Ryde, Job 1000,/ })).toBeNull();
    expect(card("Show 3 finished jobs")).toBeInTheDocument();
  });
});

describe("measuring", () => {
  /* The observer is a stand-in that only reports what it was asked to
     watch, so a bar that never asks is never re-laid. */
  it("lays the bar out again at its own width once it has one", () => {
    const watched = new Set<Element>();
    let report: () => void = () => {};
    const RO = window.ResizeObserver;
    window.ResizeObserver = class {
      constructor(cb: () => void) {
        report = cb;
      }
      observe(el: Element) {
        watched.add(el);
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    const resize = (el: HTMLElement, width: number) => {
      Object.defineProperty(el, "clientWidth", { configurable: true, value: width });
      if (watched.has(el)) act(() => report());
    };
    try {
      draw(thursday());
      const bar = document.querySelector<HTMLElement>(".hd-bar")!;
      // his width, drawn whole
      expect(document.querySelectorAll(".hd-card")).toHaveLength(6);
      // a bar with no width (not laid out yet) is not a bar 0px wide
      resize(bar, 0);
      expect(document.querySelectorAll(".hd-card")).toHaveLength(6);
      resize(bar, 700);
      expect(card("Show 3 finished jobs")).toBeInTheDocument();
      resize(bar, 1200);
      expect(document.querySelectorAll(".hd-card")).toHaveLength(6);
    } finally {
      window.ResizeObserver = RO;
    }
  });

  it("measures the words in the page's own face once the fonts are in, and lays the bar out again", async () => {
    const fonts: string[] = [];
    const g = globalThis as { OffscreenCanvas?: unknown };
    g.OffscreenCanvas = class {
      getContext() {
        return {
          set font(f: string) {
            fonts.push(f);
          },
          // every word far wider than the guess: the bar has to fold
          measureText: (t: string) => ({ width: t.length * 40 }),
        };
      }
    };
    let ready!: () => void;
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: new Promise<void>((r) => (ready = r)) },
    });
    try {
      draw(thursday());
      document.querySelector<HTMLElement>(".hd-bar")!.style.fontFamily = "Jakarta, sans-serif";
      expect(document.querySelectorAll(".hd-card")).toHaveLength(6);
      expect(fonts).toEqual([]);
      await act(async () => ready());
      expect(fonts.length).toBeGreaterThan(0);
      expect(fonts.every((f) => f.endsWith("px Jakarta, sans-serif"))).toBe(true);
      expect(fonts).toContain("700 16px Jakarta, sans-serif");
      expect(card("Show 3 finished jobs")).toBeInTheDocument();
    } finally {
      delete g.OffscreenCanvas;
      delete (document as { fonts?: unknown }).fonts;
    }
  });

  it("keeps the guess where there is no canvas, or no face to measure in", () => {
    expect(canvasMeasure("Jakarta, sans-serif")).toBeNull();
    const g = globalThis as { OffscreenCanvas?: unknown };
    g.OffscreenCanvas = class {
      getContext() {
        return { font: "", measureText: () => ({ width: 1 }) };
      }
    };
    try {
      expect(canvasMeasure("")).toBeNull();
      expect(canvasMeasure("  ")).toBeNull();
      expect(canvasMeasure("Jakarta")).not.toBeNull();
    } finally {
      delete g.OffscreenCanvas;
    }
  });
});

describe("what the bar cannot draw", () => {
  const note = () => document.querySelector(".hd-daynote");

  it("says bookings need the workboard, and still draws the timed work", () => {
    draw(rail({ enabled: false, tasks: [task()] }));
    expect(note()).toHaveTextContent("Bookings aren’t in this picture — they need the workboard. Your timed work is.");
    expect(document.querySelectorAll(".hd-card")).toHaveLength(1);
    expect(screen.queryByText("Nothing on your day.")).toBeNull();
  });

  it("says nobody is linked, with the door for someone who can open it", () => {
    draw(rail({ linked: false, linkHref: "/dashboard/admin/servicem8" }));
    expect(note()).toHaveTextContent("nobody in ServiceM8 is linked to your account yet.");
    expect(screen.getByRole("link", { name: "Link yourself to the crew" })).toHaveAttribute(
      "href",
      "/dashboard/admin/servicem8",
    );
    cleanup();
    draw(rail({ linked: false }));
    expect(note()).toHaveTextContent("The owner can link you to it.");
    expect(screen.queryByText("Nothing on your day.")).toBeNull();
  });

  it("says nothing about ServiceM8 to a workspace without it: its day is its timed work", () => {
    draw(rail({ connected: false, enabled: false, linked: false, tasks: [task()] }));
    expect(note()).toBeNull();
    expect(document.body.textContent).not.toMatch(/ServiceM8/);
    expect(document.querySelectorAll(".hd-card")).toHaveLength(1);
  });

  it("calls the day clear only when the picture is complete", () => {
    draw(rail());
    expect(screen.getByText("Nothing on your day.")).toBeInTheDocument();
    expect(document.querySelector(".hd-bar")).toBeNull();
    cleanup();
    draw(rail({ connected: false, enabled: false }));
    expect(screen.getByText("Nothing on your day.")).toBeInTheDocument();
    cleanup();
    draw(rail({ linked: false }));
    expect(screen.queryByText("Nothing on your day.")).toBeNull();
  });
});
