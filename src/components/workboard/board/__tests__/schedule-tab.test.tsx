/* The Schedule tab — the fourth side's screen behaviour. The layout law is
   pinned in lib/workboard/__tests__/schedule.test.ts; what matters HERE is
   the wiring: a day is fetched once and cached, a block opens the job it
   names, empty states say why they're empty, and the queue link goes to the
   tab that owns the queue. */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SchedulePayload } from "@/lib/workboard/schedule-query";

const scheduleDay = jest.fn<Promise<SchedulePayload>, [string]>();
jest.mock("@/app/actions/workboard", () => ({
  scheduleDay: (...a: [string]) => scheduleDay(...a),
}));

import { ScheduleTab } from "../schedule-tab";
import { contrastRatio } from "@/lib/workboard/schedule-colour";

/** "rgb(1, 2, 3)" → channels, so a test can measure what actually shipped. */
const rgb = (value: string): [number, number, number] => {
  const m = value.match(/\d+/g);
  if (!m || m.length < 3) throw new Error(`not an rgb() colour: "${value}"`);
  return [Number(m[0]), Number(m[1]), Number(m[2])];
};

const TODAY = "2026-08-14";

const payload = (over: Partial<SchedulePayload> = {}): SchedulePayload => ({
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
  weekCounts: { [TODAY]: 3, "2026-08-15": 6, "2026-08-16": 0 },
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

beforeEach(() => {
  scheduleDay.mockReset();
  scheduleDay.mockResolvedValue(payload());
});

it("fetches today on open and lays out a lane per person", async () => {
  render(tab());
  expect(await screen.findByText("Alex Lorenz")).toBeInTheDocument();
  expect(screen.getByText("David Hann")).toBeInTheDocument();
  expect(scheduleDay).toHaveBeenCalledWith(TODAY);
  // the crew job draws once per person — two blocks carry it, and the CLIENT
  // is what each one leads with, with the job number as a chip beside it
  expect(screen.getAllByText("Rifkin, Julian")).toHaveLength(2);
  expect(screen.getAllByText("3145")).toHaveLength(2);
  // lane load is spoken: Lorenz has 8h + 1h across two bookings
  expect(screen.getByText("2 bookings · 9h")).toBeInTheDocument();
});

it("never writes the time on a block — the rail already says it", async () => {
  render(tab());
  const block = (await screen.findAllByRole("button", { name: /Open job #3171/ }))[0];
  // position carries the when; the card carries who and where only
  expect(block.textContent).not.toMatch(/am|pm/);
  // ...but the hover title still says it in full
  expect(block).toHaveAttribute("title", expect.stringContaining("7am–3pm"));
});

it("opens the job a block names", async () => {
  const onOpenJob = jest.fn();
  render(tab({ onOpenJob }));
  const block = (await screen.findAllByRole("button", { name: /Open job #3171/ }))[0];
  await userEvent.click(block);
  expect(onOpenJob).toHaveBeenCalledWith(expect.objectContaining({ remoteId: "j-3171" }));
});

it("caches a day — stepping back to it asks the server nothing", async () => {
  scheduleDay.mockImplementation(async (day: string) => payload({ dayISO: day }));
  render(tab());
  await screen.findByText("Alex Lorenz");
  expect(scheduleDay).toHaveBeenCalledTimes(1);

  await userEvent.click(screen.getByRole("button", { name: "The day after" }));
  await screen.findByText("Alex Lorenz");
  expect(scheduleDay).toHaveBeenCalledTimes(2);

  await userEvent.click(screen.getByRole("button", { name: "Today" }));
  await screen.findByText("Alex Lorenz");
  expect(scheduleDay).toHaveBeenCalledTimes(2); // today came from the cache
});

it("says why a clear day is clear", async () => {
  scheduleDay.mockResolvedValue(payload({ activities: [], staff: [], jobs: [] }));
  render(tab());
  expect(await screen.findByText("Nobody was dispatched")).toBeInTheDocument();
  expect(screen.getByText(/waiting on a day are under Work orders/)).toBeInTheDocument();
});

it("says the diary lives in ServiceM8 when nothing is connected — and never fetches", () => {
  render(tab({ connected: false }));
  expect(screen.getByText("The diary lives in ServiceM8")).toBeInTheDocument();
  expect(screen.getByText("Connect ServiceM8").closest("a")).toHaveAttribute(
    "href",
    "/dashboard/admin/integrations/servicem8"
  );
  expect(scheduleDay).not.toHaveBeenCalled();
});

/* Half a walk of job_activities is a diary with people MISSING from it, which
   reads as "nobody is on today" — a worse lie than saying nothing yet. So the
   day is not fetched at all while the backfill runs, and the tab says which
   of the two silences this is. */
it("waits out the first backfill instead of drawing a half-built day", () => {
  render(tab({ syncing: true }));
  expect(screen.getByText("Still bringing the diary across")).toBeInTheDocument();
  expect(screen.queryByText("Connect ServiceM8")).not.toBeInTheDocument();
  expect(scheduleDay).not.toHaveBeenCalled();
});

it("hands the queue to the tab that owns it", async () => {
  const onGoWork = jest.fn();
  render(tab({ waitingCount: 500, onGoWork }));
  await screen.findByText("Alex Lorenz");
  await userEvent.click(screen.getByRole("button", { name: /500 work orders are waiting/ }));
  expect(onGoWork).toHaveBeenCalled();
});

it("names the category in words, not only in colour", async () => {
  render(tab());
  await screen.findByText("Alex Lorenz");
  // #3145 is an Install — twice on the rail, plus once in the day's legend.
  // #3171 has no category at all, and the block says that rather than
  // leaving a grey rectangle to be interpreted.
  expect(screen.getAllByText("Install")).toHaveLength(3);
  expect(screen.getAllByText("No category")).toHaveLength(2);
});

it("hands the block a fill and a label colour that measure up", async () => {
  render(tab());
  await screen.findByText("Alex Lorenz");
  const block = screen.getAllByRole("button", { name: /Open job #3145/ })[0];
  const fill = block.style.getPropertyValue("--fill");
  const ink = block.style.getPropertyValue("--btext");
  // the label colour is handed down beside the fill, never left to the
  // cascade to guess — and the pair clears AA, which is the whole promise
  expect(contrastRatio(rgb(fill), rgb(ink))).toBeGreaterThanOrEqual(4.5);
  // and what we draw is not ServiceM8's own wash: #e7b5ff arrives at ~85%
  // lightness, far too pale to carry a word
  expect(fill).not.toBe("rgb(231, 181, 255)");
  expect(contrastRatio(rgb(fill), [231, 181, 255])).toBeGreaterThan(1.5);
});

it("goes pale when the job is closed, rather than fading out", async () => {
  const p = payload();
  scheduleDay.mockResolvedValue({
    ...p,
    jobs: p.jobs.map((j) => ({ ...j, status: "Completed" })),
  });
  render(tab());
  await screen.findByText("Alex Lorenz");
  const block = screen.getAllByRole("button", { name: /Open job #3145/ })[0];
  expect(block).toHaveClass("done");
  // the pale is a STATED colour — the old rule was opacity:.58, which drags
  // every line on the block toward the ground behind it
  expect(block.style.getPropertyValue("--pale")).toMatch(/^rgb\(/);
  expect(block.style.opacity).toBe("");
  // and the day's legend says what pale means, in words
  expect(screen.getByText("Done and closed")).toBeInTheDocument();
});

it("wears the board's word on a tracked block", async () => {
  render(
    tab({
      tracked: new Map([["j-3145", { kind: "project" as const, label: "Enmore install" }]]),
    })
  );
  await screen.findByText("Alex Lorenz");
  // both of the crew job's blocks name the board that owns it, in words —
  // the tracked blue is never the only thing carrying that
  expect(screen.getAllByText("Project")).toHaveLength(2);
  expect(screen.getAllByText("3145")).toHaveLength(2);
  expect(screen.getByText("On a board here")).toBeInTheDocument();
});

it("shows native day-bookings on the shelf and routes their clicks by kind", async () => {
  const onOpenTracked = jest.fn();
  render(
    tab({
      onOpenTracked,
      shelfItems: [
        {
          key: "p-1",
          date: TODAY,
          kind: "project" as const,
          id: "proj-9",
          label: "Project — Enmore install",
          sub: "Rough-in day 1",
        },
        {
          key: "p-2",
          date: "2026-08-15",
          kind: "project" as const,
          id: "proj-9",
          label: "Project — elsewhere",
          sub: null,
        },
      ],
    })
  );
  await screen.findByText("Alex Lorenz");
  // only the open day's shelf shows
  expect(screen.queryByText("Project — elsewhere")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Project — Enmore install/ }));
  expect(onOpenTracked).toHaveBeenCalledWith({ kind: "project", id: "proj-9" });
});
