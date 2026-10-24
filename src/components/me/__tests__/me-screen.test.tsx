import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MeScreen } from "../me-screen";
import type { MeData } from "@/lib/me/page-data";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush, refresh: jest.fn() }) }));

/* WHAT IS LEFT OF THE ME CARD: Leave, under the old strip. Timesheet,
   Expense claims, Your vehicle and Notes are pages of their own under Your
   name (Isaac, 24 October 2026), so their tabs go to them. My leave is
   stubbed: a big screen with its own suite. */
jest.mock("@/components/timepay/my-leave", () => ({
  MyLeave: () => <div data-testid="face-leave" />,
}));

const DATA: MeData = { leave: null };

const strip = () => screen.getByRole("tablist", { name: "Yours" });

beforeEach(() => mockPush.mockClear());

it("is Leave, with the strip's other tabs going to their own pages", async () => {
  const user = userEvent.setup();
  render(<MeScreen initialTab="leave" data={DATA} />);
  expect(within(strip()).getByRole("tab", { name: "Leave" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("My leave");
  for (const [tab, href] of [
    ["Timesheet", "/dashboard/my-timesheet"],
    ["Expenses", "/dashboard/my-expenses"],
    ["Vehicle", "/dashboard/my-vehicle"],
    ["Notes", "/dashboard/my-notes"],
  ] as const) {
    await user.click(within(strip()).getByRole("tab", { name: tab }));
    expect(mockPush).toHaveBeenLastCalledWith(href);
  }
  // the page under you stays Leave until the address changes
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("My leave");
});

it("shows an empty face when there is no staff record", () => {
  render(<MeScreen initialTab="leave" data={DATA} />);
  expect(screen.getByText("No staff record yet")).toBeTruthy();
});
