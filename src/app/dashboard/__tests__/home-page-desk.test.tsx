import { render, screen } from "@testing-library/react";

/* ONE HOME. The new Home is everyone's (2026-09-26): the page draws the
   desk whatever the loader handed it, and keeps the capture's scope. It was
   two Homes behind a switch, HOME_DESK, until then; the switch and the old
   Home went together. The desk itself has a suite of its own; here it is a
   name. */

const loadDashboard = jest.fn();
jest.mock("@/lib/dashboard/page-data", () => ({ loadDashboard: () => loadDashboard() }));
jest.mock("@/lib/org/setup-gate", () => ({ redirectIfSetupPending: async () => {} }));
jest.mock("@/lib/staff/onboarding-gate", () => ({ redirectIfOnboardingPending: async () => {} }));
jest.mock("@/components/notes/note-context", () => ({
  NoteScopeScreen: ({ staffFirstNames }: { staffFirstNames: string[] }) => (
    <i data-testid="scope">{staffFirstNames.join(",")}</i>
  ),
}));
jest.mock("@/components/dashboard/home-desk", () => ({ DashboardDesk: () => <p>the desk</p> }));

import DashboardHomePage from "../page";

const loaded = (desk: { warnDays: number } | null) => ({
  jobs: [],
  assignable: [{ id: "s1", name: "Dane Cooper" }],
  desk,
});

it.each([
  ["with the desk's own reads", { warnDays: 30 }],
  ["with none (nobody signed in)", null],
])("draws the desk, %s, with the capture's scope", async (_case, desk) => {
  loadDashboard.mockResolvedValueOnce(loaded(desk));
  render(await DashboardHomePage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByText("the desk")).toBeInTheDocument();
  expect(screen.getByTestId("scope")).toHaveTextContent("Dane");
});
