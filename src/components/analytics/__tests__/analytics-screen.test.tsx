/* The analytics screen: the top line and the 180-day rule on real-shaped
   figures, the two faces, the period kept in the URL, and what it says with
   no ServiceM8 to read. */
const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh }) }));
const decideJob = jest.fn();
jest.mock("@/app/actions/analytics-decide", () => ({ decideJob: (...a: unknown[]) => decideJob(...a) }));
const markUnsuccessful = jest.fn();
jest.mock("@/app/actions/booking-sm8", () => ({ makeWorkOrder: jest.fn(), markUnsuccessful: (...a: unknown[]) => markUnsuccessful(...a) }));

import { fireEvent, render, screen } from "@testing-library/react";
import { analyse, type AnalyticsJob } from "@/lib/analytics/job-analytics";
import { AnalyticsScreen } from "../analytics-screen";

const TODAY = "2026-10-07";
let n = 0;
const job = (over: Partial<AnalyticsJob>): AnalyticsJob => ({
  id: `j${++n}`,
  status: "Quote",
  raisedOn: "2026-09-01",
  quoteSentOn: null,
  wonOn: null,
  completedOn: null,
  valueCents: 500_000,
  kind: "split",
  ...over,
});

const data = analyse(
  [
    job({ status: "Work Order", raisedOn: "2026-08-01", quoteSentOn: "2026-08-02", wonOn: "2026-08-10", valueCents: 400_000 }),
    job({ status: "Completed", raisedOn: "2025-11-01", quoteSentOn: "2025-11-03", wonOn: "2026-06-01", completedOn: "2026-07-01", valueCents: 1_500_000, kind: "ducted" }),
    job({ status: "Unsuccessful", raisedOn: "2026-05-01", quoteSentOn: "2026-05-02", valueCents: 800_000 }),
    job({ status: "Quote", raisedOn: "2026-01-10", quoteSentOn: "2026-01-12", valueCents: 300_000, kind: "multi" }),
    job({ status: "Quote", raisedOn: "2026-09-20", valueCents: null }),
  ],
  TODAY,
  "12m",
);

describe("AnalyticsScreen", () => {
  it("leads with the win rate and counts the 60-day quotes as lost", () => {
    render(<AnalyticsScreen state={{ kind: "ready", data, truncated: false }} period="12m" />);
    expect(screen.getByRole("heading", { level: 1, name: "Analytics" })).toBeInTheDocument();
    // 2 won of 4 decided: the Unsuccessful and the one past 180 days
    expect(screen.getAllByText("50%")[0]).toHaveClass("an-big");
    expect(screen.getByText("2 won of 4 decided quotes")).toBeInTheDocument();
    expect(screen.getByText("1 quote with no answer after 60 days counts as lost, $3,000 of work.")).toBeInTheDocument();
    expect(screen.getByText(/Quotes on jobs raised 8 October 2025 to 7 October 2026/)).toBeInTheDocument();
  });

  it("keeps the period in the URL, the chosen one marked", () => {
    render(<AnalyticsScreen state={{ kind: "ready", data, truncated: false }} period="12m" />);
    const chosen = screen.getByRole("link", { name: "12 months" });
    expect(chosen).toHaveAttribute("href", "/dashboard/analytics?period=12m");
    expect(chosen).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: "Financial year" })).not.toHaveAttribute("aria-current");
  });

  it("shows the rule and the lost on the Quotes face, a late win counted won", () => {
    render(<AnalyticsScreen state={{ kind: "ready", data, truncated: false }} period="12m" />);
    fireEvent.click(screen.getByRole("tab", { name: "Quotes" }));
    expect(
      screen.getByText("At 60 days with no answer. 1 of the 2 wins came inside that, and the 1 that came later count as won."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "The 2 lost" })).toBeInTheDocument();
    expect(screen.getByText("No answer after 60 days, still a Quote in ServiceM8")).toBeInTheDocument();
  });

  it("says the read was cut short when the cap bound", () => {
    render(<AnalyticsScreen state={{ kind: "ready", data, truncated: true }} period="12m" />);
    expect(screen.getByText(/the oldest are left out/)).toBeInTheDocument();
  });

  it("leads with Connect ServiceM8 when there is no copy to read", () => {
    render(<AnalyticsScreen state={{ kind: "standalone" }} period="12m" />);
    expect(screen.getByRole("link", { name: "Connect ServiceM8" })).toHaveAttribute("href", "/dashboard/admin/integrations/servicem8");
    expect(screen.queryByRole("link", { name: "12 months" })).not.toBeInTheDocument();
  });

  it("says on the Overview what waits on an answer, and the press goes to it", () => {
    const disputed = analyse(
      [job({ id: "paid", status: "Unsuccessful", paid: true, raisedOn: "2026-05-01", quoteSentOn: "2026-05-02", valueCents: 324_000 })],
      TODAY,
      "12m",
    );
    render(<AnalyticsScreen state={{ kind: "ready", data: disputed, truncated: false, names: {}, canDecide: true }} period="12m" />);
    expect(screen.getByText("1 job to decide. It is left out of these figures until then.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Decide 1 job" }));
    expect(screen.getByRole("tab", { name: /To decide/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Won or lost?" })).toBeInTheDocument();
  });

  it("counts a job with no job type apart: it is in the figures, and only waits to be placed by type", () => {
    const untyped = analyse(
      [job({ id: "u", status: "Completed", raisedOn: "2026-05-01", quoteSentOn: "2026-05-02", wonOn: "2026-05-20", valueCents: 600_000, kind: null })],
      TODAY,
      "12m",
    );
    render(<AnalyticsScreen state={{ kind: "ready", data: untyped, truncated: false, names: {}, canDecide: true }} period="12m" />);
    expect(screen.getByText("1 job has no job type: counted, as Not known by type.")).toBeInTheDocument();
    expect(screen.queryByText(/to decide\./)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Give job types" }));
    expect(screen.getByText("Nothing to decide. Every job is in the figures. 1 more with no job type, at the bottom.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What kind of job?" })).toBeInTheDocument();
  });

  it("reviews the lost quotes on the Quotes face, so a job that wasn't real can be made void", () => {
    render(<AnalyticsScreen state={{ kind: "ready", data, truncated: false, names: {}, canDecide: true }} period="12m" />);
    fireEvent.click(screen.getByRole("tab", { name: "Quotes" }));
    fireEvent.click(screen.getByRole("button", { name: "Review the 2 lost" }));
    const labels = [...document.querySelectorAll(".an-qwhat .an-label")].map((e) => e.textContent);
    expect(labels).toEqual(["Marked Unsuccessful in ServiceM8", "No answer after 60 days"]);
    expect(screen.getAllByRole("button", { name: "Void" })).toHaveLength(2);
    // only a quote nobody marked lost can be kept open as a tender
    expect(screen.getAllByRole("button", { name: "Tender, keep open" })).toHaveLength(1);
  });

  it("lets an owner mark a lost quote still a Quote Unsuccessful in ServiceM8, and nobody else", async () => {
    markUnsuccessful.mockResolvedValue({ ok: true, state: "sent", rowId: "r" });
    const { unmount } = render(<AnalyticsScreen state={{ kind: "ready", data, truncated: false, names: {}, canDecide: true }} period="12m" />);
    fireEvent.click(screen.getByRole("tab", { name: "Quotes" }));
    fireEvent.click(screen.getByRole("button", { name: "Review the 2 lost" }));
    expect(screen.queryByRole("button", { name: "Mark Unsuccessful in ServiceM8" })).not.toBeInTheDocument();
    unmount();

    render(<AnalyticsScreen state={{ kind: "ready", data, truncated: false, names: {}, canDecide: true, lostWrites: "on" }} period="12m" />);
    fireEvent.click(screen.getByRole("tab", { name: "Quotes" }));
    fireEvent.click(screen.getByRole("button", { name: "Review the 2 lost" }));
    // the one already Unsuccessful in ServiceM8 has nothing to change there
    const press = screen.getAllByRole("button", { name: "Mark Unsuccessful in ServiceM8" });
    expect(press).toHaveLength(1);
    fireEvent.click(press[0]!);
    expect(markUnsuccessful).toHaveBeenCalledWith({ jobUuid: expect.any(String), pressId: expect.any(String) });
    expect(await screen.findByText("Marked Unsuccessful in ServiceM8.")).toBeInTheDocument();
  });

  it("keeps a lost quote open as a tender, to the tender days, and takes it back", async () => {
    decideJob.mockResolvedValue({ ok: true });
    render(<AnalyticsScreen state={{ kind: "ready", data, truncated: false, names: {}, canDecide: true }} period="12m" />);
    fireEvent.click(screen.getByRole("tab", { name: "Quotes" }));
    fireEvent.click(screen.getByRole("button", { name: "Review the 2 lost" }));
    fireEvent.click(screen.getByRole("button", { name: "Tender, keep open" }));
    expect(decideJob).toHaveBeenCalledWith(expect.any(String), "extend", "tender");
    expect(await screen.findByText("Kept open as a tender, to 180 days.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(decideJob).toHaveBeenLastCalledWith(expect.any(String), "extend", null);
  });
});
