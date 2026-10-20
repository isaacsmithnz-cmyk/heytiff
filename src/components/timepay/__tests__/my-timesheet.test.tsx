import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MyTimesheet } from "../my-timesheet";
import type { PayPeriod } from "../timepay";
import {
  DEFAULT_SETTINGS,
  type DayEntry,
  type DaySource,
  type Settings,
  type StaffWeek,
  type WeekDay,
} from "../logic";
import type { SheetState } from "@/lib/timepay/query";
import { DAY_LEGEND } from "../tiles";

const saveDay = jest.fn(async () => ({ ok: true as const }));
const saveMyHours = jest.fn(async () => ({ ok: true as const }));
const submitWeek = jest.fn(async () => ({ ok: true as const }));
const markUnavailable = jest.fn(async () => ({ ok: true as const }));
const clearUnavailable = jest.fn(async () => ({ ok: true as const }));
const push = jest.fn();
const refresh = jest.fn();

jest.mock("@/app/actions/timepay", () => ({
  saveDay: (...a: unknown[]) => saveDay(...(a as [])),
  saveMyHours: (...a: unknown[]) => saveMyHours(...(a as [])),
  submitWeek: (...a: unknown[]) => submitWeek(...(a as [])),
  markUnavailable: (...a: unknown[]) => markUnavailable(...(a as [])),
  clearUnavailable: (...a: unknown[]) => clearUnavailable(...(a as [])),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

/* YOUR TIMESHEET, v2 (the board 6-timesheet): a row per day, the day you
   opened in a card beside them, and a clock you scroll.

   THE LOAD-BEARING ASSERTIONS, carried over from today's screen:

   1. THE DAYS ARE DRAWN ONCE. A row per day and nothing else; clicking one
      opens that day, and only that day, in the card.

   2. NO TIME CAN BE TYPED. Started and Finished are the wheel (the TimeField
      part). The only typed number is the unpaid break, in minutes
      (6-revisions, decision 27), and it is there only when a workspace has
      an unpaid break.

   3. AN ORDINARY WEEK NEEDS NO INPUT. The days arrive already presumed and
      the screen says which is which rather than pretending the person
      logged it.

   The standing money check is here too: not a rate, not a gross, not a
   dollar sign. Multipliers and hours only. */

const WEEK: WeekDay[] = [
  ["MON", 29, "Jun"],
  ["TUE", 30, "Jun"],
  ["WED", 1, "Jul"],
  ["THU", 2, "Jul"],
  ["FRI", 3, "Jul"],
  ["SAT", 4, "Jul"],
  ["SUN", 5, "Jul"],
];

const PERIODS: PayPeriod[] = [
  { start: "2026-06-29", range: "29 Jun – 5 Jul", year: "2026", live: true, note: "" },
  { start: "2026-06-22", range: "22 – 28 Jun", year: "2026", live: false, note: "Closed period, historical" },
];

const W = (i: string, o: string, h: number): DayEntry => ({ t: "work", in: i, out: o, h });
/* 7:00 AM → 3:00 PM is exactly 8h of span, so with no break configured the
   derived hours and the stored hours agree; a 30-minute unpaid break takes
   it to a clean 7.5. */
const w8 = W("7:00 AM", "3:00 PM", 8);
const w11 = W("7:00 AM", "6:00 PM", 11);
const EM: DayEntry = { t: "empty" };

/* The week as the SERVER hands it over: already presumed. Mon and Tue are
   ordinary days nobody entered, Wed is a real 11-hour day the person logged,
   Thu came from the leave module, Fri hasn't happened yet, and the weekend is
   untouched. */
const DAYS: DayEntry[] = [w8, w8, w11, { t: "sick", h: 8 }, EM, EM, EM];
const SOURCES: DaySource[] = ["presumed", "presumed", "entered", "leave", "expected", "none", "none"];

/* No rate — the query stopped selecting one. */
const ME: StaffWeek = { id: "me", name: "Isaac Smith", role: "Installer", rate: null, days: DAYS };

const NORMAL = { start: "7:00 AM", end: "3:00 PM" };

const SHEET = (over: Partial<SheetState> = {}): SheetState => ({
  status: "draft",
  submittedAt: null,
  reviewNote: null,
  reviewedBy: null,
  ...over,
});

const withBreak = (minutes: number, paid: boolean): Settings => ({
  ...DEFAULT_SETTINGS,
  breakMinutes: minutes,
  breakPaid: paid,
});

const BASE_PROPS: React.ComponentProps<typeof MyTimesheet> = {
  me: ME,
  sources: SOURCES,
  normal: NORMAL,
  ownNormal: false,
  workDays: [0, 1, 2, 3, 4],
  ownWorkDays: false,
  employment: "permanent",
  unavailable: [],
  week: WEEK,
  today: 4,
  /* Mon–Thu are over; Friday IS today and is not */
  through: 3,
  todayISO: "2026-07-03",
  periodStart: "2026-06-29",
  periods: PERIODS,
  periodIndex: 0,
  settings: DEFAULT_SETTINGS,
  sheet: SHEET(),
  holidays: [],
  state: "NSW",
};

function renderSheet(over: Partial<React.ComponentProps<typeof MyTimesheet>> = {}) {
  return render(<MyTimesheet {...BASE_PROPS} {...over} />);
}

/** A day's row, by the label it announces ("Mon 29 Jun — Normal"). */
const tab = (name: RegExp) => screen.getByRole("tab", { name });
const rows = () => screen.getAllByRole("tab");
const rowClass = (i: number) => rows()[i]!.className;
/** The open day's card. */
const panel = () => screen.getByRole("tabpanel");
/** Started and Finished, the TimeField part: a field that opens the wheel. */
const field = (which: "Started" | "Finished" | "Start" | "Finish", scope: HTMLElement = panel()) =>
  within(scope).getByRole("combobox", { name: which });
/** The break, the one number a day can be typed with. */
/** Press Add this day and let its next frame run: the card moves the cursor to
    Started one animation frame later, and under a loaded test run that frame
    could land in the middle of typing into another field. */
async function addThisDay(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(panel()).getByRole("button", { name: "Add this day" }));
  await act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
}
const breakField = () => within(panel()).getByRole("spinbutton", { name: "Unpaid break, minutes" });
const hours = (container: HTMLElement) => container.querySelector(".ts2-hours")?.textContent ?? "";
/** The line under the card's head that says where the saved day came from. */
const src = (container: HTMLElement) => container.querySelector(".ts2-src")?.textContent ?? "";
/** The sentence beside Send, when the sheet goes. */
const sub = (container: HTMLElement) => container.querySelector(".ts2-sub")?.textContent;

/** Pick a value on a wheel, opening its field first. The wheel portals to
    <body>, so it is looked up on the screen rather than in the card. */
const spin = async (
  user: ReturnType<typeof userEvent.setup>,
  which: "Started" | "Finished" | "Start" | "Finish",
  column: "Hour" | "Minute" | "AM/PM",
  option: string,
  scope?: HTMLElement,
) => {
  const f = field(which, scope);
  if (f.getAttribute("aria-expanded") !== "true") await user.click(f);
  const group = screen.getByRole("group", { name: which });
  const list = within(group).getByRole("listbox", { name: column });
  await user.click(within(list).getByRole("option", { name: option }));
};

beforeEach(() => {
  [saveDay, saveMyHours, submitWeek, markUnavailable, clearUnavailable, push, refresh].forEach((m) =>
    m.mockClear(),
  );
});

/* A casual's week as the server hands it over: NOTHING presumed, and an empty
   working pattern, which is what stops any of it reading as missing. */
const CASUAL = {
  employment: "casual" as const,
  workDays: [] as number[],
  me: { ...ME, days: [w8, EM, EM, EM, EM, EM, EM] as DayEntry[] },
  sources: ["entered", "none", "none", "none", "none", "none", "none"] as DaySource[],
};

describe("the head and the period", () => {
  it("is titled Timesheet, keeps the period's ‹ ›, and ONE word for where the sheet stands", () => {
    renderSheet();
    expect(screen.getByRole("heading", { level: 1, name: "Timesheet" })).toBeInTheDocument();
    expect(screen.getAllByText(/29 Jun – 5 Jul/).length).toBeGreaterThan(0);
    expect(screen.queryByText("LIVE")).toBeNull();
    expect(screen.queryByText(/^Open/)).toBeNull();
    expect(screen.getAllByText("Draft")).toHaveLength(1);
  });

  it("period arrows navigate, they don't hold local state", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByLabelText("Previous period"));
    expect(push).toHaveBeenCalledWith("/dashboard/my-timesheet?period=2026-06-22");
  });

  it("a closed period says so beside Send, not in a pill", () => {
    const { container } = renderSheet({ periodIndex: 1 });
    expect(sub(container)).toBe("This period is closed.");
    expect(screen.queryByText("Historical")).toBeNull();
  });

  /* A CLOSED WEEK AS THE LOADER HANDS IT OVER: its own dates, every day of it
     over, and `today` clamped to its last day, while the real date sits in
     the week after. Monday was logged; the rest is empty. */
  const CLOSED = {
    periodIndex: 1,
    periodStart: "2026-06-22",
    week: [
      ["MON", 22, "Jun"],
      ["TUE", 23, "Jun"],
      ["WED", 24, "Jun"],
      ["THU", 25, "Jun"],
      ["FRI", 26, "Jun"],
      ["SAT", 27, "Jun"],
      ["SUN", 28, "Jun"],
    ] as WeekDay[],
    today: 6,
    through: 6,
    me: { ...ME, days: [w8, EM, EM, EM, EM, EM, EM] as DayEntry[] },
    sources: ["entered", "none", "none", "none", "none", "none", "none"] as DaySource[],
  };

  it("says a closed period is closed once, not again on the day", () => {
    const { container } = renderSheet(CLOSED);
    expect(screen.getAllByText("This period is closed.")).toHaveLength(1);
    expect(container.querySelector(".ts2-lock")).not.toBeNull();
    expect(container.querySelector(".ts2-lock .ts2-note")).toBeNull();
  });

  it("marks no day of a closed week as today, and opens it on its first day", () => {
    const { container } = renderSheet(CLOSED);
    expect(container.querySelectorAll(".ts2-day--today")).toHaveLength(0);
    expect(rows()[0]).toHaveAttribute("aria-selected", "true");
  });

  it("shows nothing for a closed day with nothing on it", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet(CLOSED);
    expect(container.querySelector(".ts2-lock b")?.textContent).toBe("8h");
    await user.click(tab(/Sun 28 Jun/));
    expect(container.querySelector(".ts2-lock")).toBeNull();
    expect(within(panel()).getByText("No entry")).toBeInTheDocument();
    // a rostered day left empty is Missing, and has no line either
    await user.click(tab(/Tue 23 Jun/));
    expect(container.querySelector(".ts2-lock")).toBeNull();
    expect(within(panel()).getByText("Missing")).toBeInTheDocument();
  });

  it("says nothing about money — not a rate, not a gross, not a dollar sign", () => {
    const { container } = renderSheet();
    expect(container.textContent).not.toMatch(/\$/);
    expect(screen.queryByText("Your rate")).toBeNull();
  });
});

describe("the week is ONE row per day", () => {
  it("draws each day exactly once", () => {
    renderSheet();
    expect(rows()).toHaveLength(7);
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  });

  it("marks every row by the state of its day", () => {
    renderSheet();
    expect(rowClass(0)).toContain("ts2-day--std"); // presumed normal day
    expect(rowClass(2)).toContain("ts2-day--over"); // the 11-hour Wednesday
    expect(rowClass(3)).toContain("ts2-day--sick"); // booked leave
    expect(rowClass(5)).toContain("ts2-day--off-roster"); // Saturday, nobody's normal day
    expect(rowClass(6)).toContain("ts2-day--off-roster");
    expect(rowClass(0)).not.toContain("ts2-day--off-roster");
  });

  /* Rule 21: a dot and the hours for a day worked; a day away is a small
     white card with its symbol. */
  it("puts a dot on a day worked and a card with its symbol on a day away", () => {
    renderSheet();
    expect(rows()[0]!.querySelector(".pt-dot--green")).not.toBeNull();
    expect(rows()[2]!.querySelector(".pt-dot--orange")).not.toBeNull();
    expect(rows()[3]!.querySelector(".ts2-away")).not.toBeNull();
    expect(rows()[3]!.querySelector(".pt-dot")).toBeNull();
    // and nothing on a day with nothing on it
    expect(rows()[5]!.querySelector(".ts2-mark")?.children).toHaveLength(0);
    // the hours sit beside the mark
    expect(rows()[2]!.querySelector(".ts2-num")?.textContent).toBe("11");
  });

  it("says a booked absence was approved, and gives a worked day its times", () => {
    renderSheet();
    expect(rows()[3]!.textContent).toContain("Sick leave");
    expect(rows()[3]!.textContent).toContain("Approved");
    expect(rows()[2]!.textContent).toContain("7:00 AM to 6:00 PM");
    expect(rows()[2]!.querySelector(".ts2-word--look")?.textContent).toBe("Overtime");
  });

  it("marks today, and says a day that hasn't happened yet fills in once it's over", () => {
    renderSheet();
    expect(rowClass(4)).toContain("ts2-day--today");
    expect(rowClass(4)).toContain("ts2-day--ahead");
    expect(rows()[4]!.textContent).toContain("Fills in when the day is over");
    expect(rowClass(0)).not.toContain("ts2-day--ahead");
  });

  it("never calls TODAY missing — the day hasn't happened yet", () => {
    const { container } = renderSheet();
    expect(rowClass(4)).toContain("ts2-day--today");
    expect(rowClass(4)).not.toContain("ts2-day--miss");
    expect(rows()[4]!.textContent).not.toContain("Missing");
    expect(container.textContent).not.toContain("no entry logged");
  });

  it("does call it missing once the day is over", () => {
    renderSheet({ through: 4 });
    expect(rowClass(4)).toContain("ts2-day--miss");
    expect(rows()[4]!.querySelector(".ts2-word--wrong")?.textContent).toBe("Missing");
  });

  it("opens on today, so the day you came here about is already showing", () => {
    renderSheet();
    expect(rows().filter((r) => r.getAttribute("aria-selected") === "true")).toHaveLength(1);
    expect(rows()[4]).toHaveAttribute("aria-selected", "true");
    expect(within(panel()).getByRole("heading", { name: "Friday 3 July" })).toBeInTheDocument();
  });

  it("clicking a row switches the card to that day — one card, always", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(rows()[0]).toHaveAttribute("aria-selected", "true");
    expect(within(panel()).getByRole("heading", { name: "Monday 29 June" })).toBeInTheDocument();

    await user.click(tab(/Wed 1 Jul/));
    expect(within(panel()).getByRole("heading", { name: "Wednesday 1 July" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Monday 29 June" })).toBeNull();
  });

  it("calls a worked weekend WEEKEND RATES, not overtime, however short it was", () => {
    const sat: DayEntry = { t: "work", in: "8:00 AM", out: "12:00 PM", h: 4 };
    renderSheet({
      me: { ...ME, days: [...DAYS.slice(0, 5), sat, EM] },
      sources: [...SOURCES.slice(0, 5), "entered", "none"] as DaySource[],
    });
    expect(screen.getByRole("tab", { name: /Sat 4 Jul — Weekend rates/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Sat 4 Jul — Overtime/ })).toBeNull();
  });

  it("still calls a long WEEKDAY overtime — the word only changes on a weekend", () => {
    renderSheet();
    expect(screen.getByRole("tab", { name: /Wed 1 Jul — Overtime/ })).toBeInTheDocument();
  });

  it("leaves a weekend alone when the workspace pays it at standard rates", () => {
    const sat: DayEntry = { t: "work", in: "7:00 AM", out: "3:00 PM", h: 8 };
    const noSat: Settings = {
      ...DEFAULT_SETTINGS,
      rules: { ...DEFAULT_SETTINGS.rules, sat: { ...DEFAULT_SETTINGS.rules.sat, on: false } },
    };
    renderSheet({
      settings: noSat,
      me: { ...ME, days: [...DAYS.slice(0, 5), sat, EM] },
      sources: [...SOURCES.slice(0, 5), "entered", "none"] as DaySource[],
    });
    expect(screen.getByRole("tab", { name: /Sat 4 Jul — Normal/ })).toBeInTheDocument();
  });

  it("a weekend opens straight from its row — no separate offer", async () => {
    const user = userEvent.setup();
    renderSheet();
    expect(screen.queryByRole("button", { name: "Add Saturday" })).toBeNull();
    await user.click(tab(/Sat 4 Jul/));
    expect(within(panel()).getByRole("heading", { name: "Saturday 4 July" })).toBeInTheDocument();
    await addThisDay(user);
    expect(field("Started")).toBeInTheDocument();
    expect(field("Finished")).toBeInTheDocument();
  });

  /* EVERY COLOUR DRAWN IS EXPLAINED, AND NOTHING ELSE IS. */
  const captions = (el: HTMLElement) => [...el.querySelectorAll(".ts2-key-item")].map((l) => l.textContent ?? "");

  it("keys every colour the week draws, in DAY_LEGEND's order", () => {
    renderSheet();
    const key = screen.getByRole("list", { name: "Day colour" });
    expect(captions(key)).toEqual(["Normal", "Overtime", "Sick", "No entry"]);
    expect(within(key).queryByText("Public holiday")).toBeNull();
    expect(within(key).queryByText("Leave")).toBeNull();
  });

  it("still explains the two that used to be in no shipped legend", () => {
    renderSheet({
      me: { ...ME, days: [{ t: "empty" }, { t: "off" }, w8, EM, EM, EM, EM] },
      sources: ["expected", "entered", "entered", "expected", "expected", "none", "none"],
      today: 6,
      through: 5,
    });
    const key = screen.getByRole("list", { name: "Day colour" });
    expect(within(key).getByText("Missing")).toBeInTheDocument();
    expect(within(key).getByText("Off")).toBeInTheDocument();
    const known = DAY_LEGEND.map(([, c]) => c);
    for (const c of captions(key)) expect(known).toContain(c);
  });
});

describe("a normal week takes no input", () => {
  it("says a presumed day was filled in, not logged", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    expect(src(container)).toContain("Your normal day");
    expect(field("Started").textContent).toContain("7:00 AM");
    expect(field("Finished").textContent).toContain("3:00 PM");
    expect(hours(container)).toBe("8h");
  });

  it("a day still ahead of itself says it isn't marked yet", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(tab(/Fri 3 Jul/));
    expect(src(container)).toContain("marked as worked once the day is over");
  });

  it("booked leave is READ ONLY here — it belongs to the leave module", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tab(/Thu 2 Jul/));
    expect(screen.getByText("Sick leave — 8h")).toBeInTheDocument();
    expect(screen.getByText(/came from your leave/)).toBeInTheDocument();
    expect(screen.queryByText("Save day")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Started" })).toBeNull();
  });

  it("a public holiday is read only too, and names itself", async () => {
    const user = userEvent.setup();
    renderSheet({
      me: { ...ME, days: [w8, w8, { t: "ph", h: 8 }, { t: "sick", h: 8 }, EM, EM, EM] },
      sources: ["presumed", "presumed", "holiday", "leave", "expected", "none", "none"],
      holidays: [{ date: "2026-07-01", name: "Territory Day" }],
    });
    await user.click(tab(/Wed 1 Jul/));
    expect(within(panel()).getAllByText("Territory Day").length).toBeGreaterThan(0);
    expect(screen.getByText(/business is closed/)).toBeInTheDocument();
    expect(screen.queryByText("Save day")).toBeNull();
    // saying you worked it is the change, so Save comes with it
    await user.click(screen.getByRole("button", { name: "I worked this public holiday" }));
    expect(screen.getByText("Save day")).toBeInTheDocument();
  });

  it("cannot declare leave from the timesheet — that would be a second place to book it", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    const p = panel();
    expect(within(p).queryByText("Annual leave")).toBeNull();
    expect(within(p).queryByText("Public holiday")).toBeNull();
    expect(within(p).getByRole("radio", { name: "Worked" })).toBeInTheDocument();
    expect(within(p).getByRole("radio", { name: "Off" })).toBeInTheDocument();
  });

  it("is one radio group, not two toggles that happen to be adjacent", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    const group = screen.getByRole("radiogroup", { name: "What this day was" });
    // in the day's head, where the day's word would otherwise stand
    expect(container.querySelector(".ts2-card-head")?.contains(group)).toBe(true);
    const seats = within(group).getAllByRole("radio");
    expect(seats.map((b) => b.textContent)).toEqual(["Worked", "Off"]);
    expect(within(group).getAllByRole("radio", { checked: true })).toHaveLength(1);
    expect(seats.map((b) => b.tabIndex)).toEqual([0, -1]);

    seats[0]!.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Off" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Worked" })).toHaveAttribute("aria-checked", "true");
  });

  it("offers a day with no answer only what it could still become, and no switch", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tab(/Sat 4 Jul/));
    expect(screen.queryByRole("radiogroup", { name: "What this day was" })).toBeNull();
    let p = panel();
    expect(within(p).getByRole("button", { name: "Add this day" })).toBeInTheDocument();
    expect(within(p).queryByRole("button", { name: "Mark as off" })).toBeNull();

    await user.click(tab(/Fri 3 Jul/));
    p = panel();
    expect(p.textContent).toContain("marked as worked once the day is over");
    expect(within(p).queryByRole("button", { name: "Log hours" })).toBeNull();
    expect(within(p).getByRole("button", { name: "Mark as off" })).toBeInTheDocument();

    await user.click(within(p).getByRole("button", { name: "Mark as off" }));
    const group = screen.getByRole("radiogroup", { name: "What this day was" });
    expect(within(group).getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "true");
  });

  it("offers a rostered day that is over and still empty both answers — it is missing", async () => {
    const user = userEvent.setup();
    renderSheet({
      me: { ...ME, days: [EM, ...DAYS.slice(1)] },
      sources: ["none", ...SOURCES.slice(1)] as DaySource[],
    });
    await user.click(tab(/Mon 29 Jun/));
    const p = panel();
    expect(within(p).getByRole("button", { name: "Log hours" })).toBeInTheDocument();
    expect(within(p).getByRole("button", { name: "Mark as off" })).toBeInTheDocument();
  });

  it("seeds nothing and offers no Save until the day has been answered", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tab(/Sat 4 Jul/));
    expect(screen.queryByText("Save day")).toBeNull();
    expect(screen.queryByText(/Say what this day was/)).toBeNull();
    expect(within(panel()).queryByRole("combobox", { name: "Started" })).toBeNull();

    await addThisDay(user);
    expect(screen.getByText("Save day").closest("button")).toBeEnabled();
  });

  it("an answered day rests, with no Save standing over it", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    expect(screen.queryByText("Save day")).toBeNull();
    expect(field("Started").textContent).toContain("7:00 AM");
  });
});

describe("a time is scrolled, never typed", () => {
  it("has no text box on the day, and no hours box either", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    // no break in this workspace, so nothing on the screen is typed at all
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(container.querySelectorAll("textarea")).toHaveLength(0);
    expect(container.querySelectorAll('input[type="time"]')).toHaveLength(0);
    // the hours are what the times mean, a figure, never a field
    expect(screen.queryByLabelText("Hours")).toBeNull();
  });

  it("offers only real times, and re-derives the hours as you spin", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    await spin(user, "Finished", "Hour", "4");
    expect(field("Finished").textContent).toContain("4:00 PM");
    expect(hours(container)).toBe("9h");
  });

  it("sends the DERIVED hours in the same {t,in,out,h} payload", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    await spin(user, "Finished", "Hour", "4");
    await user.keyboard("{Escape}");
    await user.click(screen.getByText("Save day"));
    expect(saveDay).toHaveBeenCalledWith("2026-06-29", 0, { t: "work", in: "7:00 AM", out: "4:00 PM", h: 9 });
  });

  it("Save is never disabled, because a wheel can't produce a bad time", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    await spin(user, "Finished", "Minute", "45");
    await user.keyboard("{Escape}");
    await spin(user, "Started", "AM/PM", "PM");
    await user.keyboard("{Escape}");
    expect(screen.getByText("Save day").closest("button")).not.toBeDisabled();
  });

  it("minutes move in fives — the granularity a timesheet is actually kept to", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    await user.click(field("Started"));
    const group = screen.getByRole("group", { name: "Started" });
    const options = within(within(group).getByRole("listbox", { name: "Minute" })).getAllByRole("option");
    expect(options).toHaveLength(12);
    expect(options.map((o) => o.textContent)).toContain("35");
    expect(options.map((o) => o.textContent)).not.toContain("37");
  });

  /* THE CLOCK THAT CLOSED ITSELF: its own wheel scrolls to centre the chosen
     time the moment it opens, and that scroll must never close it. */
  it("stays open while its own wheel scrolls", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    await user.click(field("Started"));
    const group = screen.getByRole("group", { name: "Started" });
    fireEvent.scroll(within(group).getByRole("listbox", { name: "Hour" }));
    expect(field("Started")).toHaveAttribute("aria-expanded", "true");
  });

  it("closes the clock on Escape and gives the field back its focus", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    await user.click(field("Started"));
    await user.keyboard("{Escape}");
    expect(field("Started")).toHaveAttribute("aria-expanded", "false");
    expect(field("Started")).toHaveFocus();
  });

  it("never has both clocks open at once", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    await user.click(field("Started"));
    await user.click(field("Finished"));
    expect(screen.queryAllByRole("group", { name: /^(Started|Finished)$/ })).toHaveLength(1);
  });
});

describe("a day that was different", () => {
  it("a short day saves its real hours and warns it will be looked at", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    await spin(user, "Finished", "Hour", "11");
    await spin(user, "Finished", "AM/PM", "AM");
    await user.keyboard("{Escape}");
    expect(container.querySelector(".ts2-short")?.textContent).toContain("Short of your 8h day");
    expect(hours(container)).toBe("4h");
    await user.click(screen.getByText("Save day"));
    expect(saveDay).toHaveBeenCalledWith("2026-06-29", 0, { t: "work", in: "7:00 AM", out: "11:00 AM", h: 4 });
  });

  it("'Off' saves a day off, and LINKS to leave for a paid one", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    await user.click(screen.getByRole("radio", { name: "Off" }));
    expect(screen.getByText(/book it in/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My leave" })).toHaveAttribute("href", "/dashboard/my-leave");
    await user.click(screen.getByText("Save day"));
    expect(saveDay).toHaveBeenCalledWith("2026-06-29", 0, { t: "off" });
  });

  it("an entered day can go back to normal, which clears the row", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tab(/Wed 1 Jul/));
    await user.click(screen.getByText("Back to normal"));
    expect(saveDay).toHaveBeenCalledWith("2026-06-29", 2, { t: "empty" });
  });

  it("an added weekend day is removed rather than put back to normal", async () => {
    const user = userEvent.setup();
    renderSheet({
      me: { ...ME, days: [...DAYS.slice(0, 5), w8, EM] },
      sources: [...SOURCES.slice(0, 5), "entered", "none"] as DaySource[],
    });
    await user.click(tab(/Sat 4 Jul/));
    await user.click(screen.getByText("Remove day"));
    expect(saveDay).toHaveBeenCalledWith("2026-06-29", 5, { t: "empty" });
  });

  it("drops the line about the saved day while you are changing it", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tab(/Wed 1 Jul/));
    expect(screen.getByText("You logged this day.")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Off" }));
    expect(screen.queryByText("You logged this day.")).toBeNull();
    await user.click(screen.getByText("Cancel"));
    expect(screen.getByText("You logged this day.")).toBeInTheDocument();
  });

  /* The card seeds kind/start/finish into local state on mount, so it is
     keyed on the stored day: a save that changes the day underneath it must
     not leave the card showing the old answer. */
  it("re-reads the day after a save instead of keeping what it mounted with", async () => {
    const user = userEvent.setup();
    const off: DayEntry = { t: "off" };
    const { rerender } = renderSheet({
      me: { ...ME, days: [off, ...DAYS.slice(1)] },
      sources: ["entered", ...SOURCES.slice(1)] as DaySource[],
    });
    await user.click(tab(/Mon 29 Jun/));
    expect(screen.getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "true");

    rerender(
      <MyTimesheet
        {...BASE_PROPS}
        me={{ ...ME, days: [w8, ...DAYS.slice(1)] }}
        sources={["presumed", ...SOURCES.slice(1)] as DaySource[]}
      />,
    );

    expect(screen.getByRole("radio", { name: "Worked" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "false");
    expect(field("Started")).toBeInTheDocument();
    expect(screen.queryByText(/book it in/)).toBeNull();
  });

  it("a presumed day has nothing to clear — it was never a row", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    expect(screen.queryByText("Back to normal")).toBeNull();
  });

  it("says where a save went wrong, in red, and keeps the day open", async () => {
    const user = userEvent.setup();
    saveDay.mockResolvedValueOnce({ ok: false, error: "This week has been sent." } as never);
    renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    await user.click(screen.getByRole("radio", { name: "Off" }));
    await user.click(screen.getByText("Save day"));
    expect(await screen.findByText("This week has been sent.")).toBeInTheDocument();
    expect(screen.getByText("Not saved")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("a casual", () => {
  it("gets no day filled in, and none of them read as missing", () => {
    renderSheet(CASUAL);
    const cls = rows().map((r) => r.className);
    expect(cls.filter((c) => c.includes("ts2-day--miss"))).toHaveLength(0);
    expect(cls[1]).toContain("ts2-day--off-roster");
    expect(cls[4]).toContain("ts2-day--off-roster");
    expect(cls[0]).toContain("ts2-day--std");
  });

  it("says its week is entered by hand", () => {
    const { container } = renderSheet(CASUAL);
    expect(container.querySelector(".ts2-rules")?.textContent).toContain("Every day entered by hand");
    expect(sub(container)).toBe("Add the days you worked. It sends itself Sun 3:00 PM and locks.");
    expect(screen.queryByText(/then submit/)).not.toBeInTheDocument();
    expect(screen.queryByText(/filled in for you/)).not.toBeInTheDocument();
  });

  it("is never told a short day is short — they were rostered for what they did", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet(CASUAL);
    await user.click(tab(/Tue 30 Jun/));
    await addThisDay(user);
    await spin(user, "Finished", "Hour", "11");
    await spin(user, "Finished", "AM/PM", "AM");
    expect(container.querySelector(".ts2-short")).toBeNull();
  });

  it("has no normal week to set, and marks when it can't work instead", () => {
    renderSheet(CASUAL);
    expect(screen.queryByRole("button", { name: "Change normal week" })).toBeNull();
    expect(screen.getByRole("heading", { name: "When you can’t work" })).toBeInTheDocument();
    expect(screen.getByText("Nothing marked. You’re available.")).toBeInTheDocument();
  });

  it("marking a block is a declaration — it says outright that nobody approves it", async () => {
    const user = userEvent.setup();
    renderSheet(CASUAL);
    await user.click(screen.getByRole("button", { name: "Mark days you can’t work" }));
    const dialog = screen.getByRole("dialog", { name: "Days you can’t work" });
    expect(within(dialog).getByText(/Nobody approves this/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Mark unavailable" })).toBeDisabled();
    const buttons = within(dialog).getAllByRole("button").map((b) => b.textContent ?? "");
    expect(buttons.some((t) => /submit|request|withdraw|approve/i.test(t))).toBe(false);
    expect(within(dialog).queryByText(/pending|awaiting/i)).toBeNull();
  });

  it("lists a block it already has, and can take it back down", async () => {
    const user = userEvent.setup();
    renderSheet({
      ...CASUAL,
      unavailable: [{ id: "b1", staffId: "me", from: "2026-07-20", to: "2026-07-24", note: "away" }],
    });
    expect(screen.getByText("20 – 24 Jul")).toBeInTheDocument();
    expect(screen.getByText("away")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Remove 20 – 24 Jul"));
    expect(clearUnavailable).toHaveBeenCalledWith("b1");
  });

  it("drops a block that has run out — it says nothing about availability now", () => {
    renderSheet({
      ...CASUAL,
      unavailable: [{ id: "old", staffId: "me", from: "2026-06-01", to: "2026-06-02" }],
    });
    expect(screen.getByText("Nothing marked. You’re available.")).toBeInTheDocument();
  });
});

describe("a part-timer", () => {
  it("has their non-working weekday off the roster, not presumed and not missing", () => {
    renderSheet({
      workDays: [0, 1, 3],
      me: { ...ME, days: [w8, w8, EM, w8, EM, EM, EM] },
      sources: ["presumed", "presumed", "none", "presumed", "none", "none", "none"],
    });
    expect(rowClass(2)).toContain("ts2-day--off-roster");
    expect(rowClass(2)).not.toContain("ts2-day--miss");
    expect(rowClass(0)).not.toContain("ts2-day--off-roster");
  });
});

describe("your normal week", () => {
  it("states the workspace default — hours AND days — and says whose it is, once", () => {
    const { container } = renderSheet();
    const fact = container.querySelector(".ts2-fact")?.textContent ?? "";
    expect(fact).toContain("The workspace’s normal week: Mon, Tue, Wed, Thu, Fri, 7:00 AM to 3:00 PM.");
    expect((container.textContent?.match(/Mon, Tue, Wed, Thu, Fri/g) ?? []).length).toBe(1);
    // and the pay rules don't restate it
    const rules = container.querySelector(".ts2-rules")?.textContent ?? "";
    expect(rules).not.toContain("7:00 AM");
    expect(rules).not.toContain("Mon, Tue");
  });

  it("sets which DAYS are normal, so a part-timer isn’t presumed onto their day off", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole("button", { name: "Change normal week" }));
    const dialog = screen.getByRole("dialog", { name: "Your normal week" });
    await user.click(within(dialog).getByLabelText("Wednesday"));
    await user.click(within(dialog).getByLabelText("Friday"));
    expect(within(dialog).getByLabelText("Friday")).toHaveAttribute("aria-pressed", "false");
    await user.click(within(dialog).getByRole("button", { name: "Save normal week" }));
    expect(saveMyHours).toHaveBeenCalledWith("7:00 AM", "3:00 PM", [0, 1, 3]);
  });

  it("sets its own hours the way a day is set — one clock at a time, no typing", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole("button", { name: "Change normal week" }));
    const dialog = screen.getByRole("dialog", { name: "Your normal week" });
    expect(field("Start", dialog)).toBeInTheDocument();
    expect(field("Finish", dialog)).toBeInTheDocument();
    expect(dialog.querySelectorAll("input")).toHaveLength(0);
    await spin(user, "Start", "Hour", "6", dialog);
    await spin(user, "Start", "Minute", "30", dialog);
    expect(screen.getAllByRole("group", { name: /^(Start|Finish)$/ })).toHaveLength(1);
    await user.keyboard("{Escape}");
    await user.click(within(dialog).getByRole("button", { name: "Save normal week" }));
    expect(saveMyHours).toHaveBeenCalledWith("6:30 AM", "3:00 PM", [0, 1, 2, 3, 4]);
  });

  it("an override says it's yours, and can be handed back to the org's hours", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet({ ownNormal: true, normal: { start: "6:30 AM", end: "2:30 PM" } });
    expect(container.querySelector(".ts2-fact")?.textContent).toContain("Your normal week: Mon, Tue, Wed, Thu, Fri, 6:30 AM to 2:30 PM.");
    await user.click(screen.getByRole("button", { name: "Change normal week" }));
    await user.click(screen.getByRole("button", { name: "Use the default" }));
    expect(saveMyHours).toHaveBeenCalledWith(null, null, null);
  });

  it("offers no default to go back to when the week is already the default", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole("button", { name: "Change normal week" }));
    expect(screen.queryByRole("button", { name: "Use the default" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(saveMyHours).not.toHaveBeenCalled();
  });
});

describe("the break", () => {
  it("says nothing when the workspace hasn't configured one", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    expect(screen.queryByText(/break/i)).toBeNull();
    expect(within(panel()).queryByRole("spinbutton")).toBeNull();
  });

  it("an unpaid break comes off the span", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet({ settings: withBreak(30, false) });
    await user.click(tab(/Sat 4 Jul/));
    await addThisDay(user);
    expect(breakField()).toHaveValue(30);
    expect(hours(container)).toBe("7.5h");
    await user.click(screen.getByText("Save day"));
    expect(saveDay).toHaveBeenCalledWith("2026-06-29", 5, { t: "work", in: "7:00 AM", out: "3:00 PM", h: 7.5 });
  });

  it("a day can deviate from the standard break, kept to fives and two hours", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet({ settings: withBreak(30, false) });
    await user.click(tab(/Sat 4 Jul/));
    await addThisDay(user);
    await user.clear(breakField());
    await user.type(breakField(), "20");
    expect(breakField()).toHaveValue(20);
    expect(hours(container)).toBe("7.67h");
    // a typed 17 settles on the nearest five, and nothing passes 120
    await user.clear(breakField());
    await user.type(breakField(), "17");
    await user.tab();
    expect(breakField()).toHaveValue(15);
    await user.clear(breakField());
    await user.type(breakField(), "500");
    expect(breakField()).toHaveValue(120);
  });

  it("reopening a saved day shows the break it was saved with, not the org's", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet({
      settings: withBreak(30, false),
      me: { ...ME, days: [W("7:00 AM", "3:00 PM", 7.25), ...DAYS.slice(1)] },
      sources: ["entered", ...SOURCES.slice(1)] as DaySource[],
    });
    await user.click(tab(/Mon 29 Jun/));
    // 8h of span stored as 7.25 means 45 minutes were taken
    expect(breakField()).toHaveValue(45);
    expect(hours(container)).toBe("7.25h");
  });

  it("a PAID break deducts nothing and offers no per-day control", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet({ settings: withBreak(30, true) });
    await user.click(tab(/Mon 29 Jun/));
    expect(screen.getByText("30 min paid break")).toBeInTheDocument();
    expect(within(panel()).queryByRole("spinbutton")).toBeNull();
    expect(hours(container)).toBe("8h");
  });
});

describe("the payroll lines", () => {
  it("say nothing about a plain day, whose hours ARE its payroll hours", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    expect(hours(container)).toBe("8h");
    expect(container.querySelector(".ts2-pay")).toBeNull();
  });

  it("say nothing on a leave or sick day either", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(tab(/Thu 2 Jul/));
    expect(within(panel()).getByText(/Sick leave/)).toBeInTheDocument();
    expect(container.querySelector(".ts2-pay")).toBeNull();
  });

  it("split an overtime day the way the pay run does — never a dollar", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(tab(/Wed 1 Jul/));
    // 11h on a Wednesday: 8 at 1×, 3 at 1.5× → 12.5 payroll hours
    const lines = [...container.querySelectorAll(".ts2-pay > div")].map((d) => [
      d.querySelector("dt")?.textContent,
      d.querySelector("dd")?.textContent,
    ]);
    expect(lines).toEqual([
      ["Ordinary", "8h"],
      ["Time and a half", "3h"],
      ["For payroll", "12.5h"],
    ]);
    expect(container.querySelector(".ts2-pay")?.textContent).not.toContain("$");
  });
});

describe("what the week comes to", () => {
  const figs = (container: HTMLElement) =>
    [...container.querySelectorAll(".ts2-figs > div")].map((d) => [
      d.querySelector("dt")?.textContent,
      d.querySelector("dd")?.textContent,
    ]);

  it("separates what you worked from what payroll counts", () => {
    const { container } = renderSheet();
    // worked 8 + 8 + 11 = 27; payroll 24×1 + 3×1.5 + 8 sick = 36.5
    expect(container.querySelector(".ts2-big-l")?.textContent).toBe("This week so far, for payroll");
    expect(container.querySelector(".ts2-big-v")?.textContent).toBe("36.5h");
    expect(figs(container)[0]).toEqual(["Worked", "27h"]);
  });

  /* The figures reconcile both totals: 24 + 3 is the hours worked, and
     24 + 3×1.5 + 8 is what it pays. Paid absence is its own figure. */
  it("splits the buckets so both totals add up, and omits the empty ones", () => {
    const { container } = renderSheet();
    expect(figs(container).slice(1)).toEqual([
      ["Ordinary", "24h"],
      ["Time and a half", "3h"],
      ["Paid, not worked", "8h"],
    ]);
    expect(24 + 3).toBe(27);
    expect(24 + 3 * 1.5 + 8).toBe(36.5);
  });

  it("has no absence figure in a week nobody was away", () => {
    const { container } = renderSheet({
      me: { ...ME, days: [w8, w8, w8, w8, EM, EM, EM] },
      sources: ["presumed", "presumed", "presumed", "presumed", "expected", "none", "none"],
    });
    expect(figs(container).slice(1)).toEqual([["Ordinary", "32h"]]);
  });

  it("names the cycle it is totalling", () => {
    const { container } = renderSheet({ settings: { ...DEFAULT_SETTINGS, cycle: "Fortnightly" } });
    expect(container.querySelector(".ts2-big-l")?.textContent).toBe("This fortnight so far, for payroll");
  });

  it("drops 'so far' once the period is over", () => {
    const { container } = renderSheet({ periodIndex: 1 });
    expect(container.querySelector(".ts2-big-l")?.textContent).toBe("This week, for payroll");
  });

  it.each([
    ["Fortnightly", "fortnight"],
    ["Monthly", "month"],
    ["Weekly", "week"],
  ] as const)("says %s in every place it names the period", (cycle, noun) => {
    const { unmount } = renderSheet({ settings: { ...DEFAULT_SETTINGS, cycle } });
    expect(screen.getByText(new RegExp(`Send this ${noun} once`))).toBeInTheDocument();
    unmount();
    renderSheet({ settings: { ...DEFAULT_SETTINGS, cycle }, today: 5, through: 4 });
    expect(screen.getByRole("button", { name: `Send ${noun}` })).toBeInTheDocument();
  });

  it("says it on the sent day too, once the period has been sent", () => {
    renderSheet({
      settings: { ...DEFAULT_SETTINGS, cycle: "Monthly" },
      sheet: { status: "submitted", submittedAt: "2026-07-05", reviewNote: null, reviewedBy: null },
    });
    expect(screen.getByText(/This month has been sent — it can't be changed here\./)).toBeInTheDocument();
  });

  const ruleRows = (container: HTMLElement) =>
    [...container.querySelectorAll(".ts2-rules dt")].map((dt) => [
      dt.textContent ?? "",
      dt.nextElementSibling?.tagName === "DD" ? (dt.nextElementSibling.textContent ?? "") : "",
    ]);

  it("states only the pay rules stated nowhere else, a label and a value each", () => {
    const { container } = renderSheet({ settings: withBreak(30, false) });
    expect(Object.fromEntries(ruleRows(container))).toMatchObject({
      "Standard day": "8h",
      Overtime: "After 8h a day",
      "Unpaid break": "30 min",
      Saturday: "1.5× first 2h, then 2×",
    });
    const rules = container.querySelector(".ts2-rules") as HTMLElement;
    expect(rules.textContent).not.toContain("$");
    expect(rules.textContent).not.toContain("sends itself");
    expect(rules.textContent).not.toContain("·");
    for (const row of rules.children) {
      expect(row.querySelectorAll("dt")).toHaveLength(1);
      expect(row.querySelectorAll("dd")).toHaveLength(1);
    }
  });

  it("says when the sheet sends exactly once, beside the button it is about", () => {
    const { container } = renderSheet();
    expect((container.textContent ?? "").match(/sends itself Sun 3:00 PM/g) ?? []).toHaveLength(1);
    expect(container.querySelector(".ts2-head .ts2-sub")?.textContent).toBe(
      "Send this week once Fri 3 Jul is over. If you don't, it sends itself Sun 3:00 PM and locks.",
    );
  });

  it("names the period once", () => {
    const { container } = renderSheet();
    expect((container.textContent ?? "").match(/29 Jun – 5 Jul/g) ?? []).toHaveLength(1);
    expect(container.querySelector(".ts2-range")?.textContent).toContain("29 Jun – 5 Jul");
  });
});

describe("the month's public holidays", () => {
  it("says so plainly when the month has none", () => {
    renderSheet();
    expect(screen.getByRole("heading", { name: "Public holidays in July 2026" })).toBeInTheDocument();
    expect(screen.getByText("No public holidays this month")).toBeInTheDocument();
  });

  it("lists this month's, and only this month's", () => {
    renderSheet({
      holidays: [
        { date: "2026-06-08", name: "A June Thing" },
        { date: "2026-07-01", name: "Territory Day" },
      ],
    });
    expect(screen.getByText("Territory Day")).toBeInTheDocument();
    expect(screen.queryByText("A June Thing")).toBeNull();
    expect(screen.queryByText("No public holidays this month")).toBeNull();
  });

  it("expands the year on request, named for the staff member's state", async () => {
    const user = userEvent.setup();
    renderSheet({ holidays: [{ date: "2026-12-25", name: "Christmas Day" }] });
    expect(screen.queryByRole("list", { name: "Public holidays coming up" })).toBeNull();
    const more = screen.getByRole("button", { name: /All NSW public holidays/ });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);
    const year = screen.getByRole("list", { name: "Public holidays coming up" });
    expect(within(year).getByText("Christmas Day")).toBeInTheDocument();
  });
});

describe("when the week is closed to you", () => {
  it.each([
    ["submitted", { sheet: SHEET({ status: "submitted" }) }],
    ["approved", { sheet: SHEET({ status: "approved" }) }],
    ["historical", { periodIndex: 1 }],
  ])("%s: it reads, it doesn't edit", async (_label, over) => {
    const user = userEvent.setup();
    const { container } = renderSheet(over as Partial<React.ComponentProps<typeof MyTimesheet>>);
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(screen.queryByText("Save day")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send week" })).toBeNull();
    expect(rows()).toHaveLength(7);
    await user.click(tab(/Mon 29 Jun/));
    expect(container.querySelector(".ts2-lock")).not.toBeNull();
  });

  it("locks a draft at its send moment, and says when", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet({
      ...CASUAL,
      me: { ...ME, days: Array.from({ length: 7 }, () => EM) as DayEntry[] },
      sources: Array.from({ length: 7 }, () => "none") as DaySource[],
      pastSend: true,
      today: 6,
      through: 5,
      todayISO: "2026-07-05",
    });
    expect(sub(container)).toBe("This week locked at Sun 3:00 PM.");
    expect(screen.queryByRole("button", { name: "Send week" })).toBeNull();
    await user.click(tab(/Tue 30 Jun/));
    expect(within(panel()).queryByRole("button", { name: "Add this day" })).toBeNull();
    expect(screen.queryByText("Save day")).toBeNull();
  });

  it("leaves a sent-back week open after the moment — its approver reopened it", () => {
    renderSheet({ pastSend: true, sheet: SHEET({ status: "sent_back", reviewNote: "Tuesday?" }) });
    expect(screen.getByRole("button", { name: "Send again" })).toBeEnabled();
  });

  it("keeps a sent-back sheet answerable once its period has closed", async () => {
    const user = userEvent.setup();
    renderSheet({ periodIndex: 1, sheet: SHEET({ status: "sent_back", reviewNote: "Tuesday?" }) });
    expect(screen.getByText("Tuesday?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send again" })).toBeEnabled();
    await user.click(tab(/Mon 29 Jun/));
    expect(within(panel()).getByRole("radio", { name: "Off" })).toBeInTheDocument();
  });

  it("still closes an ordinary week once its period has gone", async () => {
    const user = userEvent.setup();
    renderSheet({ periodIndex: 1, sheet: SHEET({ status: "draft" }) });
    await user.click(tab(/Mon 29 Jun/));
    expect(within(panel()).queryByRole("radio", { name: "Off" })).toBeNull();
  });

  const NO_LOCK = { ...DEFAULT_SETTINGS, lock: false };

  it("keeps a sent week open while it runs when the workspace doesn't lock", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet({ settings: NO_LOCK, sheet: SHEET({ status: "submitted" }) });
    await user.click(tab(/Mon 29 Jun/));
    expect(screen.getByRole("radio", { name: "Off" })).toBeInTheDocument();
    expect(screen.queryByText(/can't be changed here/)).toBeNull();
    expect(sub(container)).toBe(
      "With your manager. You'll be told if anything needs a look. You can still change it until the week ends.",
    );
    expect(screen.queryByRole("button", { name: "Send week" })).toBeNull();
  });

  it("still closes an approved week, and a sent week that has ended, with the lock off", async () => {
    const user = userEvent.setup();
    const approved = renderSheet({ settings: NO_LOCK, sheet: SHEET({ status: "approved" }) });
    await user.click(tab(/Mon 29 Jun/));
    expect(screen.queryByRole("radio", { name: "Off" })).toBeNull();
    approved.unmount();

    renderSheet({ settings: NO_LOCK, sheet: SHEET({ status: "submitted" }), periodIndex: 1 });
    await user.click(tab(/Mon 29 Jun/));
    expect(screen.queryByRole("radio", { name: "Off" })).toBeNull();
    expect(screen.getByText(/has been sent — it can't be changed here/)).toBeInTheDocument();
  });

  it("keeps a sent week closed to its owner with the lock on, the default", async () => {
    const user = userEvent.setup();
    renderSheet({ sheet: SHEET({ status: "submitted" }) });
    await user.click(tab(/Mon 29 Jun/));
    expect(screen.queryByRole("radio", { name: "Off" })).toBeNull();
  });

  it("lets a salaried person record a long day on a sent week that is still open", async () => {
    const user = userEvent.setup();
    renderSheet({ salaried: true, settings: NO_LOCK, sheet: SHEET({ status: "submitted" }) });
    await user.click(tab(/Mon 29 Jun/));
    expect(screen.getByText("This day ran long — record the hours")).toBeInTheDocument();
    expect(screen.queryByText(/can't be changed here/)).toBeNull();
  });

  it("sends at the moment without locking a draft when the workspace doesn't lock", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet({
      ...CASUAL,
      me: { ...ME, days: Array.from({ length: 7 }, () => EM) as DayEntry[] },
      sources: Array.from({ length: 7 }, () => "none") as DaySource[],
      pastSend: true,
      today: 6,
      through: 5,
      todayISO: "2026-07-05",
      settings: NO_LOCK,
    });
    expect(sub(container)).not.toMatch(/locked at/);
    await user.click(tab(/Tue 30 Jun/));
    expect(within(panel()).getByRole("button", { name: "Add this day" })).toBeInTheDocument();
  });
});

describe("sending", () => {
  const WEEK_OVER = { today: 5, through: 4 };

  it("sends the period from the head once the working days are behind you", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet(WEEK_OVER);
    const send = screen.getByRole("button", { name: "Send week" });
    expect(container.querySelector(".ts2-head")?.contains(send)).toBe(true);
    await user.click(send);
    expect(submitWeek).toHaveBeenCalledWith("2026-06-29");
  });

  /* Sending locks the sheet and writes only the days that are over, so a
     week with a working day ahead of it has no button yet — not a dead one. */
  it("will not send a period that still has a working day ahead of it", () => {
    const { container } = renderSheet();
    expect(screen.queryByRole("button", { name: "Send week" })).toBeNull();
    expect(sub(container)).toMatch(/^Send this week once Fri 3 Jul is over\./);
    expect(screen.queryByText(/still to come/)).toBeNull();
  });

  it("does not count a weekend nobody was rostered for", () => {
    const { container } = renderSheet(WEEK_OVER);
    expect(screen.getByRole("button", { name: "Send week" })).toBeEnabled();
    expect(sub(container)).toBe("Ready to send. If you don't, it sends itself Sun 3:00 PM and locks.");
  });

  it("a casual is held for every day left, having no rostered ones", () => {
    const { container } = renderSheet({ ...CASUAL, ...WEEK_OVER });
    expect(screen.queryByRole("button", { name: "Send week" })).toBeNull();
    expect(sub(container)).toBe("Add the days you worked. It sends itself Sun 3:00 PM and locks.");
  });

  it("always lets a sent-back sheet answer, however much of the week is left", () => {
    const { container } = renderSheet({ sheet: SHEET({ status: "sent_back", reviewNote: "Why the Wednesday overtime?" }) });
    expect(screen.getByText("Sent back with a question")).toBeInTheDocument();
    expect(screen.getByText("Why the Wednesday overtime?")).toBeInTheDocument();
    // above the rows, as the board asks
    const back = container.querySelector(".ts2-back") as HTMLElement;
    expect(back.compareDocumentPosition(container.querySelector(".ts2-table")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send again" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Send week" })).toBeNull();
  });

  it("an empty week has nothing to send", () => {
    const { container } = renderSheet({
      ...WEEK_OVER,
      me: { ...ME, days: [EM, EM, EM, EM, EM, EM, EM] },
      sources: ["expected", "expected", "expected", "expected", "expected", "none", "none"],
    });
    expect(screen.queryByRole("button", { name: "Send week" })).toBeNull();
    expect(sub(container)).toBe("Log the days you worked to send this week.");
  });
});

describe("a salaried week pays itself", () => {
  it("locks the days, says why, and still offers Send", async () => {
    const user = userEvent.setup();
    renderSheet({ salaried: true, today: 5, through: 4 });
    await user.click(tab(/Mon 29/));
    expect(screen.getByText(/this day pays itself/)).toBeInTheDocument();
    expect(screen.getByText(/nothing to fill in/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send week" })).toBeInTheDocument();
  });

  it("unlocks ONE day, from the day itself", async () => {
    const user = userEvent.setup();
    renderSheet({ salaried: true, today: 5, through: 4 });
    await user.click(tab(/Mon 29/));
    expect(screen.queryByRole("combobox", { name: "Started" })).toBeNull();

    await user.click(screen.getByText(/This day ran long/));
    expect(field("Started")).toBeInTheDocument();
    expect(screen.queryByText("Save day")).toBeNull();
    await spin(user, "Finished", "Hour", "6");
    await user.keyboard("{Escape}");
    expect(screen.getByText("Save day")).toBeInTheDocument();

    await user.click(tab(/Tue 30/));
    expect(screen.queryByRole("combobox", { name: "Started" })).toBeNull();
    expect(screen.getByText(/this day pays itself/)).toBeInTheDocument();
  });

  it("has no global mode left to leave switched on", () => {
    renderSheet({ salaried: true, today: 5, through: 4 });
    expect(screen.queryByText("Add overtime")).toBeNull();
    expect(screen.queryByText("Done adding overtime")).toBeNull();
  });

  it("says when overtime is absorbed rather than paid, at rest", () => {
    renderSheet({ salaried: true, settings: { ...DEFAULT_SETTINGS, salariedOtPaid: false } });
    expect(screen.getByText(/your salary already covers the extra hours/)).toBeInTheDocument();
  });

  it("names the cycle in its own copy too — a monthly salary is not weekly", () => {
    renderSheet({ salaried: true, settings: { ...DEFAULT_SETTINGS, cycle: "Monthly", salariedOtPaid: false } });
    expect(screen.getByText(/your pay is the same every month/)).toBeInTheDocument();
  });
});

describe("the v2 rules on this page", () => {
  it("has no native select, time input, title tooltip or typed ellipsis", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet({ settings: withBreak(30, false) });
    await user.click(tab(/Mon 29 Jun/));
    expect(container.querySelectorAll("select")).toHaveLength(0);
    expect(container.querySelectorAll('input[type="time"]')).toHaveLength(0);
    expect(container.querySelectorAll("[title]")).toHaveLength(0);
    expect(container.textContent).not.toContain("…");
    expect(container.textContent).not.toMatch(/ · /);
  });

  it("has one main button at most, and it is the day's", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet({ today: 5, through: 4 });
    // Send is a second button: the open day's card holds the main one
    expect(screen.getByRole("button", { name: "Send week" }).className).toContain("pt-btn--second");
    expect(container.querySelectorAll(".pt-btn--main")).toHaveLength(1); // Friday is over and empty: Log hours
    await user.click(tab(/Mon 29 Jun/));
    await user.click(screen.getByRole("radio", { name: "Off" }));
    const mains = container.querySelectorAll(".pt-btn--main");
    expect(mains).toHaveLength(1);
    expect(mains[0]!.textContent).toBe("Save day");
  });
});
