import { render, screen } from "@testing-library/react";

/* TWO HOMES, ONE SWITCH. The loader sets `desk` only for a viewer
   `HOME_DESK` gives the new Home to (its own suite holds that rule), and
   the page draws the desk exactly then — everyone else gets today's Home as
   it was. Both keep the capture's scope. The pages themselves have suites of
   their own; here they are names. */

const loadDashboard = jest.fn();
jest.mock("@/lib/dashboard/page-data", () => ({ loadDashboard: () => loadDashboard() }));
jest.mock("@/lib/org/setup-gate", () => ({ redirectIfSetupPending: async () => {} }));
jest.mock("@/lib/staff/onboarding-gate", () => ({ redirectIfOnboardingPending: async () => {} }));
jest.mock("@/components/notes/note-context", () => ({
  NoteScopeScreen: ({ staffFirstNames }: { staffFirstNames: string[] }) => (
    <i data-testid="scope">{staffFirstNames.join(",")}</i>
  ),
}));
jest.mock("@/components/dashboard/home", () => ({ DashboardHome: () => <p>today&apos;s Home</p> }));
jest.mock("@/components/dashboard/home-desk", () => ({ DashboardDesk: () => <p>the desk</p> }));

import DashboardHomePage from "../page";

const loaded = (desk: { warnDays: number } | null) => ({
  jobs: [],
  assignable: [{ id: "s1", name: "Dane Cooper" }],
  desk,
});

it("draws the desk for a viewer the loader gave the new Home's data", async () => {
  loadDashboard.mockResolvedValueOnce(loaded({ warnDays: 30 }));
  render(await DashboardHomePage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByText("the desk")).toBeInTheDocument();
  expect(screen.queryByText("today's Home")).toBeNull();
  expect(screen.getByTestId("scope")).toHaveTextContent("Dane");
});

it("keeps everyone else on today's Home", async () => {
  loadDashboard.mockResolvedValueOnce(loaded(null));
  render(await DashboardHomePage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByText("today's Home")).toBeInTheDocument();
  expect(screen.queryByText("the desk")).toBeNull();
  expect(screen.getByTestId("scope")).toHaveTextContent("Dane");
});
