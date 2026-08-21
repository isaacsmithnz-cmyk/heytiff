/* The Capacity view — the Schedule tab's month of fill. The scoring law is
   pinned in lib/workboard/__tests__ (capacity.ts is pure); what matters HERE
   is what the screen does with it: the switcher swaps views without losing
   either, a day with no denominator shows NO percentage, an unset crew is
   said in words rather than as 31 zeros, over-capacity is marked, a day
   opens into the jobs and people on it, and the crew editor only exists for
   someone who can manage the board. Plus the one paint law: every step of
   the figure's ramp clears 4.5:1 on the white it sits on. */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SchedulePayload } from "@/lib/workboard/schedule-query";
import type { CapacityPayload } from "@/lib/workboard/capacity-query";

const scheduleDay = jest.fn<Promise<SchedulePayload>, [string]>();
const scheduleCapacity = jest.fn<Promise<CapacityPayload>, [string]>();
const setScheduleCapacity = jest.fn<
  Promise<{ ok: true } | { ok: false; error: string }>,
  [unknown]
>();
jest.mock("@/app/actions/workboard", () => ({
  scheduleDay: (...a: [string]) => scheduleDay(...a),
  scheduleCapacity: (...a: [string]) => scheduleCapacity(...a),
  setScheduleCapacity: (...a: [unknown]) => setScheduleCapacity(...a),
}));

import { ScheduleTab } from "../schedule-tab";
import { capacityInk, OVER_INK } from "@/lib/workboard/capacity-paint";
import { contrastRatio } from "@/lib/workboard/schedule-colour";

/** "rgb(1, 2, 3)" → channels, so a test measures what actually shipped. */
const rgb = (value: string): [number, number, number] => {
  const m = value.match(/\d+/g);
  if (!m || m.length < 3) throw new Error(`not an rgb() colour: "${value}"`);
  return [Number(m[0]), Number(m[1]), Number(m[2])];
};

/* A Friday. 2026-08-01 is a Saturday, so August 2026 holds 21 working days —
   at two people on 8h each (960 a day) the month's capacity is 20160min. */
const TODAY = "2026-08-14";

const dayPayload = (): SchedulePayload => ({
  dayISO: TODAY,
  activities: [
    {
      uuid: "a-1",
      jobUuid: "j-3171",
      staffUuid: "s-lorenz",
      start: `${TODAY} 07:00:00`,
      end: `${TODAY} 15:00:00`,
      wasScheduled: 1,
    },
    {
      uuid: "a-2",
      jobUuid: "j-3145",
      staffUuid: "s-hann",
      start: `${TODAY} 07:00:00`,
      end: `${TODAY} 16:00:00`,
      wasScheduled: 1,
    },
    {
      uuid: "a-3",
      jobUuid: "j-3145",
      staffUuid: "s-lorenz",
      start: `${TODAY} 15:00:00`,
      end: `${TODAY} 16:00:00`,
      wasScheduled: 1,
    },
  ],
  staff: [
    { uuid: "s-lorenz", name: "Alex Lorenz" },
    { uuid: "s-hann", name: "David Hann" },
  ],
  jobs: [
    {
      remoteId: "j-3171",
      jobNumber: "3171",
      status: "Work Order",
      paidCents: 0,
      clientName: "Girgis, Katrina",
      description: null,
      suburb: "Sylvania Waters",
      categoryName: null,
      categoryColour: null,
      date: null,
      quoteDate: null,
      completionDate: null,
      nextBooking: null,
      money: null,
    },
    {
      remoteId: "j-3145",
      jobNumber: "3145",
      status: "Work Order",
      paidCents: 0,
      clientName: "Rifkin, Julian",
      description: null,
      suburb: "Enmore",
      categoryName: "Install",
      categoryColour: "#e7b5ff",
      date: null,
      quoteDate: null,
      completionDate: null,
      nextBooking: null,
      money: null,
    },
  ],
  weekCounts: { [TODAY]: 3 },
  onSite: [],
});

/* The month around it: Friday holds 18h against 16h (113%, over), Saturday
   holds 4h against nothing (null), the Monday after holds 4h of 16h (25%). */
const capPayload = (over: Partial<CapacityPayload> = {}): CapacityPayload => ({
  anyDayISO: TODAY,
  activities: [
    ...dayPayload().activities.map((a, i) => ({ ...a, uuid: `c-${i}` })),
    {
      uuid: "c-sat",
      jobUuid: "j-3171",
      staffUuid: "s-lorenz",
      start: "2026-08-15 08:00:00",
      end: "2026-08-15 12:00:00",
      wasScheduled: 1,
    },
    {
      uuid: "c-mon",
      jobUuid: "j-3145",
      staffUuid: "s-hann",
      start: "2026-08-17 07:00:00",
      end: "2026-08-17 11:00:00",
      wasScheduled: 1,
    },
  ],
  allocation: [
    { staffUuid: "s-lorenz", name: "Alex Lorenz", included: true, dailyMinutes: 480 },
    { staffUuid: "s-hann", name: "David Hann", included: true, dailyMinutes: 480 },
  ],
  staffNames: [
    ["s-lorenz", "Alex Lorenz"],
    ["s-hann", "David Hann"],
  ],
  ...over,
});

const noop = () => {};

function tab(over: Partial<Parameters<typeof ScheduleTab>[0]> = {}) {
  return (
    <ScheduleTab
      today={TODAY}
      connected
      syncing={false}
      manage
      tracked={new Map()}
      shelfItems={[]}
      waitingCount={0}
      onOpenJob={noop}
      onOpenTracked={noop}
      onGoWork={noop}
      {...over}
    />
  );
}

/** Open the tab on its rail, then flip to the month and wait for its DATA —
    the grid only renders once the payload is in, so it is the honest wait
    (the header's label is up before anything has loaded). */
async function openCapacity(over: Partial<Parameters<typeof ScheduleTab>[0]> = {}) {
  render(tab(over));
  await screen.findByText("Alex Lorenz");
  await userEvent.click(screen.getByRole("button", { name: "Capacity" }));
  await screen.findByRole("group", { name: /How full each day of August 2026/ });
}

beforeEach(() => {
  scheduleDay.mockReset();
  scheduleDay.mockResolvedValue(dayPayload());
  scheduleCapacity.mockReset();
  scheduleCapacity.mockResolvedValue(capPayload());
  setScheduleCapacity.mockReset();
  setScheduleCapacity.mockResolvedValue({ ok: true });
});

it("flips to the month and back without losing either view", async () => {
  await openCapacity();
  expect(scheduleCapacity).toHaveBeenCalledWith(TODAY);
  // the Monday's figure is up, and the rail's lane meta is gone
  expect(screen.getByText("25%")).toBeInTheDocument();
  expect(screen.queryByText("2 bookings · 9h")).not.toBeInTheDocument();
  // the month's own line rides the header: 22h booked of 21 days × 16h
  expect(screen.getByText("22h of 336h")).toBeInTheDocument();
  expect(screen.getByText("7% full")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Day" }));
  expect(await screen.findByText("2 bookings · 9h")).toBeInTheDocument();
  expect(scheduleDay).toHaveBeenCalledTimes(1); // the rail came back from cache

  await userEvent.click(screen.getByRole("button", { name: "Capacity" }));
  await screen.findByRole("group", { name: /How full each day/ });
  expect(scheduleCapacity).toHaveBeenCalledTimes(1); // and so did the month
});

it("shows a weekend's cell with NO percentage — the hours live in its title", async () => {
  await openCapacity();
  const sat = screen.getByRole("button", { name: /Sat 15 Aug/ });
  expect(sat.textContent).not.toMatch(/%/);
  expect(sat).toHaveAttribute("title", "4h booked");
  expect(sat).toHaveAccessibleName(/4h booked/);
  // an empty weekend is not even clickable
  expect(screen.queryByRole("button", { name: /Sun 16 Aug/ })).not.toBeInTheDocument();
});

it("scores nothing for an unset crew and says so, rather than printing zeros", async () => {
  scheduleCapacity.mockResolvedValue(
    capPayload({
      allocation: [
        { staffUuid: "s-lorenz", name: "Alex Lorenz", included: false, dailyMinutes: 480 },
        { staffUuid: "s-hann", name: "David Hann", included: false, dailyMinutes: 480 },
      ],
    })
  );
  await openCapacity();
  expect(screen.getByText(/crew hasn't been set/)).toBeInTheDocument();
  // not one percentage anywhere — null is not zero
  expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
  // the booked hours are still real: on the month line and in the day's title
  expect(screen.getByText("26h booked")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Fri 14 Aug/ })).toHaveAttribute(
    "title",
    "18h booked"
  );
  // and the fix is offered to someone who can make it
  expect(screen.getByRole("button", { name: "Set the crew" })).toBeInTheDocument();
});

it("marks a day past its capacity as over, in the warn ink and in words", async () => {
  await openCapacity();
  const fri = screen.getByRole("button", { name: /Fri 14 Aug/ });
  expect(fri).toHaveClass("over");
  expect(fri).toHaveAccessibleName(/over capacity/);
  expect(within(fri).getByText("113%")).toBeInTheDocument();
  expect(within(fri).getByText("Over")).toBeInTheDocument();
  // the figure wears the warn family's INK — never the fill, never danger
  expect(fri.style.getPropertyValue("--capink")).toBe(OVER_INK);
});

it("opens a day into its jobs, hours and everyone on them", async () => {
  await openCapacity();
  const fri = screen.getByRole("button", { name: /Fri 14 Aug/ });
  await userEvent.click(fri);

  // the panel reads through the SAME cache the rail filled on mount
  expect(scheduleDay).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("2 jobs · 18h")).toBeInTheDocument();
  expect(screen.getByText("Girgis, Katrina")).toBeInTheDocument();
  expect(screen.getByText("3171")).toBeInTheDocument();
  expect(screen.getByText("8h")).toBeInTheDocument();
  expect(screen.getByText("Rifkin, Julian")).toBeInTheDocument();
  expect(screen.getByText("10h")).toBeInTheDocument();
  // the crew job names EVERYONE on it
  expect(screen.getByText("Alex Lorenz, David Hann")).toBeInTheDocument();
  expect(screen.getByText("Install · Enmore")).toBeInTheDocument();

  // Escape dismisses and hands focus back to the day it came from
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByText("2 jobs · 18h")).not.toBeInTheDocument();
  expect(fri).toHaveFocus();

  // clicking the day again toggles it closed too
  await userEvent.click(fri);
  await screen.findByText("2 jobs · 18h");
  await userEvent.click(fri);
  expect(screen.queryByText("2 jobs · 18h")).not.toBeInTheDocument();

  // and the close button is the third door
  await userEvent.click(fri);
  await screen.findByText("2 jobs · 18h");
  await userEvent.click(screen.getByRole("button", { name: "Close the day" }));
  expect(screen.queryByText("2 jobs · 18h")).not.toBeInTheDocument();
});

it("offers the crew editor only to someone who can manage the board", async () => {
  await openCapacity({ manage: false });
  expect(screen.queryByRole("button", { name: "Crew" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Set the crew" })).not.toBeInTheDocument();
});

it("explains an unset crew to a reader WITHOUT offering the editor", async () => {
  scheduleCapacity.mockResolvedValue(
    capPayload({
      allocation: [
        { staffUuid: "s-lorenz", name: "Alex Lorenz", included: false, dailyMinutes: 480 },
      ],
    })
  );
  await openCapacity({ manage: false });
  // the gap is still named — a reader deserves the why even without the fix
  expect(screen.getByText(/crew hasn't been set/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Set the crew" })).not.toBeInTheDocument();
});

it("edits the crew as a list, saves it in one write and re-reads the month", async () => {
  await openCapacity();
  await userEvent.click(screen.getByRole("button", { name: "Crew" }));
  expect(await screen.findByText("Who counts toward a day")).toBeInTheDocument();
  expect(screen.getByText("2 people · 16h a day")).toBeInTheDocument();

  // set David aside — his hours survive the toggle, so the line halves
  await userEvent.click(screen.getByRole("switch", { name: /David Hann/ }));
  expect(screen.getByText("1 person · 8h a day")).toBeInTheDocument();

  // and step Alex up half an hour
  await userEvent.click(screen.getByRole("button", { name: "More hours for Alex Lorenz" }));
  expect(screen.getByText("1 person · 8h30 a day")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(setScheduleCapacity).toHaveBeenCalledWith([
    { staffUuid: "s-lorenz", included: true, dailyMinutes: 510 },
    { staffUuid: "s-hann", included: false, dailyMinutes: 480 },
  ]);
  // the modal closes and the month is asked again — the denominator moved
  await waitFor(() =>
    expect(screen.queryByText("Who counts toward a day")).not.toBeInTheDocument()
  );
  expect(scheduleCapacity).toHaveBeenCalledTimes(2);
});

/* ── the paint law ──
   The figure sits on white and white never moves, so every step of the ramp
   is measured against white — the sweep that caught a purple at 6.12:1 and a
   yellow-green at 2.22:1 at the SAME lightness on the rail's caps. */
it("holds every ramp step and the over ink to 4.5:1 on white", () => {
  const white: [number, number, number] = [255, 255, 255];
  let worst = Infinity;
  for (let pct = 0; pct <= 100; pct += 1) {
    worst = Math.min(worst, contrastRatio(rgb(capacityInk(pct)), white));
  }
  expect(worst).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(rgb(OVER_INK), white)).toBeGreaterThanOrEqual(4.5);
  // and the full end is the GREEN, not a red anything — a full day is a
  // good day; the ramp is the traffic light's inverse, on purpose
  const [r, g] = rgb(capacityInk(100));
  expect(g).toBeGreaterThan(r);
});
