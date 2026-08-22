import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimepayScreen } from "../timepay-screen";
import type { TimepaySection } from "@/lib/timepay/section";

/* The three faces of team Time & Pay, switched on the CLIENT — the same
   conversion my-time-screen made and the same guards: instant switch, no
   links, one constant title, URL following the open face. */

jest.mock("../timepay", () => ({
  TimePay: () => <div data-testid="face-sheets" />,
}));
jest.mock("../team-leave", () => ({
  TeamLeave: () => <div data-testid="face-leave" />,
}));
jest.mock("../team-expenses", () => ({
  TeamExpenses: () => <div data-testid="face-expenses" />,
}));

const section = {
  sheets: {},
  leave: {},
  claims: [],
  canApprove: true,
  financials: true,
  canHolidays: true,
  canManage: true,
  xeroConnected: false,
  wageDrift: null,
  expenses: { owed: 0, pending: 0 },
} as unknown as TimepaySection;

afterEach(cleanup);

it("switches faces without a navigation — tabs are buttons, never links", async () => {
  const user = userEvent.setup();
  render(<TimepayScreen initialTab="sheets" section={section} />);

  expect(screen.getByTestId("face-sheets")).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: "Expenses" }));
  expect(screen.getByTestId("face-expenses")).toBeInTheDocument();
  expect(screen.queryByTestId("face-sheets")).not.toBeInTheDocument();
});

/* ONE TITLE, and it stays put — the rule the old TimepayHead pinned. It names
   the screen rather than the face because the tab row directly beneath
   already says which face you are on. */
it("titles every face Time & Pay", async () => {
  const user = userEvent.setup();
  render(<TimepayScreen initialTab="sheets" section={section} />);

  const title = () => screen.getByRole("heading", { name: "Time & Pay" });
  expect(title()).toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "Leave" }));
  expect(title()).toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "Expenses" }));
  expect(title()).toBeInTheDocument();
});

it("keeps the URL on the face that is open, so the Home chips' deep links stay real", async () => {
  const user = userEvent.setup();
  window.history.replaceState(null, "", "/dashboard/timepay");
  render(<TimepayScreen initialTab="sheets" section={section} />);

  await user.click(screen.getByRole("tab", { name: "Leave" }));
  expect(window.location.pathname).toBe("/dashboard/timepay/leave");
  await user.click(screen.getByRole("tab", { name: "Expenses" }));
  expect(window.location.pathname).toBe("/dashboard/timepay/expenses");
  await user.click(screen.getByRole("tab", { name: "Timesheets" }));
  expect(window.location.pathname).toBe("/dashboard/timepay");
});
