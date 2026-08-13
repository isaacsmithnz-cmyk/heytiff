/* The third side: the whole book of work, organised ServiceM8's way.

   What matters here is that the union holds on screen — a tracked job appears
   once wearing a chip, an untracked one appears once plainly — that money
   obeys the grant, and that an empty panel says WHY it's empty rather than
   one sentence for three different situations. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AllJobsData } from "@/lib/workboard/all-jobs-query";
import type { BoardVisit } from "@/lib/workboard/board-query";
import type { BoardProject, ProjectBoardVisit } from "@/lib/workboard/projects-board-query";
import { jobMoneyOf } from "@/lib/workboard/job-money";

const searchAllJobs = jest.fn(async () => []);
const readMirrorJob = jest.fn(async () => null);
const readJobFiles = jest.fn(async () => null);
const createProjectFromJob = jest.fn(async () => ({ ok: true as const, id: "p-new" }));
jest.mock("@/app/actions/workboard", () => ({
  searchAllJobs: (...a: unknown[]) => searchAllJobs(...(a as [])),
  readMirrorJob: (...a: unknown[]) => readMirrorJob(...(a as [])),
  readJobFiles: (...a: unknown[]) => readJobFiles(...(a as [])),
  createProjectFromJob: (...a: unknown[]) => createProjectFromJob(...(a as [])),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));
jest.mock("../new-agreement-modal", () => ({
  NewAgreementModal: (p: { initialJob?: { jobNumber: string | null } | null }) => (
    <div data-testid="agmodal">{p.initialJob?.jobNumber ?? "none"}</div>
  ),
}));

import { AllJobsBoard } from "../all-jobs-board";

const TODAY = "2026-08-12";

const mirrorJob = (over: Record<string, unknown> & { remoteId: string }) => ({
  jobNumber: "2214",
  status: "Work Order",
  clientName: "Ardex Logistics",
  description: "Cool room door heater tape failed",
  suburb: "Mascot",
  categoryName: "Service Call",
  categoryColour: null,
  date: "2026-08-08 09:00:00",
  quoteDate: null,
  completionDate: null,
  nextBooking: null,
  money: null,
  ...over,
});

const data = (over: Partial<AllJobsData> = {}): AllJobsData => ({
  jobs: [],
  truncated: false,
  projectLinks: [],
  ...over,
});

const visitFix = (over: Partial<BoardVisit> & { id: string }) =>
  ({
    agreementId: "a-1",
    label: "Quarterly service",
    clientName: "Kingsford Medical Centre",
    siteLabel: "Kingsford",
    intervalMonths: 3,
    techsNeeded: 1,
    hoursEstimate: null,
    accessNotes: null,
    category: null,
    tags: [],
    packing: [],
    dueDate: "2026-08-20",
    bookedDate: null,
    status: "upcoming",
    readiness: {},
    techs: [],
    packedIds: [],
    jobNo: 1004,
    jobNumber: null,
    provider: null,
    remoteId: null,
    bookedStart: null,
    mirrorStatus: null,
    warn: false,
    notes: null,
    completedAt: null,
    completedSource: null,
    actualHours: null,
    completionNote: null,
    invoicedAt: null,
    ...over,
  }) as unknown as BoardVisit;

const projectFix = (over: Partial<BoardProject> & { id: string }) =>
  ({
    name: "Belmont change-over",
    clientName: "Belmont",
    siteLabel: "Belmont",
    siteAddress: null,
    stage: "Pre-install",
    status: "active",
    blockedReason: null,
    blockedOn: null,
    blockedAt: null,
    budgetCents: null,
    budgetSource: null,
    hoursBudget: null,
    promisedFinish: null,
    defectsEnd: null,
    designId: null,
    notes: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    checklist: [],
    progress: { done: 0, total: 0, percent: 0 },
    equipmentCount: 0,
    scopeCounts: { inclusions: 0, exclusions: 0 },
    hoursLogged: 0,
    milestones: [],
    jobs: [],
    ...over,
  }) as unknown as BoardProject;

const onOpenTracked = jest.fn();

function mount(over: {
  data?: AllJobsData;
  visits?: BoardVisit[];
  projects?: BoardProject[];
  projectVisits?: ProjectBoardVisit[];
  manage?: boolean;
  moneyVisible?: boolean;
  connected?: boolean;
} = {}) {
  return render(
    <AllJobsBoard
      data={over.data ?? data()}
      visits={over.visits ?? []}
      projectVisits={over.projectVisits ?? []}
      projects={over.projects ?? []}
      agreements={[]}
      categories={[]}
      today={TODAY}
      manage={over.manage ?? true}
      moneyVisible={over.moneyVisible ?? false}
      connected={over.connected ?? true}
      onOpenTracked={onOpenTracked}
    />
  );
}

const toTab = (name: string) => userEvent.click(screen.getByRole("tab", { name }));
const rows = () => [...document.querySelectorAll(".wb2-ajr")];

beforeEach(() => {
  onOpenTracked.mockClear();
  searchAllJobs.mockClear();
  readMirrorJob.mockClear();
});

describe("the shell", () => {
  it("runs ServiceM8's own three lanes, in its order", () => {
    mount();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Work orders",
      "Quotes",
      "Completed",
    ]);
  });

  /* The badge on the switcher means "this many need you". A book total is a
     different kind of number, so this side deliberately has none — and the
     tabs stay label-only like both boards beside it. */
  it("puts no count on any tab", () => {
    mount({ data: data({ jobs: [mirrorJob({ remoteId: "j-1" })] }) });
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.textContent).not.toMatch(/\d/);
    }
  });
});

describe("work orders", () => {
  it("splits booked from waiting, and says so in the head", () => {
    mount({
      data: data({
        jobs: [
          mirrorJob({ remoteId: "booked", nextBooking: "2026-08-14 07:30:00" }),
          mirrorJob({ remoteId: "waiting" }),
        ],
      }),
    });
    expect(screen.getByText("2 jobs on — 1 booked, 1 waiting on a day")).toBeInTheDocument();
    expect(screen.getByText("Booked in")).toBeInTheDocument();
    expect(screen.getByText("Waiting on a day")).toBeInTheDocument();
    expect(rows()).toHaveLength(2);
  });

  it("labels whose number a row wears", () => {
    mount({
      data: data({ jobs: [mirrorJob({ remoteId: "j-1", jobNumber: "2214" })] }),
      visits: [visitFix({ id: "v-1", jobNo: 1004 })],
    });
    const text = document.body.textContent ?? "";
    expect(text).toContain("#2214");
    expect(text).toContain("ServiceM8");
    expect(text).toContain("#1004");
    expect(text).toContain("HeyTiff");
  });

  it("shows a tracked job once, wearing what tracks it", () => {
    mount({
      data: data({ jobs: [mirrorJob({ remoteId: "j-1" })] }),
      visits: [visitFix({ id: "v-1", remoteId: "j-1", jobNo: 1004 })],
    });
    expect(rows()).toHaveLength(1);
    expect(screen.getByText("On the board #1004")).toBeInTheDocument();
  });

  it("names the project when a project is what tracks it", () => {
    mount({
      data: data({
        jobs: [mirrorJob({ remoteId: "j-1" })],
        projectLinks: [{ remoteId: "j-1", projectId: "p-1" }],
      }),
      projects: [projectFix({ id: "p-1" })],
    });
    expect(rows()).toHaveLength(1);
    expect(screen.getByText("Project — Belmont change-over")).toBeInTheDocument();
  });

  it("says out loud when the list is capped", () => {
    mount({ data: data({ jobs: [mirrorJob({ remoteId: "j-1" })], truncated: true }) });
    expect(screen.getByText(/Showing the newest jobs/)).toBeInTheDocument();
  });
});

describe("quotes", () => {
  it("lists what's out awaiting an answer", async () => {
    mount({
      data: data({
        jobs: [
          mirrorJob({
            remoteId: "q-1",
            status: "Quote",
            quoteDate: "2026-08-05 00:00:00",
            clientName: "Strathfield Dental",
          }),
        ],
      }),
    });
    await toTab("Quotes");
    expect(screen.getByText("1 quote awaiting an answer")).toBeInTheDocument();
    expect(screen.getByText("Strathfield Dental")).toBeInTheDocument();
  });

  /* An unsent quote is an action gap, not a wait — the chip must say which of
     the two a row is, and only to a reader who holds money (the flags ride
     the money columns). */
  it("splits sent from unsent for a money reader, and says nothing without", async () => {
    const quotes = data({
      jobs: [
        mirrorJob({
          remoteId: "q-sent",
          status: "Quote",
          quoteDate: "2026-08-05 00:00:00",
          clientName: "Strathfield Dental",
          money: jobMoneyOf({ quote_sent: 1, quote_sent_stamp: "2026-08-05 10:00:00" }),
        }),
        mirrorJob({
          remoteId: "q-quiet",
          status: "Quote",
          quoteDate: "2026-08-06 00:00:00",
          clientName: "Bradfield Badgerfield",
          money: jobMoneyOf({ quote_sent: 0 }),
        }),
      ],
    });
    const first = mount({ data: quotes, moneyVisible: true });
    await toTab("Quotes");
    expect(screen.getByText("Quote sent")).toBeInTheDocument();
    expect(screen.getByText("Not sent yet")).toBeInTheDocument();
    first.unmount();

    mount({ data: quotes, moneyVisible: false });
    await toTab("Quotes");
    expect(screen.queryByText("Quote sent")).toBeNull();
    expect(screen.queryByText("Not sent yet")).toBeNull();
  });
});

describe("completed", () => {
  const done = data({
    jobs: [
      mirrorJob({ remoteId: "c-1", status: "Completed", completionDate: "2026-08-01 00:00:00" }),
      mirrorJob({ remoteId: "u-1", status: "Unsuccessful", completionDate: "2026-07-30 00:00:00" }),
    ],
  });

  it("folds the ones that didn't go ahead behind a toggle", async () => {
    mount({ data: done });
    await toTab("Completed");
    expect(rows()).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: /Show 1 that did not go ahead/ }));
    expect(rows()).toHaveLength(2);
  });

  it("counts what's invoiced and still owed, for a reader who may see money", async () => {
    mount({
      moneyVisible: true,
      data: data({
        jobs: [
          mirrorJob({
            remoteId: "c-1",
            status: "Completed",
            completionDate: "2026-08-01 00:00:00",
            money: jobMoneyOf({ total_invoice_amount: "3960.00", invoice_sent: 1 }),
          }),
        ],
      }),
    });
    await toTab("Completed");
    expect(screen.getByText(/1 of these is invoiced and still awaiting payment/)).toBeInTheDocument();
    expect(screen.getByText("Awaiting payment")).toBeInTheDocument();
  });
});

describe("money obeys the grant", () => {
  const withValue = data({
    jobs: [
      mirrorJob({
        remoteId: "j-1",
        money: jobMoneyOf({ total_invoice_amount: "640.00" }),
      }),
    ],
  });

  it("shows the value when the reader holds it", () => {
    mount({ data: withValue, moneyVisible: true });
    expect(screen.getByText("$640")).toBeInTheDocument();
  });

  it("shows no dollars at all when they don't", () => {
    mount({ data: withValue, moneyVisible: false });
    expect(document.body.textContent).not.toMatch(/\$/);
    expect(document.querySelector(".wb2-ajmoney")).not.toBeInTheDocument();
  });
});

describe("empty says WHY", () => {
  it("invites connecting ServiceM8 when standalone", () => {
    mount({ connected: false });
    expect(screen.getByText("Showing the work tracked here")).toBeInTheDocument();
  });

  it("says nothing is on when connected and genuinely empty", () => {
    mount({ connected: true });
    expect(screen.getByText("Nothing on")).toBeInTheDocument();
  });

  it("says nothing matches when a search found nothing", async () => {
    mount({ data: data({ jobs: [mirrorJob({ remoteId: "j-1" })] }) });
    await userEvent.type(screen.getByLabelText("Search all jobs"), "zzzz");
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
  });
});

describe("search", () => {
  it("filters what's loaded and asks the server for the rest", async () => {
    mount({
      data: data({
        jobs: [
          mirrorJob({ remoteId: "a", clientName: "Ardex Logistics" }),
          mirrorJob({ remoteId: "b", clientName: "Hearth Cafe" }),
        ],
      }),
    });
    await userEvent.type(screen.getByLabelText("Search all jobs"), "ardex");
    expect(rows()).toHaveLength(1);
    expect(searchAllJobs).toHaveBeenCalledWith("ardex");
  });

  /* One character is not a search — it's a keystroke on the way to one, and
     firing the whole mirror at it would be a query per letter. */
  it("doesn't ask the server for a single character", async () => {
    mount();
    await userEvent.type(screen.getByLabelText("Search all jobs"), "a");
    expect(searchAllJobs).not.toHaveBeenCalled();
  });
});

describe("opening a row", () => {
  it("opens the sheet for a ServiceM8 job", async () => {
    mount({ data: data({ jobs: [mirrorJob({ remoteId: "j-1" })] }) });
    await userEvent.click(rows()[0]);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(readMirrorJob).toHaveBeenCalledWith("j-1");
  });

  /* A native row already has a home. Sending it to a viewer that knows less
     than the board it came from would be a worse answer than the handoff. */
  it("sends a native row to the board that owns it, without a sheet", async () => {
    mount({ visits: [visitFix({ id: "v-1" })] });
    await userEvent.click(rows()[0]);
    expect(onOpenTracked).toHaveBeenCalledWith({ kind: "visit", id: "v-1" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("promotion", () => {
  it("offers both ways out of a job, to a manager", async () => {
    mount({ data: data({ jobs: [mirrorJob({ remoteId: "j-1" })] }), manage: true });
    await userEvent.click(rows()[0]);
    const sheet = await screen.findByRole("dialog");
    expect(
      within(sheet).getByRole("button", { name: /Create a project from this job/ })
    ).toBeInTheDocument();
    expect(
      within(sheet).getByRole("button", { name: /Create a maintenance agreement/ })
    ).toBeInTheDocument();
  });

  it("offers neither to someone who can't manage the board", async () => {
    mount({ data: data({ jobs: [mirrorJob({ remoteId: "j-1" })] }), manage: false });
    await userEvent.click(rows()[0]);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).queryByRole("button", { name: /Create a project/ })).not.toBeInTheDocument();
    expect(
      within(sheet).queryByRole("button", { name: /Create a maintenance agreement/ })
    ).not.toBeInTheDocument();
  });

  it("names the project before creating it, then calls with that name", async () => {
    mount({ data: data({ jobs: [mirrorJob({ remoteId: "j-1" })] }) });
    await userEvent.click(rows()[0]);
    const sheet = await screen.findByRole("dialog");
    await userEvent.click(
      within(sheet).getByRole("button", { name: /Create a project from this job/ })
    );
    const field = within(sheet).getByLabelText("Name the project");
    await userEvent.clear(field);
    await userEvent.type(field, "Ardex cool room");
    await userEvent.click(within(sheet).getByRole("button", { name: /Create it/ }));

    expect(createProjectFromJob).toHaveBeenCalledWith(
      "j-1",
      expect.objectContaining({ name: "Ardex cool room", clientName: "Ardex Logistics" })
    );
  });

  it("hands the job straight to the agreement modal, pre-picked", async () => {
    mount({ data: data({ jobs: [mirrorJob({ remoteId: "j-1", jobNumber: "2214" })] }) });
    await userEvent.click(rows()[0]);
    const sheet = await screen.findByRole("dialog");
    await userEvent.click(
      within(sheet).getByRole("button", { name: /Create a maintenance agreement/ })
    );
    expect(await screen.findByTestId("agmodal")).toHaveTextContent("2214");
  });
});
