import { render, screen } from "@testing-library/react";
import MyTimesheetPage from "@/app/dashboard/(me)/my-timesheet/page";

/* THE PAGE AT /dashboard/my-timesheet (v2): it loads what the Me card's
   timesheet face loaded, `loadMyTimesheet` with the address's period, and
   hands it to the screen untouched. Someone with no staff card, and a
   subcontractor, get the page's empty state instead of a week. */

const loadMyTimesheet = jest.fn();
jest.mock("@/lib/timepay/page-data", () => ({
  loadMyTimesheet: (...a: unknown[]) => loadMyTimesheet(...a),
}));
jest.mock("@/components/timepay/my-timesheet", () => ({
  MyTimesheet: (p: { periodStart: string }) => <div data-testid="sheet">{p.periodStart}</div>,
}));

const page = async (period?: string) =>
  render(await MyTimesheetPage({ searchParams: Promise.resolve(period ? { period } : {}) }));

beforeEach(() => loadMyTimesheet.mockReset());

it("loads the period the address names, and draws the week", async () => {
  loadMyTimesheet.mockResolvedValue({ periodStart: "2026-06-22" });
  await page("2026-06-22");
  expect(loadMyTimesheet).toHaveBeenCalledWith("2026-06-22");
  expect(screen.getByTestId("sheet")).toHaveTextContent("2026-06-22");
});

it("loads this period when the address names none", async () => {
  loadMyTimesheet.mockResolvedValue({ periodStart: "2026-06-29" });
  await page();
  expect(loadMyTimesheet).toHaveBeenCalledWith(undefined);
});

it("says what is missing when there is no staff card, and leads to your card", async () => {
  loadMyTimesheet.mockResolvedValue(null);
  await page();
  expect(screen.getByRole("heading", { level: 1, name: "Timesheet" })).toBeInTheDocument();
  expect(screen.getByText("No staff card yet")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open your card" })).toHaveAttribute("href", "/dashboard/profile");
  expect(screen.queryByTestId("sheet")).toBeNull();
});

it("tells a subcontractor there is no timesheet to keep", async () => {
  loadMyTimesheet.mockResolvedValue({ subcontractor: true });
  await page();
  expect(screen.getByText(/Subcontractors don’t keep a timesheet here/)).toBeInTheDocument();
  expect(screen.queryByTestId("sheet")).toBeNull();
});
