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
  // both techs have clocked on against their own bookings — the ordinary day
  onSite: ["j-3171|s-lorenz", "j-3145|s-hann", "j-3145|s-lorenz"],
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

/* ── filled or hollow ──
   Three gates guard this, and the wrong hollow block is worse than none. */
describe("nobody has started it", () => {
  const idle = () =>
    screen.getAllByRole("button", { name: /Open job #/ }).filter((b) =>
      b.classList.contains("idle")
    );

  it("hollows the booking nobody has clocked on to", async () => {
    // Hann's booking on #3145 has no recorded time; everything else does
    scheduleDay.mockResolvedValue({ ...payload(), onSite: ["j-3171|s-lorenz", "j-3145|s-lorenz"] });
    render(tab());
    await screen.findByText("Alex Lorenz");
    expect(idle()).toHaveLength(1);
    // and it is spoken, not left to the outline — a ring reaches nobody on a
    // screen reader
    expect(
      screen.getByRole("button", { name: /Open job #3145.*not started/ })
    ).toBeInTheDocument();
    expect(screen.getByText("Not started")).toBeInTheDocument();
  });

  it("only calls it late once the start has actually gone", async () => {
    // lateness is read off the BROWSER's clock, and only when that clock
    // agrees with the board's date — the same rule the now line follows.
    // Midday on the fixture's day: the 7am booking should have started.
    jest.useFakeTimers({ now: new Date(2026, 7, 14, 12, 0, 0) });
    try {
      scheduleDay.mockResolvedValue({ ...payload(), onSite: ["j-3171|s-lorenz"] });
      render(tab());
      await screen.findByText("Alex Lorenz");
      // the 7am booking should have started hours ago and has nothing on it
      expect(
        screen.getByRole("button", { name: /Open job #3145.*7am to 4pm.*nothing recorded yet/ })
      ).toHaveClass("late");
      // the 3pm one is simply not due yet — hollow, but not an accusation
      const later = screen.getByRole("button", { name: /Open job #3145.*3pm to 4pm/ });
      expect(later).toHaveClass("idle");
      expect(later).not.toHaveClass("late");
      expect(later).toHaveAccessibleName(/not started/);
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not claim lateness when the viewer's clock is on another date", async () => {
    // an overseas viewer: no mark beats one that is hours wrong, so the block
    // is hollow but never accused
    scheduleDay.mockResolvedValue({ ...payload(), onSite: ["j-3171|s-lorenz"] });
    render(tab());
    await screen.findByText("Alex Lorenz");
    expect(idle().every((b) => !b.classList.contains("late"))).toBe(true);
  });

  it("stays filled for an account that never clocks on", async () => {
    // no recorded time anywhere: a crew that marks jobs complete and moves on.
    // Hollowing every block would be a screenful of alarm about nothing.
    scheduleDay.mockResolvedValue({ ...payload(), onSite: [] });
    render(tab());
    await screen.findByText("Alex Lorenz");
    expect(idle()).toHaveLength(0);
    expect(screen.queryByText("Not started")).not.toBeInTheDocument();
  });

  it("stays filled on a day that has not begun", async () => {
    // nothing ahead of us is started yet by definition. The payload is keyed
    // to the day asked for — the component only draws one that matches.
    scheduleDay.mockImplementation(async (dayISO: string) => ({
      ...payload(),
      dayISO,
      onSite: dayISO === TODAY ? ["j-3171|s-lorenz"] : [],
    }));
    render(tab());
    await screen.findByText("Alex Lorenz");
    // #3145 is booked twice today and neither booking has recorded time
    expect(idle()).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "The day after" }));
    await screen.findByText("Alex Lorenz");
    expect(idle()).toHaveLength(0); // tomorrow, nothing is "not started" yet
  });

  it("never hollows work that is already closed off", async () => {
    const p = payload();
    scheduleDay.mockResolvedValue({
      ...p,
      // one job done, one that didn't go ahead — neither is "not started",
      // and both would otherwise qualify on having no recorded time
      jobs: [
        { ...p.jobs[0], status: "Completed" },
        { ...p.jobs[1], status: "Unsuccessful" },
      ],
      onSite: ["j-3145|s-lorenz"],
    });
    render(tab());
    await screen.findByText("Alex Lorenz");
    expect(idle()).toHaveLength(0);
  });
});

/* ── ServiceM8 marks LATER bookings complete too ──
   Completing a job for the day closes every booking it draws, including ones
   on days that have not happened. The crew still turn up. */
describe("a job closed before this booking's day", () => {
  it("keeps its colour and says so, rather than fading out", async () => {
    const p = payload();
    scheduleDay.mockResolvedValue({
      ...p,
      jobs: p.jobs.map((j) =>
        j.remoteId === "j-3145"
          ? { ...j, status: "Completed", completionDate: `2026-08-11 16:00:00` }
          : j
      ),
    });
    render(tab());
    await screen.findByText("Alex Lorenz");
    const stale = screen.getAllByRole("button", { name: /Open job #3145/ });
    for (const b of stale) {
      // still on somebody's run, so it must not recede like finished work
      expect(b).toHaveClass("stale");
      expect(b).not.toHaveClass("done");
    }
    // and it is words, not just an amber ring
    expect(screen.getAllByText(/Job closed/).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: /Open job #3145.*7am to 4pm.*job already closed/ })
    ).toBeInTheDocument();
    expect(screen.getByText("Job closed, still booked")).toBeInTheDocument();
  });

  it("still fades a booking the completion actually covers", async () => {
    const p = payload();
    scheduleDay.mockResolvedValue({
      ...p,
      jobs: p.jobs.map((j) =>
        j.remoteId === "j-3145"
          ? { ...j, status: "Completed", completionDate: `${TODAY} 17:00:00` }
          : j
      ),
    });
    render(tab());
    await screen.findByText("Alex Lorenz");
    for (const b of screen.getAllByRole("button", { name: /Open job #3145/ })) {
      expect(b).toHaveClass("done");
      expect(b).not.toHaveClass("stale");
    }
    expect(screen.queryByText("Job closed, still booked")).not.toBeInTheDocument();
  });

  it("does not accuse a job whose completion date never synced", async () => {
    const p = payload();
    scheduleDay.mockResolvedValue({
      ...p,
      jobs: p.jobs.map((j) =>
        j.remoteId === "j-3145" ? { ...j, status: "Completed", completionDate: null } : j
      ),
    });
    render(tab());
    await screen.findByText("Alex Lorenz");
    for (const b of screen.getAllByRole("button", { name: /Open job #3145/ })) {
      expect(b).not.toHaveClass("stale");
    }
  });
});

describe("the presence dot", () => {
  const dotFor = (name: string) =>
    screen.getByText(name).closest("b")!.querySelector(".wb2-schpd");

  it("says who has started, in a word as well as a colour", async () => {
    // Lorenz has recorded time; Hann has not, and his 7am booking has gone
    jest.useFakeTimers({ now: new Date(2026, 7, 14, 12, 0, 0) });
    try {
      scheduleDay.mockResolvedValue({ ...payload(), onSite: ["j-3171|s-lorenz"] });
      render(tab());
      await screen.findByText("Alex Lorenz");
      expect(dotFor("Alex Lorenz")).toHaveClass("on");
      expect(dotFor("David Hann")).toHaveClass("late");
      // the colour is never carrying it alone
      expect(screen.getByText("Alex Lorenz").closest("b")).toHaveTextContent("started");
      expect(screen.getByText("David Hann").closest("b")).toHaveTextContent(
        "nothing recorded yet"
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("shows nothing for an account that never clocks on", async () => {
    // the same gate the hollow blocks use — no recorded time anywhere means
    // this reading does not exist, not that everybody is idle
    scheduleDay.mockResolvedValue({ ...payload(), onSite: [] });
    render(tab());
    await screen.findByText("Alex Lorenz");
    expect(dotFor("Alex Lorenz")).toBeNull();
    expect(dotFor("David Hann")).toBeNull();
  });
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
