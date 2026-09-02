/* The Workboard page's own job — everything that isn't inside a board card.
   Both sides run the redesigned architecture (each side's suite lives in
   board/__tests__); here we pin what the PAGE owns: the centre switcher and
   its per-side counts, the scope it reports to the Tiff button, mirror health reaching
   both rows, and the flag ROUTING that keeps a flag on exactly one board. */

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverviewScreen } from "../overview-screen";
import { NoteScopeProvider, useNoteScope } from "@/components/notes/note-context";
import type { WorkboardData } from "@/lib/workboard/page-data";
import type { ProjectBoardVisit } from "@/lib/workboard/projects-board-query";
import type { BoardVisit } from "@/lib/workboard/board-query";
import type { BoardFlag } from "@/lib/workboard/notes-query";

const push = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn(), push: (...a: unknown[]) => push(...(a as [])) }),
}));

/* The mirror's older half, which the page asks for on the page's behalf now —
   the All jobs board used to own this call. */
const searchAllJobs = jest.fn(async () => [] as unknown[]);
jest.mock("@/app/actions/workboard", () => ({
  searchAllJobs: (...a: unknown[]) => searchAllJobs(...(a as [])),
}));

/* The photo bank's half of the universal search, and the star a hit's viewer
   carries. Both are `"use server"` modules — unmocked, they drag `next/cache`
   into jsdom and the suite dies at import time. */
const searchPhotos = jest.fn(
  async (): Promise<{
    ok: boolean;
    hits: unknown[];
    banked: number;
    capped: boolean;
  }> => ({ ok: true, hits: [], banked: 0, capped: false })
);
jest.mock("@/app/actions/photo-search", () => ({
  searchPhotos: (...a: unknown[]) => searchPhotos(...(a as [])),
}));
const setJobPhotoFavourite = jest.fn(async (_j: string, _a: string, starred: boolean) => ({
  ok: true,
  starred,
  note: null,
}));
jest.mock("@/app/actions/job-photo-favourites", () => ({
  listShowcase: async () => [],
  setJobPhotoFavourite: (...a: unknown[]) =>
    setJobPhotoFavourite(...(a as [string, string, boolean])),
}));

/* Both boards are stubbed — here we only pin that the switcher mounts each
   with the right dataset and flags.

   THE CAPTURE CONTROL IS NOT ON THIS SCREEN ANY MORE. It was a capsule docked
   in the tab row; it is the Tiff button in the app frame now, on every screen
   rather than two. What this screen still owes it is CONTEXT, so the probe
   below reads the scope the screen pushed UP — which is a better test than
   the docked-pill one it replaces, because a pill could render perfectly
   while pointed at nothing. */
function ScopeProbe() {
  const s = useNoteScope();
  return (
    <div data-testid="scope">
      {s.target.kind}|{s.targetLabel ?? "-"}|{s.jobs.length} jobs|{s.staffFirstNames.length} names
    </div>
  );
}

type BoardStub = {
  manage: boolean;
  connected: boolean;
  flags: unknown[];
  tools?: React.ReactNode;
  searchPanel?: React.ReactNode;
  openTarget?: { kind: string; id?: string; job?: { remoteId: string } } | null;
  sm8?: { attention: boolean } | null;
};
/* The stubs print the HANDOFF they were given as well as their data: with the
   real boards mocked out, "the search took me there" is only observable as
   the right side mounting with the right target on it. */
const handoffOf = (p: BoardStub) =>
  p.openTarget ? `${p.openTarget.kind}:${p.openTarget.id ?? p.openTarget.job?.remoteId}` : "none";
/* jest.mock is hoisted above every const, so each factory builds its own
   stub rather than closing over a shared helper. */
const stubBody = (testid: string, p: BoardStub) => (
  <div data-testid={testid}>
    board · manage:{String(p.manage)} · connected:{String(p.connected)} · flags:{p.flags.length} ·
    sm8:
    {p.sm8 ? (p.sm8.attention ? "attention" : "ok") : "none"} · open:{handoffOf(p)}
    {p.tools}
    {p.searchPanel}
  </div>
);
jest.mock("../board/maintenance-board", () => ({
  MaintenanceBoard: (p: BoardStub) => stubBody("mboard", p),
}));
jest.mock("../board/projects-board", () => ({
  ProjectsBoard: (p: BoardStub) => stubBody("pboard", p),
}));
jest.mock("../board/all-jobs-board", () => ({
  AllJobsBoard: (
    p: BoardStub & { moneyVisible: boolean; backfilling: { jobs: boolean; schedule: boolean } }
  ) => (
    <div data-testid="jboard">
      board · manage:{String(p.manage)} · connected:{String(p.connected)} · money:
      {String(p.moneyVisible)} · sm8:{p.sm8 ? (p.sm8.attention ? "attention" : "ok") : "none"} ·
      backfilling:
      {[p.backfilling.jobs && "jobs", p.backfilling.schedule && "schedule"]
        .filter(Boolean)
        .join("+") || "none"}
      {" · open:"}
      {handoffOf(p)}
      {p.tools}
      {p.searchPanel}
    </div>
  ),
}));

const TODAY = "2026-07-28";

const base: WorkboardData = {
  manage: false,
  moneyVisible: false,
  connection: "none",
  timezone: null,
  today: TODAY,
  flags: [],
  board: { visits: [], agreements: [], staff: [], tagPool: [], categories: [], tasks: [] },
  projectsBoard: { projects: [], visits: [], staff: [] },
  allJobs: { jobs: [], truncated: false, projectLinks: [] },
  aiEnabled: false,
  synced: null,
  backfilling: { jobs: false, schedule: false },
};

const tripStub = (over: Partial<ProjectBoardVisit> & { id: string }): ProjectBoardVisit => ({
  projectId: "p-1",
  projectName: "Smith St change-over",
  clientName: "Smith",
  siteLabel: null,
  label: "Rough-in",
  dueDate: "2026-08-04",
  bookedDate: null,
  status: "upcoming",
  readiness: { equipment_ready: false, access_confirmed: false },
  techs: [],
  bringList: [],
  jobNo: 1001,
  jobNumber: null,
  provider: null,
  remoteId: null,
  bookedStart: null,
  mirrorStatus: null,
  mirrorNextStart: null,
  warn: false,
  notes: null,
  completedAt: null,
  completedSource: null,
  actualHours: null,
  completionNote: null,
  invoicedAt: null,
  ...over,
});

const visitStub = (over: Partial<BoardVisit> & { id: string }): BoardVisit => ({
  agreementId: "a-1",
  label: "Rooftop package — monthly",
  clientName: "Ardex Logistics",
  siteLabel: null,
  intervalMonths: 1,
  techsNeeded: 1,
  hoursEstimate: null,
  accessNotes: null,
  category: null,
  tags: [],
  packing: [],
  dueDate: "2026-08-04",
  bookedDate: null,
  status: "upcoming",
  readiness: { equipment_ready: false, access_confirmed: false },
  techs: [],
  packedIds: [],
  jobNo: 1001,
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
});

const flag = (over: Partial<BoardFlag> & { id: string }): BoardFlag => ({
  message: "No roof access booked",
  severity: "urgent",
  targetKind: "none",
  targetId: null,
  createdAt: "2026-07-28T00:00:00.000Z",
  ...over,
});

const toProjects = () => userEvent.click(screen.getByRole("tab", { name: /Projects/ }));
/* The board opens on All jobs now, so anything asserting about the two
   curated boards walks to them first — the same click a person makes. */
const toMaintenance = () => userEvent.click(screen.getByRole("tab", { name: /Maintenance/ }));
const seg = () => screen.getByRole("tablist", { name: "Which work" });

describe("standalone", () => {
  /* The page itself says NOTHING about being standalone — the offer lives in
     the empty list that the absence actually produces (board/sm8-gap), and a
     caption repeating it under a working board is the hint text the design
     rule bans. Asserted for a manager, who is the one the old stamp addressed
     and so the one who would get it back first. */
  it("carries no standalone caption under the board", () => {
    render(<OverviewScreen data={{ ...base, manage: true }} />);
    expect(screen.queryByText(/Running standalone/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Connect ServiceM8/)).not.toBeInTheDocument();
  });

  it("hands the board the backfill state, so it can tell empty from not-yet", () => {
    render(
      <OverviewScreen
        data={{ ...base, connection: "connected", backfilling: { jobs: true, schedule: true } }}
      />
    );
    expect(screen.getByTestId("jboard")).toHaveTextContent("backfilling:jobs+schedule");
  });

  it("gives neither board a mirror-health chip when there is no mirror", async () => {
    render(<OverviewScreen data={base} />);
    await toMaintenance();
    expect(screen.getByTestId("mboard")).toHaveTextContent("sm8:none");
  });
});

describe("the switcher", () => {
  /* The order is a decision, not an accident — All jobs leads because it is
     the only side carrying the whole account's day, and its Schedule tab
     answers the question this board is asked first each morning. Nothing in
     the CSS is position-keyed, so only this test would notice a reshuffle. */
  it("leads with All jobs, then the two curated sides", () => {
    render(<OverviewScreen data={base} />);
    /* firstChild, not textContent: the curated sides append a badge, and the
       fact that All jobs has none is its own rule, pinned below. */
    expect(screen.getAllByRole("tab").map((t) => t.firstChild?.textContent)).toEqual([
      "All jobs",
      "Projects",
      "Maintenance",
    ]);
  });

  /* The landing side follows the order: first side, first tab, which puts
     today's diary in front of you. A badge is a summons visible from any
     side — the switcher carries both counts always — so opening on the
     curated queues bought nothing the switcher wasn't already saying. */
  it("opens on All jobs and swaps whole boards", async () => {
    render(<OverviewScreen data={base} />);

    expect(screen.getByTestId("jboard")).toBeInTheDocument();
    expect(screen.queryByTestId("mboard")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pboard")).not.toBeInTheDocument();

    await toProjects();

    expect(screen.getByTestId("pboard")).toBeInTheDocument();
    expect(screen.queryByTestId("jboard")).not.toBeInTheDocument();

    await toMaintenance();

    expect(screen.getByTestId("mboard")).toBeInTheDocument();
    expect(screen.queryByTestId("pboard")).not.toBeInTheDocument();
  });

  it("carries the live side on the element, so the fill takes that side's colour", async () => {
    render(<OverviewScreen data={base} />);
    expect(seg()).toHaveAttribute("data-on", "jobs");
    await toProjects();
    expect(seg()).toHaveAttribute("data-on", "projects");
    await toMaintenance();
    expect(seg()).toHaveAttribute("data-on", "maintenance");
  });

  it("hands both boards their permissions and connection truthfully", async () => {
    render(<OverviewScreen data={{ ...base, manage: true, connection: "connected" }} />);
    await toMaintenance();
    expect(screen.getByTestId("mboard")).toHaveTextContent("manage:true");
    expect(screen.getByTestId("mboard")).toHaveTextContent("connected:true");
    await toProjects();
    expect(screen.getByTestId("pboard")).toHaveTextContent("manage:true");
    expect(screen.getByTestId("pboard")).toHaveTextContent("connected:true");
  });


  it("offers Display mode on both sides", async () => {
    render(<OverviewScreen data={base} />);
    expect(screen.getByRole("button", { name: /Display mode/ })).toBeInTheDocument();
    await toProjects();
    expect(screen.getByRole("button", { name: /Display mode/ })).toBeInTheDocument();
  });
});

/* THE THIRD SIDE. Maintenance and Projects are derived boards — promoted
   work, each with a queue. All jobs is the whole book, which is a reference
   rather than a to-do list, and the difference has to show. */
describe("the All jobs side", () => {
  const toJobs = () => userEvent.click(screen.getByRole("tab", { name: /All jobs/ }));

  it("swaps in as a whole board, like the other two", async () => {
    render(<OverviewScreen data={base} />);
    await toJobs();
    expect(screen.getByTestId("jboard")).toBeInTheDocument();
    expect(screen.queryByTestId("mboard")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pboard")).not.toBeInTheDocument();
  });

  it("carries its own identity on the element", async () => {
    render(<OverviewScreen data={base} />);
    await toJobs();
    expect(seg()).toHaveAttribute("data-on", "jobs");
  });

  /* A badge means "this many need you today". A total of everything answers a
     different question, and a number that LOOKS like the others while meaning
     something else is worse than no number. */
  it("wears no count, where the other two do", () => {
    render(<OverviewScreen data={base} />);
    const jobs = screen.getByRole("tab", { name: /All jobs/ });
    expect(jobs.querySelector("i")).toBeNull();
    expect(screen.getByRole("tab", { name: /Maintenance/ }).querySelector("i")).not.toBeNull();
  });

  it("hands the board the money grant", async () => {
    render(<OverviewScreen data={{ ...base, moneyVisible: true }} />);
    await toJobs();
    expect(screen.getByTestId("jboard")).toHaveTextContent("money:true");
  });

  it("withholds it when the reader hasn't got it", async () => {
    render(<OverviewScreen data={base} />);
    await toJobs();
    expect(screen.getByTestId("jboard")).toHaveTextContent("money:false");
  });

  /* Standalone has no mirror, so the side has only native rows to show — but
     it must still be REACHABLE, or a workspace with no integration would find
     a third of its board missing with no explanation. */
  it("is offered even with no ServiceM8 connection", async () => {
    render(<OverviewScreen data={base} />);
    expect(screen.getByRole("tab", { name: /All jobs/ })).toBeInTheDocument();
    await toJobs();
    expect(screen.getByTestId("jboard")).toHaveTextContent("connected:false");
  });
});

/* Display mode MIRRORS the page — 2026-08-02, Isaac. It used to swap the
   maintenance side for a separate untouchable wall composition; now it takes
   the app frame away and leaves everything else exactly where it was, because
   the point of a big screen is working off it. jsdom has no Fullscreen API,
   which is fine and deliberate: a missing API still hides the shell. */
describe("display mode", () => {
  const enter = async () => {
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Display mode/ }));
    return user;
  };

  afterEach(() => document.documentElement.removeAttribute("data-wb-display"));

  it("hides the app shell by marking the root, and un-marks it on the way out", async () => {
    render(<OverviewScreen data={base} />);
    const user = await enter();
    expect(document.documentElement).toHaveAttribute("data-wb-display", "on");
    await user.click(screen.getByRole("button", { name: /Close display mode/ }));
    expect(document.documentElement).not.toHaveAttribute("data-wb-display");
  });

  it("keeps the side switcher live — you can still change boards from inside it", async () => {
    render(<OverviewScreen data={base} />);
    const user = await enter();
    await user.click(screen.getByRole("tab", { name: /Projects/ }));
    expect(screen.getByTestId("pboard")).toBeInTheDocument();
    // and the mode survived the switch
    expect(document.documentElement).toHaveAttribute("data-wb-display", "on");
    expect(screen.getByRole("button", { name: /Close display mode/ })).toBeInTheDocument();
  });

  /* The capture control moved to the frame, but the DECISION it embodied did
     not: display mode is for working off a big screen, so you can still take
     a note in it. The mode fullscreens the document rather than the board, so
     the frame — and the Tiff button in it — comes along. What this pins is
     that nothing here stamps the mode onto something that would hide it. */
  it("keeps capture available — the mode is for working, not watching", async () => {
    render(
      <NoteScopeProvider voiceEnabled>
        <OverviewScreen data={base} />
      </NoteScopeProvider>
    );
    await enter();
    /* The mode is stamped on the ROOT and the whole document is what goes
       fullscreen, so the frame — and the button in it — comes along. jsdom
       has no `fullscreenElement`, so the attribute is the honest assertion. */
    expect(document.documentElement).toHaveAttribute("data-wb-display", "on");
  });

  it("leaves display mode when the browser leaves fullscreen (Esc)", async () => {
    render(<OverviewScreen data={base} />);
    await enter();
    act(() => void document.dispatchEvent(new Event("fullscreenchange")));
    expect(document.documentElement).not.toHaveAttribute("data-wb-display");
    expect(screen.getByRole("button", { name: /Display mode/ })).toBeInTheDocument();
  });
});

/* The count on each side of the switcher is that side's Urgent queue, run
   through the SAME derivation the tab uses — the number you'd see if you
   switched. A quiet side reads 0 in the ok tone, never a red 0. */
describe("the side counts", () => {
  const overdue = visitStub({ id: "mv-1", dueDate: "2026-07-01" });

  it("counts each side's urgent queue on its own button", () => {
    const data: WorkboardData = {
      ...base,
      board: { ...base.board, visits: [overdue] },
    };
    render(<OverviewScreen data={data} />);
    const maint = screen.getByRole("tab", { name: /Maintenance/ });
    const proj = screen.getByRole("tab", { name: /Projects/ });
    expect(maint.querySelector("i")).toHaveTextContent("1");
    expect(proj.querySelector("i")).toHaveTextContent("0");
  });

  it("takes its tone from the worst row on that side — clear when nothing is open", () => {
    render(<OverviewScreen data={base} />);
    expect(screen.getByRole("tab", { name: /Maintenance/ }).querySelector("i")).toHaveClass("clr");
  });

  it("reads danger when something is overdue, warn when it is only unready", () => {
    const dan: WorkboardData = { ...base, board: { ...base.board, visits: [overdue] } };
    const { unmount } = render(<OverviewScreen data={dan} />);
    expect(screen.getByRole("tab", { name: /Maintenance/ }).querySelector("i")).toHaveClass("dan");
    unmount();

    const warn: WorkboardData = {
      ...base,
      flags: [flag({ id: "f-1", severity: "warn" })],
    };
    render(<OverviewScreen data={warn} />);
    expect(screen.getByRole("tab", { name: /Maintenance/ }).querySelector("i")).toHaveClass("wrn");
  });

  it("counts a project flag on the PROJECTS side, never both", () => {
    const data: WorkboardData = {
      ...base,
      flags: [flag({ id: "f-1", targetKind: "project", targetId: "p-1" })],
    };
    render(<OverviewScreen data={data} />);
    expect(screen.getByRole("tab", { name: /Projects/ }).querySelector("i")).toHaveTextContent("1");
    expect(screen.getByRole("tab", { name: /Maintenance/ }).querySelector("i")).toHaveTextContent(
      "0"
    );
  });
});

/* The one rule: a flag appears on exactly ONE board. Project flags and flags
   on a project's trips go to the projects queue; everything else stays with
   maintenance. */
describe("flag routing", () => {
  it("routes project-targeted flags to the projects board only", async () => {
    const data: WorkboardData = {
      ...base,
      flags: [
        flag({ id: "f-1", targetKind: "project", targetId: "p-1" }),
        flag({ id: "f-2", targetKind: "none" }),
      ],
    };
    render(<OverviewScreen data={data} />);
    await toMaintenance();
    expect(screen.getByTestId("mboard")).toHaveTextContent("flags:1");
    await toProjects();
    expect(screen.getByTestId("pboard")).toHaveTextContent("flags:1");
  });

  it("routes a flag on a project's trip to the projects board", async () => {
    const data: WorkboardData = {
      ...base,
      projectsBoard: { ...base.projectsBoard, visits: [tripStub({ id: "pv-9" })] },
      flags: [
        flag({ id: "f-1", targetKind: "visit", targetId: "pv-9" }),
        flag({ id: "f-2", targetKind: "visit", targetId: "mv-1" }), // a maintenance visit
      ],
    };
    render(<OverviewScreen data={data} />);
    await toMaintenance();
    expect(screen.getByTestId("mboard")).toHaveTextContent("flags:1");
    await toProjects();
    expect(screen.getByTestId("pboard")).toHaveTextContent("flags:1");
  });
});

describe("connected", () => {
  const connected: WorkboardData = {
    ...base,
    connection: "connected",
    timezone: "Australia/Brisbane",
    synced: { finishedAt: new Date(Date.now() - 3 * 60_000).toISOString(), running: false },
  };

  it("hands mirror health to BOTH tab rows — staleness is a fact about the data", async () => {
    render(<OverviewScreen data={connected} />);
    await toMaintenance();
    expect(screen.getByTestId("mboard")).toHaveTextContent("sm8:ok");
    await toProjects();
    expect(screen.getByTestId("pboard")).toHaveTextContent("sm8:ok");
  });

  it("says when the connection itself needs attention, on either side", async () => {
    render(<OverviewScreen data={{ ...connected, connection: "attention" }} />);
    await toMaintenance();
    expect(screen.getByTestId("mboard")).toHaveTextContent("sm8:attention");
    await toProjects();
    expect(screen.getByTestId("pboard")).toHaveTextContent("sm8:attention");
  });

  it("drops the standalone line once a mirror exists", () => {
    render(<OverviewScreen data={connected} />);
    expect(screen.queryByText(/Running standalone/)).not.toBeInTheDocument();
  });
});

/* ONE BOX, ABOVE ALL THREE CARDS.

   The board used to carry two search fields, both inside the white card: the
   agreements ledger's, and the one repeated across the three All jobs lists.
   Which one you could reach depended on the tab you were standing on, and
   five tabs had none at all. This is the page's half of the replacement — the
   field docked in every tab row, the answers taking the card, and choosing
   one landing you on the work wherever it lives. The RULES it searches by are
   pinned in lib/workboard/__tests__/work-search. */
describe("the universal search", () => {
  const loaded: WorkboardData = {
    ...base,
    connection: "connected",
    board: {
      ...base.board,
      visits: [visitStub({ id: "v-1", clientName: "Kingsford Medical Centre" })],
    },
    projectsBoard: {
      ...base.projectsBoard,
      visits: [tripStub({ id: "t-1", projectName: "Kingsford fitout" })],
    },
    allJobs: {
      truncated: false,
      projectLinks: [],
      jobs: [
        {
          remoteId: "j-1",
          jobNumber: "2214",
          status: "Work Order",
          clientName: "Kingsford Bakery",
          description: "Cool room down",
          suburb: "Kingsford",
          categoryName: null,
          categoryColour: null,
          date: "2026-07-20 09:00:00",
          quoteDate: null,
          completionDate: null,
          nextBooking: null,
          money: null,
          paidCents: 0,
        },
      ],
    },
  };
  const box = () =>
    screen.getByRole("searchbox", { name: "Search the whole workboard, including photos" });

  beforeEach(() => {
    searchAllJobs.mockClear();
    searchPhotos.mockReset();
    searchPhotos.mockResolvedValue({ ok: true, hits: [], banked: 0, capped: false });
    setJobPhotoFavourite.mockClear();
    push.mockClear();
  });

  /* The reason it moved out of the card: a board you can't reach the search
     from is a board where the search doesn't exist. */
  it("rides the tab row on every side", async () => {
    render(<OverviewScreen data={base} />);
    expect(box()).toBeInTheDocument();
    await toProjects();
    expect(box()).toBeInTheDocument();
    await toMaintenance();
    expect(box()).toBeInTheDocument();
  });

  it("answers from every side at once, whichever side you typed on", async () => {
    render(<OverviewScreen data={loaded} />);
    await toMaintenance();
    await userEvent.type(box(), "kingsford");

    expect(screen.getByText(/3 matches for/)).toBeInTheDocument();
    expect(screen.getByText("Kingsford Medical Centre")).toBeInTheDocument();
    expect(screen.getByText("Kingsford fitout")).toBeInTheDocument();
    expect(screen.getByText("Kingsford Bakery")).toBeInTheDocument();
  });

  /* One character is not a search — it's a keystroke on the way to one, and
     firing the whole mirror at each of them is a query per letter. */
  it("asks the mirror from two characters, never from one", async () => {
    render(<OverviewScreen data={loaded} />);
    await userEvent.type(box(), "k");
    expect(searchAllJobs).not.toHaveBeenCalled();
    await userEvent.type(box(), "i");
    expect(searchAllJobs).toHaveBeenCalledWith("ki");
  });

  /* The whole point of the box: the answer is on a side you weren't standing
     on, and choosing it takes you there with the right sheet named. */
  it("crosses sides to land you on the work", async () => {
    render(<OverviewScreen data={loaded} />);
    await userEvent.type(box(), "kingsford medical");
    await userEvent.click(screen.getByRole("button", { name: /Open Kingsford Medical Centre/ }));

    expect(screen.getByTestId("mboard")).toHaveTextContent("open:visit:v-1");
    expect(screen.queryByTestId("jboard")).not.toBeInTheDocument();
  });

  it("hands a ServiceM8 job to the All jobs side as the job, not as an id", async () => {
    render(<OverviewScreen data={loaded} />);
    await toMaintenance();
    await userEvent.type(box(), "bakery");
    await userEvent.click(screen.getByRole("button", { name: /Open Kingsford Bakery/ }));

    expect(screen.getByTestId("jboard")).toHaveTextContent("open:job:j-1");
  });

  /* A project is the one answer that isn't a sheet — it has a page of its
     own, so it routes rather than opening over the board. */
  it("routes to a project's own page instead of opening a sheet", async () => {
    const withProject: WorkboardData = {
      ...loaded,
      projectsBoard: {
        ...loaded.projectsBoard,
        projects: [
          {
            id: "p-9",
            name: "Randwick tower fitout",
            clientName: "Randwick Holdings",
            status: "active",
            stage: "Pre-install",
            updatedAt: "2026-07-20T00:00:00.000Z",
          },
        ] as unknown as WorkboardData["projectsBoard"]["projects"],
      },
    };
    render(<OverviewScreen data={withProject} />);
    await userEvent.type(box(), "randwick tower");
    await userEvent.click(screen.getByRole("button", { name: /Open Randwick tower fitout/ }));
    expect(push).toHaveBeenCalledWith("/dashboard/workboard/projects/p-9");
  });

  it("gives the card back when the search is cleared", async () => {
    render(<OverviewScreen data={loaded} />);
    await userEvent.type(box(), "kingsford");
    expect(screen.getByText(/3 matches for/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.queryByText(/matches for/)).not.toBeInTheDocument();
    expect(box()).toHaveValue("");
  });

  /* Told nothing while a single letter sits in the box, you can't tell a
     search that hasn't started from one that found nothing. */
  it("says a single character is not yet a search, rather than saying nothing matched", async () => {
    render(<OverviewScreen data={loaded} />);
    await userEvent.type(box(), "k");
    expect(screen.getByText("Keep typing")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing matches/)).not.toBeInTheDocument();
  });

  /* The boards take a target by identity and hold it for as long as it's
     handed to them, so something has to say "done with that". Moving the
     switcher yourself is that moment — without it, coming back to a side
     would reopen the sheet you'd already closed. */
  it("drops the handoff when you move the switcher yourself", async () => {
    render(<OverviewScreen data={loaded} />);
    await userEvent.type(box(), "kingsford medical");
    await userEvent.click(screen.getByRole("button", { name: /Open Kingsford Medical Centre/ }));
    expect(screen.getByTestId("mboard")).toHaveTextContent("open:visit:v-1");

    await toProjects();
    await toMaintenance();
    expect(screen.getByTestId("mboard")).toHaveTextContent("open:none");
  });

  it("says when nothing matched, and what it read", async () => {
    render(<OverviewScreen data={loaded} />);
    await userEvent.type(box(), "zzzz");
    expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument();
  });

  /* ── the photo bank's half ──────────────────────────────────────────────
     The gallery tab used to carry its own box for this, a hand's width under
     the universal field. This is the box now, so the behaviours the old box
     pinned — the debounce, the last-answer-wins guard, the honesty about how
     much has been read — are pinned here, on the field that owns them. */

  const photoHit = (over: Partial<Record<string, unknown>> & { remoteId: string }) => ({
    jobUuid: "job-1",
    jobNumber: "907",
    clientName: "Heuvel Construction",
    name: "Photo",
    takenAt: "2026-08-28 13:25:00",
    subject: "dataplate",
    tags: [],
    caption: "Mitsubishi outdoor unit rating plate",
    ocrText: "MODEL PUZ-M125VKA2-A SERIAL 0081 R32 230V",
    url: "https://signed/p.jpg",
    readAt: "2026-08-29T02:00:00Z",
    match: { text: false, transcript: true, caption: false, tag: false },
    starred: false,
    ...over,
  });

  it("answers with photos beside the work, under one headline", async () => {
    searchPhotos.mockResolvedValue({
      ok: true,
      hits: [photoHit({ remoteId: "b-1" })],
      banked: 84,
      capped: false,
    });
    render(<OverviewScreen data={loaded} />);
    await userEvent.type(box(), "kingsford");

    /* Three work rows at once, then the photo lands a debounce later and the
       headline count follows it up. */
    expect(screen.getByText(/3 matches for/)).toBeInTheDocument();
    expect(await screen.findByText("Mitsubishi outdoor unit rating plate")).toBeInTheDocument();
    expect(screen.getByText(/4 matches for/)).toBeInTheDocument();
    /* And the group says what the count was measured against. */
    expect(screen.getByText(/out of 84 photos read so far/)).toBeInTheDocument();
  });

  it("shows the transcription that matched, not just the picture", async () => {
    searchPhotos.mockResolvedValue({
      ok: true,
      hits: [photoHit({ remoteId: "b-1" })],
      banked: 84,
      capped: false,
    });
    render(<OverviewScreen data={loaded} />);
    await userEvent.type(box(), "PUZ-M125");
    expect(await screen.findByText(/PUZ-M125VKA2-A/)).toBeInTheDocument();
  });

  /* One character matches most of the bank and tells nobody anything. */
  it("does not ask the photo bank about a single character", async () => {
    render(<OverviewScreen data={loaded} />);
    await userEvent.type(box(), "k");
    await new Promise((r) => setTimeout(r, 400));
    expect(searchPhotos).not.toHaveBeenCalled();
  });

  /* An empty bank is a different problem from a bad query, and the empty
     state has to say which one the reader is looking at. */
  it("tells an empty bank apart from a query nothing matches", async () => {
    render(<OverviewScreen data={loaded} />);
    await userEvent.type(box(), "zzzz");
    expect(await screen.findByText(/no photos have been read yet/)).toBeInTheDocument();
  });

  it("counts the bank in the empty state once photos exist", async () => {
    searchPhotos.mockResolvedValue({ ok: true, hits: [], banked: 84, capped: false });
    render(<OverviewScreen data={loaded} />);
    await userEvent.type(box(), "zzzz");
    expect(await screen.findByText(/84 photos read so far/)).toBeInTheDocument();
  });

  /* THE AS-YOU-TYPE RACE, kept from the old box: a slow query for "duct" can
     land AFTER a fast one for "ductwork" and paint the wrong photos under the
     right word. Only the last query's answer may reach the screen. Both
     answers are held open deliberately and released in the wrong order. */
  it("ignores a slow photo answer that arrives after a newer one", async () => {
    const release: Record<string, (hits: unknown[]) => void> = {};
    searchPhotos.mockImplementation(
      (...args: unknown[]) =>
        new Promise((resolve) => {
          release[args[0] as string] = (hits) =>
            resolve({ ok: true, hits, banked: 84, capped: false });
        })
    );

    render(<OverviewScreen data={loaded} />);
    await userEvent.type(box(), "duct");
    await waitFor(() => expect(release["duct"]).toBeDefined());
    await userEvent.type(box(), "work");
    await waitFor(() => expect(release["ductwork"]).toBeDefined());

    release["ductwork"]([photoHit({ remoteId: "fresh", caption: "FRESH ANSWER" })]);
    expect(await screen.findByText("FRESH ANSWER")).toBeInTheDocument();

    /* Released inside `act`, or the assertions run before React has processed
       the stale update and the test passes for the wrong reason. */
    await act(async () => {
      release["duct"]([photoHit({ remoteId: "stale", caption: "STALE ANSWER" })]);
      await Promise.resolve();
    });
    expect(screen.queryByText("STALE ANSWER")).toBeNull();
    expect(screen.getByText("FRESH ANSWER")).toBeInTheDocument();
  });

  /* ── the viewer a photo hit opens ── */

  /* THE STAR ON A RESULT CARD says whether that photo is already in the
     gallery — and here, unlike the gallery where everything is starred by
     definition, it genuinely varies. It is what lets a search end in a
     decision without opening anything. */
  it("says on each result whether it is already in the gallery", async () => {
    searchPhotos.mockResolvedValue({
      ok: true,
      hits: [
        photoHit({ remoteId: "kept", caption: "Already kept", starred: true }),
        photoHit({ remoteId: "loose", caption: "Not kept", starred: false }),
      ],
      banked: 84,
      capped: false,
    });
    render(<OverviewScreen data={loaded} />);
    await userEvent.type(box(), "PUZ-M125");

    expect(await screen.findByRole("button", { name: "Unstar Already kept" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Star Not kept" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("keeps a photo straight off the results card", async () => {
    searchPhotos.mockResolvedValue({
      ok: true,
      hits: [photoHit({ remoteId: "loose", caption: "Not kept", starred: false })],
      banked: 84,
      capped: false,
    });
    render(<OverviewScreen data={loaded} />);
    await userEvent.type(box(), "PUZ-M125");

    await userEvent.click(await screen.findByRole("button", { name: "Star Not kept" }));
    expect(setJobPhotoFavourite).toHaveBeenCalledWith("job-1", "loose", true);
    expect(screen.getByRole("button", { name: "Unstar Not kept" })).toBeInTheDocument();
  });

  /* The card and the viewer over it are two views of one photograph, so the
     star has to read the same in both — a mark that flips depending on which
     one you are looking at is a bug with two right answers. */
  it("shows one star state on the card and in the viewer over it", async () => {
    searchPhotos.mockResolvedValue({
      ok: true,
      hits: [photoHit({ remoteId: "b-1", caption: "The plate", starred: false })],
      banked: 84,
      capped: false,
    });
    render(<OverviewScreen data={loaded} />);
    await userEvent.type(box(), "PUZ-M125");
    await userEvent.click(await screen.findByRole("button", { name: "Star The plate" }));

    await userEvent.click(screen.getByRole("button", { name: "Open The plate" }));
    const viewer = screen.getByRole("dialog");
    expect(within(viewer).getByRole("button", { name: "Unstar The plate" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("opens a hit in the viewer and stars it from there", async () => {
    searchPhotos.mockResolvedValue({
      ok: true,
      hits: [photoHit({ remoteId: "b-1" })],
      banked: 84,
      capped: false,
    });
    render(<OverviewScreen data={loaded} />);
    await userEvent.type(box(), "PUZ-M125");
    await userEvent.click(
      await screen.findByRole("button", { name: "Open Mitsubishi outdoor unit rating plate" })
    );

    const viewer = screen.getByRole("dialog");
    expect(within(viewer).getByText(/#907 · Heuvel Construction/)).toBeInTheDocument();
    /* The hit said it was not starred, so the star draws ready to keep it —
       a search that just found the right photo is also the moment to keep it. */
    await userEvent.click(
      within(viewer).getByRole("button", { name: /Star Mitsubishi outdoor unit rating plate/ })
    );
    expect(setJobPhotoFavourite).toHaveBeenCalledWith("job-1", "b-1", true);
  });

  /* Escape peels the viewer FIRST; the search under it survives to be read
     again. A second Escape is the one that clears the field. */
  it("closes the viewer on Escape without tearing the search down with it", async () => {
    searchPhotos.mockResolvedValue({
      ok: true,
      hits: [photoHit({ remoteId: "b-1" })],
      banked: 84,
      capped: false,
    });
    render(<OverviewScreen data={loaded} />);
    await userEvent.type(box(), "PUZ-M125");
    await userEvent.click(
      await screen.findByRole("button", { name: "Open Mitsubishi outdoor unit rating plate" })
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(/1 match for/)).toBeInTheDocument();
    expect(box()).toHaveValue("PUZ-M125");
  });

  it("takes the viewer down with the search when the search is cleared", async () => {
    searchPhotos.mockResolvedValue({
      ok: true,
      hits: [photoHit({ remoteId: "b-1" })],
      banked: 84,
      capped: false,
    });
    render(<OverviewScreen data={loaded} />);
    await userEvent.type(box(), "PUZ-M125");
    await userEvent.click(
      await screen.findByRole("button", { name: "Open Mitsubishi outdoor unit rating plate" })
    );

    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/matches for/)).toBeNull();
  });
});

describe("what the screen tells the Tiff button", () => {
  const withProbe = (data: WorkboardData) =>
    render(
      <NoteScopeProvider voiceEnabled>
        <ScopeProbe />
        <OverviewScreen data={data} />
      </NoteScopeProvider>
    );

  it("carries no capture control of its own — that lives in the frame now", () => {
    const { container } = withProbe(base);
    expect(container.querySelector(".wb2-tok")).toBeNull();
    expect(screen.queryByLabelText(/Ask or tell Tiff/)).not.toBeInTheDocument();
  });

  /* An open job and somebody to name in it — the two things the button needs
     from a board before a spoken note can be pinned or a person recognised. */
  const loaded: WorkboardData = {
    ...base,
    board: {
      ...base.board,
      visits: [visitStub({ id: "v-1", status: "booked", clientName: "Meridian Data" })],
      staff: [{ id: "s-1", name: "Dane Whitcombe" }] as WorkboardData["board"]["staff"],
    },
  };

  it("reports the board's jobs and roster upward, so a note can be pinned", () => {
    withProbe(loaded);
    expect(screen.getByTestId("scope")).toHaveTextContent("1 jobs");
  });

  it("stops reporting when the screen goes away, so the button is not left holding a stale board", () => {
    const { unmount } = withProbe(loaded);
    expect(screen.getByTestId("scope")).toHaveTextContent("1 jobs");
    unmount();

    render(
      <NoteScopeProvider voiceEnabled>
        <ScopeProbe />
      </NoteScopeProvider>
    );
    expect(screen.getByTestId("scope")).toHaveTextContent("none|-|0 jobs|0 names");
  });
});
