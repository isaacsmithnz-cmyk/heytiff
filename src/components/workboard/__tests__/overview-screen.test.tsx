/* The Overview's two lives: standalone (no integration — the board says so
   and keeps working) and connected (stats + the week's run sheet, rendered
   from mirror strings without any Date() reinterpretation). */

import { render, screen } from "@testing-library/react";
import { OverviewScreen } from "../overview-screen";
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

const base: WorkboardData = {
  manage: false,
  connection: "none",
  timezone: null,
  today: "2026-07-28",
  counts: null,
  upcoming: [],
  projects: [],
  radar: [],
  flags: [],
  voiceEnabled: false,
  synced: null,
};

describe("standalone", () => {
  it("says it runs without an integration, and only routes managers to connect", () => {
    render(<OverviewScreen data={base} />);
    expect(screen.getByText("Running standalone")).toBeInTheDocument();
    expect(screen.queryByText(/Admin → Integrations/)).not.toBeInTheDocument();
  });

  it("offers the connect path to someone who can act on it", () => {
    render(<OverviewScreen data={{ ...base, manage: true }} />);
    expect(screen.getByText(/Admin → Integrations/).closest("a")).toHaveAttribute(
      "href",
      "/dashboard/admin/integrations/servicem8"
    );
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

  it("renders the stats and the run sheet from mirror strings", () => {
    render(<OverviewScreen data={connected} />);
    expect(screen.getByText("Open quotes")).toBeInTheDocument();
    expect(screen.getByText("11")).toBeInTheDocument();
    // 07:30 wall-clock renders as 7:30am — string maths, no Date()
    expect(screen.getByText("7:30am")).toBeInTheDocument();
    expect(screen.getByText("#1042")).toBeInTheDocument();
    expect(screen.getByText("Acme Air Pty Ltd")).toBeInTheDocument();
    expect(screen.getByText("Luke Nguyen")).toBeInTheDocument();
  });

  it("stamps the mirror's age and the account's clock", () => {
    render(<OverviewScreen data={connected} />);
    expect(screen.getByText(/Mirror synced 3 min ago/)).toBeInTheDocument();
    expect(screen.getByText(/Australia\/Brisbane/)).toBeInTheDocument();
  });

  it("offers Display mode for the wall screen", () => {
    render(<OverviewScreen data={connected} />);
    expect(screen.getByRole("button", { name: /Display mode/ })).toBeInTheDocument();
  });

  it("says when the connection itself needs attention", () => {
    render(<OverviewScreen data={{ ...connected, connection: "attention", counts: null }} />);
    expect(screen.getByText(/needs attention/)).toBeInTheDocument();
  });

  it("groups the radar hardest-first, and overdue rows breathe", () => {
    const radar = (bucket: "overdue" | "due_soon" | "upcoming", i: number) => ({
      visitId: `v-${bucket}-${i}`,
      agreementId: "a-1",
      label: "Warehouse quarterly",
      clientName: "Acme",
      siteLabel: null,
      dueDate: "2026-07-20",
      bucket,
      status: "upcoming",
      ready: 2,
      readyTotal: 4,
      jobNumber: null,
      bookedStart: null,
    });
    render(
      <OverviewScreen
        data={{ ...base, radar: [radar("upcoming", 1), radar("overdue", 2), radar("due_soon", 3)] }}
      />
    );
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByText("Due soon")).toBeInTheDocument();
    expect(screen.getByText("Coming up")).toBeInTheDocument();
    // the overdue row carries the breathe class — the wall screen's whole brief
    const overdueRow = screen.getAllByText("Warehouse quarterly")[0].closest("a");
    expect(overdueRow?.className).toContain("wb-pulse");
    expect(screen.getAllByText("2/4 ready")).toHaveLength(3);
  });

  it("pulses urgent flags and offers to clear them", () => {
    const flag = (severity: "urgent" | "warn" | "info", message: string) => ({
      id: `f-${severity}`,
      message,
      severity,
      targetKind: "none",
      targetId: null,
      createdAt: "2026-07-28T00:00:00.000Z",
    });
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

  it("offers the capture box, and says whether the mic is available", () => {
    const { rerender } = render(<OverviewScreen data={base} />);
    expect(screen.getByTestId("capture")).toHaveTextContent("typing only");
    rerender(<OverviewScreen data={{ ...base, voiceEnabled: true }} />);
    expect(screen.getByTestId("capture")).toHaveTextContent("voice on");
  });

  it("shows projects in flight — standalone rows, no integration required", () => {
    render(
      <OverviewScreen
        data={{
          ...base,
          projects: [
            { id: "p-1", name: "Smith St change-over", clientName: "Smith", stage: "Rough-in", percent: 40 },
          ],
        }}
      />
    );
    expect(screen.getByText("Smith St change-over").closest("a")).toHaveAttribute(
      "href",
      "/dashboard/workboard/projects/p-1"
    );
    expect(screen.getByText("Rough-in")).toBeInTheDocument();
  });
});
