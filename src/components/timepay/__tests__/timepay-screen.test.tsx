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

/* THE URL MUST NOT MOVE — same guard as my-time-screen and the same wreck
   behind it: the shell's outlet keys on the pathname, so a cross-path
   replaceState remounts the page and resets the open tab. Deep links live in
   the three ROUTES (the Home chips point at them); the switcher itself stays
   out of the address bar, exactly like Team's. */
it("never touches the URL when switching faces", async () => {
  const user = userEvent.setup();
  window.history.replaceState(null, "", "/dashboard/timepay/expenses");
  render(<TimepayScreen initialTab="expenses" section={section} />);

  await user.click(screen.getByRole("tab", { name: "Leave" }));
  expect(screen.getByTestId("face-leave")).toBeInTheDocument();
  expect(window.location.pathname).toBe("/dashboard/timepay/expenses");
  await user.click(screen.getByRole("tab", { name: "Timesheets" }));
  expect(window.location.pathname).toBe("/dashboard/timepay/expenses");
});
