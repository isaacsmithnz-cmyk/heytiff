import { readFileSync } from "fs";
import { join } from "path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { pickDate } from "@/components/ui/__tests__/fixtures/pick-date";
import { HomeCalendarPage } from "../home-cal-page";
import { revealIn } from "../home-cal-parts";
import { companyItems, type CompanyCalendar, type CompanyRows } from "@/lib/calendar/items";
import type { BoxSave } from "@/components/tiff/modal/tiff-box";
import { TiffContext, type TiffApi, type TiffLanded } from "@/components/tiff/modal/tiff-context";

/* THE CALENDAR, ON SCREEN (H21). The rows, the maths and the words are
   lib/calendar's and have their own suites; every calendar here is built
   by them from rows like the loader's, so what is pinned is what the page
   does: its own toolbar, one choice — a thing or a day — and one set of
   filters across the three views, the rail built from the list's rows, the
   arrows resting at the twelve months' edges, and Save on the day the box
   names (Home walk, part 2: "simplify it. how does a calendar normally add
   things in?").

   The box is Tiff's and has its own suite: stubbed here to a field with
   what the calendar hands it — its room, its words for the day it adds to,
   that day, what Enter does, and its Save. The actions are server
   functions ("use server" cannot load in jsdom), and the list's rows bring
   the list's along: stubbed, as on the desk. */
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }));
jest.mock("@/components/workboard/board/job-sheet", () => ({ JobSheet: () => null }));
jest.mock("@/app/actions/workboard", () => ({ openMirrorJob: jest.fn() }));
jest.mock("@/app/actions/dashboard", () => ({
  completeTask: jest.fn(),
  reopenTask: jest.fn(),
  resolveIssue: jest.fn(),
  reopenIssue: jest.fn(),
}));
jest.mock("@/app/actions/workboard-maintenance", () => ({ placeVisit: jest.fn(), clearVisitPlacement: jest.fn() }));
const mockAdd = jest.fn();
const mockEdit = jest.fn();
const mockDelete = jest.fn();
jest.mock("@/app/actions/calendar", () => ({
  addCalendarEvent: (...a: unknown[]) => mockAdd(...a),
  editCalendarEvent: (...a: unknown[]) => mockEdit(...a),
  deleteCalendarEvent: (...a: unknown[]) => mockDelete(...a),
}));
type BoxProps = { room: string; placeholder: string; save: BoxSave; day?: string; enter?: "sort" | "save" };
let box: BoxProps | null = null;
jest.mock("@/components/tiff/modal/tiff-box", () => ({
  TiffBox: (p: BoxProps) => {
    box = p;
    return <input data-testid="tiff-box" data-room={p.room} aria-label={p.placeholder} readOnly />;
  },
}));

const TODAY = "2026-09-24"; // a Thursday

const ROWS: CompanyRows = {
  holidays: [
    { date: "2026-10-05", name: "Labour Day" },
    { date: "2026-12-25", name: "Christmas Day" },
    { date: "2026-12-26", name: "Boxing Day" },
  ],
  school: [{ season: "spring", startsOn: "2026-09-28", endsOn: "2026-10-09", studentsBack: "2026-10-13" }],
  events: [
    {
      id: "e1",
      kind: "event",
      title: "Toolbox talk",
      startsOn: "2026-10-01",
      endsOn: "2026-10-01",
      startsAt: "06:45:00",
      endsAt: "07:15:00",
      location: "The yard",
      audience: "Everyone",
      note: null,
      seriesId: null,
      repeat: null,
      createdBy: null,
      createdAt: null,
    },
    {
      id: "e2",
      kind: "shutdown",
      title: "Christmas shutdown",
      startsOn: "2026-12-23",
      endsOn: "2027-01-08",
      startsAt: null,
      endsAt: null,
      location: null,
      audience: null,
      note: null,
      seriesId: null,
      repeat: null,
      createdBy: null,
      createdAt: null,
    },
  ],
  notices: [],
  vehicles: [
    { id: "v1", name: "Spare van", plate: "CY14FE", status: "active", regoExpiry: "2026-09-17", insuranceExpiry: null, ctpExpiry: null },
    { id: "v3", name: "Trailer", plate: "TC22BJ", status: null, regoExpiry: "2026-10-20", insuranceExpiry: null, ctpExpiry: null },
  ],
  credentials: [
    {
      id: "c1",
      kind: "insurance",
      name: "Public liability",
      number: null,
      issuer: "QBE Insurance (Australia) Ltd",
      expiryDate: "2026-11-10",
      color: null,
    },
  ],
};

const calendar = (rows: Partial<CompanyRows> = {}, over: Partial<CompanyCalendar> = {}): CompanyCalendar => ({
  today: TODAY,
  windowStart: "2026-09-01",
  windowEnd: "2027-08-31",
  stateName: "NSW",
  items: companyItems({ ...ROWS, ...rows }, { today: TODAY, windowEnd: "2027-08-31", warnDays: 30 }),
  warnDays: 30,
  canAdd: true,
  hasSchool: true,
  ...over,
});

const draw = (cal = calendar()) => render(<HomeCalendarPage cal={cal} />);
const viewBtn = (name: string) => within(screen.getByRole("group", { name: "View" })).getByRole("button", { name });
const filter = (name: RegExp) =>
  within(screen.getByRole("group", { name: "Show on the calendar" })).getByRole("button", { name });
const agenda = () => document.querySelector<HTMLElement>(".hd-cal-ag")!;
const panel = () => screen.getByRole("complementary", { name: "Details" });
const rail = () => screen.getByRole("complementary", { name: "Due and holidays ahead" });
/** What the panel is headed with: a thing's title, or a day in full. */
const heading = () => within(panel()).getByRole("heading", { level: 3 });
/** The right-hand column: the box on top, then the rail or the panel. */
const side = () => document.querySelector<HTMLElement>(".hd-cal-side")!;
const field = () => screen.getByTestId("tiff-box");
/** What is in view: the toolbar's heading (the rail's groups are headings too). */
const rangeTitle = () => document.querySelector<HTMLElement>(".hd-cal-rt")!;
/** A box on screen, for a layout jsdom does not have. */
const at = (top: number, height: number) =>
  ({ top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
/** Lays out the page: each element that matches a selector is the box it gives, everything else nowhere. */
const layout = (boxes: [string, (el: HTMLElement) => DOMRect][]) =>
  jest.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const hit = boxes.find(([sel]) => this.matches(sel));
    return hit ? hit[1](this as HTMLElement) : at(0, 0);
  });

afterEach(() => {
  cleanup();
  box = null;
  mockAdd.mockReset();
  mockEdit.mockReset();
  mockDelete.mockReset();
});

describe("its own toolbar", () => {
  /* "simplify it" (2026-09-26): the box's row went, and the toolbar is one
     row — ‹ ›, what is in view, Today, the filters, and the switch at its
     end, with the filters, so the two go to another line together. */
  it("is one row: ‹ ›, what is in view and Today, then the filters, and 4 weeks | Month | Year at its end", () => {
    draw();
    expect(document.querySelector(".hd-cal-hd")).toBeNull();
    const bars = document.querySelectorAll(".hd-cal-tb");
    expect(bars).toHaveLength(1);
    const tb = bars[0] as HTMLElement;
    expect(within(tb).queryByTestId("tiff-box")).toBeNull();
    const views = screen.getByRole("group", { name: "View" });
    const filters = screen.getByRole("group", { name: "Show on the calendar" });
    expect(tb.contains(views)).toBe(true);
    // the switch is the row's last thing, beside the filters
    expect(views.parentElement).toBe(filters.parentElement);
    expect(filters.nextElementSibling).toBe(views);
    expect(views.nextElementSibling).toBeNull();
    expect(within(views).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "4 weeks4 weeks",
      "MonthMonth",
      "YearYear",
    ]);
    expect(viewBtn("4 weeks")).toHaveAttribute("aria-pressed", "true");
    // each seat's name is said once: the bold copy is out of the tree
    expect(viewBtn("Month")).toHaveAccessibleName("Month");
  });

  it("leaves the box out for a viewer who may not add to the calendar", () => {
    draw(calendar({}, { canAdd: false }));
    expect(screen.queryByTestId("tiff-box")).toBeNull();
    expect(screen.getByRole("group", { name: "View" })).toBeInTheDocument();
  });

  it("says what is in view, rests Today on today's range, and steps inside the twelve months", async () => {
    const user = userEvent.setup();
    draw();
    const title = () => rangeTitle();
    expect(title()).toHaveTextContent("24 Sept – 21 Oct");
    const today = screen.getByRole("button", { name: "Today" });
    expect(today).toHaveAttribute("aria-disabled", "true");

    await user.click(screen.getByRole("button", { name: "Later" }));
    expect(title()).toHaveTextContent("22 Oct – 18 Nov");
    expect(today).toHaveAttribute("aria-disabled", "false");
    await user.click(today);
    expect(title()).toHaveTextContent("24 Sept – 21 Oct");

    await user.click(viewBtn("Year"));
    expect(title()).toHaveTextContent("Sept 2026 – Aug 2027");
    expect(screen.getByRole("button", { name: "Earlier" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Later" })).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("button", { name: "Later" }));
    expect(title()).toHaveTextContent("Sept 2026 – Aug 2027");
  });

  it("stops Month at the last of the twelve months", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(viewBtn("Month"));
    const later = screen.getByRole("button", { name: "Later" });
    for (let i = 0; i < 11; i++) await user.click(later);
    expect(rangeTitle()).toHaveTextContent("August 2027");
    expect(later).toHaveAttribute("aria-disabled", "true");
  });
});

/* THE BOX, at the top of the right-hand column (2026-09-26): over the rail
   beside 4 weeks and over the panel beside Month and Year, naming the day
   it adds to. */
describe("the box", () => {
  it("stands at the top of the right-hand column in every view, in the calendar's room, and is the same box throughout", async () => {
    const user = userEvent.setup();
    draw();
    const first = field();
    expect(first).toHaveAttribute("data-room", "calendar");
    expect(side().firstElementChild).toContainElement(first);
    expect(side()).toContainElement(rail());
    for (const v of ["Month", "Year"]) {
      await user.click(viewBtn(v));
      expect(side().firstElementChild).toContainElement(field());
      expect(side()).toContainElement(panel());
      // the words typed stay with it: it is never drawn again for a view
      expect(field()).toBe(first);
    }
  });

  it("adds to today while nothing is picked, the first thing from today in the panel or not, and Enter saves", async () => {
    const user = userEvent.setup();
    draw();
    expect(field()).toHaveAccessibleName("Add to today…");
    expect(box).toMatchObject({ day: TODAY, enter: "save" });
    await user.click(viewBtn("Month"));
    expect(heading()).toHaveTextContent("School holidays");
    expect(box).toMatchObject({ placeholder: "Add to today…", day: TODAY });
  });

  it("names the day picked, or else the first day of the thing picked", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(within(agenda()).getByRole("button", { name: "Toolbox talk" }));
    expect(field()).toHaveAccessibleName("Add to Thu 1 Oct…");
    expect(box?.day).toBe("2026-10-01");
    await user.click(within(agenda()).getByRole("button", { name: "Fri 25 – Sun 27 Sept, nothing on" }));
    expect(field()).toHaveAccessibleName("Add to Fri 25 Sept…");
    expect(box?.day).toBe("2026-09-25");
    await user.click(within(agenda()).getByRole("button", { name: "Thu 24 Sept" }));
    expect(field()).toHaveAccessibleName("Add to today…");
  });

  /* The page's own choice is not a day anyone asked to add to — until it
     is pressed. */
  it("follows the first thing from today once it is pressed, not before", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(viewBtn("Month"));
    expect(field()).toHaveAccessibleName("Add to today…");
    await user.click(screen.getByRole("button", { name: "School holidays, Mon 28 Sept – Fri 9 Oct" }));
    expect(heading()).toHaveTextContent("School holidays");
    expect(field()).toHaveAccessibleName("Add to Mon 28 Sept…");
  });
});

describe("4 weeks", () => {
  it("has a row for today, saying nothing is on, and for each day with something on", () => {
    draw();
    expect(within(agenda()).getByText("Nothing on today.")).toBeInTheDocument();
    expect(within(agenda()).getByRole("button", { name: "School holidays start" })).toBeInTheDocument();
    expect(within(agenda()).getByRole("button", { name: "Toolbox talk" })).toBeInTheDocument();
    expect(within(agenda()).getByText("6:45 am")).toBeInTheDocument();
    // his span tag on the week the school holidays run through
    expect(within(agenda()).getByText("School holidays all week")).toHaveClass("hd-cal-tag");
    // Labour Day's row is a holiday's
    expect(within(agenda()).getByRole("button", { name: "Labour Day" }).closest(".hd-cal-r")).toHaveAttribute("data-holiday");
  });

  it("gives an admin date its one action, to the vehicle's renewal screen", () => {
    draw();
    expect(within(agenda()).getByRole("link", { name: "Renew rego" })).toHaveAttribute(
      "href",
      "/dashboard/assets?v=v3&screen=rego",
    );
  });

  /* His calLine: an event's row says its time on the right, and only an
     admin date carries an action there. */
  it("gives a noticeboard event its time and no action on its row, and leaves Open notice to the panel", async () => {
    const user = userEvent.setup();
    draw(calendar({ notices: [{ id: "n1", title: "Staff BBQ", date: "2026-10-02", time: "17:30:00", location: "Yard" }] }));
    const title = within(agenda()).getByRole("button", { name: "Staff BBQ" });
    const row = title.closest<HTMLElement>(".hd-cal-it")!;
    expect(within(row).getByText("5:30 pm")).toHaveClass("hd-cal-tm");
    expect(within(row).queryByRole("link")).toBeNull();
    await user.click(title);
    await user.click(viewBtn("Month"));
    expect(within(panel()).getByRole("link", { name: "Open notice" })).toHaveAttribute("href", "/dashboard/notices");
  });

  /* The action is the row's own control: pressing it opens where the thing
     is renewed and leaves the calendar's choice where it was. */
  it("leaves the choice alone when an admin date's action is pressed", async () => {
    const user = userEvent.setup();
    draw();
    const stay = (e: Event) => e.preventDefault();
    document.addEventListener("click", stay, true);
    try {
      const renew = within(agenda()).getByRole("link", { name: "Renew rego" });
      await user.click(renew);
      const row = renew.closest<HTMLElement>(".hd-cal-it")!;
      expect(within(row).getByRole("button", { name: "Trailer, TC22BJ rego" })).toHaveAttribute("aria-pressed", "false");
      expect(row).not.toHaveAttribute("data-sel");
    } finally {
      document.removeEventListener("click", stay, true);
    }
  });

  it("picks a thing from anywhere on its row, and from its title with a key", async () => {
    const user = userEvent.setup();
    draw();
    const talk = within(agenda()).getByRole("button", { name: "Toolbox talk" });
    await user.click(talk.closest(".hd-cal-it")!.querySelector(".hd-cal-s")!);
    expect(talk).toHaveAttribute("aria-pressed", "true");
    const labour = within(agenda()).getByRole("button", { name: "Labour Day" });
    labour.focus();
    await user.keyboard("{Enter}");
    expect(labour).toHaveAttribute("aria-pressed", "true");
    expect(talk).toHaveAttribute("aria-pressed", "false");
  });

  /* "There's no way to select different days to add different things to
     them" (2026-09-26): a press on a day's row that is not on one of its
     things picks the day, through its date, which is its button. */
  it("picks a day from its row but its things, and from its date with a key", async () => {
    const user = userEvent.setup();
    draw();
    const today = within(agenda()).getByRole("button", { name: "Thu 24 Sept" });
    expect(today).toHaveAttribute("aria-current", "date");
    await user.click(within(agenda()).getByText("Nothing on today."));
    expect(today).toHaveAttribute("aria-pressed", "true");
    // a press on a thing on a day picks the thing, and the day lets go
    const talk = within(agenda()).getByRole("button", { name: "Toolbox talk" });
    await user.click(talk.closest(".hd-cal-it")!.querySelector(".hd-cal-s")!);
    expect(talk).toHaveAttribute("aria-pressed", "true");
    expect(today).toHaveAttribute("aria-pressed", "false");
    const oct1 = within(agenda()).getByRole("button", { name: "Thu 1 Oct" });
    expect(oct1).toHaveAttribute("aria-pressed", "false");
    // the day's own date column, around the thing, is the day's
    await user.click(oct1.closest(".hd-cal-d")!);
    expect(oct1).toHaveAttribute("aria-pressed", "true");
    expect(talk).toHaveAttribute("aria-pressed", "false");
    const mon = within(agenda()).getByRole("button", { name: "Mon 28 Sept" });
    mon.focus();
    await user.keyboard("{Enter}");
    expect(mon).toHaveAttribute("aria-pressed", "true");
    expect(oct1).toHaveAttribute("aria-pressed", "false");
    // an admin date's action is its own, and picks nothing
    const stay = (e: Event) => e.preventDefault();
    document.addEventListener("click", stay, true);
    try {
      await user.click(within(agenda()).getByRole("link", { name: "Renew rego" }));
      expect(mon).toHaveAttribute("aria-pressed", "true");
      expect(within(agenda()).getByRole("button", { name: "Tue 20 Oct" })).toHaveAttribute("aria-pressed", "false");
    } finally {
      document.removeEventListener("click", stay, true);
    }
  });

  it("picks a quiet run's first day from anywhere on it, and leaves a day chosen in it where it is", async () => {
    const user = userEvent.setup();
    draw();
    const run = within(agenda()).getByRole("button", { name: "Fri 25 – Sun 27 Sept, nothing on" });
    expect(run).toHaveTextContent("25 – 27");
    await user.click(within(agenda()).getByText("Fri – Sun, nothing on"));
    expect(run).toHaveAttribute("aria-pressed", "true");
    expect(field()).toHaveAccessibleName("Add to Fri 25 Sept…");
    // Sunday, chosen in Month, is in the run: 4 weeks says so, and a press keeps it
    await user.click(viewBtn("Month"));
    await user.click(screen.getByRole("button", { name: "Sun 27 Sept" }));
    await user.click(viewBtn("4 weeks"));
    const again = within(agenda()).getByRole("button", { name: "Fri 25 – Sun 27 Sept, nothing on" });
    expect(again).toHaveAttribute("aria-pressed", "true");
    await user.click(again);
    expect(field()).toHaveAccessibleName("Add to Sun 27 Sept…");
  });
});

describe("the rail", () => {
  it("keeps Due, late first, and Holidays ahead, in the list's own rows", () => {
    draw();
    const heads = within(rail()).getAllByRole("heading", { level: 2 });
    expect(heads.map((h) => h.textContent)).toEqual(["Due 2", "Holidays ahead"]);
    expect(heads[0]).toHaveClass("hd-ls-grp", "due");
    const due = within(heads[0]!.closest("section")!).getAllByRole("listitem");
    expect(due.map((r) => r.querySelector(".hd-ls-t")!.textContent)).toEqual([
      "Spare van, CY14FE rego",
      "Trailer, TC22BJ rego",
    ]);
    expect(due[0]).toHaveTextContent("Ran out Thu 17 Sept.");
    expect(due[0]!.querySelector(".hd-ls-sub")).toHaveClass("late");
    expect(due[1]).toHaveTextContent("26 days");
    const hols = within(heads[1]!.closest("section")!).getAllByRole("listitem");
    expect(hols.map((r) => r.querySelector(".hd-ls-t")!.textContent)).toEqual([
      "Labour Day",
      "Christmas shutdown",
      "Christmas Day",
      "Boxing Day",
    ]);
  });

  it("picks what a row names, the same thing 4 weeks shows chosen", async () => {
    const user = userEvent.setup();
    draw();
    const row = within(rail()).getByRole("button", { name: "Trailer, TC22BJ rego" });
    await user.click(row);
    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(row.closest(".hd-ls-row")).toHaveAttribute("data-pressed");
    expect(within(agenda()).getByRole("button", { name: "Trailer, TC22BJ rego" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("one choice across the views", () => {
  it("is never empty: before anything is picked, the panel holds the first thing from today", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(viewBtn("Month"));
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("School holidays");
    expect(panel()).toHaveTextContent("Starts in 4 days");
  });

  it("shows in Month's panel what was picked in 4 weeks, with its facts and its Edit", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(within(agenda()).getByRole("button", { name: "Toolbox talk" }));
    await user.click(viewBtn("Month"));
    const p = panel();
    expect(within(p).getByRole("heading", { level: 3 })).toHaveTextContent("Toolbox talk");
    expect(p).toHaveTextContent("Event");
    expect(p).toHaveTextContent("Thu 1 Oct, 6:45 – 7:15 am");
    expect(p).toHaveTextContent("In 7 days");
    expect(within(p).getByText("Where").nextSibling).toHaveTextContent("The yard");
    expect(within(p).getAllByRole("button").map((b) => b.textContent)).toEqual(["Edit"]);
    expect(within(p).queryByRole("link")).toBeNull();
  });

  /* The page never scrolls: only the view's own scroller moves. */
  it("keeps the choice in sight in the view it switches to, moving that view's scroller and never the page", async () => {
    const user = userEvent.setup();
    const spy = layout([
      [".hd-cal-ag", () => at(100, 300)],
      ['.hd-cal-ag [aria-pressed="true"]', () => at(900, 24)],
    ]);
    try {
      draw();
      await user.click(viewBtn("Year"));
      await user.click(screen.getByRole("button", { name: "Mon 5 Oct: Labour Day, School holidays" }));
      await user.click(viewBtn("4 weeks"));
      expect(within(agenda()).getByRole("button", { name: "Mon 5 Oct" })).toHaveAttribute("aria-pressed", "true");
      expect(agenda().scrollTop).toBe(900 - 100 - 96);
      expect(document.documentElement.scrollTop).toBe(0);
      expect(document.body.scrollTop).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("carries the choice on to Year, and back to 4 weeks: a thing, and a day", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(within(agenda()).getByRole("button", { name: "Labour Day" }));
    await user.click(viewBtn("Year"));
    expect(heading()).toHaveTextContent("Labour Day");
    expect(panel()).toHaveTextContent("Public holiday in NSW.");
    expect(within(panel()).getByRole("list", { name: "Key" })).toHaveTextContent("Admin overdue");
    expect(screen.getByRole("button", { name: "Mon 5 Oct: Labour Day, School holidays" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Tue 29 Sept: School holidays" }));
    expect(heading()).toHaveTextContent("Tuesday 29 September");
    await user.click(viewBtn("4 weeks"));
    expect(within(agenda()).getByRole("button", { name: "Tue 29 – Wed 30 Sept, nothing on" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(agenda()).getByRole("button", { name: "Labour Day" })).toHaveAttribute("aria-pressed", "false");
  });

  /* "Pick something in any view and every view shows it": 4 weeks' row is
     filled, Month's item and every week's piece of a bar are pressed, and
     so is Year's day — and only the one chosen. A day picked in Year is
     4 weeks' day, not the holiday on it. */
  it("draws the one choice in every view: 4 weeks' row, Month's item and bar, and Year's day", async () => {
    const user = userEvent.setup();
    draw();
    const talkRow = () => within(agenda()).getByRole("button", { name: "Toolbox talk" }).closest(".hd-cal-it");
    await user.click(within(agenda()).getByRole("button", { name: "Toolbox talk" }));
    expect(talkRow()).toHaveAttribute("data-sel");

    await user.click(viewBtn("Month"));
    await user.click(screen.getByRole("button", { name: "Later" }));
    expect(screen.getByRole("button", { name: /^Thu 1 Oct: Toolbox talk/ })).toHaveAttribute("aria-pressed", "true");
    const bar = "School holidays, Mon 28 Sept – Fri 9 Oct";
    expect(screen.getAllByRole("button", { name: bar })).toHaveLength(2);
    for (const b of screen.getAllByRole("button", { name: bar })) expect(b).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getAllByRole("button", { name: bar })[0]!);
    for (const b of screen.getAllByRole("button", { name: bar })) expect(b).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Thu 1 Oct: Toolbox talk/ })).toHaveAttribute("aria-pressed", "false");

    await user.click(viewBtn("Year"));
    const labour = () => screen.getByRole("button", { name: "Mon 5 Oct: Labour Day, School holidays" });
    expect(labour()).toHaveAttribute("aria-pressed", "false");
    await user.click(labour());
    expect(labour()).toHaveAttribute("aria-pressed", "true");

    await user.click(viewBtn("4 weeks"));
    expect(within(agenda()).getByRole("button", { name: "Mon 5 Oct" })).toHaveAttribute("aria-pressed", "true");
    expect(within(agenda()).getByRole("button", { name: "Labour Day" }).closest(".hd-cal-it")).not.toHaveAttribute("data-sel");
    expect(talkRow()).not.toHaveAttribute("data-sel");
  });

  /* "Today a holiday's date row picks the holiday — now it picks the day,
     and the day lists the holiday." */
  it("picks a day by its date row in Month, a holiday's listing the holiday, and the school holidays by their bar", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(viewBtn("Month"));
    await user.click(screen.getByRole("button", { name: "School holidays, Mon 28 Sept – Fri 9 Oct" }));
    expect(heading()).toHaveTextContent("School holidays");
    await user.click(screen.getByRole("button", { name: "Later" }));
    const labour = screen.getByRole("button", { name: "Mon 5 Oct: Labour Day" });
    await user.click(labour);
    expect(heading()).toHaveTextContent("Monday 5 October");
    expect(labour).toHaveAttribute("aria-pressed", "true");
    expect(labour.closest(".hd-cal-mc")).toHaveAttribute("data-picked");
    expect(within(panel()).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Labour Day",
      "School holidays",
    ]);
    // the holiday, picked from the day, is still the day's date row's
    await user.click(within(panel()).getByRole("button", { name: "Labour Day" }));
    expect(heading()).toHaveTextContent("Labour Day");
    expect(panel()).toHaveTextContent("Public holiday in NSW.");
    expect(labour).toHaveAttribute("aria-pressed", "true");
    // and the same row, pressed, picks the day again
    await user.click(labour);
    expect(heading()).toHaveTextContent("Monday 5 October");
  });

  it("offers its action in the panel: the business's cover opens where it is renewed", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(viewBtn("Month"));
    await user.click(screen.getByRole("button", { name: "Later" }));
    await user.click(screen.getByRole("button", { name: "Later" }));
    await user.click(screen.getByRole("button", { name: /^Tue 10 Nov: Public liability/ }));
    expect(within(panel()).getByRole("link", { name: "Renew" })).toHaveAttribute(
      "href",
      "/dashboard/admin/organization?sec=credentials",
    );
  });
});

/* "If you go into the month view, you can't click on the day for it to
   show up on the right" (Isaac, 2026-09-26). A day is picked from anywhere
   in it, and the panel shows the day in full and everything on it. */
describe("a day, picked", () => {
  const month = async (user: ReturnType<typeof userEvent.setup>, steps = 0) => {
    await user.click(viewBtn("Month"));
    for (let i = 0; i < steps; i++) await user.click(screen.getByRole("button", { name: "Later" }));
  };
  /** Month's cell for a day, found by its date row. */
  const cell = (name: string) => screen.getByRole("button", { name }).closest<HTMLElement>(".hd-cal-mc")!;
  const listed = () => within(panel()).queryAllByRole("button").map((b) => b.getAttribute("aria-label"));

  it("shows in Month's panel, from a press anywhere in its cell, with everything on it", async () => {
    const user = userEvent.setup();
    draw();
    await month(user, 1);
    await user.click(cell("Thu 1 Oct"));
    expect(heading()).toHaveTextContent("Thursday 1 October");
    expect(listed()).toEqual(["School holidays", "Toolbox talk, 6:45 am"]);
    expect(screen.getByRole("button", { name: "Thu 1 Oct" })).toHaveAttribute("aria-pressed", "true");
    expect(cell("Thu 1 Oct")).toHaveAttribute("data-picked");
    expect(field()).toHaveAccessibleName("Add to Thu 1 Oct…");
  });

  it('says "Nothing on." for a day with nothing on it', async () => {
    const user = userEvent.setup();
    draw();
    await month(user, 1);
    await user.click(cell("Wed 14 Oct"));
    expect(heading()).toHaveTextContent("Wednesday 14 October");
    expect(within(panel()).getByText("Nothing on.")).toBeInTheDocument();
    expect(listed()).toEqual([]);
  });

  it("leaves a thing in the cell to pick itself, and picks the thing from the day's list", async () => {
    const user = userEvent.setup();
    draw();
    await month(user, 1);
    await user.click(screen.getByRole("button", { name: /^Thu 1 Oct: Toolbox talk/ }));
    expect(heading()).toHaveTextContent("Toolbox talk");
    expect(screen.getByRole("button", { name: "Thu 1 Oct" })).toHaveAttribute("aria-pressed", "false");
    await user.click(cell("Thu 1 Oct"));
    expect(heading()).toHaveTextContent("Thursday 1 October");
    // from the list: the panel shows the thing as it always has, and keeps the focus
    await user.click(within(panel()).getByRole("button", { name: "Toolbox talk, 6:45 am" }));
    expect(heading()).toHaveTextContent("Toolbox talk");
    expect(panel()).toHaveTextContent("Thu 1 Oct, 6:45 – 7:15 am");
    expect(within(panel()).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(panel()).toHaveFocus();
    expect(screen.getByRole("button", { name: /^Thu 1 Oct: Toolbox talk/ })).toHaveAttribute("aria-pressed", "true");
  });

  /* A quick add: the caret goes where the words will be typed — for a
     pointer. A key leaves focus on the day it pressed (law 8's spirit:
     nothing moves for the keyboard). */
  it("puts the caret in the box for a pointer, and leaves focus on the day for a key", async () => {
    const user = userEvent.setup();
    draw();
    await month(user, 1);
    await user.click(cell("Wed 14 Oct"));
    expect(field()).toHaveFocus();
    const day = screen.getByRole("button", { name: "Thu 15 Oct" });
    day.focus();
    await user.keyboard("{Enter}");
    expect(heading()).toHaveTextContent("Thursday 15 October");
    expect(day).toHaveFocus();
    expect(field()).toHaveAccessibleName("Add to Thu 15 Oct…");
  });

  it("offers no day outside the twelve months, where Month's whole weeks reach past them", async () => {
    const user = userEvent.setup();
    draw();
    await month(user);
    // September's first week begins on Mon 31 Aug, before the calendar does
    const aug31 = document.querySelector<HTMLElement>(".hd-cal-mc[data-out]")!;
    expect(aug31).toHaveTextContent("31");
    expect(aug31).not.toHaveAttribute("data-pick");
    expect(within(aug31).queryByRole("button")).toBeNull();
    await user.click(aug31);
    expect(heading()).toHaveTextContent("School holidays");
    expect(field()).toHaveAccessibleName("Add to today…");
    // and the days in view of another month that are on it are the calendar's
    expect(screen.getByRole("button", { name: "Thu 1 Oct" })).toBeInTheDocument();
  });

  it("is every day of Year, empty or not, each a button that picks the day", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(viewBtn("Year"));
    const empty = screen.getByRole("button", { name: "Wed 14 Oct" });
    expect(empty).toHaveAttribute("aria-pressed", "false");
    await user.click(empty);
    expect(empty).toHaveAttribute("aria-pressed", "true");
    expect(heading()).toHaveTextContent("Wednesday 14 October");
    expect(within(panel()).getByText("Nothing on.")).toBeInTheDocument();
    expect(field()).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Mon 5 Oct: Labour Day, School holidays" }));
    expect(heading()).toHaveTextContent("Monday 5 October");
    expect(listed()).toEqual(["Labour Day", "School holidays"]);
    expect(empty).toHaveAttribute("aria-pressed", "false");
    // today is marked as today, whatever is picked
    expect(screen.getByRole("button", { name: "Thu 24 Sept" })).toHaveAttribute("aria-current", "date");
  });

  it("stays picked whatever the filters hide, its list showing what is left", async () => {
    const user = userEvent.setup();
    draw();
    await month(user, 1);
    await user.click(cell("Thu 1 Oct"));
    await user.click(filter(/^Events/));
    expect(heading()).toHaveTextContent("Thursday 1 October");
    expect(listed()).toEqual(["School holidays"]);
    await user.click(filter(/^School holidays/));
    expect(within(panel()).getByText("Nothing on.")).toBeInTheDocument();
    await user.click(filter(/^Events/));
    expect(listed()).toEqual(["Toolbox talk, 6:45 am"]);
    expect(field()).toHaveAccessibleName("Add to Thu 1 Oct…");
  });

  it("is one choice across the views: a day picked in Month is 4 weeks' and Year's", async () => {
    const user = userEvent.setup();
    draw();
    await month(user, 1);
    await user.click(cell("Thu 1 Oct"));
    await user.click(viewBtn("4 weeks"));
    expect(within(agenda()).getByRole("button", { name: "Thu 1 Oct" })).toHaveAttribute("aria-pressed", "true");
    expect(within(agenda()).getByRole("button", { name: "Toolbox talk" })).toHaveAttribute("aria-pressed", "false");
    await user.click(viewBtn("Year"));
    expect(screen.getByRole("button", { name: "Thu 1 Oct: School holidays, Toolbox talk" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(heading()).toHaveTextContent("Thursday 1 October");
  });
});

describe("the filters", () => {
  it("count what is in view, and a filter turned off hides its things everywhere without changing a count", async () => {
    const user = userEvent.setup();
    draw();
    expect(within(screen.getByRole("group", { name: "Show on the calendar" })).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Public holidays1",
      "Events1",
      "Admin1",
      "School holidays",
    ]);
    await user.click(filter(/^Public holidays/));
    expect(filter(/^Public holidays/)).toHaveAttribute("aria-pressed", "false");
    expect(filter(/^Public holidays/)).toHaveTextContent("Public holidays1");
    expect(within(agenda()).queryByRole("button", { name: "Labour Day" })).toBeNull();
    expect(within(rail()).queryByRole("button", { name: "Labour Day" })).toBeNull();
    // and stays off in the next view
    await user.click(viewBtn("Month"));
    await user.click(screen.getByRole("button", { name: "Later" }));
    expect(filter(/^Public holidays/)).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "Mon 5 Oct: Labour Day" })).toBeNull();
  });

  it("moves the choice to the first thing still shown when a filter hides it", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(within(agenda()).getByRole("button", { name: "Toolbox talk" }));
    await user.click(filter(/^Events/));
    await user.click(filter(/^Events/));
    await user.click(viewBtn("Month"));
    // the choice moved when the talk was hidden, and did not come back with it
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("School holidays");
  });

  it("leaves out Admin for a viewer with no admin dates, and School holidays where the state has none", () => {
    draw(calendar({ vehicles: [], credentials: [], school: [] }, { hasSchool: false }));
    expect(within(screen.getByRole("group", { name: "Show on the calendar" })).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Public holidays1",
      "Events1",
    ]);
  });
});

describe("Save", () => {
  it("puts the words on today as typed while nothing is picked, and chooses, lights and shows what landed", async () => {
    const user = userEvent.setup();
    const { rerender } = draw();
    await user.click(filter(/^Events/));
    mockAdd.mockResolvedValueOnce({ ok: true, id: "e9", day: TODAY });
    let said: unknown;
    await act(async () => {
      said = await box!.save("Team barbecue");
    });
    expect(mockAdd).toHaveBeenCalledWith("Team barbecue", TODAY);
    expect(said).toEqual({ ok: true });
    // its filter is back on
    expect(filter(/^Events/)).toHaveAttribute("aria-pressed", "true");
    // the page comes back with it, as the action's revalidation brings it
    const landed = {
      id: "e9",
      kind: "event" as const,
      title: "Team barbecue",
      startsOn: TODAY,
      endsOn: TODAY,
      startsAt: null,
      endsAt: null,
      location: null,
      audience: null,
      note: null,
      seriesId: null,
      repeat: null,
      createdBy: null,
      createdAt: null,
    };
    rerender(<HomeCalendarPage cal={calendar({ events: [...ROWS.events, landed] })} />);
    const row = within(agenda()).getByRole("button", { name: "Team barbecue" });
    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(row.closest(".hd-cal-it")).toHaveAttribute("data-fresh");
    expect(row.closest(".hd-cal-r")).toHaveAttribute("data-today");
    expect(within(agenda()).queryByText("Nothing on today.")).toBeNull();
  });

  /* "Click a day and add to that day" (2026-09-26): the day stays picked,
     with what went on it lit in its list, so the next thing typed goes on
     the same day. */
  it("puts the words on the day picked, and keeps the day picked with the new thing lit in its list", async () => {
    const user = userEvent.setup();
    const { rerender } = draw();
    await user.click(viewBtn("Month"));
    await user.click(screen.getByRole("button", { name: "Later" }));
    await user.click(screen.getByRole("button", { name: "Wed 14 Oct" }).closest(".hd-cal-mc")!);
    expect(box).toMatchObject({ placeholder: "Add to Wed 14 Oct…", day: "2026-10-14" });
    mockAdd.mockResolvedValueOnce({ ok: true, id: "e9", day: "2026-10-14" });
    await act(async () => {
      await box!.save("Team barbecue");
    });
    expect(mockAdd).toHaveBeenCalledWith("Team barbecue", "2026-10-14");
    const bbq = eventRow({ id: "e9", title: "Team barbecue", startsOn: "2026-10-14", endsOn: "2026-10-14", startsAt: null, endsAt: null });
    rerender(<HomeCalendarPage cal={calendar({ events: [...ROWS.events, bbq] })} />);
    expect(heading()).toHaveTextContent("Wednesday 14 October");
    const listed = within(panel()).getByRole("button", { name: "Team barbecue" });
    expect(listed).toHaveAttribute("data-fresh");
    expect(screen.getByRole("button", { name: "Wed 14 Oct: Team barbecue" })).toHaveAttribute("data-fresh");
    expect(screen.getByRole("button", { name: "Wed 14 Oct" })).toHaveAttribute("aria-pressed", "true");
    expect(box).toMatchObject({ placeholder: "Add to Wed 14 Oct…", day: "2026-10-14" });
    // and the next goes on the same day
    mockAdd.mockResolvedValueOnce({ ok: true, id: "e10", day: "2026-10-14" });
    await act(async () => {
      await box!.save("Van check");
    });
    expect(mockAdd).toHaveBeenLastCalledWith("Van check", "2026-10-14");
    expect(heading()).toHaveTextContent("Wednesday 14 October");
  });

  it("puts the words on the first day of the thing picked, and chooses what landed", async () => {
    const user = userEvent.setup();
    const { rerender } = draw();
    await user.click(within(agenda()).getByRole("button", { name: "Toolbox talk" }));
    mockAdd.mockResolvedValueOnce({ ok: true, id: "e9", day: "2026-10-01" });
    await act(async () => {
      await box!.save("Ladder check");
    });
    expect(mockAdd).toHaveBeenCalledWith("Ladder check", "2026-10-01");
    const check = eventRow({ id: "e9", title: "Ladder check", startsOn: "2026-10-01", endsOn: "2026-10-01", startsAt: null, endsAt: null });
    rerender(<HomeCalendarPage cal={calendar({ events: [...ROWS.events, check] })} />);
    expect(within(agenda()).getByRole("button", { name: "Ladder check" })).toHaveAttribute("aria-pressed", "true");
    expect(within(agenda()).getByRole("button", { name: "Toolbox talk" })).toHaveAttribute("aria-pressed", "false");
    expect(field()).toHaveAccessibleName("Add to Thu 1 Oct…");
  });

  /* His calLand: what landed is brought into sight, once, as soon as the
     action's revalidation has put it on the page. */
  it("brings what landed into its view's sight once it is on the page, and only once", async () => {
    const spy = layout([
      [".hd-cal-ag", () => at(100, 240)],
      // today's row, above the scroller: the agenda was scrolled down to next week
      [".hd-cal-it[data-fresh]", () => at(-300, 40)],
    ]);
    try {
      const { rerender } = draw();
      agenda().scrollTop = 600;
      mockAdd.mockResolvedValueOnce({ ok: true, id: "e9", day: TODAY });
      await act(async () => {
        await box!.save("Team barbecue");
      });
      // not on the page yet: nothing to bring
      expect(agenda().scrollTop).toBe(600);
      const landed = { ...ROWS.events[0]!, id: "e9", title: "Team barbecue", startsOn: TODAY, endsOn: TODAY, startsAt: null, endsAt: null };
      rerender(<HomeCalendarPage cal={calendar({ events: [...ROWS.events, landed] })} />);
      expect(agenda().scrollTop).toBe(600 + (-300 - 100 - 96));
      // the reader scrolls on while it is still lit; the page comes back again, and leaves the view to them
      agenda().scrollTop = 600;
      rerender(<HomeCalendarPage cal={calendar({ events: [...ROWS.events, landed] })} />);
      expect(agenda().scrollTop).toBe(600);
    } finally {
      spy.mockRestore();
    }
  });

  it("lights what landed for his 2.4 s (calFresh), then leaves it chosen", async () => {
    jest.useFakeTimers();
    try {
      const { rerender } = draw();
      mockAdd.mockResolvedValueOnce({ ok: true, id: "e9", day: TODAY });
      await act(async () => {
        await box!.save("Team barbecue");
      });
      rerender(
        <HomeCalendarPage
          cal={calendar({
            events: [
              {
                ...ROWS.events[0]!,
                id: "e9",
                title: "Team barbecue",
                startsOn: TODAY,
                endsOn: TODAY,
                startsAt: null,
                endsAt: null,
              },
            ],
          })}
        />,
      );
      const it = () => screen.getByRole("button", { name: "Team barbecue" }).closest(".hd-cal-it");
      expect(it()).toHaveAttribute("data-fresh");
      act(() => {
        jest.advanceTimersByTime(2399);
      });
      expect(it()).toHaveAttribute("data-fresh");
      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(it()).not.toHaveAttribute("data-fresh");
      expect(screen.getByRole("button", { name: "Team barbecue" })).toHaveAttribute("aria-pressed", "true");
    } finally {
      jest.useRealTimers();
    }
  });

  it("hands a refusal back to the box as it came, and changes nothing", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(filter(/^Events/));
    mockAdd.mockResolvedValueOnce({ ok: false, error: "You can't add to the calendar." });
    let said: unknown;
    await act(async () => {
      said = await box!.save("Team barbecue");
    });
    expect(said).toEqual({ ok: false, error: "You can't add to the calendar." });
    expect(filter(/^Events/)).toHaveAttribute("aria-pressed", "false");
  });

  it("brings the day it landed on into view, when the view is elsewhere", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(viewBtn("Month"));
    await user.click(screen.getByRole("button", { name: "Later" }));
    expect(rangeTitle()).toHaveTextContent("October 2026");
    mockAdd.mockResolvedValueOnce({ ok: true, id: "e9", day: TODAY });
    await act(async () => {
      await box!.save("Team barbecue");
    });
    expect(rangeTitle()).toHaveTextContent("September 2026");
  });
});

/* ── H22: Edit, series delete, and what Tiff put on ── */

const eventRow = (over: Partial<CompanyRows["events"][number]>) => ({ ...ROWS.events[0]!, ...over });
/** His toolbox talk as Tiff files it: three first Thursdays under one series. */
const SERIES = ["2026-10-01", "2026-11-05", "2026-12-03"].map((d, i) =>
  eventRow({
    id: `s${i + 1}`,
    startsOn: d,
    endsOn: d,
    seriesId: "ser",
    repeat: { every: "month", day: "thu", nth: 1 },
    note: null,
  }),
);

/** Month's panel, on the thing picked in 4 weeks. */
async function inPanel(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(within(agenda()).getByRole("button", { name }));
  await user.click(viewBtn("Month"));
  return panel();
}

describe("Edit", () => {
  it("opens the form in the panel with what the event holds, and Save changes sends it and closes it", async () => {
    const user = userEvent.setup();
    draw();
    const p = await inPanel(user, "Toolbox talk");
    await user.click(within(p).getByRole("button", { name: "Edit" }));
    const form = within(p).getByRole("form", { name: "Edit Toolbox talk" });
    const name = within(form).getByRole("textbox", { name: "Name" });
    expect(name).toHaveValue("Toolbox talk");
    expect(name).toHaveFocus();
    expect(within(form).getByLabelText("From")).toHaveValue("06:45");
    expect(within(form).getByLabelText("To")).toHaveValue("07:15");
    expect(within(form).getByRole("textbox", { name: "Where" })).toHaveValue("The yard");
    expect(within(form).getByRole("textbox", { name: "Who" })).toHaveValue("Everyone");
    expect(within(form).getByRole("textbox", { name: "Note" })).toHaveValue("");
    // one event: one save, and no "all"
    expect(within(form).queryByRole("button", { name: /^Save all/ })).toBeNull();

    await user.clear(name);
    await user.type(name, "Toolbox talk: ladders");
    await user.type(within(form).getByRole("textbox", { name: "Note" }), "Bring a harness");
    mockEdit.mockResolvedValueOnce({ ok: true });
    await user.click(within(form).getByRole("button", { name: "Save changes" }));
    expect(mockEdit).toHaveBeenCalledWith(
      "e1",
      {
        title: "Toolbox talk: ladders",
        startsOn: "2026-10-01",
        endsOn: "2026-10-01",
        startsAt: "06:45",
        endsAt: "07:15",
        location: "The yard",
        audience: "Everyone",
        note: "Bring a harness",
      },
      "one",
    );
    expect(within(panel()).queryByRole("form")).toBeNull();
    expect(within(panel()).getByRole("button", { name: "Edit" })).toHaveFocus();
  });

  it("keeps the form, and says why, when a change is refused", async () => {
    const user = userEvent.setup();
    draw();
    const p = await inPanel(user, "Toolbox talk");
    await user.click(within(p).getByRole("button", { name: "Edit" }));
    mockEdit.mockResolvedValueOnce({ ok: false, error: "It has to finish after it starts." });
    await user.click(within(p).getByRole("button", { name: "Save changes" }));
    expect(within(p).getByRole("alert")).toHaveTextContent("It has to finish after it starts.");
    expect(within(p).getByRole("form")).toBeInTheDocument();
  });

  it("can't be saved without a name", async () => {
    const user = userEvent.setup();
    draw();
    const p = await inPanel(user, "Toolbox talk");
    await user.click(within(p).getByRole("button", { name: "Edit" }));
    await user.clear(within(p).getByRole("textbox", { name: "Name" }));
    expect(within(p).getByRole("button", { name: "Save changes" })).toBeDisabled();
    await user.keyboard("{Enter}");
    expect(mockEdit).not.toHaveBeenCalled();
  });

  it("closes on Cancel, and on choosing something else", async () => {
    const user = userEvent.setup();
    draw();
    const p = await inPanel(user, "Toolbox talk");
    await user.click(within(p).getByRole("button", { name: "Edit" }));
    await user.click(within(p).getByRole("button", { name: "Cancel" }));
    expect(within(panel()).queryByRole("form")).toBeNull();
    expect(within(panel()).getByRole("button", { name: "Edit" })).toHaveFocus();
    await user.click(within(panel()).getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "School holidays, Mon 28 Sept – Fri 9 Oct" }));
    expect(within(panel()).queryByRole("form")).toBeNull();
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("School holidays");
  });

  it("closes when another event is chosen, and never holds one event's words over another", async () => {
    const user = userEvent.setup();
    const meeting = eventRow({ id: "e5", title: "Team meeting", startsOn: "2026-10-02", endsOn: "2026-10-02", location: null });
    draw(calendar({ events: [...ROWS.events, meeting] }));
    const p = await inPanel(user, "Toolbox talk");
    await user.click(within(p).getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: /: Team meeting/ }));
    expect(within(panel()).queryByRole("form")).toBeNull();
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("Team meeting");
    await user.click(within(panel()).getByRole("button", { name: "Edit" }));
    expect(within(panel()).getByRole("textbox", { name: "Name" })).toHaveValue("Team meeting");
  });

  /* Choosing something else lets the form go: choosing the event again shows
     the event, not the form it had, whose opening would pull focus off the
     day just pressed and into its Name. */
  it("shows an event chosen again as itself, not the form it had, and leaves focus on the day pressed", async () => {
    const user = userEvent.setup();
    const meeting = eventRow({ id: "e5", title: "Team meeting", startsOn: "2026-10-02", endsOn: "2026-10-02", location: null });
    draw(calendar({ events: [...ROWS.events, meeting] }));
    const p = await inPanel(user, "Toolbox talk");
    await user.click(within(p).getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: /: Team meeting/ }));
    const talk = screen.getByRole("button", { name: /: Toolbox talk/ });
    talk.focus();
    await user.keyboard("{Enter}");
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("Toolbox talk");
    expect(within(panel()).queryByRole("form")).toBeNull();
    expect(talk).toHaveFocus();
  });

  /* The form and the Edit that opened it are gone after a delete: focus goes
     to the panel's own column, never to nowhere. */
  it("puts focus in the panel's column after a delete from the keyboard", async () => {
    const user = userEvent.setup();
    draw();
    const p = await inPanel(user, "Toolbox talk");
    await user.click(within(p).getByRole("button", { name: "Edit" }));
    await user.click(within(p).getByRole("button", { name: "Delete event" }));
    mockDelete.mockResolvedValueOnce({ ok: true, count: 1 });
    const ask = within(p).getByRole("group", { name: "Delete for good?" });
    within(ask).getByRole("button", { name: "Delete event" }).focus();
    await user.keyboard("{Enter}");
    expect(mockDelete).toHaveBeenCalledWith("e1", "one");
    expect(within(panel()).queryByRole("form")).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(panel()).toHaveFocus();
  });

  /* A one-day event moved to another day stays one day: its last day is
     the day it is now on, never the day it was on. */
  it("moves a one-day event whole: its last day is its new day", async () => {
    const user = userEvent.setup();
    draw();
    const p = await inPanel(user, "Toolbox talk");
    await user.click(within(p).getByRole("button", { name: "Edit" }));
    const form = within(panel()).getByRole("form");
    await pickDate("Day", "2026-09-28", within(form));
    mockEdit.mockResolvedValueOnce({ ok: true });
    await user.click(within(form).getByRole("button", { name: "Save changes" }));
    expect(mockEdit).toHaveBeenCalledWith(
      "e1",
      expect.objectContaining({ startsOn: "2026-09-28", endsOn: "2026-09-28" }),
      "one",
    );
  });

  it("carries a range's last day along when its first day moves past it", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(viewBtn("Month"));
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole("button", { name: "Later" }));
    await user.click(screen.getAllByRole("button", { name: /^Christmas shutdown/ })[0]!);
    await user.click(within(panel()).getByRole("button", { name: "Edit" }));
    const form = within(panel()).getByRole("form");
    await pickDate("First day", "2027-01-12", within(form));
    expect(within(form).getByLabelText("Last day")).toHaveTextContent("12/01/2027");
    mockEdit.mockResolvedValueOnce({ ok: true });
    await user.click(within(form).getByRole("button", { name: "Save changes" }));
    expect(mockEdit).toHaveBeenCalledWith(
      "e2",
      expect.objectContaining({ startsOn: "2027-01-12", endsOn: "2027-01-12" }),
      "one",
    );
  });

  /* Enter pressed twice before the form has drawn its first press. */
  it("sends one change for two presses that land before the form redraws", async () => {
    const user = userEvent.setup();
    draw();
    const p = await inPanel(user, "Toolbox talk");
    await user.click(within(p).getByRole("button", { name: "Edit" }));
    mockEdit.mockReturnValue(new Promise(() => {}));
    const form = within(panel()).getByRole("form");
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(mockEdit).toHaveBeenCalledTimes(1);
  });

  it("gives a one-day shutdown a first and last day too, and a lone date of a series no choice of all", async () => {
    const user = userEvent.setup();
    const oneDay = eventRow({
      id: "e6",
      kind: "shutdown",
      title: "Stocktake",
      startsOn: "2026-09-30",
      endsOn: "2026-09-30",
      startsAt: null,
      endsAt: null,
    });
    draw(calendar({ events: [ROWS.events[1]!, oneDay, SERIES[0]!] }));
    await user.click(viewBtn("Month"));
    await user.click(screen.getByRole("button", { name: /: Stocktake/ }));
    await user.click(within(panel()).getByRole("button", { name: "Edit" }));
    expect(within(panel()).getByText("First day")).toBeInTheDocument();
    expect(within(panel()).getByText("Last day")).toBeInTheDocument();
    await user.click(within(panel()).getByRole("button", { name: "Cancel" }));

    // a series with one date on the calendar is one event to the form
    await user.click(screen.getByRole("button", { name: /: Toolbox talk/ }));
    await user.click(within(panel()).getByRole("button", { name: "Edit" }));
    const form = within(panel()).getByRole("form");
    expect(within(form).getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(within(form).queryByRole("button", { name: /^Save all/ })).toBeNull();
    await user.click(within(form).getByRole("button", { name: "Delete event" }));
    const ask = within(form).getByRole("group", { name: "Delete for good?" });
    expect(within(ask).getAllByRole("button").map((b) => b.textContent)).toEqual(["Delete event", "Keep"]);
  });

  /* Month's day cell has an inner box, `.hd-cal-in`; the form once named its
     fields the same, and the form's rule, later in the sheet, dressed every
     day cell in Month as a field. jsdom lays nothing out, so nothing else
     could see it: the classes the form's own block of the sheet declares
     are the form's alone, worn by nothing outside it in any view. */
  it("wears classes of its own, which nothing outside it wears in any view", async () => {
    const user = userEvent.setup();
    const sheet = readFileSync(join(process.cwd(), "src/app/dashboard/shell.css"), "utf8");
    const from = sheet.indexOf("/* THE EDIT FORM");
    const block = sheet.slice(from, sheet.indexOf("/* THE KEY", from)).replace(/\/\*[\s\S]*?\*\//g, "");
    const own = new Set(
      [...block.matchAll(/([^{}]+)\{[^{}]*\}/g)]
        .flatMap((m) => m[1]!.split(","))
        .map((s) => /^\.fg (?:[a-z]+)?\.([\w-]+)$/.exec(s.trim())?.[1])
        .filter((c): c is string => !!c),
    );
    expect(own.size).toBeGreaterThan(4);
    const strays = () =>
      [...own].flatMap((c) =>
        [...document.getElementsByClassName(c)].filter((el) => !el.closest(".hd-cal-ed")).map(() => c),
      );

    draw();
    const p = await inPanel(user, "Toolbox talk");
    await user.click(within(p).getByRole("button", { name: "Edit" }));
    const name = within(panel()).getByRole("textbox", { name: "Name" });
    expect([...name.classList].some((c) => own.has(c))).toBe(true);
    expect(strays()).toEqual([]);
    await user.click(viewBtn("Year"));
    expect(strays()).toEqual([]);
    await user.click(viewBtn("4 weeks"));
    expect(strays()).toEqual([]);
  });

  it("asks twice before a delete, with Keep taking focus and backing out", async () => {
    const user = userEvent.setup();
    draw();
    const p = await inPanel(user, "Toolbox talk");
    await user.click(within(p).getByRole("button", { name: "Edit" }));
    await user.click(within(p).getByRole("button", { name: "Delete event" }));
    expect(mockDelete).not.toHaveBeenCalled();
    const ask = within(p).getByRole("group", { name: "Delete for good?" });
    expect(within(ask).getByRole("button", { name: "Keep" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(mockDelete).not.toHaveBeenCalled();
    expect(within(p).queryByRole("group", { name: "Delete for good?" })).toBeNull();
    // backed out of, the question gives focus back to where it was
    expect(within(p).getByRole("button", { name: "Delete event" })).toHaveFocus();

    await user.click(within(p).getByRole("button", { name: "Delete event" }));
    mockDelete.mockResolvedValueOnce({ ok: true, count: 1 });
    await user.click(within(within(p).getByRole("group", { name: "Delete for good?" })).getByRole("button", { name: "Delete event" }));
    expect(mockDelete).toHaveBeenCalledWith("e1", "one");
  });

  it("gives a series its choices: Save this one or all, Delete this one or all", async () => {
    const user = userEvent.setup();
    draw(calendar({ events: [...SERIES, ROWS.events[1]!] }));
    const p = await inPanel(user, "Toolbox talk");
    expect(within(p).getByText("Repeats").nextSibling).toHaveTextContent("Monthly, until Dec 2026");
    await user.click(within(p).getByRole("button", { name: "Edit" }));
    expect(within(p).queryByRole("button", { name: "Save changes" })).toBeNull();
    mockEdit.mockResolvedValueOnce({ ok: true });
    await user.click(within(p).getByRole("button", { name: "Save all 3" }));
    expect(mockEdit).toHaveBeenCalledWith("s1", expect.objectContaining({ title: "Toolbox talk" }), "series");

    await user.click(within(panel()).getByRole("button", { name: "Edit" }));
    mockEdit.mockResolvedValueOnce({ ok: true });
    await user.click(within(panel()).getByRole("button", { name: "Save this one" }));
    expect(mockEdit).toHaveBeenLastCalledWith("s1", expect.anything(), "one");

    // Enter in the form saves this one, never all of them
    await user.click(within(panel()).getByRole("button", { name: "Edit" }));
    mockEdit.mockResolvedValueOnce({ ok: true });
    await user.type(within(panel()).getByRole("textbox", { name: "Name" }), "{Enter}");
    expect(mockEdit).toHaveBeenCalledTimes(3);
    expect(mockEdit).toHaveBeenLastCalledWith("s1", expect.anything(), "one");

    await user.click(within(panel()).getByRole("button", { name: "Edit" }));
    await user.click(within(panel()).getByRole("button", { name: "Delete event" }));
    const ask = within(panel()).getByRole("group", { name: "Delete for good?" });
    expect(within(ask).getAllByRole("button").map((b) => b.textContent)).toEqual(["Delete this one", "Delete all 3", "Keep"]);
    mockDelete.mockResolvedValueOnce({ ok: true, count: 3 });
    await user.click(within(ask).getByRole("button", { name: "Delete all 3" }));
    expect(mockDelete).toHaveBeenCalledWith("s1", "series");
  });

  it("gives a shutdown its first and last day and no hours", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(viewBtn("Month"));
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole("button", { name: "Later" }));
    await user.click(screen.getAllByRole("button", { name: /^Christmas shutdown/ })[0]!);
    await user.click(within(panel()).getByRole("button", { name: "Edit" }));
    const form = within(panel()).getByRole("form");
    expect(within(form).getByText("First day")).toBeInTheDocument();
    expect(within(form).getByText("Last day")).toBeInTheDocument();
    expect(within(form).queryByLabelText("From")).toBeNull();
    mockEdit.mockResolvedValueOnce({ ok: true });
    await user.click(within(form).getByRole("button", { name: "Save changes" }));
    expect(mockEdit).toHaveBeenCalledWith(
      "e2",
      expect.objectContaining({ startsOn: "2026-12-23", endsOn: "2027-01-08", startsAt: null, endsAt: null }),
      "one",
    );
  });

  it("is not there for someone who can't add to the calendar, nor for what lives elsewhere", async () => {
    const user = userEvent.setup();
    draw(calendar({}, { canAdd: false }));
    const p = await inPanel(user, "Toolbox talk");
    expect(within(p).queryByRole("button", { name: "Edit" })).toBeNull();
    cleanup();
    draw();
    await user.click(viewBtn("Month"));
    await user.click(screen.getByRole("button", { name: "School holidays, Mon 28 Sept – Fri 9 Oct" }));
    expect(within(panel()).queryByRole("button", { name: "Edit" })).toBeNull();
  });
});

describe("what Tiff put on", () => {
  const api = (landed: TiffLanded | null): TiffApi => ({
    open: () => false,
    openedBy: null,
    isOpen: false,
    landed,
  });
  const withTiff = (landed: TiffLanded | null, cal = calendar()) => (
    <TiffContext.Provider value={api(landed)}>
      <HomeCalendarPage cal={cal} />
    </TiffContext.Provider>
  );

  it("is chosen, brought into view and lit once the calendar has it, even after the modal's word has gone", () => {
    const { rerender } = render(withTiff(null));
    // the modal closes and says what it filed, before the refresh has brought it
    rerender(withTiff({ noteIds: [], ids: ["s2", "s3"] }));
    expect(within(agenda()).queryByRole("button", { name: "Toolbox talk", pressed: true })).toBeNull();
    // its word goes after two seconds; the refresh is slower still
    rerender(withTiff(null));
    rerender(withTiff(null, calendar({ events: [...ROWS.events, SERIES[1]!, SERIES[2]!] })));
    // the first of it, 5 Nov, is out of the four weeks: they move to show it
    expect(rangeTitle()).toHaveTextContent("5 Nov");
    const row = within(agenda()).getByRole("button", { name: "Toolbox talk", pressed: true });
    expect(row.closest(".hd-cal-it")).toHaveAttribute("data-fresh");
  });

  /* His calLand lights every date of it in view (`items.slice(1)…fresh`),
     and chooses the first: a weekly line shows its weeks lit, and says in
     4 weeks, which has no panel, that it repeats. */
  it("lights every date of a repeat it put on, and chooses only the first", async () => {
    const user = userEvent.setup();
    const weekly = ["2026-10-06", "2026-10-13", "2026-10-20"].map((d, i) =>
      eventRow({
        id: `w${i + 1}`,
        title: "Van check",
        startsOn: d,
        endsOn: d,
        startsAt: null,
        endsAt: null,
        location: null,
        seriesId: "wk",
        repeat: { every: "week", day: "tue" },
      }),
    );
    const cal = calendar({ events: [...ROWS.events, ...weekly] });
    const { rerender } = render(withTiff(null, cal));
    rerender(withTiff({ noteIds: [], ids: ["w1", "w2", "w3"] }, cal));
    const rows = within(agenda()).getAllByRole("button", { name: "Van check" });
    expect(rows).toHaveLength(3);
    expect(rows.map((b) => b.closest(".hd-cal-it")!.hasAttribute("data-fresh"))).toEqual([true, true, true]);
    expect(rows.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
    expect(rows[0]!.closest(".hd-cal-it")).toHaveTextContent("Every Tuesday.");
    // and in October's Month, while they are still lit
    await user.click(viewBtn("Month"));
    await user.click(screen.getByRole("button", { name: "Later" }));
    expect(rangeTitle()).toHaveTextContent("October");
    const cells = screen.getAllByRole("button", { name: /: Van check/ });
    expect(cells.filter((b) => b.hasAttribute("data-fresh"))).toHaveLength(3);
  });

  it("lets go of what never reaches the calendar, and lands the next thing that does", () => {
    const { rerender } = render(withTiff(null));
    // a task filed from the top bar never comes
    rerender(withTiff({ noteIds: ["n1"], ids: ["t1"] }));
    rerender(withTiff({ noteIds: [], ids: ["s2"] }));
    rerender(withTiff({ noteIds: [], ids: ["s2"] }, calendar({ events: [...ROWS.events, SERIES[1]!] })));
    expect(within(agenda()).getByRole("button", { name: "Toolbox talk", pressed: true }).closest(".hd-cal-it")).toHaveAttribute(
      "data-fresh",
    );
  });

  it("lands once: a pick after it is the reader's", async () => {
    const user = userEvent.setup();
    const cal = calendar({ events: [...ROWS.events, SERIES[1]!] });
    const landed = { noteIds: [], ids: ["s2"] };
    const { rerender } = render(withTiff(null, cal));
    rerender(withTiff(landed, cal));
    expect(within(agenda()).getByRole("button", { name: "Toolbox talk", pressed: true })).toBeInTheDocument();
    await user.click(within(agenda()).getByRole("button", { name: "Public liability insurance" }));
    // the page renders again while the modal's word is still up
    rerender(withTiff(landed, cal));
    expect(within(agenda()).getByRole("button", { name: "Public liability insurance" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

/* HIS MOTION (calSwap, calPick, calChip, calLand), laid out by hand: every
   animation the page starts is recorded with its keyframes and options,
   and while `gate` is set a fade out holds until the test opens it, so
   what the page draws in between can be seen. */
describe("motion", () => {
  const real = Element.prototype.animate;
  type Run = { el: Element; kf: Keyframe[]; opt: KeyframeAnimationOptions; cancelled: boolean };
  let runs: Run[] = [];
  let gate: { promise: Promise<void>; open: () => void } | null = null;
  const hold = () => {
    let open!: () => void;
    const promise = new Promise<void>((r) => {
      open = r;
    });
    gate = { promise, open };
  };
  const release = () =>
    act(async () => {
      gate?.open();
      gate = null;
    });
  /** Each run as `class:kind` — out, in (rising or not) or grow. */
  const said = () =>
    runs.map(({ el, kf }) => {
      const kind =
        kf[0]!.height !== undefined
          ? "grow"
          : kf[0]!.opacity === 1
            ? "out"
            : `in${kf[0]!.transform === "translateY(4px)" ? " rising" : ""}`;
      return `${el.classList[0]}:${kind}`;
    });
  beforeEach(() => {
    runs = [];
    gate = null;
    Element.prototype.animate = function (this: Element, kf: Keyframe[], opt: KeyframeAnimationOptions) {
      const r: Run = { el: this, kf, opt, cancelled: false };
      runs.push(r);
      const out = opt?.fill === "forwards";
      return {
        finished: out && gate ? gate.promise : Promise.resolve(),
        cancel: () => {
          r.cancelled = true;
        },
      } as unknown as Animation;
    } as typeof Element.prototype.animate;
    window.matchMedia = ((q: string) => ({ matches: false, media: q })) as typeof window.matchMedia;
  });
  afterEach(() => {
    Element.prototype.animate = real;
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it("swaps a view, a step and a pick for a pointer as he does: out on --t-fast, then in over 180 ms rising 4px; and not for a key", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(viewBtn("Month"));
    expect(said()).toEqual(["hd-cal-body:out", "hd-cal-body:in rising"]);
    const [out, fin] = runs;
    expect(out!.opt).toMatchObject({ duration: 120, easing: "ease-out", fill: "forwards" });
    expect(fin!.opt).toMatchObject({ duration: 180, easing: "ease-out", fill: "backwards" });
    expect(fin!.kf).toEqual([
      { opacity: 0, transform: "translateY(4px)" },
      { opacity: 1, transform: "none" },
    ]);
    // the fade out held the old view at nothing until the new one came in, and is taken off as it does
    expect(out!.cancelled).toBe(true);
    await user.click(screen.getByRole("button", { name: "School holidays, Mon 28 Sept – Fri 9 Oct" }));
    await user.click(screen.getByRole("button", { name: "Later" }));
    await user.click(screen.getByRole("button", { name: "Mon 5 Oct: Labour Day" }));
    expect(said()).toEqual([
      "hd-cal-body:out",
      "hd-cal-body:in rising",
      "hd-cal-body:out",
      "hd-cal-body:in rising",
      "hd-cal-dx:out",
      "hd-cal-dx:in rising",
    ]);
    expect(runs[4]!.cancelled).toBe(true);

    runs = [];
    viewBtn("Year").focus();
    await user.keyboard("{Enter}");
    screen.getByRole("button", { name: "Earlier" }).focus();
    await user.keyboard("{Enter}");
    screen.getByRole("button", { name: "Thu 1 Oct: School holidays, Toolbox talk" }).focus();
    await user.keyboard("{Enter}");
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("Thursday 1 October");
    expect(runs).toEqual([]);
  });

  /* A day is a pick like a thing (his calPick): a pointer's fades the panel
     over to it, a key's is simply there, and 4 weeks, which has no panel,
     fades nothing either way. */
  it("fades the panel over to a pointer's day, and to a key's not at all", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(within(agenda()).getByText("Nothing on today."));
    expect(runs).toEqual([]);
    await user.click(viewBtn("Month"));
    await user.click(screen.getByRole("button", { name: "Later" }));
    runs = [];
    hold();
    await user.click(screen.getByRole("button", { name: "Wed 14 Oct" }).closest(".hd-cal-mc")!);
    expect(screen.getByRole("button", { name: "Wed 14 Oct" })).toHaveAttribute("aria-pressed", "true");
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("Thursday 24 September");
    expect(said()).toEqual(["hd-cal-dx:out"]);
    await release();
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("Wednesday 14 October");
    expect(said()).toEqual(["hd-cal-dx:out", "hd-cal-dx:in rising"]);

    runs = [];
    screen.getByRole("button", { name: "Thu 15 Oct" }).focus();
    await user.keyboard("{Enter}");
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("Thursday 15 October");
    expect(runs).toEqual([]);
  });

  /* The panel coming up with Month is not a pick: what was picked with a
     pointer in 4 weeks, which has no panel, is what it starts from. */
  it("does not fade the panel in when a key brings it up, whatever a pointer picked before", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(within(agenda()).getByRole("button", { name: "Toolbox talk" }));
    runs = [];
    viewBtn("Month").focus();
    await user.keyboard("{Enter}");
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("Toolbox talk");
    expect(runs).toEqual([]);
  });

  it("swaps the view once when a pointer brings the panel up, not the panel over it", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(within(agenda()).getByRole("button", { name: "Toolbox talk" }));
    runs = [];
    await user.click(viewBtn("Month"));
    expect(said()).toEqual(["hd-cal-body:out", "hd-cal-body:in rising"]);
  });

  /* His calChrome: the toolbar says where you are going at once, and the
     body follows once it has faded out. */
  it("says where a pointer is going at once, and draws it once the view has faded out", async () => {
    const user = userEvent.setup();
    draw();
    hold();
    await user.click(viewBtn("Month"));
    expect(viewBtn("Month")).toHaveAttribute("aria-pressed", "true");
    expect(rangeTitle()).toHaveTextContent("September 2026");
    expect(agenda()).toBeInTheDocument();
    expect(said()).toEqual(["hd-cal-body:out"]);
    await release();
    expect(document.querySelector(".hd-cal-mg")).toBeInTheDocument();
    expect(document.querySelector(".hd-cal-ag")).toBeNull();
    expect(said()).toEqual(["hd-cal-body:out", "hd-cal-body:in rising"]);
  });

  /* His calPick: the views show the pick at once; the panel fades out what
     it showed, and then fades the pick in. */
  it("shows a pointer's pick in the view at once, and in the panel once the panel has faded out", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(viewBtn("Month"));
    await user.click(screen.getByRole("button", { name: "Later" }));
    runs = [];
    hold();
    const labour = screen.getByRole("button", { name: "Mon 5 Oct: Labour Day" });
    await user.click(labour);
    expect(labour).toHaveAttribute("aria-pressed", "true");
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("School holidays");
    expect(said()).toEqual(["hd-cal-dx:out"]);
    await release();
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("Monday 5 October");
    expect(said()).toEqual(["hd-cal-dx:out", "hd-cal-dx:in rising"]);
  });

  /* Anything pressed while a fade is on its way lands it first, so a key
     is never drawn from what was about to change, and nothing fades for it. */
  it("lands a pointer's swap at once when a key presses on, and fades nothing for the key", async () => {
    const user = userEvent.setup();
    draw();
    hold();
    await user.click(viewBtn("Month"));
    const out = runs[0]!;
    viewBtn("Year").focus();
    await user.keyboard("{Enter}");
    expect(out.cancelled).toBe(true);
    expect(rangeTitle()).toHaveTextContent("Sept 2026 – Aug 2027");
    expect(document.querySelector(".hd-cal-yg")).toBeInTheDocument();
    await release();
    expect(document.querySelector(".hd-cal-yg")).toBeInTheDocument();
    expect(said()).toEqual(["hd-cal-body:out"]);
  });

  /* His calChip: a filter turned off fades its things out, then the view
     closes up; turned back on, they are drawn and fade in where they stand. */
  it("fades a filter's things out before the view closes up, and back in where they stand, for a pointer", async () => {
    const user = userEvent.setup();
    draw();
    const talk = () => within(agenda()).queryByRole("button", { name: "Toolbox talk" });
    const row = talk()!.closest(".hd-cal-it")!;
    hold();
    await user.click(filter(/^Events/));
    expect(filter(/^Events/)).toHaveAttribute("aria-pressed", "false");
    // still drawn while it fades, and nothing else of another kind fades with it
    expect(talk()).toBeInTheDocument();
    expect(runs.map((r) => r.el)).toContain(row);
    for (const r of runs) {
      expect(r.kf[0]).toEqual({ opacity: 1 });
      expect(r.el.matches('[data-c="event"]') || r.el.querySelector('[data-c="event"]')).toBeTruthy();
      expect(r.el.closest(".hd-cal-det")).toBeNull();
    }
    const outs = [...runs];
    await release();
    expect(talk()).toBeNull();
    expect(outs.every((r) => r.cancelled)).toBe(true);

    runs = [];
    await user.click(filter(/^Events/));
    const back = talk()!.closest(".hd-cal-it")!;
    expect(runs.map((r) => r.el)).toContain(back);
    for (const r of runs) {
      expect(r.kf).toEqual([
        { opacity: 0, transform: "translateY(0px)" },
        { opacity: 1, transform: "none" },
      ]);
      expect(r.opt).toMatchObject({ duration: 180 });
    }

    runs = [];
    filter(/^Events/).focus();
    await user.keyboard("{Enter}");
    expect(talk()).toBeNull();
    filter(/^Events/).focus();
    await user.keyboard("{Enter}");
    expect(talk()).toBeInTheDocument();
    expect(runs).toEqual([]);
  });

  /* The choice a filter leaves is made once its things have gone: until
     then the panel shows what it showed. */
  it("moves the choice off what a filter hides only once its things have faded", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(viewBtn("Month"));
    await user.click(screen.getByRole("button", { name: "Later" }));
    await user.click(screen.getByRole("button", { name: /^Thu 1 Oct: Toolbox talk/ }));
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("Toolbox talk");
    hold();
    await user.click(filter(/^Events/));
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("Toolbox talk");
    await release();
    expect(within(panel()).getByRole("heading", { level: 3 })).not.toHaveTextContent("Toolbox talk");
    expect(screen.queryByRole("button", { name: /^Thu 1 Oct: Toolbox talk/ })).toBeNull();
  });

  /* His calLand: what Save lands grows in over 280 ms as it is lit — when
     Save was pressed with a pointer. From the keyboard it is lit, and
     still. */
  it("grows in what a pointer's Save landed, and not what a key's did", async () => {
    const landed = { ...ROWS.events[0]!, id: "e9", title: "Team barbecue", startsOn: TODAY, endsOn: TODAY, startsAt: null, endsAt: null };
    const saveBy = async (how: "pointer" | "key", id: string) => {
      const { rerender, unmount } = draw();
      const add = document.querySelector<HTMLElement>(".hd-cal-add")!;
      if (how === "pointer") add.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      else add.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      mockAdd.mockResolvedValueOnce({ ok: true, id, day: TODAY });
      await act(async () => {
        await box!.save("Team barbecue");
      });
      runs = [];
      rerender(<HomeCalendarPage cal={calendar({ events: [...ROWS.events, { ...landed, id }] })} />);
      const row = within(agenda()).getByRole("button", { name: "Team barbecue" }).closest(".hd-cal-it")!;
      expect(row).toHaveAttribute("data-fresh");
      const grew = runs.filter((r) => r.el === row);
      unmount();
      return grew;
    };
    const grew = await saveBy("pointer", "e9");
    expect(grew).toHaveLength(1);
    expect(grew[0]!.kf[0]).toEqual({ height: "0px", marginTop: "0px", paddingTop: "0px", paddingBottom: "0px", opacity: 0 });
    expect(grew[0]!.opt).toMatchObject({ duration: 280, easing: "ease-out" });
    expect(await saveBy("key", "e10")).toEqual([]);
  });

  it("fades nothing for a key, wherever the key is pressed", async () => {
    const user = userEvent.setup();
    draw();
    const press = async (el: HTMLElement) => {
      el.focus();
      await user.keyboard("{Enter}");
    };
    await press(within(agenda()).getByRole("button", { name: "Toolbox talk" }));
    await press(within(rail()).getByRole("button", { name: "Trailer, TC22BJ rego" }));
    await press(viewBtn("Month"));
    await press(screen.getByRole("button", { name: "School holidays, Mon 28 Sept – Fri 9 Oct" }));
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("School holidays");
    await press(screen.getByRole("button", { name: "Later" }));
    await press(screen.getByRole("button", { name: "Mon 5 Oct: Labour Day" }));
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("Monday 5 October");
    await press(within(panel()).getByRole("button", { name: "Labour Day" }));
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("Labour Day");
    await press(screen.getByRole("button", { name: /^Thu 1 Oct: Toolbox talk/ }));
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("Toolbox talk");
    await press(screen.getByRole("button", { name: "Today" }));
    expect(rangeTitle()).toHaveTextContent("September 2026");
    await press(viewBtn("Year"));
    await press(screen.getByRole("button", { name: "Wed 14 Oct" }));
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("Wednesday 14 October");
    await press(viewBtn("4 weeks"));
    await press(within(agenda()).getByRole("button", { name: "Fri 25 – Sun 27 Sept, nothing on" }));
    expect(runs).toEqual([]);
  });

  it("fades nothing under reduced motion, whatever the pointer does", async () => {
    window.matchMedia = ((q: string) => ({ matches: q.includes("prefers-reduced-motion: reduce"), media: q })) as typeof window.matchMedia;
    const user = userEvent.setup();
    draw();
    await user.click(viewBtn("Month"));
    await user.click(screen.getByRole("button", { name: "School holidays, Mon 28 Sept – Fri 9 Oct" }));
    await user.click(screen.getByRole("button", { name: "Later" }));
    await user.click(screen.getByRole("button", { name: "Mon 5 Oct: Labour Day" }));
    await user.click(within(panel()).getByRole("button", { name: "Labour Day" }));
    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("Labour Day");
    expect(rangeTitle()).toHaveTextContent("September 2026");
    await user.click(viewBtn("4 weeks"));
    await user.click(filter(/^Events/));
    expect(within(agenda()).queryByRole("button", { name: "Toolbox talk" })).toBeNull();
    await user.click(filter(/^Events/));
    expect(within(agenda()).getByRole("button", { name: "Toolbox talk" })).toBeInTheDocument();
    expect(runs).toEqual([]);
  });

  /* The grow runs through el.animate, which the stylesheet's reduced-motion
     rules cannot reach: what a pointer's Save lands is lit and still. */
  it("lights what a pointer's Save landed under reduced motion, and never grows it", async () => {
    window.matchMedia = ((q: string) => ({ matches: q.includes("prefers-reduced-motion: reduce"), media: q })) as typeof window.matchMedia;
    const { rerender } = draw();
    document.querySelector<HTMLElement>(".hd-cal-add")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    mockAdd.mockResolvedValueOnce({ ok: true, id: "e9", day: TODAY });
    await act(async () => {
      await box!.save("Team barbecue");
    });
    const landed = { ...ROWS.events[0]!, id: "e9", title: "Team barbecue", startsOn: TODAY, endsOn: TODAY, startsAt: null, endsAt: null };
    rerender(<HomeCalendarPage cal={calendar({ events: [...ROWS.events, landed] })} />);
    const row = within(agenda()).getByRole("button", { name: "Team barbecue" }).closest(".hd-cal-it")!;
    expect(row).toHaveAttribute("data-fresh");
    expect(runs.filter((r) => r.el === row)).toEqual([]);
    expect(runs).toEqual([]);
  });

  /* "Muted and inert when today is already in view." */
  it("does nothing on Today while it rests: no step, no fade, and the grid stays where it was moved", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(viewBtn("Month"));
    await user.click(screen.getByRole("button", { name: "Later" }));
    await user.click(screen.getByRole("button", { name: "Earlier" }));
    expect(rangeTitle()).toHaveTextContent("September 2026");
    const grid = document.querySelector<HTMLElement>(".hd-cal-mg")!;
    grid.dispatchEvent(new Event("wheel"));
    grid.scrollTop = 100;
    runs = [];
    const today = screen.getByRole("button", { name: "Today" });
    expect(today).toHaveAttribute("aria-disabled", "true");
    await user.click(today);
    expect(rangeTitle()).toHaveTextContent("September 2026");
    expect(runs).toEqual([]);
    expect(grid.scrollTop).toBe(100);
  });

  /* What Tiff put on, landing as the modal closes (his calLand). */
  const tiffOn = (landed: TiffLanded | null, cal = calendar()) => (
    <TiffContext.Provider
      value={{ open: () => false, openedBy: null, isOpen: false, landed }}
    >
      <HomeCalendarPage cal={cal} />
    </TiffContext.Provider>
  );

  it("lands a pointer's swap first when what Tiff put on arrives while it fades, and brings it into the view chosen", async () => {
    const user = userEvent.setup();
    const { rerender } = render(tiffOn(null));
    hold();
    await user.click(viewBtn("Month"));
    expect(said()).toEqual(["hd-cal-body:out"]);
    rerender(tiffOn({ noteIds: [], ids: ["s2"] }, calendar({ events: [...ROWS.events, SERIES[1]!] })));
    // Month, as the pointer chose, on the month of what landed: 5 Nov
    expect(document.querySelector(".hd-cal-mg")).toBeInTheDocument();
    expect(rangeTitle()).toHaveTextContent("November 2026");
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("Toolbox talk");
    expect(runs[0]!.cancelled).toBe(true);
    // the swap it landed puts nothing down after it
    await release();
    expect(rangeTitle()).toHaveTextContent("November 2026");
    expect(said()).toEqual(["hd-cal-body:out"]);
  });

  it("lands what Tiff put on lit and still, even while a pointer's Save is still to arrive", async () => {
    const { rerender } = render(tiffOn(null));
    document.querySelector(".hd-cal-add")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    mockAdd.mockResolvedValueOnce({ ok: true, id: "e9", day: TODAY });
    await act(async () => {
      await box!.save("Team barbecue");
    });
    runs = [];
    rerender(tiffOn({ noteIds: [], ids: ["s1"] }, calendar({ events: [...ROWS.events, SERIES[0]!] })));
    const row = within(agenda()).getByRole("button", { name: "Toolbox talk", pressed: true }).closest(".hd-cal-it")!;
    expect(row).toHaveAttribute("data-fresh");
    expect(runs.filter((r) => r.el === row)).toEqual([]);
  });
});

/* MONTH OPENS ON TODAY'S WEEK (his calToWeek), laid out here by hand: the
   grid 240 tall at 100, today's week `weekAt` down its content. jsdom's
   ResizeObserver never calls back, so a fake stands in that the test fires
   as the grid settling. */
describe("Month on today's week", () => {
  const realRO = window.ResizeObserver;
  const realTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetTop")!;
  let observers: { cb: ResizeObserverCallback; on: boolean }[] = [];
  let weekAt = 540;
  let gridHeight = 240;
  let spy: jest.SpyInstance;
  const grid = () => document.querySelector<HTMLElement>(".hd-cal-mg")!;
  const settles = () =>
    act(() => {
      for (const o of observers) if (o.on) o.cb([], {} as ResizeObserver);
    });

  beforeEach(() => {
    observers = [];
    weekAt = 540;
    gridHeight = 240;
    window.ResizeObserver = class {
      private o: { cb: ResizeObserverCallback; on: boolean };
      constructor(cb: ResizeObserverCallback) {
        this.o = { cb, on: false };
        observers.push(this.o);
      }
      observe() {
        this.o.on = true;
      }
      unobserve() {}
      disconnect() {
        this.o.on = false;
      }
    } as unknown as typeof ResizeObserver;
    spy = layout([
      [".hd-cal-mg", () => at(100, gridHeight)],
      [".hd-cal-wk[data-today]", (el) => at(100 + weekAt - el.closest<HTMLElement>(".hd-cal-mg")!.scrollTop, 124)],
    ]);
    // where the week sits in its grid, for anything that reads it that way
    Object.defineProperty(HTMLElement.prototype, "offsetTop", {
      configurable: true,
      get(this: HTMLElement) {
        return this.matches(".hd-cal-wk[data-today]") ? weekAt : 0;
      },
    });
  });
  afterEach(() => {
    window.ResizeObserver = realRO;
    spy.mockRestore();
    Object.defineProperty(HTMLElement.prototype, "offsetTop", realTop);
  });

  it("brings today's week up when it is out of sight, and holds it there until the grid is moved", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(viewBtn("Month"));
    expect(grid().scrollTop).toBe(540);
    // the grid settles (the day's card opening above it): the week is held
    grid().scrollTop = 200;
    settles();
    expect(grid().scrollTop).toBe(540);
    // moved by hand: the grid is the reader's from then on
    grid().dispatchEvent(new Event("wheel"));
    grid().scrollTop = 100;
    settles();
    expect(grid().scrollTop).toBe(100);
    // October has no today in it: its grid opens at its top
    await user.click(screen.getByRole("button", { name: "Later" }));
    expect(grid().scrollTop).toBe(0);
  });

  it("leaves a week already in sight where it is, with the days' heads above it, until the grid settles smaller round it", async () => {
    const user = userEvent.setup();
    weekAt = 60;
    draw();
    await user.click(viewBtn("Month"));
    expect(grid().scrollTop).toBe(0);
    settles();
    expect(grid().scrollTop).toBe(0);
    // the day's card opens above: the grid is shorter, and the week falls out of it
    gridHeight = 150;
    settles();
    expect(grid().scrollTop).toBe(60);
  });

  it("opens a month you step back to at its top, and at today's week only if it must", async () => {
    const user = userEvent.setup();
    weekAt = 60;
    draw();
    await user.click(viewBtn("Month"));
    await user.click(screen.getByRole("button", { name: "Later" }));
    grid().dispatchEvent(new Event("wheel"));
    grid().scrollTop = 300;
    await user.click(screen.getByRole("button", { name: "Earlier" }));
    expect(rangeTitle()).toHaveTextContent("September 2026");
    expect(grid().scrollTop).toBe(0);
  });
});

describe("revealIn", () => {
  it("moves nothing for a thing in its scroller's sight, and only the scroller for one out of it", () => {
    const sc = document.createElement("div");
    sc.setAttribute("data-scroll", "");
    const el = document.createElement("div");
    sc.append(el);
    document.body.append(sc);
    let top = 150;
    const spy = layout([
      ["[data-scroll]", () => at(100, 300)],
      ["[data-scroll] > div", () => at(top, 24)],
    ]);
    try {
      revealIn(el);
      expect(sc.scrollTop).toBe(0);
      top = 500;
      revealIn(el);
      expect(sc.scrollTop).toBe(500 - 100 - 96);
      expect(document.documentElement.scrollTop).toBe(0);
      // nothing to reveal, or nowhere to reveal it in: nothing happens
      expect(() => revealIn(null)).not.toThrow();
      expect(() => revealIn(document.createElement("div"))).not.toThrow();
    } finally {
      spy.mockRestore();
      sc.remove();
    }
  });
});

it("says nothing a dashboard says by rote, and nothing made up", async () => {
  const user = userEvent.setup();
  draw();
  for (const v of ["4 weeks", "Month", "Year"]) {
    await user.click(viewBtn(v));
    expect(document.body.textContent).not.toMatch(/needs you|needs attention|action required|click anything|example/i);
  }
});
