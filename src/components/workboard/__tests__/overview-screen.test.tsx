/* The Workboard's several lives: standalone (no integration — the board says
   so and keeps working), connected (counts + the week's run sheet, rendered
   from mirror strings without any Date() reinterpretation), and the two
   sides of the switcher — now BOTH the redesigned board architecture (each
   side's suite lives in board/__tests__; here we pin what the page owns:
   the switcher, the capture pill, the run sheet, and the flag ROUTING that
   keeps a flag on exactly one board). */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverviewScreen } from "../overview-screen";
import type { WorkboardData } from "@/lib/workboard/page-data";
import type { ProjectBoardVisit } from "@/lib/workboard/projects-board-query";
import type { BoardFlag } from "@/lib/workboard/notes-query";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

/* The capture box is its own component with its own suite; the server actions
   behind it can't be imported into jsdom. Same for both boards — here we only
   pin that the switcher mounts each with the right dataset and flags. */
jest.mock("../note-capture", () => ({
  NoteCapture: ({ voiceEnabled }: { voiceEnabled: boolean }) => (
    <div data-testid="capture">{voiceEnabled ? "voice on" : "typing only"}</div>
  ),
}));
jest.mock("../board/maintenance-board", () => ({
  MaintenanceBoard: ({
    manage,
    connected,
    flags,
    calOthers,
  }: {
    manage: boolean;
    connected: boolean;
    flags: unknown[];
    calOthers?: unknown[];
  }) => (
    <div data-testid="mboard">
      board · manage:{String(manage)} · connected:{String(connected)} · flags:{flags.length} ·
      others:{calOthers?.length ?? 0}
    </div>
  ),
}));
jest.mock("../board/projects-board", () => ({
  ProjectsBoard: ({
    manage,
    connected,
    flags,
    calOthers,
  }: {
    manage: boolean;
    connected: boolean;
    flags: unknown[];
    calOthers?: unknown[];
  }) => (
    <div data-testid="pboard">
      projects · manage:{String(manage)} · connected:{String(connected)} · flags:{flags.length} ·
      others:{calOthers?.length ?? 0}
    </div>
  ),
}));

const TODAY = "2026-07-28";

const base: WorkboardData = {
  manage: false,
  connection: "none",
  timezone: null,
  today: TODAY,
  counts: null,
  upcoming: [],
  projects: [],
  radar: [],
  flags: [],
  board: { visits: [], agreements: [], staff: [], tagPool: [], categories: [], tasks: [] },
  projectsBoard: { projects: [], visits: [], staff: [] },
  voiceEnabled: false,
  aiEnabled: false,
  synced: null,
};

const tripStub = (id: string): ProjectBoardVisit => ({
  id,
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
});

const flag = (over: Partial<BoardFlag> & { id: string }): BoardFlag => ({
  message: "No roof access booked",
  severity: "urgent",
  targetKind: "none",
  targetId: null,
  createdAt: "2026-07-28T00:00:00.000Z",
  ...over,
});

const toProjects = () => userEvent.click(screen.getByRole("button", { name: "Projects" }));

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

  it("hands both boards their permissions and connection truthfully", async () => {
    render(<OverviewScreen data={{ ...base, manage: true, connection: "connected" }} />);
    expect(screen.getByTestId("mboard")).toHaveTextContent("manage:true");
    expect(screen.getByTestId("mboard")).toHaveTextContent("connected:true");
    await toProjects();
    expect(screen.getByTestId("pboard")).toHaveTextContent("manage:true");
    expect(screen.getByTestId("pboard")).toHaveTextContent("connected:true");
  });

  it("hands each board the OTHER side's visits for the merged calendar (P3)", async () => {
    const data: WorkboardData = {
      ...base,
      projectsBoard: { ...base.projectsBoard, visits: [tripStub("pv-1"), tripStub("pv-2")] },
    };
    render(<OverviewScreen data={data} />);
    expect(screen.getByTestId("mboard")).toHaveTextContent("others:2");
    await toProjects();
    // maintenance board holds no visits in this fixture
    expect(screen.getByTestId("pboard")).toHaveTextContent("others:0");
  });

  it("drives the sliding thumb by index rather than swapping a background", async () => {
    render(<OverviewScreen data={base} />);
    const seg = screen.getByRole("navigation", { name: "Board" });
    expect(seg).toHaveAttribute("data-active", "0");
    await toProjects();
    expect(seg).toHaveAttribute("data-active", "1");
  });

  it("offers Display mode on both sides", async () => {
    render(<OverviewScreen data={base} />);
    expect(screen.getByRole("button", { name: /Display mode/ })).toBeInTheDocument();
    await toProjects();
    expect(screen.getByRole("button", { name: /Display mode/ })).toBeInTheDocument();
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
      projectsBoard: { ...base.projectsBoard, visits: [tripStub("pv-9")] },
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
    counts: { quotes: 4, workOrders: 11, completedFortnight: 9 },
    upcoming: [
      {
        id: "a-1",
        start: "2026-07-29 07:30:00",
        end: "2026-07-29 09:30:00",
        staffName: "Luke Nguyen",
        jobNumber: "1042",
        jobStatus: "Work Order",
        clientName: "Acme Air Pty Ltd",
        suburb: "Milton",
      },
    ],
    synced: { finishedAt: new Date(Date.now() - 3 * 60_000).toISOString(), running: false },
  };

  it("renders the counts and the run sheet from mirror strings", () => {
    render(<OverviewScreen data={connected} />);
    expect(screen.getByText(/work\s*orders/)).toBeInTheDocument();
    expect(screen.getByText("11")).toBeInTheDocument();
    // 07:30 wall-clock renders as 7:30am — string maths, no Date()
    expect(screen.getByText("7:30am")).toBeInTheDocument();
    expect(screen.getByText("#1042")).toBeInTheDocument();
    expect(screen.getByText("Acme Air Pty Ltd")).toBeInTheDocument();
    expect(screen.getByText("Luke Nguyen")).toBeInTheDocument();
  });

  it("keeps the run sheet on both tabs — it's the crew's week, not a category", async () => {
    render(<OverviewScreen data={connected} />);
    expect(screen.getByText("Booked in — next 7 days")).toBeInTheDocument();
    await toProjects();
    expect(screen.getByText("Booked in — next 7 days")).toBeInTheDocument();
  });

  it("stamps the mirror's age and the account's clock", () => {
    render(<OverviewScreen data={connected} />);
    expect(screen.getByText(/Mirror synced 3 min ago/)).toBeInTheDocument();
    expect(screen.getByText(/Australia\/Brisbane/)).toBeInTheDocument();
  });

  it("says when the connection itself needs attention — on the projects side; the board's own chip carries it for maintenance", async () => {
    render(<OverviewScreen data={{ ...connected, connection: "attention", counts: null }} />);
    // maintenance side: the mocked board owns the news (its sm8 chip)
    expect(screen.queryByText(/needs attention — job data/)).not.toBeInTheDocument();
    await toProjects();
    expect(screen.getByText(/needs attention/)).toBeInTheDocument();
  });
});

describe("smart notes", () => {
  it("offers the capture box, and says whether the mic is available", () => {
    const { rerender } = render(<OverviewScreen data={base} />);
    expect(screen.getByTestId("capture")).toHaveTextContent("typing only");
    rerender(<OverviewScreen data={{ ...base, voiceEnabled: true }} />);
    expect(screen.getByTestId("capture")).toHaveTextContent("voice on");
  });

  it("keeps the capture box OUTSIDE the board, so Display mode drops it", () => {
    const { container } = render(<OverviewScreen data={base} />);
    expect(container.querySelector(".wb-board [data-testid='capture']")).toBeNull();
    expect(screen.getByTestId("capture")).toBeInTheDocument();
  });
});
