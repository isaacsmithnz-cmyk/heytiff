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
import { DAY_GAP, DAY_GROW_MS, DAY_H, dayCardPaint, dayItems, fitDay, guessMeasure } from "@/lib/dashboard/day-bar";
import {
  DAY_BODY_EASE,
  DAY_BODY_MOVE_MS,
  DAY_GROW_EASE,
  DAY_PANEL_FADE_MS,
  liftFrames,
  PANEL_IN,
  skinSpan,
} from "@/lib/dashboard/day-flip";

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

/* A face's own button and its form, to see that they still hear their own
   clicks, and which of those clicks close the card. */
const mockFacePress = jest.fn();
const mockFaceSend = jest.fn();
const tree = (r: HomeRail) => (
  <DeskJobHost manage moneyVisible={false}>
    <div className="hd-page">
      <HomeDay rail={r} />
      <p>Elsewhere on the page</p>
      <div data-day-keep="">
        <button type="button">A tab</button>
      </div>
      <button type="button" onClick={() => mockFacePress()}>
        {"A face's button"}
      </button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mockFaceSend();
        }}
      >
        <input aria-label="A face's box" />
        <button type="submit">Send</button>
      </form>
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
  mockFacePress.mockClear();
  mockFaceSend.mockClear();
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

  it("leaves Escape that something in the day already answered", async () => {
    const user = userEvent.setup();
    draw(thursday());
    const answered = (e: KeyboardEvent) => e.preventDefault();
    const day = screen.getByRole("region", { name: "Your day" });
    day.addEventListener("keydown", answered);
    try {
      within(panel()).getByRole("button", { name: "Open job" }).focus();
      await user.keyboard("{Escape}");
      expect(isOpen()).toBe(true);
    } finally {
      day.removeEventListener("keydown", answered);
    }
    await user.keyboard("{Escape}");
    expect(isOpen()).toBe(false);
  });

  it("closes on a click anywhere else on the page, and the thing clicked still hears it", async () => {
    const user = userEvent.setup();
    draw(thursday());
    await user.click(screen.getByText("Elsewhere on the page"));
    expect(isOpen()).toBe(false);
    await user.click(card(LIVE));
    await user.click(screen.getByRole("button", { name: "A face's button" }));
    expect(isOpen()).toBe(false);
    expect(mockFacePress).toHaveBeenCalledTimes(1);
  });

  it("closes on a click that something on the page stops from rising", async () => {
    const user = userEvent.setup();
    draw(thursday());
    const page = document.querySelector(".hd-page")!;
    const stop = (e: Event) => e.stopPropagation();
    page.addEventListener("click", stop);
    try {
      await user.click(screen.getByRole("button", { name: "A face's button" }));
      expect(isOpen()).toBe(false);
    } finally {
      page.removeEventListener("click", stop);
    }
  });

  /* The panel is above the faces: closed on the press, it would lift the
     page under a pointer that is still down, and the release — and so the
     click — would land on something else. jsdom has no layout to lift, so
     what is held here is the order: nothing moves until the click. */
  it("closes on the click, not the press: a button held down keeps the page where it is", async () => {
    const user = userEvent.setup();
    draw(thursday());
    const face = screen.getByRole("button", { name: "A face's button" });
    await user.pointer({ keys: "[MouseLeft>]", target: face });
    expect(isOpen()).toBe(true);
    await user.pointer({ keys: "[/MouseLeft]", target: face });
    expect(mockFacePress).toHaveBeenCalledTimes(1);
    expect(isOpen()).toBe(false);
  });

  it("stays open for a press alone, and for one released off the page", async () => {
    const user = userEvent.setup();
    draw(busy());
    await user.click(card("Show 9 finished jobs"));
    const away = screen.getByText("Elsewhere on the page");
    // a press that is never a click, as on a face's scrollbar
    fireEvent.pointerDown(away);
    fireEvent.mouseDown(away);
    expect(isOpen()).toBe(true);
    expect(document.querySelectorAll(".hd-card")).toHaveLength(10);
    // released off the page, the click goes to what the two share, which is not Home
    await user.pointer({ keys: "[MouseLeft>]", target: away });
    await user.pointer({ keys: "[/MouseLeft]", target: screen.getByRole("button", { name: "Outside the page" }) });
    expect(isOpen()).toBe(true);
    expect(document.querySelectorAll(".hd-card")).toHaveLength(10);
  });

  /* A click from the keyboard carries no count: the key was pressed in a
     face, and the card does not close under someone working there. */
  it("stays open for a face's button pressed from the keyboard, and for Enter in a face's form", async () => {
    const user = userEvent.setup();
    draw(thursday());
    screen.getByRole("button", { name: "A face's button" }).focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(mockFacePress).toHaveBeenCalledTimes(2);
    expect(isOpen()).toBe(true);
    screen.getByRole("textbox", { name: "A face's box" }).focus();
    await user.keyboard("{Enter}");
    expect(mockFaceSend).toHaveBeenCalledTimes(1);
    expect(isOpen()).toBe(true);
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

  it("cannot be pressed again while the task is being marked done", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    mockComplete.mockImplementationOnce(() => new Promise<undefined>((r) => (finish = () => r(undefined))));
    draw(rail({ tasks: [task()], nowMin: hm(14) }));
    await user.click(card("Task, Call Reece about the filters, 3pm, To come"));
    const done = within(panel()).getByRole("button", { name: "Mark done" });
    expect(done).not.toBeDisabled();
    await user.click(done);
    expect(done).toBeDisabled();
    await user.click(done);
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(mockRefresh).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(done).not.toBeDisabled();
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

/* Every colour is dayCardPaint's, measured in its own suite; what is held
   here is that each card and panel asks it the right question. */
describe("the colours", () => {
  const first = /^Sydney, Job 3342, 6:30/;

  it("paints a finished card that is open, and its panel, in its tint with the heading ink — not gone pale", async () => {
    const user = userEvent.setup();
    draw(thursday());
    await user.click(card(first));
    const item = dayItems(thursday())[0]!;
    const open = dayCardPaint(item, 1, { selected: true });
    // the question matters: asked as a quiet card, the answer differs
    expect(open.bg).not.toBe(dayCardPaint(item, 1).bg);
    expect(open.title).not.toBe(open.sub);
    const pan = panel().querySelector<HTMLElement>(".hd-pan")!;
    expect(pan.style.getPropertyValue("--hd-pbg")).toBe(open.bg);
    expect(pan.style.getPropertyValue("--hd-ptitle")).toBe(open.title);
    expect(pan.style.getPropertyValue("--hd-psub")).toBe(open.sub);
    expect(pan.style.getPropertyValue("--hd-psw")).toBe(open.swatch);
    expect(card(first).style.getPropertyValue("--hd-bg")).toBe(open.bg);
  });

  it("paints a finished card under the pointer at full strength, and pale again once the pointer leaves", () => {
    draw(thursday({ nowMin: hm(14) }));
    const row = document.querySelector(".hd-row")!;
    const away = screen.getByText("Elsewhere on the page");
    const item = dayItems(thursday())[0]!;
    const quiet = dayCardPaint(item, 1);
    const hovered = dayCardPaint(item, 1, { hovered: true });
    expect(hovered.bg).not.toBe(quiet.bg);
    expect(hovered.text).not.toBe(quiet.text);
    const c = card(first);
    expect(c.style.getPropertyValue("--hd-bg")).toBe(quiet.bg);
    fireEvent.mouseMove(c);
    expect(c.style.getPropertyValue("--hd-bg")).toBe(hovered.bg);
    expect(c.style.getPropertyValue("--hd-text")).toBe(hovered.text);
    fireEvent.mouseOut(row, { relatedTarget: away });
    expect(card(first).style.getPropertyValue("--hd-bg")).toBe(quiet.bg);
  });

  /* The cards grow and give way under a pointer standing still, and the
     browser reports each one that passes under it as entered. Only the
     pointer's own move makes a card the hovered one, or the bar would
     unfold the card that slid under it, move again, and chase the pointer.
     React reads an enter off the `mouseout` of what the pointer left. */
  it("takes a card as under the pointer only when the pointer moved onto it", () => {
    draw(thursday({ nowMin: hm(14) }));
    const row = document.querySelector(".hd-row")!;
    const item = dayItems(thursday())[0]!;
    const c = card(first);
    fireEvent.mouseOut(row, { relatedTarget: c });
    fireEvent.mouseOver(c, { relatedTarget: row });
    expect(c.style.getPropertyValue("--hd-bg")).toBe(dayCardPaint(item, 1).bg);
    fireEvent.mouseMove(c);
    expect(c.style.getPropertyValue("--hd-bg")).toBe(dayCardPaint(item, 1, { hovered: true }).bg);
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
    // folded to its tick: centred by the sheet, and no words in 64px
    expect(block9).toHaveAttribute("data-collapsed");
    expect(block9.querySelector(".hd-lab")).toBeNull();
    expect(block9.querySelector(".hd-tick")).not.toBeNull();
    const live = card(/^Ryde, Job 1009,/);
    expect(live).not.toHaveAttribute("data-collapsed");
    expect(live.querySelector(".hd-lab")).toHaveTextContent("RydeJob 10094:00–4:45");
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

  /* The pointer moves onto the first card; React reads leave off the
     `mouseout` of the element the pointer left and its related target, so
     that path is spelled out: off the card back onto the row, and off the
     bar onto the page. */
  it("keeps the card under the pointer out of the fold until the pointer leaves the bar", () => {
    draw(busy({ nowMin: hm(9, 50) }));
    const row = document.querySelector(".hd-row")!;
    const away = screen.getByText("Elsewhere on the page");
    // 7, 8 and 9 are done and fold; open them out to point at the first
    fireEvent.click(card("Show 3 finished jobs"));
    const first = card(/^Ryde, Job 1000,/);
    fireEvent.mouseMove(first);
    fireEvent.click(away, { detail: 1 });
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
    const r = thursday();
    const compactAt = (barWidth: number) =>
      fitDay({
        items: dayItems(r),
        nowMin: r.nowMin,
        barWidth,
        selectedKey: "job:d",
        hoverKey: null,
        showFinished: false,
        measure: guessMeasure,
      }).compact;
    try {
      draw(r);
      const bar = document.querySelector<HTMLElement>(".hd-bar")!;
      // his width, drawn whole
      expect(document.querySelectorAll(".hd-card")).toHaveLength(6);
      expect(bar).not.toHaveAttribute("data-compact");
      // a bar with no width (not laid out yet) is not a bar 0px wide
      resize(bar, 0);
      expect(document.querySelectorAll(".hd-card")).toHaveLength(6);
      resize(bar, 700);
      expect(card("Show 3 finished jobs")).toBeInTheDocument();
      // crowded to compact words: the sheet has to draw the names at the
      // size they were measured in
      expect(compactAt(500)).toBe(true);
      resize(bar, 500);
      expect(bar).toHaveAttribute("data-compact");
      expect(card(LIVE).querySelector(".hd-time")).toHaveTextContent(/^4:45$/);
      expect(compactAt(1200)).toBe(false);
      resize(bar, 1200);
      expect(document.querySelectorAll(".hd-card")).toHaveLength(6);
      expect(bar).not.toHaveAttribute("data-compact");
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

/* "when there is nothing on your day, it looks very bland… a placeholder
   that brings in the color of what your day normally shows" (Isaac,
   2026-09-26): the next day with your bookings, drawn as the bar. */
describe("nothing on today", () => {
  const MONDAY = "2026-08-17";
  const next = () => ({
    dayISO: MONDAY,
    blocks: [
      block({ key: "m1", remoteId: "j2313", jobNumber: "2313", suburb: "Darlinghurst", categoryColour: "#be2d2d", start: `${MONDAY} 09:30:00`, end: `${MONDAY} 11:00:00`, startMin: hm(9, 30), endMin: hm(11) }),
      block({ key: "m2", remoteId: "j1377", jobNumber: "1377", suburb: "Cremorne", categoryColour: "#8f2dbe", start: `${MONDAY} 12:00:00`, end: `${MONDAY} 15:00:00`, startMin: hm(12), endMin: hm(15) }),
    ],
    jobs: [mirror("j2313", "2313", { description: "Unit tripping the breaker" }), mirror("j1377", "1377")],
    where: { j2313: "Oxford St" },
    crew: {},
  });

  it("says so, names the next day, and draws that day's bookings in their colours, all still to come", () => {
    draw(rail({ next: next() }));
    expect(document.querySelector(".hd-daynone")).toHaveTextContent("Nothing on today. Next, Monday 17 August.");
    expect(screen.queryByText("Nothing on your day.")).toBeNull();
    expect(document.querySelectorAll(".hd-card")).toHaveLength(2);
    expect(card(/^Darlinghurst, Job 2313, 9:30–11am, To come/)).toBeInTheDocument();
    expect(card(/^Cremorne, Job 1377/)).toBeInTheDocument();
    // nothing is on now, on a day that isn't today
    expect(isOpen()).toBe(false);
  });

  it("opens a card of that day on its panel, and Open job on that day's card", async () => {
    const user = userEvent.setup();
    draw(rail({ next: next() }));
    await user.click(card(/^Darlinghurst, Job 2313/));
    expect(isOpen()).toBe(true);
    expect(within(panel()).getByText("To come")).toBeInTheDocument();
    expect(within(panel()).getByText("Unit tripping the breaker")).toBeInTheDocument();
    await user.click(within(panel()).getByRole("button", { name: "Open job" }));
    expect(await screen.findByRole("dialog", { name: "Job 2313" })).toBeInTheDocument();
  });

  it("is today's bar, never the next day's, when today has something on", () => {
    draw(rail({ blocks: [block()], jobs: [mirror("j3342", "3342")], next: next() }));
    expect(document.querySelector(".hd-daynone")).toBeNull();
    expect(document.querySelectorAll(".hd-card")).toHaveLength(1);
  });

  it("says nothing of a next day where the picture of today isn't complete", () => {
    draw(rail({ linked: false, next: next() }));
    expect(document.querySelector(".hd-daynone")).toBeNull();
    expect(document.querySelectorAll(".hd-card")).toHaveLength(0);
  });

  it("is the plain line when nothing is booked for a fortnight", () => {
    draw(rail({ next: null }));
    expect(screen.getByText("Nothing on your day.")).toBeInTheDocument();
    expect(document.querySelector(".hd-bar")).toBeNull();
  });
});

/* THE TRACE: the light that runs round the job on now. Its turn is the
   sheet's (home-day-sheet); here, where it is drawn. */
describe("the Trace", () => {
  it("runs round the job on now and nothing else, inside its skin, over its fill", () => {
    draw(thursday());
    const traces = document.querySelectorAll(".hd-trace");
    expect(traces).toHaveLength(1);
    const skin = card(LIVE).querySelector(".hd-skin")!;
    expect(traces[0]!.parentElement).toBe(skin);
    expect(skin.firstElementChild).toHaveClass("hd-fill");
    expect(traces[0]!.previousElementSibling).toBe(skin.firstElementChild);
    // the light is the child that turns
    expect(traces[0]!.querySelector(":scope > i")).not.toBeNull();
  });

  it("is on the job on now whether or not it is open, and goes when nothing is on", async () => {
    const user = userEvent.setup();
    draw(thursday());
    await user.click(card(LIVE));
    expect(card(LIVE).querySelector(".hd-trace")).not.toBeNull();
    cleanup();
    draw(thursday({ nowMin: hm(14) }));
    expect(document.querySelector(".hd-trace")).toBeNull();
  });
});

/* IN MOTION. jsdom lays nothing out and has no animation API, so both are
   stood in for. The layout follows what the bar committed: each card as
   wide as its min-width, end to end with the gap, its skin drawn half the
   bar's height wider each side for its lean, its tag at its left (at its
   middle when open), its words at its middle, its tick at its right; and
   everything under the day a panel's height lower while the panel is up.
   Each animation is recorded with its frames. So a grow can be checked the
   way it is meant: from where each part was drawn BEFORE the press, to
   where the commit put it. */
describe("in motion", () => {
  type Run = { el: Element; frames: Keyframe[]; opts: KeyframeAnimationOptions; cancel: jest.Mock };
  let runs: Run[] = [];
  let reduced = false;
  const PANEL = 120;
  const realRect = Element.prototype.getBoundingClientRect;

  type Box = { left: number; top: number; width: number; height: number };
  function layout(el: Element): Box {
    const c = el.closest<HTMLElement>(".hd-card");
    if (c) {
      let left = 0;
      for (const sib of c.parentElement!.children) {
        if (sib === c) break;
        left += parseFloat((sib as HTMLElement).style.minWidth) + DAY_GAP;
      }
      const w = parseFloat(c.style.minWidth);
      const open = c.getAttribute("aria-expanded") === "true";
      if (el.classList.contains("hd-skin")) return { left: left - DAY_H / 2, top: 0, width: w + DAY_H, height: DAY_H };
      if (el.classList.contains("hd-tag")) {
        return { left: open ? left + w / 2 - 20 : left + 10, top: open ? 14 : 10, width: 40, height: 18 };
      }
      if (el.classList.contains("hd-mid")) return { left: left + w / 2 - 30, top: 40, width: 60, height: 30 };
      if (el.classList.contains("hd-tick")) return { left: left + w - 30, top: 63, width: 18, height: 18 };
      return { left, top: 0, width: w, height: DAY_H };
    }
    const day = document.querySelector(".hd-day");
    const under =
      !!day && el.parentElement === day.parentElement && !!(day.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (under) return { left: 0, top: 300 + (document.querySelector(".hd-pan") ? PANEL : 0), width: 1000, height: 40 };
    return { left: 0, top: 0, width: 0, height: 0 };
  }

  beforeEach(() => {
    runs = [];
    reduced = false;
    Element.prototype.animate = function (this: Element, frames: Keyframe[], opts: KeyframeAnimationOptions) {
      const cancel = jest.fn();
      runs.push({ el: this, frames, opts, cancel });
      return { cancel, finished: new Promise(() => {}) } as unknown as Animation;
    } as typeof Element.prototype.animate;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const b = layout(this);
      return { ...b, x: b.left, y: b.top, right: b.left + b.width, bottom: b.top + b.height, toJSON() {} } as DOMRect;
    };
    window.matchMedia = ((q: string) => ({ matches: reduced && q.includes("reduce") })) as typeof window.matchMedia;
  });
  afterEach(() => {
    delete (Element.prototype as { animate?: unknown }).animate;
    Element.prototype.getBoundingClientRect = realRect;
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  const skins = () => runs.filter((r) => r.el.classList.contains("hd-skin"));
  const skinOf = (c: Element) => c.querySelector(".hd-skin")!;
  /** A skin's layout box as the made-up layout draws it now. */
  const spanNow = (c: Element) => skinSpan(skinOf(c).getBoundingClientRect());
  const mid = (s: { left: number; width: number }) => s.left + s.width / 2;
  const flipIn = (r: Run) => {
    const m = /^translateX\((-?[\d.]+)px\) skewX\(45deg\) scaleX\(([\d.]+)\)$/.exec(String(r.frames[0]!.transform));
    if (!m) throw new Error(`not a skin's first frame: ${String(r.frames[0]!.transform)}`);
    return { dx: Number(m[1]), s: Number(m[2]) };
  };
  /** Every card's skin box, by its button, as drawn now. */
  const drawn = () => new Map([...document.querySelectorAll(".hd-card")].map((c) => [c, spanNow(c)]));

  it("grows the card pressed and gives way beside it, each from where it was drawn", async () => {
    const user = userEvent.setup();
    draw(thursday());
    const before = drawn();
    await user.click(card(/^Willoughby East/));
    expect(skins().length).toBeGreaterThan(0);
    for (const r of skins()) {
      const c = r.el.closest(".hd-card")!;
      const { dx, s } = flipIn(r);
      const was = before.get(c)!;
      const now = spanNow(c);
      // put back by its first frame, the skin stands exactly where it was
      expect(mid(now) + dx).toBeCloseTo(mid(was), 1);
      expect(now.width * s).toBeCloseTo(was.width, 1);
      // and it eases to its own place, leaning 45° the whole way
      expect(r.frames[1]).toEqual({ transform: "translateX(0px) skewX(45deg) scaleX(1)" });
      expect(r.opts).toEqual({ duration: DAY_GROW_MS, easing: DAY_GROW_EASE });
    }
    const grew = skins().find((r) => r.el === skinOf(card(/^Willoughby East/)))!;
    const gave = skins().find((r) => r.el === skinOf(card(LIVE)))!;
    expect(flipIn(grew).s).toBeLessThan(1);
    expect(flipIn(gave).s).toBeGreaterThan(1);
    // the panel was up already: it takes the new card's words, and does not fade in again
    expect(runs.filter((r) => r.el.classList.contains("hd-pan"))).toEqual([]);
  });

  it("slides a card's words level, by translate alone, and the opened card's place name to its middle", async () => {
    const user = userEvent.setup();
    draw(thursday());
    const tag = () => card(/^Willoughby East/).querySelector(".hd-tag")!;
    const was = tag().getBoundingClientRect();
    await user.click(card(/^Willoughby East/));
    const words = runs.filter((r) => !r.el.classList.contains("hd-skin") && r.el.closest(".hd-card"));
    expect(words.length).toBeGreaterThan(0);
    for (const r of words) {
      expect(r.frames.flatMap((f) => Object.keys(f))).toEqual(["translate", "translate"]);
      expect(r.frames[1]).toEqual({ translate: "0px 0px" });
    }
    const slid = words.find((r) => r.el === tag())!;
    const now = tag().getBoundingClientRect();
    expect(now.top).not.toBe(was.top);
    expect(slid.frames[0]).toEqual({ translate: `${was.left - now.left}px ${was.top - now.top}px` });
  });

  it("fades the panel in, and brings what stands under the day down with it, when a card opens with none open", async () => {
    const user = userEvent.setup();
    draw(thursday({ nowMin: hm(14) }));
    await user.click(card(/^Cremorne/));
    const pan = runs.filter((r) => r.el.classList.contains("hd-pan"));
    expect(pan.map((r) => [r.frames, r.opts])).toEqual([[PANEL_IN, { duration: DAY_PANEL_FADE_MS, easing: DAY_BODY_EASE }]]);
    const lifts = runs.filter((r) => r.el.closest(".hd-day") === null);
    expect(lifts.length).toBeGreaterThan(0);
    for (const r of lifts) {
      expect(r.frames).toEqual(liftFrames(-PANEL));
      expect(r.opts).toEqual({ duration: DAY_BODY_MOVE_MS, easing: DAY_BODY_EASE });
    }
  });

  it("lets what stands under the day back up when the card closes, and fades nothing", async () => {
    const user = userEvent.setup();
    draw(thursday());
    await user.click(within(panel()).getByRole("button", { name: "Close" }));
    expect(runs.filter((r) => r.el.classList.contains("hd-pan"))).toEqual([]);
    const lifts = runs.filter((r) => r.el.closest(".hd-day") === null);
    expect(lifts.length).toBeGreaterThan(0);
    for (const r of lifts) expect(r.frames).toEqual(liftFrames(PANEL));
  });

  it("opens the folded block out of itself, and folds the cards back into it", async () => {
    const user = userEvent.setup();
    draw(busy());
    const block = spanNow(card("Show 9 finished jobs"));
    await user.click(card("Show 9 finished jobs"));
    const finished = (c: Element) => /Finished$/.test(c.getAttribute("aria-label")!);
    const out = skins().filter((r) => finished(r.el.closest(".hd-card")!));
    expect(out).toHaveLength(9);
    for (const r of out) {
      const now = spanNow(r.el.closest(".hd-card")!);
      const { dx, s } = flipIn(r);
      // every card it held starts as the block
      expect(mid(now) + dx).toBeCloseTo(mid(block), 1);
      expect(now.width * s).toBeCloseTo(block.width, 1);
    }
    const spans = [...document.querySelectorAll(".hd-card")].filter(finished).map(spanNow);
    const took = { left: spans[0]!.left, width: spans.at(-1)!.left + spans.at(-1)!.width - spans[0]!.left };
    runs = [];
    await user.click(screen.getByText("Elsewhere on the page"));
    const folded = card("Show 9 finished jobs");
    const r = skins().find((x) => x.el === skinOf(folded))!;
    const { dx, s } = flipIn(r);
    // the block starts as the cards it took in, end to end
    expect(mid(spanNow(folded)) + dx).toBeCloseTo(mid(took), 1);
    expect(spanNow(folded).width * s).toBeCloseTo(took.width, 1);
  });

  it("grows a finished card the pointer moves onto out of its sliver", async () => {
    const user = userEvent.setup();
    draw(busy({ nowMin: hm(9, 50) }));
    await user.click(card("Show 3 finished jobs"));
    runs = [];
    // crowded: a finished card stands as a sliver until the pointer is on it
    const first = card(/^Ryde, Job 1000,/);
    expect(first).toHaveAttribute("data-collapsed");
    fireEvent.mouseMove(first);
    expect(first).not.toHaveAttribute("data-collapsed");
    expect(skins().some((r) => r.el === skinOf(first) && flipIn(r).s < 1)).toBe(true);
  });

  /* Law 8: no motion on a keyboard-driven action. A key changes the bar at
     once, and a grow still in flight stops rather than finish somewhere
     the bar no longer is. */
  it("grows nothing for a card or the cross pressed from the keyboard, or for Escape, and stops a grow in flight", async () => {
    const user = userEvent.setup();
    draw(thursday());
    await user.click(card(/^Willoughby East/));
    const flying = [...runs];
    expect(flying.length).toBeGreaterThan(0);
    runs = [];
    card(/^Cremorne/).focus();
    await user.keyboard("{Enter}");
    expect(card(/^Cremorne/)).toHaveAttribute("aria-expanded", "true");
    expect(flying.every((r) => r.cancel.mock.calls.length > 0)).toBe(true);
    expect(runs).toEqual([]);
    within(panel()).getByRole("button", { name: "Close" }).focus();
    await user.keyboard("{Enter}");
    expect(isOpen()).toBe(false);
    expect(runs).toEqual([]);
    await user.click(card(/^Cremorne/));
    const again = [...runs];
    expect(again.length).toBeGreaterThan(0);
    runs = [];
    fireEvent.keyDown(card(/^Cremorne/), { key: "Escape" });
    expect(isOpen()).toBe(false);
    expect(again.every((r) => r.cancel.mock.calls.length > 0)).toBe(true);
    expect(runs).toEqual([]);
  });

  /* The folded block is a key like any card: pressed from the keyboard,
     its nine cards are simply there, focus on the first, and the grow a
     pointer started stops. */
  it("opens the folded block at once for a press from the keyboard, and stops a grow in flight", async () => {
    const user = userEvent.setup();
    draw(busy());
    await user.click(card(/^Ryde, Job 1009,/));
    const flying = [...runs];
    expect(flying.length).toBeGreaterThan(0);
    runs = [];
    card("Show 9 finished jobs").focus();
    await user.keyboard("{Enter}");
    expect(document.querySelectorAll(".hd-card")).toHaveLength(10);
    expect(document.activeElement).toBe(card(/^Ryde, Job 1000,/));
    expect(flying.every((r) => r.cancel.mock.calls.length > 0)).toBe(true);
    expect(runs).toEqual([]);
  });

  it("moves nothing under reduced motion: every change is simply there", async () => {
    const user = userEvent.setup();
    reduced = true;
    draw(thursday());
    await user.click(card(/^Willoughby East/));
    await user.click(within(panel()).getByRole("button", { name: "Close" }));
    await user.click(card(/^Cremorne/));
    expect(isOpen()).toBe(true);
    expect(runs).toEqual([]);
    // the pointer onto a sliver: it opens out, and nothing grows
    cleanup();
    draw(busy({ nowMin: hm(9, 50) }));
    await user.click(card("Show 3 finished jobs"));
    fireEvent.mouseMove(card(/^Ryde, Job 1000,/));
    expect(card(/^Ryde, Job 1000,/)).not.toHaveAttribute("data-collapsed");
    expect(runs).toEqual([]);
  });

  it("changes at once, and throws nothing, where the browser has no animation API", async () => {
    const user = userEvent.setup();
    delete (Element.prototype as { animate?: unknown }).animate;
    draw(thursday());
    await user.click(card(/^Willoughby East/));
    expect(card(/^Willoughby East/)).toHaveAttribute("aria-expanded", "true");
    await user.click(card(/^Willoughby East/));
    expect(isOpen()).toBe(false);
    cleanup();
    draw(busy({ nowMin: hm(9, 50) }));
    await user.click(card("Show 3 finished jobs"));
    fireEvent.mouseMove(card(/^Ryde, Job 1000,/));
    expect(card(/^Ryde, Job 1000,/)).not.toHaveAttribute("data-collapsed");
  });
});
