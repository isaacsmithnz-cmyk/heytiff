/* The Workboard page's own job — everything that isn't inside a board card.
   Both sides run the redesigned architecture (each side's suite lives in
   board/__tests__); here we pin what the PAGE owns: the centre switcher and
   its per-side counts, the capture pill's ownership, mirror health reaching
   both rows, and the flag ROUTING that keeps a flag on exactly one board. */

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverviewScreen } from "../overview-screen";
import type { WorkboardData } from "@/lib/workboard/page-data";
import type { ProjectBoardVisit } from "@/lib/workboard/projects-board-query";
import type { BoardVisit } from "@/lib/workboard/board-query";
import type { BoardFlag } from "@/lib/workboard/notes-query";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

/* The capture box is its own component with its own suite; the server actions
   behind it can't be imported into jsdom. Same for both boards — here we only
   pin that the switcher mounts each with the right dataset, flags and tools. */
jest.mock("../note-capture", () => ({
  NoteCapture: ({ voiceEnabled }: { voiceEnabled: boolean }) => (
    <div data-testid="capture">{voiceEnabled ? "voice on" : "typing only"}</div>
  ),
}));

type BoardStub = {
  manage: boolean;
  connected: boolean;
  flags: unknown[];
  tools?: React.ReactNode;
  sm8?: { attention: boolean } | null;
};
/* jest.mock is hoisted above every const, so each factory builds its own
   stub rather than closing over a shared helper. */
const stubBody = (testid: string, p: BoardStub) => (
  <div data-testid={testid}>
    board · manage:{String(p.manage)} · connected:{String(p.connected)} · flags:{p.flags.length} ·
    sm8:
    {p.sm8 ? (p.sm8.attention ? "attention" : "ok") : "none"}
    {p.tools}
  </div>
);
jest.mock("../board/maintenance-board", () => ({
  MaintenanceBoard: (p: BoardStub) => stubBody("mboard", p),
}));
jest.mock("../board/projects-board", () => ({
  ProjectsBoard: (p: BoardStub) => stubBody("pboard", p),
}));

const TODAY = "2026-07-28";

const base: WorkboardData = {
  manage: false,
  connection: "none",
  timezone: null,
  today: TODAY,
  flags: [],
  board: { visits: [], agreements: [], staff: [], tagPool: [], categories: [], tasks: [] },
  projectsBoard: { projects: [], visits: [], staff: [] },
  voiceEnabled: false,
  aiEnabled: false,
  synced: null,
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
const seg = () => screen.getByRole("tablist", { name: "Which work" });

describe("standalone", () => {
  it("says it runs without an integration, and only routes managers to connect", () => {
    render(<OverviewScreen data={base} />);
    expect(screen.getByText(/Running standalone/)).toBeInTheDocument();
    expect(screen.queryByText(/Connect ServiceM8/)).not.toBeInTheDocument();
  });

  it("offers the connect path to someone who can act on it", () => {
    render(<OverviewScreen data={{ ...base, manage: true }} />);
    expect(screen.getByText(/Connect ServiceM8/).closest("a")).toHaveAttribute(
      "href",
      "/dashboard/admin/integrations/servicem8"
    );
  });

  it("gives neither board a mirror-health chip when there is no mirror", () => {
    render(<OverviewScreen data={base} />);
    expect(screen.getByTestId("mboard")).toHaveTextContent("sm8:none");
  });
});

describe("the switcher", () => {
  it("opens on Maintenance and swaps whole boards", async () => {
    render(<OverviewScreen data={base} />);

    expect(screen.getByTestId("mboard")).toBeInTheDocument();
    expect(screen.queryByTestId("pboard")).not.toBeInTheDocument();

    await toProjects();

    expect(screen.getByTestId("pboard")).toBeInTheDocument();
    expect(screen.queryByTestId("mboard")).not.toBeInTheDocument();
  });

  it("carries the live side on the element, so the fill takes that side's colour", async () => {
    render(<OverviewScreen data={base} />);
    expect(seg()).toHaveAttribute("data-on", "maintenance");
    await toProjects();
    expect(seg()).toHaveAttribute("data-on", "projects");
  });

  it("hands both boards their permissions and connection truthfully", async () => {
    render(<OverviewScreen data={{ ...base, manage: true, connection: "connected" }} />);
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

  it("keeps the capture pill — the mode is for working, not watching", async () => {
    render(<OverviewScreen data={base} />);
    await enter();
    expect(screen.getByTestId("capture")).toBeInTheDocument();
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
    expect(screen.getByTestId("mboard")).toHaveTextContent("sm8:ok");
    await toProjects();
    expect(screen.getByTestId("pboard")).toHaveTextContent("sm8:ok");
  });

  it("says when the connection itself needs attention, on either side", async () => {
    render(<OverviewScreen data={{ ...connected, connection: "attention" }} />);
    expect(screen.getByTestId("mboard")).toHaveTextContent("sm8:attention");
    await toProjects();
    expect(screen.getByTestId("pboard")).toHaveTextContent("sm8:attention");
  });

  it("drops the standalone line once a mirror exists", () => {
    render(<OverviewScreen data={connected} />);
    expect(screen.queryByText(/Running standalone/)).not.toBeInTheDocument();
  });
});

describe("smart notes", () => {
  it("hands the pill to whichever board is up, and says whether the mic is available", async () => {
    const { rerender } = render(<OverviewScreen data={base} />);
    expect(screen.getByTestId("capture")).toHaveTextContent("typing only");
    rerender(<OverviewScreen data={{ ...base, voiceEnabled: true }} />);
    expect(screen.getByTestId("capture")).toHaveTextContent("voice on");
    await toProjects();
    expect(screen.getByTestId("capture")).toBeInTheDocument();
  });

  it("docks the pill INSIDE the board's tab row, where the design puts it", () => {
    const { container } = render(<OverviewScreen data={base} />);
    expect(container.querySelector(".wb-board [data-testid='capture']")).not.toBeNull();
  });
});
