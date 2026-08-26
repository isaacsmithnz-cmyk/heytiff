/* The Capacity view — the Schedule tab's rolling four weeks of fill. The
   scoring law is pinned in lib/workboard/__tests__ (capacity.ts is pure);
   what matters HERE is what the screen does with it: the window opens on the
   current week's Monday, the switcher swaps views without losing either, a
   day with no denominator shows NO percentage, an unset crew is said in
   words rather than as 28 zeros, over-capacity brims the gauge in danger, a
   day opens into the jobs and people on it, and the crew editor only exists
   for someone who can manage the board. Plus the one paint law: the figure's
   ink clears 4.5:1 against whatever ground the gauge actually puts under it. */

import { useState } from "react";
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

import { CapacityView } from "../capacity-view";
import { capacityCellPaint } from "@/lib/workboard/capacity-paint";
import { contrastRatio, scheduleBlockPaint } from "@/lib/workboard/schedule-colour";

/** "rgb(1, 2, 3)" → channels, so a test measures what actually shipped. */
const rgb = (value: string): [number, number, number] => {
  const m = value.match(/\d+/g);
  if (!m || m.length < 3) throw new Error(`not an rgb() colour: "${value}"`);
  return [Number(m[0]), Number(m[1]), Number(m[2])];
};

/* A Friday. Its week's Monday is 2026-08-10, so the rolling window runs
   2026-08-10 → 2026-09-06: 20 working days — at two people on 8h each
   (960 a day) the window's capacity is 19200min = 320h. */
const TODAY = "2026-08-14";
const WINDOW_START = "2026-08-10";

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
  anyDayISO: WINDOW_START,
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

/* The caches and the window's anchor belong to the BOARD — Capacity is a tab
   beside Schedule now, not a face of it, and what the two share is these. The
   harness owns them exactly as the board does, so a test can seed the day
   cache the way a visit to the rail would have. */
let dayCache: { current: Map<string, SchedulePayload> };
let capCache: { current: Map<string, CapacityPayload> };

type Over = Partial<Parameters<typeof CapacityView>[0]>;

function Harness({ over }: { over: Over }) {
  const [anchor, setAnchor] = useState(TODAY);
  return (
    <CapacityView
      today={TODAY}
      connected
      syncing={false}
      manage
      anchor={anchor}
      onAnchor={setAnchor}
      capCache={capCache}
      dayCache={dayCache}
      tracked={new Map()}
      onOpenJob={noop}
      {...over}
    />
  );
}

/** Open the window and wait for its DATA — the grid only renders once the
    payload is in, so it is the honest wait (the header's label is up before
    anything has loaded). */
async function openCapacity(over: Over = {}) {
  const r = render(<Harness over={over} />);
  await screen.findByRole("group", { name: "How full each day is" });
  return r;
}

beforeEach(() => {
  dayCache = { current: new Map() };
  capCache = { current: new Map() };
  scheduleDay.mockReset();
  scheduleDay.mockResolvedValue(dayPayload());
  scheduleCapacity.mockReset();
  scheduleCapacity.mockResolvedValue(capPayload());
  setScheduleCapacity.mockReset();
  setScheduleCapacity.mockResolvedValue({ ok: true });
});

it("opens on the current week's Monday and says what it is", async () => {
  await openCapacity();
  // the window is asked for FROM ITS MONDAY — the current week is the top row
  expect(scheduleCapacity).toHaveBeenCalledWith(WINDOW_START);
  // the Monday's figure is up, and the rail's lane meta is nowhere near it
  expect(screen.getByText("25%")).toBeInTheDocument();
  expect(screen.queryByText("2 bookings · 9h")).not.toBeInTheDocument();
  // the header names the window's grain on the left and the stepper says
  // WHICH four weeks; the chip is left with only the number it measures
  expect(screen.getByText("Four weeks")).toBeInTheDocument();
  expect(screen.getByText("10 Aug – 6 Sept")).toBeInTheDocument();
  expect(screen.getByText("7% full")).toBeInTheDocument();
  expect(screen.queryByText(/\d+h of \d+h/)).not.toBeInTheDocument();
});

/* Leaving for another tab UNMOUNTS this — the anchor and both caches live on
   the board for exactly that reason. Stepping to a window and coming back
   must not re-read a thing, or every glance at the diary costs a round trip. */
it("keeps its window and pays nothing to be reopened", async () => {
  // each window answers for ITSELF here — the payload the view keeps is only
  // the one whose start matches the window on screen
  scheduleCapacity.mockImplementation(async (startISO) =>
    capPayload({ anyDayISO: startISO })
  );
  const { unmount } = await openCapacity();
  await userEvent.click(screen.getByRole("button", { name: "The week after" }));
  await waitFor(() => expect(scheduleCapacity).toHaveBeenCalledWith("2026-08-17"));
  expect(scheduleCapacity).toHaveBeenCalledTimes(2);

  unmount();
  render(<Harness over={{ anchor: "2026-08-17", onAnchor: noop }} />);
  await screen.findByRole("group", { name: "How full each day is" });
  // the window that was open is still the window, out of the board's cache
  expect(screen.getByText("17 Aug – 13 Sept")).toBeInTheDocument();
  expect(scheduleCapacity).toHaveBeenCalledTimes(2);
});

/* Reachable cold now that it is its own tab: no mirror, no grid, and the
   reason said in words rather than four weeks of empty cells. */
it("explains the ServiceM8 gap instead of scoring an account with no mirror", async () => {
  render(<Harness over={{ connected: false }} />);
  expect(await screen.findByText("The diary lives in ServiceM8")).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "How full each day is" })).not.toBeInTheDocument();
  expect(scheduleCapacity).not.toHaveBeenCalled();
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

it("marks a day past its capacity as over: the gauge brims in danger, in words too", async () => {
  await openCapacity();
  const fri = screen.getByRole("button", { name: /Fri 14 Aug/ });
  expect(fri).toHaveClass("over");
  expect(fri).toHaveAccessibleName(/over capacity/);
  expect(within(fri).getByText("113%")).toBeInTheDocument();
  expect(within(fri).getByText("Over")).toBeInTheDocument();
  // the gauge is full and wears the danger fill; the figure goes white on it
  expect(fri.style.getPropertyValue("--caplevel")).toBe("100%");
  expect(fri.style.getPropertyValue("--capfill")).toBe("rgb(224, 38, 79)");
  expect(fri.style.getPropertyValue("--capink")).toBe("rgb(255, 255, 255)");
});

it("draws the gauge from the day's own fill — the level is the percentage", async () => {
  await openCapacity();
  const mon = screen.getByRole("button", { name: /Mon 17 Aug/ });
  expect(mon.style.getPropertyValue("--caplevel")).toBe("25%");
  // a quarter-full gauge sits below the figure, so the figure stays dark
  expect(mon.style.getPropertyValue("--capink")).toBe("rgb(10, 11, 16)");
  expect(mon.style.getPropertyValue("--capfill")).toBe(capacityCellPaint(25, false).fill);
});

it("opens a day into its jobs, hours and everyone on them — as a card, not a shelf", async () => {
  await openCapacity();
  // the day is in the board's cache, as it would be after a visit to the rail
  dayCache.current.set(TODAY, dayPayload());
  const fri = screen.getByRole("button", { name: /Fri 14 Aug/ });
  await userEvent.click(fri);

  // the panel reads a day the RAIL had already read — one cache, two tabs
  expect(scheduleDay).not.toHaveBeenCalled();
  const dayCard = await screen.findByRole("dialog", { name: /Jobs on Fri 14 Aug/ });
  // a card over a scrim is a dialog the keyboard is IN — not a panel in flow
  expect(dayCard).toHaveFocus();
  expect(within(dayCard).getByText("2 jobs · 18h")).toBeInTheDocument();
  expect(within(dayCard).getByText("Girgis, Katrina")).toBeInTheDocument();
  expect(within(dayCard).getByText("3171")).toBeInTheDocument();
  expect(within(dayCard).getByText("8h")).toBeInTheDocument();
  expect(within(dayCard).getByText("Rifkin, Julian")).toBeInTheDocument();
  expect(within(dayCard).getByText("10h")).toBeInTheDocument();
  // the crew job names EVERYONE on it
  expect(within(dayCard).getByText("Alex Lorenz, David Hann")).toBeInTheDocument();
  expect(within(dayCard).getByText("Install · Enmore")).toBeInTheDocument();

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

/* A row in the day is the block it would be on the rail, and it opens the
   SAME card the rail's blocks open — one law for what a booking is doing.
   The day steps back while that card is up rather than stacking under it:
   two scrims is two blurs, and the page gets one. */
it("brings a job forward out of the day, in the rail's own card", async () => {
  const onOpenJob = jest.fn();
  await openCapacity({ onOpenJob });
  await userEvent.click(screen.getByRole("button", { name: /Fri 14 Aug/ }));
  const dayCard = await screen.findByRole("dialog", { name: /Jobs on Fri 14 Aug/ });

  // the row wears its category's paint — the cap the rail draws, same hue
  const row = within(dayCard).getByRole("button", { name: /Rifkin, Julian/ });
  expect(row.style.getPropertyValue("--bar")).toBe(scheduleBlockPaint("#e7b5ff").bar);
  expect(row.style.getPropertyValue("--fill")).toBe(scheduleBlockPaint("#e7b5ff").fill);

  await userEvent.click(row);
  // the day is gone and the job is on the table, with everyone on it
  expect(screen.queryByRole("dialog", { name: /Jobs on Fri 14 Aug/ })).not.toBeInTheDocument();
  expect(screen.getByText("2 people on this job")).toBeInTheDocument();
  // a card each, in the paint their block wears, with the hours they hold
  const card = screen.getByRole("dialog", { name: /Rifkin, Julian/ });
  expect(
    [...card.querySelectorAll(".wb2-scfcard")].map((c) => c.textContent)
  ).toEqual(["Alex Lorenz3pm–4pm", "David Hann7am–4pm"]);

  // "Back to the day" is literally that, and focus lands on the row it left
  await userEvent.click(screen.getByRole("button", { name: "Back to the day" }));
  const backCard = await screen.findByRole("dialog", { name: /Jobs on Fri 14 Aug/ });
  await waitFor(() =>
    expect(within(backCard).getByRole("button", { name: /Rifkin, Julian/ })).toHaveFocus()
  );

  // and Open job hands the sheet the job, leaving nothing on top of it
  await userEvent.click(within(backCard).getByRole("button", { name: /Rifkin, Julian/ }));
  await userEvent.click(screen.getByRole("button", { name: /Open job/ }));
  expect(onOpenJob).toHaveBeenCalledWith(expect.objectContaining({ remoteId: "j-3145" }), null);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
   The cell is a GAUGE now (Isaac, 2026-08-24) and this REVERSED the old
   ramp on purpose: green when there's room, red as the day runs out — the
   previous design pinned green-at-full ("a full day is revenue"), and this
   sweep replaces that pin deliberately. The figure's ground moves with the
   gauge, so its ink is measured against the ground it actually sits on:
   white below the waterline, the fill above it — the sweep that caught a
   purple at 6.12:1 and a yellow-green at 2.22:1 at the SAME lightness. */
it("holds the figure's ink to 4.5:1 against the ground the gauge puts under it", () => {
  const white: [number, number, number] = [255, 255, 255];
  let worst = Infinity;
  for (let pct = 0; pct <= 100; pct += 1) {
    const p = capacityCellPaint(pct, false);
    const ground = p.level >= 55 ? rgb(p.fill) : white;
    worst = Math.min(worst, contrastRatio(rgb(p.ink), ground));
    // the date label at the brim: once the paint claims an ink for it, that
    // ink must read on the fill it sits on
    if (p.dateInk !== null) {
      worst = Math.min(worst, contrastRatio(rgb(p.dateInk), rgb(p.fill)));
    }
  }
  expect(worst).toBeGreaterThanOrEqual(4.5);
  // over: a brimful danger gauge with a white figure that still reads
  const over = capacityCellPaint(113, true);
  expect(over.level).toBe(100);
  expect(contrastRatio(rgb(over.ink), rgb(over.fill))).toBeGreaterThanOrEqual(4.5);
  // and the DIRECTION is the tank's: room is green, running out is red
  const [r0, g0] = rgb(capacityCellPaint(0, false).fill);
  expect(g0).toBeGreaterThan(r0);
  const [r100, g100] = rgb(capacityCellPaint(100, false).fill);
  expect(r100).toBeGreaterThan(g100);
});
