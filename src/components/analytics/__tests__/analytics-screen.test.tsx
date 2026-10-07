/* The analytics screen: the top line and the 180-day rule on real-shaped
   figures, the two faces, the period kept in the URL, and what it says with
   no ServiceM8 to read. */
const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh }) }));
jest.mock("@/app/actions/analytics-decide", () => ({ decideJob: jest.fn() }));
jest.mock("@/app/actions/booking-sm8", () => ({ makeWorkOrder: jest.fn() }));

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
  it("leads with the win rate and counts the 180-day quotes as lost", () => {
    render(<AnalyticsScreen state={{ kind: "ready", data, truncated: false }} period="12m" />);
    expect(screen.getByRole("heading", { level: 1, name: "Analytics" })).toBeInTheDocument();
    // 2 won of 4 decided: the Unsuccessful and the one past 180 days
    expect(screen.getAllByText("50%")[0]).toHaveClass("an-big");
    expect(screen.getByText("2 won of 4 decided quotes")).toBeInTheDocument();
    expect(screen.getByText("1 quote with no answer after 180 days counts as lost, $3,000 of work.")).toBeInTheDocument();
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
      screen.getByText("At 180 days with no answer. 1 of the 2 wins came inside that, and the 1 that came later count as won."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "The 2 lost" })).toBeInTheDocument();
    expect(screen.getByText("No answer after 180 days, still a Quote in ServiceM8")).toBeInTheDocument();
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

  it("reviews the lost quotes on the Quotes face, so a job that wasn't real can be made void", () => {
    render(<AnalyticsScreen state={{ kind: "ready", data, truncated: false, names: {}, canDecide: true }} period="12m" />);
    fireEvent.click(screen.getByRole("tab", { name: "Quotes" }));
    fireEvent.click(screen.getByRole("button", { name: "Review the 2 lost" }));
    const labels = [...document.querySelectorAll(".an-qwhat .an-label")].map((e) => e.textContent);
    expect(labels).toEqual(["Marked Unsuccessful in ServiceM8", "No answer after 180 days"]);
    expect(screen.getAllByRole("button", { name: "Void" })).toHaveLength(2);
  });
});
