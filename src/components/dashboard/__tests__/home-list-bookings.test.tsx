import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeList } from "../home-list";
import { DeskJobHost, useDeskJobs, type OpenJobOptions } from "../home-job-sheet";
import { placeList, type ListCaps, type ListInput } from "@/lib/dashboard/home-list";
import type { AllJobRow, AllJobsMirrorJob } from "@/lib/workboard/all-jobs";

/* HOME'S BOOKING DOORS, ON SCREEN (two-way phase 3, PR E).

   E-1: where bookings are offered, a won job's Book in opens Home's one
   card on its Visits face with Book in's panel open — not the Schedule.
   E-3: a leftover's Clear opens the card with that booking's confirm.
   E-11: the host passes both on to its one JobSheet, and never opens two.

   The card is the board's, stubbed as a window that prints what it was
   opened with, and counts how often it was mounted. */
let mounts = 0;
jest.mock("@/components/workboard/board/job-sheet", () => {
  const { useEffect } = jest.requireActual<typeof import("react")>("react");
  return {
    JobSheet: (p: {
      row: { id: string; number: string | null };
      initialTab?: string;
      openBookIn?: true;
      openClear?: string;
      onClose: () => void;
    }) => {
      useEffect(() => {
        mounts += 1;
      }, []);
      return (
        <div role="dialog" aria-label={`Job ${p.row.number ?? ""}`}>
          tab:{p.initialTab ?? "summary"}, bookIn:{String(p.openBookIn ?? "none")}, clear:{p.openClear ?? "none"}
          <button onClick={p.onClose}>Close the card</button>
        </div>
      );
    },
  };
});
const mockRouter = { refresh: jest.fn(), push: jest.fn() };
jest.mock("next/navigation", () => ({ useRouter: () => mockRouter }));
const mockOpenMirrorJob = jest.fn();
jest.mock("@/app/actions/workboard", () => ({ openMirrorJob: (id: string) => mockOpenMirrorJob(id) }));
jest.mock("@/app/actions/dashboard", () => ({
  completeTask: jest.fn(),
  reopenTask: jest.fn(),
  resolveIssue: jest.fn(),
  reopenIssue: jest.fn(),
}));
jest.mock("@/app/actions/workboard-maintenance", () => ({ placeVisit: jest.fn(), clearVisitPlacement: jest.fn() }));

const DAY = "2026-09-25";
const JOB = "0b1e0b1e-0000-4000-8000-00000000a001";
const DONE = "0b1e0b1e-0000-4000-8000-00000000a002";
const ACT = "7e7e7e7e-0000-4000-8000-00000000a003";
const MAIN: ListCaps = { assetsAll: false, placeVisits: true, money: false, sm8: true };

const job: AllJobsMirrorJob = {
  remoteId: JOB,
  jobNumber: "3342",
  status: "Work Order",
  clientName: "Test Strata",
  description: null,
  suburb: "Testville",
  categoryName: null,
  categoryColour: null,
  date: "2026-09-20 09:00:00",
  quoteDate: null,
  completionDate: null,
  nextBooking: null,
  money: null,
  paidCents: 0,
};

const place = (over: Partial<ListInput> = {}) =>
  placeList({
    day: DAY,
    tz: "Australia/Sydney",
    warnDays: 30,
    viewerStaffId: "me",
    names: {},
    tasks: [],
    journal: [],
    chips: [],
    issues: [],
    wins: [{ job, wonOn: "2026-09-24" }],
    visits: [],
    caps: MAIN,
    ...over,
  });

const draw = (list: ReturnType<typeof place>) =>
  render(
    <DeskJobHost manage moneyVisible={false}>
      <HomeList list={list} onShow={jest.fn()} />
    </DeskJobHost>,
  );

const rowOf = (title: string) => screen.getByText(title).closest("li")!;

beforeEach(() => {
  jest.clearAllMocks();
  mounts = 0;
});

describe("E-1: Book in on a won job", () => {
  it("opens the one card on Visits with the panel open, on the row the list carries", async () => {
    const user = userEvent.setup();
    draw(place({ caps: { ...MAIN, bookIn: true } }));
    const row = rowOf("Job 3342, Testville");
    // a press, not a link to the Schedule
    expect(within(row).queryByRole("link", { name: "Book in" })).toBeNull();
    const verb = within(row).getByRole("button", { name: "Book in" });
    await user.click(verb);
    const card = screen.getByRole("dialog", { name: "Job 3342" });
    expect(card.textContent).toContain("tab:visits");
    expect(card.textContent).toContain("bookIn:true");
    expect(card.textContent).toContain("clear:none");
    expect(mockOpenMirrorJob).not.toHaveBeenCalled();
    // closing puts focus back on the verb that opened it
    await user.click(screen.getByRole("button", { name: "Close the card" }));
    expect(document.activeElement).toBe(verb);
  });

  it("is the Schedule's link, as on main, where bookings aren't offered", () => {
    draw(place());
    expect(within(rowOf("Job 3342, Testville")).getByRole("link", { name: "Book in" })).toHaveAttribute(
      "href",
      `/dashboard/workboard?job=${JOB}`,
    );
  });
});

describe("E-3: Clear on a leftover booking", () => {
  it("opens the job's card on Visits with that booking's confirm", async () => {
    const user = userEvent.setup();
    let answer: (row: AllJobRow) => void = () => {};
    mockOpenMirrorJob.mockImplementation(() => new Promise<AllJobRow>((r) => (answer = r)));
    draw(
      place({
        caps: { ...MAIN, bookIn: true },
        wins: [],
        leftovers: [{ activityUuid: ACT, jobUuid: DONE, jobNumber: "3370", jobStatus: "Completed", staffName: "Sam", start: "2026-09-28 08:00:00" }],
      }),
    );
    const row = rowOf("Job 3370 is finished but still booked");
    expect(within(row).getByText("Sam, Mon 28 Sept, 8:00 am.")).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Clear" }));
    // a finished job isn't on the list's rows: the mirror is asked for it
    expect(mockOpenMirrorJob).toHaveBeenCalledWith(DONE);
    await (async () => answer({ id: DONE, number: "3370" } as AllJobRow))();
    const card = await screen.findByRole("dialog", { name: "Job 3370" });
    expect(card.textContent).toContain("tab:visits");
    expect(card.textContent).toContain(`clear:${ACT}`);
    expect(card.textContent).toContain("bookIn:none");
  });
});

function Door({ job: j, opts, label }: { job: AllJobRow | string; opts?: OpenJobOptions; label: string }) {
  const { openJob } = useDeskJobs();
  return <button onClick={() => openJob(j, opts)}>{label}</button>;
}

describe("E-11: the one card host", () => {
  const row = { id: "j1", number: "1042", clientName: "Test Strata" } as AllJobRow;

  it("passes Book in and a Clear on to its one JobSheet, and never opens two", async () => {
    const user = userEvent.setup();
    render(
      <DeskJobHost manage moneyVisible={false}>
        <Door job={row} opts={{ tab: "visits", bookIn: true }} label="Book" />
        <Door job={row} opts={{ tab: "visits", clear: ACT }} label="Clear" />
        <Door job={row} label="Plain" />
      </DeskJobHost>,
    );
    await user.click(screen.getByRole("button", { name: "Book" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog").textContent).toContain("bookIn:true");

    // the same job, asked for a Clear: a fresh card on what it came for
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog").textContent).toContain(`clear:${ACT}`);
    expect(screen.getByRole("dialog").textContent).toContain("bookIn:none");
    expect(mounts).toBe(2);
  });

  it("opens on Visits whatever face the door named, when it came to book", async () => {
    const user = userEvent.setup();
    render(
      <DeskJobHost manage moneyVisible={false}>
        <Door job={row} opts={{ tab: "diary", bookIn: true }} label="Book" />
      </DeskJobHost>,
    );
    await user.click(screen.getByRole("button", { name: "Book" }));
    expect(screen.getByRole("dialog").textContent).toContain("tab:visits");
  });

  it("gives a door with neither exactly main's card: no booking props, keyed by the job", async () => {
    const user = userEvent.setup();
    render(
      <DeskJobHost manage moneyVisible={false}>
        <Door job={row} opts={{ tab: "diary" }} label="Plain" />
        <Door job={row} label="Again" />
      </DeskJobHost>,
    );
    await user.click(screen.getByRole("button", { name: "Plain" }));
    expect(screen.getByRole("dialog").textContent).toContain("tab:diary, bookIn:none, clear:none");
    // the same job again refills the one card, as on main
    await user.click(screen.getByRole("button", { name: "Again" }));
    expect(mounts).toBe(1);
  });
});
