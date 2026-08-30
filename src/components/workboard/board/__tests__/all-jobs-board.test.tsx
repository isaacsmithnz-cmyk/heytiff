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
const readMirrorJob = jest.fn(async () => ({ detail: null, focusRemoteId: null }));
const readJobFiles = jest.fn(async () => null);
const createProjectFromJob = jest.fn(async () => ({ ok: true as const, id: "p-new" }));
const scheduleDay = jest.fn(async (dayISO: string) => ({
  dayISO,
  activities: [],
  staff: [],
  jobs: [],
  weekCounts: {},
}));
jest.mock("@/app/actions/workboard", () => ({
  searchAllJobs: (...a: unknown[]) => searchAllJobs(...(a as [])),
  readMirrorJob: (...a: unknown[]) => readMirrorJob(...(a as [])),
  readClaim: async () => null,
  readJobFiles: (...a: unknown[]) => readJobFiles(...(a as [])),
  readJobRecord: jest.fn(async () => null),
  createProjectFromJob: (...a: unknown[]) => createProjectFromJob(...(a as [])),
  scheduleDay: (...a: [string]) => scheduleDay(...a),
}));
/* A "use server" module drags next/server into jsdom, where `Request` is
   undefined and the suite dies before a single test runs. */
jest.mock("@/app/actions/workboard-media", () => ({
  cacheJobFiles: jest.fn(async () => ({ ok: true, cached: 0, remaining: 0, media: null, note: null })),
}));
jest.mock("@/app/actions/job-picklist", () => ({
  listJobPicklist: jest.fn(async () => []),
  setPicklistItemPicked: jest.fn(async () => {}),
  removePicklistItem: jest.fn(async () => {}),
}));
jest.mock("@/app/actions/job-photo-favourites", () => ({
  listJobPhotoFavourites: jest.fn(async () => []),
  setJobPhotoFavourite: jest.fn(async () => ({ ok: true, starred: true, note: null })),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));
/* The job card's pen reaches `"use server"` modules through NoteToken, and a
   server-action import pulls `next/cache` — which needs a `Request` global
   jsdom hasn't got. Mocked here so the board's own suite still boots. */
jest.mock("@/app/actions/workboard-notes", () => ({
  routeNote: jest.fn(async () => ({ ok: false, error: "no" })),
  applyNote: jest.fn(async () => ({ ok: true, summary: "" })),
  answerClarify: jest.fn(async () => ({ ok: false, error: "no" })),
  dismissNote: jest.fn(async () => ({ ok: true, summary: "" })),
  keepNoteOnJob: jest.fn(async () => ({ ok: true, summary: "" })),
  keepNoteForMe: jest.fn(async () => ({ ok: true, summary: "" })),
  clearFlag: jest.fn(async () => ({ ok: true, summary: "" })),
  restoreFlag: jest.fn(async () => ({ ok: true, summary: "" })),
}));
jest.mock("@/app/actions/job-notes", () => ({
  addJobNote: jest.fn(async () => ({ id: "our-1", text: "", at: "", author: null })),
  removeJobNote: jest.fn(async () => {}),
  taskFromJobNote: jest.fn(async () => ({ ok: true, taskId: "t" })),
  dismissJobNote: jest.fn(async () => {}),
}));

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
  paidCents: 0,
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
  backfilling?: { jobs: boolean; schedule: boolean };
  tools?: React.ReactNode;
  searchPanel?: React.ReactNode;
  onExitSearch?: () => void;
  openTarget?: React.ComponentProps<typeof AllJobsBoard>["openTarget"];
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
      backfilling={over.backfilling ?? { jobs: false, schedule: false }}
      onOpenTracked={onOpenTracked}
      tools={over.tools}
      searchPanel={over.searchPanel}
      onExitSearch={over.onExitSearch}
      openTarget={over.openTarget ?? null}
    />
  );
}

const toTab = (name: string) => userEvent.click(screen.getByRole("tab", { name }));
const rows = () => [...document.querySelectorAll(".wb2-ajr")];

/* The board lands on Schedule now, so the book-of-work tests walk to their
   panel first — the same click a person makes. */
const mountWork = async (over: Parameters<typeof mount>[0] = {}) => {
  mount(over);
  await toTab("Work orders");
};

beforeEach(() => {
  onOpenTracked.mockClear();
  searchAllJobs.mockClear();
  readMirrorJob.mockClear();
  scheduleDay.mockClear();
});

describe("the shell", () => {
  it("leads with the diary, then ServiceM8's three lanes in its order", () => {
    mount();
    /* Capacity asks the coming weeks a question today's diary can't, so it
       sits after the three lanes. SHOWCASE IS LAST and it is the odd one
       out on purpose: every tab before it is work in flight, and this one
       is the only one that isn't about the present at all — it is what the
       crew kept, to show somebody later. */
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Schedule",
      "Work orders",
      "Quotes",
      "Completed",
      "Capacity",
      "Showcase",
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

  /* The diary is the landing panel, and its fetch fires when the SIDE opens
     — which is this board mounting, not the Workboard page loading. */
  it("lands on Schedule and asks for today, once", async () => {
    mount();
    expect(scheduleDay).toHaveBeenCalledWith(TODAY);
    expect(scheduleDay).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Nobody was dispatched")).toBeInTheDocument();
  });
});

describe("work orders", () => {
  it("splits booked from waiting, and says so in the head", async () => {
    await mountWork({
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

  it("labels whose number a row wears", async () => {
    await mountWork({
      data: data({ jobs: [mirrorJob({ remoteId: "j-1", jobNumber: "2214" })] }),
      visits: [visitFix({ id: "v-1", jobNo: 1004 })],
    });
    const text = document.body.textContent ?? "";
    expect(text).toContain("#2214");
    expect(text).toContain("ServiceM8");
    expect(text).toContain("#1004");
    expect(text).toContain("HeyTiff");
  });

  it("shows a tracked job once, wearing what tracks it", async () => {
    await mountWork({
      data: data({ jobs: [mirrorJob({ remoteId: "j-1" })] }),
      visits: [visitFix({ id: "v-1", remoteId: "j-1", jobNo: 1004 })],
    });
    expect(rows()).toHaveLength(1);
    expect(screen.getByText("On the board #1004")).toBeInTheDocument();
  });

  it("names the project when a project is what tracks it", async () => {
    await mountWork({
      data: data({
        jobs: [mirrorJob({ remoteId: "j-1" })],
        projectLinks: [{ remoteId: "j-1", projectId: "p-1" }],
      }),
      projects: [projectFix({ id: "p-1" })],
    });
    expect(rows()).toHaveLength(1);
    expect(screen.getByText("Project — Belmont change-over")).toBeInTheDocument();
  });

  it("says out loud when the list is capped", async () => {
    await mountWork({ data: data({ jobs: [mirrorJob({ remoteId: "j-1" })], truncated: true }) });
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

  /* The chip is COUNTED from payment rows now. Under the old flag read it
     could never fire at all on this account — `invoice_sent` never arrives —
     so a finished job with money still out looked identical to a settled one. */
  it("flags finished work with money still out", async () => {
    mount({
      moneyVisible: true,
      data: data({
        jobs: [
          mirrorJob({
            remoteId: "c-1",
            status: "Completed",
            completionDate: "2026-08-01 00:00:00",
            money: jobMoneyOf({ total_invoice_amount: "3960.00" }),
            paidCents: 0,
          }),
        ],
      }),
    });
    await toTab("Completed");
    expect(screen.getByText(/1 of these is invoiced and still awaiting payment/)).toBeInTheDocument();
    expect(screen.getByText("Awaiting payment")).toBeInTheDocument();
  });

  it("says how much is left on a part-paid job", async () => {
    mount({
      moneyVisible: true,
      data: data({
        jobs: [
          mirrorJob({
            remoteId: "c-1",
            status: "Completed",
            completionDate: "2026-08-01 00:00:00",
            money: jobMoneyOf({ total_invoice_amount: "3960.00" }),
            paidCents: 100000,
          }),
        ],
      }),
    });
    await toTab("Completed");
    expect(screen.getByText("Part paid — $2,960 to come")).toBeInTheDocument();
  });

  /* THE MAJORITY CASE, and it must stay quiet. 1,819 completed jobs carry
     payments against a total ServiceM8 never recorded — chipping those as
     owing would bury the eleven that genuinely are, and a green "paid" on the
     few with totals would imply these were unpaid. Silence is the answer. */
  it("stays quiet on a paid job whose total was never recorded", async () => {
    mount({
      moneyVisible: true,
      data: data({
        jobs: [
          mirrorJob({
            remoteId: "c-1",
            status: "Completed",
            completionDate: "2026-08-01 00:00:00",
            money: jobMoneyOf({}),
            paidCents: 45000,
          }),
        ],
      }),
    });
    await toTab("Completed");
    expect(screen.queryByText("Awaiting payment")).toBeNull();
    expect(screen.queryByText(/Part paid/)).toBeNull();
    expect(screen.queryByText("Paid")).toBeNull();
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

  it("shows the value when the reader holds it", async () => {
    await mountWork({ data: withValue, moneyVisible: true });
    expect(screen.getByText("$640")).toBeInTheDocument();
  });

  it("shows no dollars at all when they don't", async () => {
    await mountWork({ data: withValue, moneyVisible: false });
    expect(document.body.textContent).not.toMatch(/\$/);
    expect(document.querySelector(".wb2-ajmoney")).not.toBeInTheDocument();
  });
});

describe("empty says WHY", () => {
  /* All jobs is the UNION of the mirror and the native rows, so an empty one
     is an empty board — which makes this the one empty state that has to
     carry the offer. Three ways to be empty, three different answers. */
  it("invites connecting ServiceM8 when standalone, and links a manager to it", async () => {
    await mountWork({ connected: false, manage: true });
    expect(screen.getByText("No work to show yet")).toBeInTheDocument();
    expect(screen.getByText("Connect ServiceM8").closest("a")).toHaveAttribute(
      "href",
      "/dashboard/admin/integrations/servicem8"
    );
  });

  it("explains the gap to a tech without a door they can't open", async () => {
    await mountWork({ connected: false, manage: false });
    expect(screen.getByText("No work to show yet")).toBeInTheDocument();
    expect(screen.queryByText("Connect ServiceM8")).not.toBeInTheDocument();
  });

  /* The one this exists for: a fresh grant reads empty for minutes, and
     telling that person to connect ServiceM8 tells them to redo what they
     just did. Only backfill_done separates the two — a row count can't. */
  it("says the first sync is still running rather than inviting a second connect", async () => {
    await mountWork({
      connected: true,
      manage: true,
      backfilling: { jobs: true, schedule: true },
    });
    expect(screen.getByText("Still bringing the jobs across")).toBeInTheDocument();
    expect(screen.queryByText("Connect ServiceM8")).not.toBeInTheDocument();
  });

  it("says nothing is on when connected and genuinely empty", async () => {
    await mountWork({ connected: true });
    expect(screen.getByText("Nothing on")).toBeInTheDocument();
  });

});

/* THE SEARCH LEFT THIS BOARD. It used to own a box per list panel and its own
   half of the mirror query; the page owns one box above all three boards now,
   and its tests live with it (components/workboard/__tests__/overview-screen
   for the wiring, lib/workboard/__tests__/work-search for the rules). What
   stays this board's job is honouring the two slots the page fills. */
describe("the page's search slots", () => {
  it("docks the field in the tab row and lets the panel take the card", async () => {
    await mountWork({
      data: data({ jobs: [mirrorJob({ remoteId: "j-1" })] }),
      tools: <input aria-label="The one box" />,
      searchPanel: <p>Results panel</p>,
    });
    expect(screen.getByLabelText("The one box")).toBeInTheDocument();
    expect(screen.getByText("Results panel")).toBeInTheDocument();
    // The card is the panel's now — the list underneath must not still be on.
    expect(rows()).toHaveLength(0);
  });

  /* The tab row stays lit behind the results, so its tabs have to actually
     take you there — which they can't while the panel covers the card. */
  it("leaves the search when a tab is picked", async () => {
    const onExitSearch = jest.fn();
    await mountWork({ searchPanel: <p>Results panel</p>, onExitSearch });
    await userEvent.click(screen.getByRole("tab", { name: "Quotes" }));
    expect(onExitSearch).toHaveBeenCalled();
  });

  /* A hit from past the loaded window has no row here to be looked up in, so
     the job travels whole rather than as an id. */
  it("opens a job handed in from outside, even one this board never loaded", async () => {
    await mountWork({
      openTarget: { kind: "job", job: mirrorJob({ remoteId: "j-old" }) },
    });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(readMirrorJob).toHaveBeenCalledWith("j-old");
  });
});

describe("opening a row", () => {
  it("opens the sheet for a ServiceM8 job", async () => {
    await mountWork({ data: data({ jobs: [mirrorJob({ remoteId: "j-1" })] }) });
    await userEvent.click(rows()[0]);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(readMirrorJob).toHaveBeenCalledWith("j-1");
  });

  /* A native row already has a home. Sending it to a viewer that knows less
     than the board it came from would be a worse answer than the handoff. */
  it("sends a native row to the board that owns it, without a sheet", async () => {
    await mountWork({ visits: [visitFix({ id: "v-1" })] });
    await userEvent.click(rows()[0]);
    expect(onOpenTracked).toHaveBeenCalledWith({ kind: "visit", id: "v-1" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("promotion", () => {
  it("offers both ways out of a job, to a manager", async () => {
    await mountWork({ data: data({ jobs: [mirrorJob({ remoteId: "j-1" })] }), manage: true });
    await userEvent.click(rows()[0]);
    const sheet = await screen.findByRole("dialog");
    // both live behind the band's ⋯ — a once-per-job act does not belong
    // on a face whose daily job is to be read, and it never earned one
    await userEvent.click(within(sheet).getByLabelText("More actions"));
    expect(
      within(sheet).getByRole("button", { name: /Create a project from this job/ })
    ).toBeInTheDocument();
    expect(
      within(sheet).getByRole("button", { name: /Create a maintenance agreement/ })
    ).toBeInTheDocument();
  });

  it("offers no ⋯ to someone who can't manage the board", async () => {
    await mountWork({ data: data({ jobs: [mirrorJob({ remoteId: "j-1" })] }), manage: false });
    await userEvent.click(rows()[0]);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).queryByLabelText("More actions")).not.toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: /Create a project/ })).not.toBeInTheDocument();
    expect(
      within(sheet).queryByRole("button", { name: /Create a maintenance agreement/ })
    ).not.toBeInTheDocument();
  });

  it("names the project before creating it, then calls with that name", async () => {
    await mountWork({ data: data({ jobs: [mirrorJob({ remoteId: "j-1" })] }) });
    await userEvent.click(rows()[0]);
    const sheet = await screen.findByRole("dialog");
    await userEvent.click(within(sheet).getByLabelText("More actions"));
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
    await mountWork({ data: data({ jobs: [mirrorJob({ remoteId: "j-1", jobNumber: "2214" })] }) });
    await userEvent.click(rows()[0]);
    const sheet = await screen.findByRole("dialog");
    await userEvent.click(within(sheet).getByLabelText("More actions"));
    await userEvent.click(
      within(sheet).getByRole("button", { name: /Create a maintenance agreement/ })
    );
    expect(await screen.findByTestId("agmodal")).toHaveTextContent("2214");
  });
});
