import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeCalendarPage } from "../home-cal-page";
import { revealIn } from "../home-cal-parts";
import { companyItems, type CompanyCalendar, type CompanyRows } from "@/lib/calendar/items";
import type { BoxSave } from "@/components/tiff/modal/tiff-box";

/* THE CALENDAR, ON SCREEN (H21). The rows, the maths and the words are
   lib/calendar's and have their own suites; every calendar here is built
   by them from rows like the loader's, so what is pinned is what the page
   does: its own toolbar, one choice and one set of filters across the
   three views, the rail built from the list's rows, the arrows resting at
   the twelve months' edges, and Save.

   The box is Tiff's and has its own suite: stubbed here to the one thing
   the calendar hands it, its room and its Save. The actions are server
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
jest.mock("@/app/actions/calendar", () => ({ addCalendarEvent: (text: string) => mockAdd(text) }));
let box: { room: string; placeholder: string; save: BoxSave } | null = null;
jest.mock("@/components/tiff/modal/tiff-box", () => ({
  TiffBox: (p: { room: string; placeholder: string; save: BoxSave }) => {
    box = p;
    return <div data-testid="tiff-box" data-room={p.room} aria-label={p.placeholder} />;
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
});

describe("its own toolbar", () => {
  it("holds the box, in the calendar's room, and 4 weeks | Month | Year, with 4 weeks chosen", () => {
    draw();
    const head = document.querySelector(".hd-cal-hd")!;
    expect(within(head as HTMLElement).getByTestId("tiff-box")).toHaveAttribute("data-room", "calendar");
    expect(box?.placeholder).toBe("Add to the calendar…");
    expect(within(screen.getByRole("group", { name: "View" })).getAllByRole("button").map((b) => b.textContent)).toEqual([
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

  it("shows in Month's panel what was picked in 4 weeks, with its facts and no Edit before its form", async () => {
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
    expect(within(p).queryByRole("button")).toBeNull();
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
      expect(within(agenda()).getByRole("button", { name: "Labour Day" })).toHaveAttribute("aria-pressed", "true");
      expect(agenda().scrollTop).toBe(900 - 100 - 96);
      expect(document.documentElement.scrollTop).toBe(0);
      expect(document.body.scrollTop).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("carries the choice on to Year, and back to 4 weeks", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(viewBtn("Year"));
    await user.click(screen.getByRole("button", { name: "Mon 5 Oct: Labour Day, School holidays" }));
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("Labour Day");
    expect(panel()).toHaveTextContent("Public holiday in NSW.");
    expect(within(panel()).getByRole("list", { name: "Key" })).toHaveTextContent("Admin overdue");
    await user.click(viewBtn("4 weeks"));
    expect(within(agenda()).getByRole("button", { name: "Labour Day" })).toHaveAttribute("aria-pressed", "true");
  });

  it("picks a holiday by its date in Month, and the school holidays by their bar", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(viewBtn("Month"));
    await user.click(screen.getByRole("button", { name: "School holidays, Mon 28 Sept – Fri 9 Oct" }));
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("School holidays");
    await user.click(screen.getByRole("button", { name: "Later" }));
    await user.click(screen.getByRole("button", { name: "Mon 5 Oct: Labour Day" }));
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("Labour Day");
    expect(screen.getByRole("button", { name: "Mon 5 Oct: Labour Day" })).toHaveAttribute("aria-pressed", "true");
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
  it("puts the words on today as typed, and chooses, lights and shows what landed", async () => {
    const user = userEvent.setup();
    const { rerender } = draw();
    await user.click(filter(/^Events/));
    mockAdd.mockResolvedValueOnce({ ok: true, id: "e9", day: TODAY });
    let said: unknown;
    await act(async () => {
      said = await box!.save("Team barbecue");
    });
    expect(mockAdd).toHaveBeenCalledWith("Team barbecue");
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

  it("stops lighting what landed after the list's flash", async () => {
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
        jest.advanceTimersByTime(1600);
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

describe("motion", () => {
  const real = Element.prototype.animate;
  let runs: Element[] = [];
  beforeEach(() => {
    runs = [];
    Element.prototype.animate = function (this: Element) {
      runs.push(this);
      return { finished: Promise.resolve(), cancel: () => {} } as unknown as Animation;
    } as typeof Element.prototype.animate;
    window.matchMedia = ((q: string) => ({ matches: false, media: q })) as typeof window.matchMedia;
  });
  afterEach(() => {
    Element.prototype.animate = real;
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it("fades a view, a step and a pick in for a pointer, and not for a key", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(viewBtn("Month"));
    expect(runs.map((el) => el.className)).toEqual(["hd-cal-body"]);
    await user.click(screen.getByRole("button", { name: "School holidays, Mon 28 Sept – Fri 9 Oct" }));
    await user.click(screen.getByRole("button", { name: "Later" }));
    await user.click(screen.getByRole("button", { name: "Mon 5 Oct: Labour Day" }));
    expect(runs.map((el) => el.className)).toEqual(["hd-cal-body", "hd-cal-body", "hd-cal-dx"]);

    runs = [];
    viewBtn("Year").focus();
    await user.keyboard("{Enter}");
    screen.getByRole("button", { name: "Earlier" }).focus();
    await user.keyboard("{Enter}");
    screen.getByRole("button", { name: "Thu 1 Oct: School holidays, Toolbox talk" }).focus();
    await user.keyboard("{Enter}");
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("Toolbox talk");
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

  it("fades the view once when a pointer brings the panel up, not the panel over it", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(within(agenda()).getByRole("button", { name: "Toolbox talk" }));
    runs = [];
    await user.click(viewBtn("Month"));
    expect(runs.map((el) => el.className)).toEqual(["hd-cal-body"]);
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
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("Labour Day");
    await press(screen.getByRole("button", { name: /^Thu 1 Oct: Toolbox talk/ }));
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("Toolbox talk");
    await press(screen.getByRole("button", { name: "Today" }));
    expect(rangeTitle()).toHaveTextContent("September 2026");
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
    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(within(panel()).getByRole("heading", { level: 3 })).toHaveTextContent("Labour Day");
    expect(rangeTitle()).toHaveTextContent("September 2026");
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
