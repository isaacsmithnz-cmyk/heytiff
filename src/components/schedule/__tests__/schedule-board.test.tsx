import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScheduleBoard } from "../schedule-board";
import type { PanelJob, SchedulePage } from "@/lib/schedule/schedule-page-query";
import type { SchedulePayload } from "@/lib/workboard/schedule-query";

/* The Schedule, as Isaac walked it on 25 October 2026: Open display kept
   through a change of view, the title saying only what the pager doesn't,
   and the Jobs to drag drawn as the board's own cards under a search box
   with its glass. */

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh, prefetch: jest.fn() }) }));
jest.mock("@/app/actions/booking-sm8", () => ({ bookJobIn: jest.fn(), readBookInContext: jest.fn(), takeBackBooking: jest.fn() }));
const loadSchedulePanel = jest.fn();
jest.mock("@/app/actions/schedule-panel", () => ({ loadSchedulePanel: () => loadSchedulePanel() }));
jest.mock("@/components/making/regular-days-off-form", () => ({ RegularDaysOffForm: () => null }));

const DAY = "2026-10-26";
const payload = (dayISO: string): SchedulePayload => ({ dayISO, activities: [], staff: [], jobs: [], onSite: [], addresses: {} });
const page = (over: Partial<SchedulePage> = {}): SchedulePage => ({
  view: "day",
  day: DAY,
  today: DAY,
  days: [DAY],
  payloads: [payload(DAY)],
  canBook: true,
  capacity: [],
  team: [],
  profiles: {},
  canTeam: false,
  ...over,
});
const JOB: PanelJob = { uuid: "j-3450", number: "3450", client: "BRC Build", site: "Kingsford", kind: "Install", hue: "purple", state: "Waiting on a day", tone: "look", toBook: true, words: "3450 brc build kingsford install" };

const requestFullscreen = jest.fn(() => Promise.resolve());
beforeAll(() => {
  Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: requestFullscreen });
});
beforeEach(() => {
  loadSchedulePanel.mockResolvedValue({ ok: true, jobs: [JOB] });
  refresh.mockClear();
});
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-wb-display");
});

describe("Open display", () => {
  it("(F) stays open when the view changes, though the board is drawn again", async () => {
    const { rerender } = render(<ScheduleBoard key="day" data={page()} />);
    await userEvent.click(screen.getByRole("button", { name: "Open display" }));
    expect(document.documentElement).toHaveAttribute("data-wb-display", "on");
    /* the page draws a new board for each view, keyed by view and day */
    rerender(<ScheduleBoard key="week" data={page({ view: "week" })} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByRole("button", { name: "Close display" })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("data-wb-display", "on");
    await userEvent.click(screen.getByRole("button", { name: "Close display" }));
    expect(document.documentElement).not.toHaveAttribute("data-wb-display");
  });

  it("(F) closes when the Schedule is left", async () => {
    const { unmount } = render(<ScheduleBoard key="day" data={page()} />);
    await userEvent.click(screen.getByRole("button", { name: "Open display" }));
    unmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(document.documentElement).not.toHaveAttribute("data-wb-display");
  });
});

describe("the title", () => {
  it("(F) says the date once, in the pager, not again beside the title", () => {
    render(<ScheduleBoard data={page()} />);
    expect(screen.getAllByText("Monday 26 October")).toHaveLength(1);
  });

  it("(F) beside the title, 4 weeks says how booked it is and nothing the pager says", () => {
    const days = ["2026-10-26", "2026-10-27"];
    render(
      <ScheduleBoard
        data={page({
          view: "weeks",
          days,
          payloads: [],
          capacity: days.map((d) => ({ dayISO: d, bookedMinutes: 240, capacityMinutes: 480, bookings: 1, jobs: 1, people: [], fillPct: 50, over: false }) as unknown as SchedulePage["capacity"][number]),
        })}
      />,
    );
    expect(screen.getByText("50% booked")).toBeInTheDocument();
    expect(screen.queryByText(/4 weeks from/)).toBeNull();
  });
});

describe("the month", () => {
  it("(F) says who's off as their initials in a row, so five weeks fit the screen; the day's panel says why", () => {
    const days = ["2026-10-26"];
    const off = ["Alex Lorenz", "Isaac Smith", "Luke Irving"].map((name) => ({ staffUuid: name, name, why: "Holidays", part: null, minutes: 480 }));
    render(<ScheduleBoard data={page({ view: "month", days, payloads: [], team: [{ dayISO: days[0], holiday: null, events: [], off } as unknown as SchedulePage["team"][number]] })} />);
    const row = screen.getByLabelText("Off: Alex Lorenz, Isaac Smith, Luke Irving");
    expect(row.querySelectorAll(".pt-initials")).toHaveLength(3);
    expect(screen.queryByText("Holidays")).toBeNull();
  });
});

describe("Jobs, to drag", () => {
  it("(F) are the board's own cards: the number in a box of the job's colour, the client, the site, the kind", async () => {
    render(<ScheduleBoard data={page()} />);
    const jobs = screen.getByRole("complementary", { name: "Jobs" });
    const card = await waitFor(() => within(jobs).getByRole("button", { name: /BRC Build/ }));
    expect(card).toHaveClass("sc-card", "sc-card--purple");
    expect(card.querySelector(".sc-cn")).toHaveTextContent("3450");
    expect(card.querySelector(".sc-c1")).toHaveTextContent("BRC Build");
    expect(card.querySelector(".sc-c2")).toHaveTextContent("Kingsford");
    expect(card.querySelector(".sc-c3")).toHaveTextContent("Install");
    expect(card).toHaveAttribute("draggable", "true");
  });

  it("(F) are found with the one search box, its glass inside it", async () => {
    render(<ScheduleBoard data={page()} />);
    const jobs = screen.getByRole("complementary", { name: "Jobs" });
    const box = within(jobs).getByRole("search");
    expect(box).toHaveClass("pt-search");
    expect(box.querySelector(".pt-search-icon svg")).not.toBeNull();
    await userEvent.type(within(box).getByRole("textbox", { name: "Find a job, client or site" }), "nothing like it");
    expect(within(jobs).getByText("No job matches that.")).toBeInTheDocument();
  });
});
