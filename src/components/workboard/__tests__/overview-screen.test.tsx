/* The Workboard's several lives: standalone (no integration — the board says
   so and keeps working), connected (counts + the week's run sheet, rendered
   from mirror strings without any Date() reinterpretation), and the two
   sides of the switcher — the redesigned maintenance BOARD (its own suite
   lives in board/__tests__) and the projects side, which keeps the vitals
   filter, the flags card and the pipeline. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverviewScreen } from "../overview-screen";
import type { ProjectStripItem } from "@/lib/workboard/projects-query";
import type { WorkboardData } from "@/lib/workboard/page-data";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

/* The capture box is its own component with its own suite; the server actions
   behind it can't be imported into jsdom. Same for the maintenance board —
   here we only pin that the switcher mounts it with the right dataset. */
jest.mock("../note-capture", () => ({
  NoteCapture: ({ voiceEnabled }: { voiceEnabled: boolean }) => (
    <div data-testid="capture">{voiceEnabled ? "voice on" : "typing only"}</div>
  ),
}));
jest.mock("../board/maintenance-board", () => ({
  MaintenanceBoard: ({ manage, connected }: { manage: boolean; connected: boolean }) => (
    <div data-testid="mboard">
      board · manage:{String(manage)} · connected:{String(connected)}
    </div>
  ),
}));
jest.mock("@/app/actions/workboard-notes", () => ({ clearFlag: jest.fn() }));

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
  board: { visits: [], agreements: [], staff: [], tagPool: [], tasks: [] },
  voiceEnabled: false,
  synced: null,
};

function project(over: Partial<ProjectStripItem> & { id: string }): ProjectStripItem {
  return {
    name: "Smith St change-over",
    clientName: "Smith",
    siteLabel: null,
    stage: "Rough-in",
    status: "active",
    percent: 40,
    done: 6,
    total: 15,
    updatedAt: `${TODAY}T01:00:00Z`,
    ...over,
  };
}

const toProjects = () => userEvent.click(screen.getByRole("button", { name: "Projects" }));

const card = (heading: string) =>
  within(screen.getByText(heading).closest(".card2") as HTMLElement);

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
  it("opens on Maintenance — the redesigned board — and swaps whole for Projects", async () => {
    render(<OverviewScreen data={{ ...base, projects: [project({ id: "p1" })] }} />);

    expect(screen.getByTestId("mboard")).toBeInTheDocument();
    expect(screen.queryByText("Live projects")).not.toBeInTheDocument();

    await toProjects();

    expect(screen.getByText("Live projects")).toBeInTheDocument();
    expect(screen.queryByTestId("mboard")).not.toBeInTheDocument();
    expect(screen.getByText("Smith St change-over")).toBeInTheDocument();
  });

  it("hands the board its permissions and connection truthfully", () => {
    render(<OverviewScreen data={{ ...base, manage: true, connection: "connected" }} />);
    expect(screen.getByTestId("mboard")).toHaveTextContent("manage:true");
    expect(screen.getByTestId("mboard")).toHaveTextContent("connected:true");
  });

  it("drives the sliding thumb by index rather than swapping a background", async () => {
    render(<OverviewScreen data={base} />);
    const seg = screen.getByRole("navigation", { name: "Board" });
    expect(seg).toHaveAttribute("data-active", "0");
    await toProjects();
    expect(seg).toHaveAttribute("data-active", "1");
  });

  it("keeps Display mode a projects-side offer until step 5's wall composition", async () => {
    render(<OverviewScreen data={base} />);
    expect(screen.queryByRole("button", { name: /Display mode/ })).not.toBeInTheDocument();
    await toProjects();
    expect(screen.getByRole("button", { name: /Display mode/ })).toBeInTheDocument();
  });
});

describe("the projects vitals", () => {
  it("live only on the projects side — the maintenance board carries its own signal", async () => {
    render(<OverviewScreen data={{ ...base, projects: [project({ id: "p1", status: "on_hold" })] }} />);
    expect(screen.queryByRole("button", { name: /Urgent/ })).not.toBeInTheDocument();
    await toProjects();
    expect(
      within(screen.getByRole("button", { name: /Urgent/ })).getByText("1")
    ).toBeInTheDocument();
  });

  it("filter and the good-outcome empty state still work", async () => {
    render(<OverviewScreen data={{ ...base, projects: [project({ id: "p1" })] }} />);
    await toProjects();
    await userEvent.click(screen.getByRole("button", { name: /Urgent/ }));
    expect(screen.getByText(/Nothing urgent/)).toBeInTheDocument();
  });
});

describe("the projects list", () => {
  it("links each card and shows its checklist and stage", async () => {
    render(<OverviewScreen data={{ ...base, projects: [project({ id: "p-1" })] }} />);
    await toProjects();
    expect(screen.getByText("Smith St change-over").closest("a")).toHaveAttribute(
      "href",
      "/dashboard/workboard/projects/p-1"
    );
    expect(card("Projects in flight").getByText("Rough-in")).toBeInTheDocument();
    expect(screen.getByText(/6\/15 ticked/)).toBeInTheDocument();
  });

  it("flags a stalled project with its reason, not a bare colour", async () => {
    render(
      <OverviewScreen
        data={{ ...base, projects: [project({ id: "p-1", updatedAt: "2026-07-17T01:00:00Z" })] }}
      />
    );
    await toProjects();
    expect(screen.getByText("No movement for 11 days")).toBeInTheDocument();
  });

  it("carries an on-hold project instead of hiding it", async () => {
    render(<OverviewScreen data={{ ...base, projects: [project({ id: "p-1", status: "on_hold" })] }} />);
    await toProjects();
    expect(screen.getByText("On hold")).toBeInTheDocument();
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

  it("says when the connection itself needs attention", () => {
    render(<OverviewScreen data={{ ...connected, connection: "attention", counts: null }} />);
    expect(screen.getByText(/needs attention/)).toBeInTheDocument();
  });
});

/* Smart Notes still lives on this screen — the capture box above the board.
   The flags card is now the PROJECTS side's surface only: on the maintenance
   board a flag is an urgent row with its Clear right there (the L1 ruleset),
   and rendering it twice would break the board's one rule. */
describe("smart notes", () => {
  const flag = (severity: "urgent" | "warn" | "info", message: string) => ({
    id: `f-${severity}`,
    message,
    severity,
    targetKind: "none" as const,
    targetId: null,
    createdAt: "2026-07-28T00:00:00.000Z",
  });

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

  it("shows the flags card on the projects side only — the maintenance board owns them as urgent rows", async () => {
    render(<OverviewScreen data={{ ...base, flags: [flag("urgent", "No roof access booked")] }} />);
    expect(screen.queryByText("Raised from notes")).not.toBeInTheDocument();
    await toProjects();
    expect(screen.getByText("Raised from notes")).toBeInTheDocument();
    // only the urgent one breathes — that's the signal
    expect(screen.getByText("No roof access booked").closest("div")?.className).toContain("wb-pulse");
    expect(screen.getAllByRole("button", { name: "Clear" })).toHaveLength(1);
  });

  it("hides the flags card entirely when there's nothing raised", async () => {
    render(<OverviewScreen data={base} />);
    await toProjects();
    expect(screen.queryByText("Raised from notes")).not.toBeInTheDocument();
  });

  it("leaves the projects Urgent vital alone — a human's severity word is not the rule", async () => {
    render(<OverviewScreen data={{ ...base, flags: [flag("urgent", "No roof access booked")] }} />);
    await toProjects();
    expect(within(screen.getByRole("button", { name: /Urgent/ })).getByText("0")).toBeInTheDocument();
  });
});
