import { render, screen, within } from "@testing-library/react";
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

/* My timesheet — one strip of day tabs, and a clock you scroll.

   THE THREE LOAD-BEARING ASSERTIONS in this file:

   1. THE DAYS ARE DRAWN ONCE. There is a row of day tabs and nothing else —
      no second vertical list of the same seven days. Clicking a tab opens
      that day, and only that day, in the panel below.

   2. NO TIME CAN BE TYPED. There is no text input on this screen at all. A
      start and a finish are chosen from wheels of real times, so the old
      "we can't read that" state has no way to occur.

   3. AN ORDINARY WEEK NEEDS NO INPUT. The days arrive already presumed —
      normal hours on a past weekday, a public holiday or booked leave where
      the business already knows better — and the screen says which is which
      rather than pretending the person logged it.

   The standing money check is here too: not a rate, not a gross, not a dollar
   sign — multipliers and hours only. */

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
  { start: "2026-06-22", range: "22 – 28 Jun", year: "2026", live: false, note: "Closed period · historical" },
];

const W = (i: string, o: string, h: number): DayEntry => ({ t: "work", in: i, out: o, h });
/* 7:00 AM → 3:00 PM is exactly 8h of span, so with no break configured the
   derived hours and the stored hours agree — and a 30-minute unpaid break
   takes it to a clean 7.5. */
const w8 = W("7:00 AM", "3:00 PM", 8);
const w11 = W("7:00 AM", "6:00 PM", 11);
const EM: DayEntry = { t: "empty" };

/* The week as the SERVER hands it over: already presumed. Mon and Tue are
   ordinary days nobody entered, Wed is a real 11-hour day the person logged,
   Thu came from the leave module, Fri hasn't happened yet, and the weekend is
   untouched. `sources` is what makes those four different things legible. */
const DAYS: DayEntry[] = [w8, w8, w11, { t: "sick", h: 8 }, EM, EM, EM];
const SOURCES: DaySource[] = [
  "presumed",
  "presumed",
  "entered",
  "leave",
  "expected",
  "none",
  "none",
];

/* No rate — the query stopped selecting one. */
const ME: StaffWeek = {
  id: "me",
  name: "Isaac Smith",
  role: "Installer",
  rate: null,
  days: DAYS,
};

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

/* One place the props are declared, so a test that needs to RE-render with a
   changed day (the server answering a save) can reuse the same baseline. */
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

/** A day tab, by the label it announces ("Mon 29 Jun — Normal"). */
const tab = (name: RegExp) => screen.getByRole("tab", { name });
/** The open day, as its own scope — the rail has wheels of its own. */
const panel = () => screen.getByRole("tabpanel");
/** Pick a value on a wheel inside the given scope (the day panel by default). */
const spin = async (
  user: ReturnType<typeof userEvent.setup>,
  wheel: "Start" | "Finish",
  column: "Hour" | "Minute" | "AM/PM",
  option: string,
  scope: HTMLElement = panel(),
) => {
  const group = within(scope).getByRole("group", { name: wheel });
  const list = within(group).getByRole("listbox", { name: column });
  await user.click(within(list).getByRole("option", { name: option }));
};

beforeEach(() => {
  [saveDay, saveMyHours, submitWeek, markUnavailable, clearUnavailable, push, refresh].forEach(
    (m) => m.mockClear(),
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

describe("the period header", () => {
  it("keeps the period nav, the LIVE pill and the status chip", () => {
    renderSheet();
    expect(screen.getByText("My timesheet")).toBeInTheDocument();
    expect(screen.getAllByText("29 Jun – 5 Jul").length).toBeGreaterThan(0);
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.getAllByText("Draft").length).toBeGreaterThan(0);
  });

  it("period arrows navigate, they don't hold local state", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByLabelText("Previous period"));
    expect(push).toHaveBeenCalledWith("/dashboard/my-timesheet?period=2026-06-22");
  });

  it("a historical period says so in the period pill", () => {
    renderSheet({ periodIndex: 1 });
    expect(screen.getByText("Historical")).toBeInTheDocument();
  });

  it("says nothing about money — not a rate, not a gross, not a dollar sign", () => {
    const { container } = renderSheet();
    expect(container.textContent).not.toMatch(/\$/);
    expect(screen.queryByText("Your rate")).toBeNull();
  });
});

describe("the week is ONE strip of day tabs", () => {
  it("draws each day exactly once — there is no second list underneath", () => {
    const { container } = renderSheet();
    expect(container.querySelectorAll(".mts2-tab")).toHaveLength(7);
    // the vertical row stack this screen used to also render is gone
    expect(container.querySelectorAll(".mts2-row")).toHaveLength(0);
    expect(container.querySelectorAll(".mts2-rows")).toHaveLength(0);
  });

  it("colours every tab by the state of its day", () => {
    const { container } = renderSheet();
    const tabs = [...container.querySelectorAll(".mts2-tab")].map((t) => t.className);
    expect(tabs[0]).toContain("std"); // presumed normal day
    expect(tabs[2]).toContain("over"); // the 11-hour Wednesday
    expect(tabs[3]).toContain("sick"); // booked leave
    expect(tabs[5]).toContain("offroster"); // Saturday, nobody's normal day
    expect(tabs[6]).toContain("offroster");
    expect(tabs[0]).not.toContain("offroster");
  });

  it("marks today, and dims a day that hasn't happened yet", () => {
    const { container } = renderSheet();
    const tabs = [...container.querySelectorAll(".mts2-tab")].map((t) => t.className);
    expect(tabs[4]).toContain("today");
    expect(tabs[4]).toContain("ahead"); // today isn't marked worked until it's over
    expect(tabs[0]).not.toContain("ahead");
  });

  /* Reported from the live screen at ~6:45am: today's card read "Missing" and
     the rail chased it — for a day that hadn't started. The presumption had
     always declined to fill today in ("marked as worked once the day is
     over"); the missing check used `i <= today` and so disagreed by exactly
     one day. Both now read `through`. */
  it("never calls TODAY missing — the day hasn't happened yet", () => {
    const { container } = renderSheet();
    const todayTab = container.querySelectorAll(".mts2-tab")[4] as HTMLElement;
    expect(todayTab.className).toContain("today");
    expect(todayTab.className).not.toContain("miss");
    expect(todayTab.textContent).not.toContain("Missing");
    expect(container.textContent).not.toContain("no entry logged");
  });

  it("does call it missing once the day is over", () => {
    const { container } = renderSheet({ through: 4 });
    const fri = container.querySelectorAll(".mts2-tab")[4] as HTMLElement;
    expect(fri.className).toContain("miss");
  });

  it("opens on today, so the day you came here about is already showing", () => {
    const { container } = renderSheet();
    expect(container.querySelectorAll(".mts2-tab.on")).toHaveLength(1);
    expect((container.querySelectorAll(".mts2-tab")[4] as HTMLElement).className).toContain("on");
    expect(screen.getByRole("tabpanel")).toBeInTheDocument();
  });

  it("clicking a tab switches the panel to that day — one panel, always", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    expect(container.querySelectorAll(".mts2-panel")).toHaveLength(1);
    expect(container.querySelectorAll(".mts2-tab.on")).toHaveLength(1);
    expect(screen.getByText("Mon 29 Jun")).toBeInTheDocument();

    await user.click(tab(/Wed 1 Jul/));
    expect(container.querySelectorAll(".mts2-panel")).toHaveLength(1);
    expect(screen.getByText("Wed 1 Jul")).toBeInTheDocument();
    expect(screen.queryByText("Mon 29 Jun")).toBeNull();
  });

  /* A worked Saturday runs every hour through the weekend rule, so `dayClass`
     calls it `over` — correct about the pay, wrong about the word. A four-hour
     Saturday was labelled "Overtime day", which describes a long day when it
     was a short one. The premium is for the day of the week. */
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
    // Wednesday is the stored 11-hour day
    expect(screen.getByRole("tab", { name: /Wed 1 Jul — Overtime day/ })).toBeInTheDocument();
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
    // no weekend premium applied, so it is simply a normal day
    expect(screen.getByRole("tab", { name: /Sat 4 Jul — Normal/ })).toBeInTheDocument();
  });

  it("a weekend is clickable straight from the strip — no separate offer", async () => {
    const user = userEvent.setup();
    renderSheet();
    expect(screen.queryByRole("button", { name: "Add Saturday" })).toBeNull();
    await user.click(tab(/Sat 4 Jul/));
    expect(screen.getByText("Sat 4 Jul")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Start" })).toBeInTheDocument();
  });

  it("legends the colours, so a week's shape can be read without opening it", () => {
    const { container } = renderSheet();
    const legend = container.querySelector(".mts2-legend") as HTMLElement;
    ["Normal", "Overtime", "Short", "Leave", "Sick", "Public holiday", "Not worked"].forEach((l) =>
      expect(within(legend).getByText(l)).toBeInTheDocument(),
    );
  });
});

describe("a normal week takes no input", () => {
  it("says a presumed day was filled in, not logged", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    expect(container.querySelector(".mts2-esrc")?.textContent).toContain("Your normal day");
    // and it is already showing the normal hours, ready to submit untouched
    expect(container.querySelector(".mts2-derv")?.textContent).toContain("7:00 AM – 3:00 PM");
    expect(container.querySelector(".mts2-derv")?.textContent).toContain("8h");
  });

  it("a day still ahead of itself says it isn't marked yet", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(tab(/Fri 3 Jul/));
    expect(container.querySelector(".mts2-esrc")?.textContent).toContain(
      "marked as worked once the day is over",
    );
  });

  it("booked leave is READ ONLY here — it belongs to the leave module", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tab(/Thu 2 Jul/));
    expect(screen.getByText("Sick leave — 8h")).toBeInTheDocument();
    expect(screen.getByText(/came from your leave/)).toBeInTheDocument();
    // nothing to edit, and nothing to save over the booking
    expect(screen.queryByText("Save day")).toBeNull();
    expect(screen.queryByRole("group", { name: "Start" })).toBeNull();
  });

  it("a public holiday is read only too, and names itself", async () => {
    const user = userEvent.setup();
    renderSheet({
      me: { ...ME, days: [w8, w8, { t: "ph", h: 8 }, { t: "sick", h: 8 }, EM, EM, EM] },
      sources: ["presumed", "presumed", "holiday", "leave", "expected", "none", "none"],
      holidays: [{ date: "2026-07-01", name: "Territory Day" }],
    });
    await user.click(tab(/Wed 1 Jul/));
    expect(screen.getAllByText("Territory Day").length).toBeGreaterThan(0);
    expect(screen.getByText(/business is closed/)).toBeInTheDocument();
    expect(screen.queryByText("Save day")).toBeNull();
  });

  it("cannot declare leave from the timesheet — that would be a second place to book it", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    // scoped to the open day: the legend names every state, but the EDITOR
    // offers only the two a person is entitled to assert
    const p = panel();
    expect(within(p).queryByText("Annual leave")).toBeNull();
    expect(within(p).queryByText("Public holiday")).toBeNull();
    expect(within(p).getByText("Worked")).toBeInTheDocument();
    expect(within(p).getByText("Didn't work")).toBeInTheDocument();
  });
});

describe("a time is scrolled, never typed", () => {
  it("has no text input anywhere on the screen", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(container.querySelectorAll("textarea")).toHaveLength(0);
    // and no hours box either — hours are still what the times mean
    expect(screen.queryByLabelText("Hours")).toBeNull();
  });

  it("offers only real times, and re-derives the hours as you spin", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    await spin(user, "Finish", "Hour", "4");
    expect(container.querySelector(".mts2-derv")?.textContent).toContain("4:00 PM");
    expect(container.querySelector(".mts2-derv")?.textContent).toContain("9h");
  });

  it("sends the DERIVED hours in the same {t,in,out,h} payload", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    await spin(user, "Finish", "Hour", "4");
    await user.click(screen.getByText("Save day"));
    expect(saveDay).toHaveBeenCalledWith("2026-06-29", 0, {
      t: "work",
      in: "7:00 AM",
      out: "4:00 PM",
      h: 9,
    });
  });

  it("Save is never disabled, because a wheel can't produce a bad time", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    await spin(user, "Finish", "Minute", "45");
    await spin(user, "Start", "AM/PM", "PM");
    expect(screen.getByText("Save day").closest("button")).not.toBeDisabled();
  });

  it("minutes move in fives — the granularity a timesheet is actually kept to", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    const group = screen.getByRole("group", { name: "Start" });
    const minutes = within(group).getByRole("listbox", { name: "Minute" });
    const options = within(minutes).getAllByRole("option");
    expect(options).toHaveLength(12);
    expect(options.map((o) => o.textContent)).toContain("35");
    expect(options.map((o) => o.textContent)).not.toContain("37");
  });
});

describe("a day that was different", () => {
  it("a short day saves its real hours and warns it will be looked at", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    await spin(user, "Finish", "Hour", "11");
    await spin(user, "Finish", "AM/PM", "AM");
    expect(container.querySelector(".mts2-derv")?.className).toContain("short");
    expect(container.querySelector(".mts2-derv")?.textContent).toContain("4h");
    await user.click(screen.getByText("Save day"));
    expect(saveDay).toHaveBeenCalledWith("2026-06-29", 0, {
      t: "work",
      in: "7:00 AM",
      out: "11:00 AM",
      h: 4,
    });
  });

  it("'Didn't work' saves a day off, and points at leave for a paid one", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    await user.click(screen.getByText("Didn't work"));
    expect(screen.getByText(/book it in/)).toBeInTheDocument();
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

  /* FOUND BY FILLING A WEEK IN ON THE REAL SCREEN. The editor seeds kind/start
     /finish into local state on mount and was keyed by the day INDEX alone, so
     a save that changed the day underneath it left the editor showing the old
     answer: the card returned to "Normal · 8h" while the panel still read
     "Didn't work · 0h". Pressing Save from there wrote the `off` straight back
     and undid the correction without saying a word. */
  it("re-reads the day after a save instead of keeping what it mounted with", async () => {
    const user = userEvent.setup();
    const off: DayEntry = { t: "off" };
    const { rerender } = renderSheet({
      me: { ...ME, days: [off, ...DAYS.slice(1)] },
      sources: ["entered", ...SOURCES.slice(1)] as DaySource[],
    });
    await user.click(tab(/Mon 29 Jun/));
    expect(screen.getByText("Didn't work").className).toContain("on");

    // the server sends the day back as an ordinary presumed day
    rerender(
      <MyTimesheet
        {...(BASE_PROPS as React.ComponentProps<typeof MyTimesheet>)}
        me={{ ...ME, days: [w8, ...DAYS.slice(1)] }}
        sources={["presumed", ...SOURCES.slice(1)] as DaySource[]}
      />,
    );

    // the panel must follow the day, not its own stale state
    expect(screen.getByText("Worked").className).toContain("on");
    expect(screen.getByText("Didn't work").className).not.toContain("on");
    expect(screen.getByRole("group", { name: "Start" })).toBeInTheDocument();
    expect(screen.queryByText(/book it in/)).toBeNull();
  });

  it("a presumed day has nothing to clear — it was never a row", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    expect(screen.queryByText("Back to normal")).toBeNull();
  });
});

/* Employment type decides whether a person has a normal week at all. The class
   comes from staff_profiles.employment_type through the shared classifier —
   this screen never string-matches a label. */
describe("a casual", () => {
  it("gets no day filled in, and none of them read as missing", () => {
    const { container } = renderSheet(CASUAL);
    const tabs = [...container.querySelectorAll(".mts2-tab")].map((t) => t.className);
    // Tue–Fri are past weekdays with nothing on them. For a permanent that is
    // four "Missing" days; for a casual it is four days they weren't rostered.
    expect(tabs.filter((c) => c.includes("miss"))).toHaveLength(0);
    expect(tabs[1]).toContain("offroster");
    expect(tabs[4]).toContain("offroster");
    // the day they DID work is still theirs
    expect(tabs[0]).toContain("std");
  });

  it("says its week is entered by hand, not filled in", () => {
    const { container } = renderSheet(CASUAL);
    expect(screen.getByText(/Nothing is filled in for you/)).toBeInTheDocument();
    expect(container.querySelector(".mts2-rules")?.textContent).toContain(
      "every day entered by hand",
    );
  });

  it("is never told a short day is short — they were rostered for what they did", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet(CASUAL);
    await user.click(tab(/Tue 30 Jun/));
    await spin(user, "Finish", "Hour", "11");
    await spin(user, "Finish", "AM/PM", "AM");
    expect(container.querySelector(".mts2-derv")?.className).not.toContain("short");
  });

  it("has no normal week to set, and marks when it can't work instead", () => {
    renderSheet(CASUAL);
    expect(screen.queryByText("My normal week")).toBeNull();
    expect(screen.getByText("When I can’t work")).toBeInTheDocument();
    expect(screen.getByText("Nothing marked. You’re available.")).toBeInTheDocument();
  });

  it("marking a block is a declaration — it says outright that nobody approves it", async () => {
    const user = userEvent.setup();
    renderSheet(CASUAL);
    expect(screen.getByText(/Nobody approves this/)).toBeInTheDocument();
    await user.click(screen.getByText("Mark days I can’t work"));
    expect(screen.getByText("Mark unavailable")).toBeInTheDocument();
    /* It SAYS nobody approves it, and it offers no approval machinery to match:
       nothing to submit for review, no request to withdraw, no status to sit
       in. A declaration that shipped with an approve step would be a request
       wearing different words. */
    const card = screen.getByText("When I can’t work").closest(".mts2-card") as HTMLElement;
    const buttons = within(card).getAllByRole("button").map((b) => b.textContent ?? "");
    expect(buttons.some((t) => /submit|request|withdraw|approve/i.test(t))).toBe(false);
    expect(within(card).queryByText(/pending|awaiting/i)).toBeNull();
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
  it("has their non-working weekday greyed, not presumed and not missing", () => {
    const { container } = renderSheet({
      workDays: [0, 1, 3], // Mon, Tue, Thu
      me: { ...ME, days: [w8, w8, EM, w8, EM, EM, EM] },
      sources: ["presumed", "presumed", "none", "presumed", "none", "none", "none"],
    });
    const tabs = [...container.querySelectorAll(".mts2-tab")].map((t) => t.className);
    expect(tabs[2]).toContain("offroster"); // Wednesday
    expect(tabs[2]).not.toContain("miss");
    expect(tabs[0]).not.toContain("offroster");
  });
});

describe("my normal hours", () => {
  it("shows the workspace default \u2014 hours AND days \u2014 and says whose it is", () => {
    renderSheet();
    expect(screen.getByText("My normal week")).toBeInTheDocument();
    expect(screen.getByText("7:00 AM \u2013 3:00 PM")).toBeInTheDocument();
    expect(screen.getByText("Mon, Tue, Wed, Thu, Fri")).toBeInTheDocument();
    expect(screen.getByText(/workspace default/)).toBeInTheDocument();
  });

  it("sets which DAYS are normal, so a part-timer isn\u2019t presumed onto their day off", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByText("Change my normal week"));
    const card = screen.getByText("My normal week").closest(".mts2-card") as HTMLElement;
    await user.click(within(card).getByLabelText("Wednesday"));
    await user.click(within(card).getByLabelText("Friday"));
    await user.click(within(card).getByText("Save"));
    expect(saveMyHours).toHaveBeenCalledWith("7:00 AM", "3:00 PM", [0, 1, 3]);
  });

  it("a person sets their own with the same wheels, no typing", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(screen.getByText("Change my normal week"));
    const card = screen.getByText("My normal week").closest(".mts2-card") as HTMLElement;
    await spin(user, "Start", "Hour", "6", card);
    await spin(user, "Start", "Minute", "30", card);
    expect(container.querySelectorAll("input")).toHaveLength(0);
    await user.click(within(card).getByText("Save"));
    expect(saveMyHours).toHaveBeenCalledWith("6:30 AM", "3:00 PM", [0, 1, 2, 3, 4]);
  });

  it("an override can be handed back to the org's hours", async () => {
    const user = userEvent.setup();
    renderSheet({ ownNormal: true, normal: { start: "6:30 AM", end: "2:30 PM" } });
    expect(screen.getByText(/Yours\./)).toBeInTheDocument();
    await user.click(screen.getByText("Change my normal week"));
    await user.click(screen.getByText("Use the default"));
    expect(saveMyHours).toHaveBeenCalledWith(null, null, null);
  });
});

describe("the break", () => {
  it("says nothing when the workspace hasn't configured one", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    expect(screen.queryByText(/^Break:/)).toBeNull();
    expect(screen.queryByLabelText("Shorter break")).toBeNull();
  });

  it("an unpaid break comes off the span", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet({ settings: withBreak(30, false) });
    await user.click(tab(/Sat 4 Jul/));
    expect(screen.getByText("Break: 30 min · unpaid")).toBeInTheDocument();
    expect(container.querySelector(".mts2-derv")?.textContent).toContain("7.5h");
    await user.click(screen.getByText("Save day"));
    expect(saveDay).toHaveBeenCalledWith("2026-06-29", 5, {
      t: "work",
      in: "7:00 AM",
      out: "3:00 PM",
      h: 7.5,
    });
  });

  it("a day can deviate from the standard break", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet({ settings: withBreak(30, false) });
    await user.click(tab(/Sat 4 Jul/));
    await user.click(screen.getByLabelText("Shorter break"));
    await user.click(screen.getByLabelText("Shorter break"));
    expect(screen.getByText("Break: 20 min · unpaid")).toBeInTheDocument();
    expect(container.querySelector(".mts2-derv")?.textContent).toContain("7.67h");
  });

  it("reopening a saved day shows the break it was saved with, not the org's", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet({
      settings: withBreak(30, false),
      me: { ...ME, days: [W("7:00 AM", "3:00 PM", 7.25), ...DAYS.slice(1)] },
      sources: ["entered", ...SOURCES.slice(1)] as DaySource[],
    });
    await user.click(tab(/Mon 29 Jun/));
    // 8h of span stored as 7.25 means 45 minutes were taken, whatever the
    // org's standard is — a per-day break has no column, so it is read back
    // out of the entry rather than guessed
    expect(screen.getByText("Break: 45 min · unpaid")).toBeInTheDocument();
    expect(container.querySelector(".mts2-derv")?.textContent).toContain("7.25h");
  });

  it("a PAID break deducts nothing and offers no per-day control", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet({ settings: withBreak(30, true) });
    await user.click(tab(/Mon 29 Jun/));
    expect(screen.getByText("Break: 30 min · paid")).toBeInTheDocument();
    expect(screen.queryByLabelText("Shorter break")).toBeNull();
    expect(container.querySelector(".mts2-derv")?.textContent).toContain("8h");
  });
});

describe("the payroll line", () => {
  it("states a plain day as hours × one", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(tab(/Mon 29 Jun/));
    expect(container.querySelector(".mts2-paych")?.textContent).toBe("8h ×1.0 = 8h");
  });

  it("splits an overtime day the way the pay run does — never a dollar", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(tab(/Wed 1 Jul/));
    // 11h on a Wednesday: 8 at 1×, 3 at 1.5× → 12.5 payroll hours
    expect(container.querySelector(".mts2-paych")?.textContent).toBe("8h ×1.0 + 3h ×1.5 = 12.5h");
    expect(container.querySelector(".mts2-paych")?.textContent).not.toContain("$");
  });
});

describe("the rail", () => {
  it("separates what you worked from what payroll counts", () => {
    const { container } = renderSheet();
    const card = container.querySelector(".mts2-card") as HTMLElement;
    expect(within(card).getByText("My week")).toBeInTheDocument();
    // worked 8 + 8 + 11 = 27; payroll 24×1 + 3×1.5 + 8 sick = 36.5
    expect(within(card).getByText("27h")).toBeInTheDocument();
    expect(within(card).getByText("36.5h")).toBeInTheDocument();
    expect(within(card).getByText("Actual worked")).toBeInTheDocument();
    expect(within(card).getByText("Payroll hrs")).toBeInTheDocument();
  });

  it("chips the multiplier buckets and omits the empty ones", () => {
    const { container } = renderSheet();
    const chips = [...container.querySelectorAll(".mts2-bkc")].map((c) => c.textContent);
    expect(chips).toEqual(["32h ×1.0", "3h ×1.5"]); // no 2× hours this week
  });

  it("names the cycle it is totalling", () => {
    renderSheet({ settings: { ...DEFAULT_SETTINGS, cycle: "Fortnightly" } });
    expect(screen.getByText("My fortnight")).toBeInTheDocument();
  });

  /* THE HEADING WAS ALREADY RIGHT — everything under it was wrong.

     This screen knew the cycle well enough to say "My month", then put
     "Submit week" on the button directly beneath it and "Your normal week is
     already filled in" in the status line above that. Four independent
     wordings of one fact, three of them false for two of the three cycles the
     app supports. The test that existed checked the one that was correct. */
  it.each([
    ["Fortnightly", "fortnight"],
    ["Monthly", "month"],
    ["Weekly", "week"],
  ] as const)("says %s in every place it names the period, not just the heading", (cycle, noun) => {
    renderSheet({ settings: { ...DEFAULT_SETTINGS, cycle } });
    expect(screen.getByText(`My ${noun}`)).toBeInTheDocument();
    expect(screen.getByText(`Submit ${noun}`)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Your normal ${noun} is already filled in`))).toBeInTheDocument();
  });

  it("says it in the LOCKED note too, once the period has been sent", () => {
    // the copy a person sees most often after they have finished with it
    renderSheet({
      settings: { ...DEFAULT_SETTINGS, cycle: "Monthly" },
      sheet: { status: "submitted", submittedAt: "2026-07-05", reviewNote: null, reviewedBy: null },
    });
    expect(
      screen.getByText(/This month has been sent — it can't be changed here\./),
    ).toBeInTheDocument();
  });

  it("footnotes the rules that produced those numbers, normal hours first", () => {
    const { container } = renderSheet({ settings: withBreak(30, false) });
    const rules = container.querySelector(".mts2-rules")?.textContent ?? "";
    expect(rules).toContain("Normal 7:00 AM – 3:00 PM");
    expect(rules).toContain("Standard 8h day");
    expect(rules).toContain("OT after 8h/day");
    expect(rules).toContain("30 min break · unpaid");
    expect(rules).toContain("auto-submits Sun 3:00 PM");
    expect(rules).not.toContain("$");
  });
});

describe("the month's public holidays", () => {
  it("says so plainly when the month has none", () => {
    renderSheet();
    expect(screen.getByText("Public holidays — July 2026")).toBeInTheDocument();
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

  it("expands the full year on request, named for the staff member's state", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet({
      holidays: [{ date: "2026-12-25", name: "Christmas Day" }],
    });
    expect(container.querySelector(".mts-hols")).toBeNull();
    await user.click(screen.getByRole("button", { name: /All NSW public holidays/ }));
    expect(container.querySelector(".mts-hols")).not.toBeNull();
    expect(screen.getByText("Christmas Day")).toBeInTheDocument();
  });
});

describe("when the week is closed to you", () => {
  it.each([
    ["submitted", { sheet: SHEET({ status: "submitted" }) }],
    ["approved", { sheet: SHEET({ status: "approved" }) }],
    ["historical", { periodIndex: 1 }],
  ])("%s: it reads, it doesn't edit", async (_label, over) => {
    const { container } = renderSheet(over as Partial<React.ComponentProps<typeof MyTimesheet>>);
    expect(container.querySelector(".tpr")?.className).toContain("locked");
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(screen.queryByText("Save day")).toBeNull();
    expect(screen.queryByText("Submit week")).toBeNull();
    // the days are still all there, and still switchable
    expect(container.querySelectorAll(".mts2-tab")).toHaveLength(7);
    expect(container.querySelector(".mts2-elock")).not.toBeNull();
  });
});

describe("submitting", () => {
  it("submits the period from the rail", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByText("Submit week"));
    expect(submitWeek).toHaveBeenCalledWith("2026-06-29");
  });

  it("a sent-back week shows the manager's question and asks again", () => {
    renderSheet({ sheet: SHEET({ status: "sent_back", reviewNote: "Why the Wednesday overtime?" }) });
    expect(screen.getByText("Sent back with a question")).toBeInTheDocument();
    expect(screen.getByText("Why the Wednesday overtime?")).toBeInTheDocument();
    expect(screen.getByText("Submit again")).toBeInTheDocument();
    expect(screen.queryByText("Submit week")).toBeNull();
  });

  it("an empty week has nothing to send", () => {
    renderSheet({
      me: { ...ME, days: [EM, EM, EM, EM, EM, EM, EM] },
      sources: ["expected", "expected", "expected", "expected", "expected", "none", "none"],
    });
    expect(screen.getByText("Submit week").closest("button")).toBeDisabled();
  });
});

describe("a salaried week pays itself", () => {
  /* Same pay whatever the days say, so the screen goes exception-only: days
     read-only at rest, one "Add overtime" tick for the day that ran long.
     The record keeps writing underneath — presumption and submit unchanged. */
  it("locks the days, says why, and still offers Submit", async () => {
    const user = userEvent.setup();
    renderSheet({ salaried: true });
    await user.click(tab(/Mon 29/));
    expect(screen.getByText(/Salaried — the day pays itself/)).toBeInTheDocument();
    expect(screen.getByText(/nothing to fill in/)).toBeInTheDocument();
    expect(screen.getByText("Submit week")).toBeInTheDocument();
  });

  it("Add overtime opens the editors; Done closes them again", async () => {
    const user = userEvent.setup();
    renderSheet({ salaried: true });
    await user.click(tab(/Mon 29/));
    expect(screen.queryByText("Save day")).not.toBeInTheDocument();

    await user.click(screen.getByText("Add overtime"));
    await user.click(tab(/Mon 29/));
    expect(screen.getByText(/Pick the day it happened/)).toBeInTheDocument();

    await user.click(screen.getByText("Done adding overtime"));
    expect(screen.getByText(/Salaried — the day pays itself/)).toBeInTheDocument();
  });

  it("says when overtime is absorbed rather than paid", async () => {
    const user = userEvent.setup();
    renderSheet({ salaried: true, settings: { ...DEFAULT_SETTINGS, salariedOtPaid: false } });
    await user.click(screen.getByText("Add overtime"));
    expect(screen.getByText(/your salary already covers additional hours/)).toBeInTheDocument();
  });

  it("names the cycle in its own copy too — a monthly salary is not weekly", async () => {
    /* "your pay is the same every week" is a strange thing to tell somebody
       paid monthly, and the sentence right after it is the one explaining why
       they have nothing to do. */
    const user = userEvent.setup();
    renderSheet({ salaried: true, settings: { ...DEFAULT_SETTINGS, cycle: "Monthly", salariedOtPaid: false } });
    expect(screen.getByText(/your pay is the same every month/)).toBeInTheDocument();
    await user.click(screen.getByText("Add overtime"));
    expect(screen.getByText(/recorded with your month/)).toBeInTheDocument();
  });
});
