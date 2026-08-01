/* The Workboard's several lives: standalone (no integration — the board says
   so and keeps working), connected (counts + the week's run sheet, rendered
   from mirror strings without any Date() reinterpretation), and DEMO (the
   throwaway fixture, which must be unmistakable and must never link).

   The behaviour these lock down is the command-centre brief: the numbers up
   top are the filter, the two tabs are one control, and nothing that says
   "urgent" is allowed to be decoration. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverviewScreen } from "../overview-screen";
import type { RadarItem } from "@/lib/workboard/maintenance-query";
import type { ProjectStripItem } from "@/lib/workboard/projects-query";
import type { WorkboardData } from "@/lib/workboard/page-data";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

/* The capture box is its own component with its own suite; the server actions
   behind it can't be imported into jsdom. */
jest.mock("../note-capture", () => ({
  NoteCapture: ({ voiceEnabled }: { voiceEnabled: boolean }) => (
    <div data-testid="capture">{voiceEnabled ? "voice on" : "typing only"}</div>
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
  voiceEnabled: false,
  synced: null,
};

function visit(over: Partial<RadarItem> & { visitId: string }): RadarItem {
  return {
    agreementId: "a-1",
    label: "Warehouse quarterly",
    clientName: "Acme",
    siteLabel: null,
    dueDate: "2026-08-04",
    bucket: "upcoming",
    status: "upcoming",
    ready: 2,
    readyTotal: 2,
    readiness: {
      equipment_ready: true,
      access_confirmed: true,
    },
    jobNumber: null,
    bookedStart: null,
    ...over,
  };
}

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

/* The load rail and the list below it deliberately share vocabulary — a week
   column and a group heading both say "Overdue", a funnel column and a card
   chip both say "Rough-in" — so assertions about the LIST scope themselves to
   its card rather than searching the whole board. */
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

  it("offers Display mode for the wall screen", () => {
    render(<OverviewScreen data={base} />);
    expect(screen.getByRole("button", { name: /Display mode/ })).toBeInTheDocument();
  });
});

describe("the switcher", () => {
  it("opens on Maintenance and swaps the whole board for Projects", async () => {
    render(<OverviewScreen data={{ ...base, radar: [visit({ visitId: "v1" })], projects: [project({ id: "p1" })] }} />);

    expect(screen.getByText("Services on the radar")).toBeInTheDocument();
    expect(screen.queryByText("Live projects")).not.toBeInTheDocument();

    await toProjects();

    expect(screen.getByText("Live projects")).toBeInTheDocument();
    expect(screen.queryByText("Services on the radar")).not.toBeInTheDocument();
    expect(screen.getByText("Smith St change-over")).toBeInTheDocument();
  });

  it("drives the sliding thumb by index rather than swapping a background", async () => {
    render(<OverviewScreen data={base} />);
    const seg = screen.getByRole("navigation", { name: "Board" });
    expect(seg).toHaveAttribute("data-active", "0");
    await toProjects();
    expect(seg).toHaveAttribute("data-active", "1");
  });
});

describe("the vitals", () => {
  const overdue = visit({ visitId: "late", dueDate: "2026-07-19", bucket: "overdue" });
  const bare = visit({
    visitId: "bare",
    dueDate: "2026-08-01",
    bucket: "due_soon",
    ready: 1,
    readyTotal: 2,
    readiness: {
      equipment_ready: false,
      access_confirmed: true,
    },
  });

  it("counts urgent and attention off the radar, and says why", () => {
    render(<OverviewScreen data={{ ...base, radar: [overdue, bare, visit({ visitId: "fine" })] }} />);
    const urgent = screen.getByRole("button", { name: /Urgent/ });
    expect(within(urgent).getByText("1")).toBeInTheDocument();
    expect(within(urgent).getByText("Oldest is 9 days over")).toBeInTheDocument();
    expect(
      within(screen.getByRole("button", { name: /Needs attention/ })).getByText("1 of 2 checks ticked")
    ).toBeInTheDocument();
  });

  it("is a filter, not a readout — pressing Urgent hides everything else", async () => {
    render(<OverviewScreen data={{ ...base, radar: [overdue, bare] }} />);
    expect(card("Services").getByText("Due soon")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Urgent/ }));

    expect(screen.getByRole("button", { name: /Urgent/ })).toHaveAttribute("aria-pressed", "true");
    expect(card("Services").getByText("Overdue")).toBeInTheDocument();
    expect(card("Services").queryByText("Due soon")).not.toBeInTheDocument();
  });

  it("says the good outcome out loud when a filter comes up empty", async () => {
    render(<OverviewScreen data={{ ...base, radar: [visit({ visitId: "fine" })] }} />);
    await userEvent.click(screen.getByRole("button", { name: /Urgent/ }));
    expect(screen.getByText(/Nothing urgent/)).toBeInTheDocument();
  });

  it("drops a filter when you change tabs, rather than hiding rows silently", async () => {
    render(
      <OverviewScreen
        data={{ ...base, radar: [overdue], projects: [project({ id: "p1" })] }}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /Urgent/ }));
    await toProjects();
    // p1 moved yesterday and is not urgent — it must still be on screen.
    expect(screen.getByRole("button", { name: /Live projects/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByText("Smith St change-over")).toBeInTheDocument();
  });
});

describe("the maintenance list", () => {
  it("groups hardest-first, breathes on overdue, and names what's missing", () => {
    const radar = (bucket: RadarItem["bucket"], i: number) =>
      visit({
        visitId: `v-${bucket}-${i}`,
        bucket,
        dueDate: bucket === "overdue" ? "2026-07-20" : "2026-08-04",
        ready: 1,
        readyTotal: 2,
        readiness: {
          equipment_ready: false,
          access_confirmed: true,
        },
      });
    render(
      <OverviewScreen
        data={{ ...base, radar: [radar("upcoming", 1), radar("overdue", 2), radar("due_soon", 3)] }}
      />
    );
    const services = card("Services");
    expect(services.getByText("Overdue")).toBeInTheDocument();
    expect(services.getByText("Due soon")).toBeInTheDocument();
    expect(services.getByText("Coming up")).toBeInTheDocument();

    // the overdue row carries the breathe class — the wall screen's whole brief
    const overdueRow = screen.getAllByText("Warehouse quarterly")[0].closest("a");
    expect(overdueRow?.className).toContain("wb-pulse");

    // pips name the gap rather than reporting a fraction nobody can act on
    expect(screen.getAllByText("Equipment")).toHaveLength(3);
  });

  it("says Ready when both stored gates are ticked", () => {
    render(<OverviewScreen data={{ ...base, radar: [visit({ visitId: "v1" })] }} />);
    expect(screen.getByText("Ready")).toBeInTheDocument();
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
    expect(within(screen.getByRole("button", { name: /Urgent/ })).getByText("1")).toBeInTheDocument();
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

/* Smart Notes lives on this screen too — the capture box above the board and
   the flags people spoke into it. The command-centre rebuild must not have
   quietly dropped either; that regression is exactly what these pin. */
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

  it("pulses urgent flags and offers to clear them", () => {
    render(
      <OverviewScreen
        data={{
          ...base,
          flags: [flag("urgent", "No roof access booked"), flag("info", "Gate code changed")],
        }}
      />
    );
    expect(screen.getByText("Raised from notes")).toBeInTheDocument();
    // only the urgent one breathes — that's the signal, and it's wasted if
    // everything pulses
    expect(screen.getByText("No roof access booked").closest("div")?.className).toContain("wb-pulse");
    expect(screen.getByText("Gate code changed").closest("div")?.className).not.toContain("wb-pulse");
    expect(screen.getAllByRole("button", { name: "Clear" })).toHaveLength(2);
  });

  it("hides the flags card entirely when there's nothing raised", () => {
    render(<OverviewScreen data={base} />);
    expect(screen.queryByText("Raised from notes")).not.toBeInTheDocument();
  });

  it("shows the flags on BOTH tabs — a spoken flag is neither maintenance nor projects", async () => {
    render(<OverviewScreen data={{ ...base, flags: [flag("urgent", "No roof access booked")] }} />);
    expect(screen.getByText("No roof access booked")).toBeInTheDocument();
    await toProjects();
    expect(screen.getByText("No roof access booked")).toBeInTheDocument();
  });

  it("leaves the Urgent vital alone — a human's severity word is not the rule", () => {
    render(<OverviewScreen data={{ ...base, flags: [flag("urgent", "No roof access booked")] }} />);
    // vitals.ts defines Urgent as overdue visits; the radar here is empty.
    expect(within(screen.getByRole("button", { name: /Urgent/ })).getByText("0")).toBeInTheDocument();
  });
});
