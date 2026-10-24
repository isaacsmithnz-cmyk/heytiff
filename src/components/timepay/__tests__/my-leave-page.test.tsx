import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import MyLeavePage from "@/app/dashboard/(me)/my-leave/page";

/* THE PAGE AT /dashboard/my-leave (v2): a page of its own, as Timesheet is.
   It loads `loadMyLeave` and nothing else, and hands it to the screen
   untouched; someone with no staff card gets the page's empty state. */

const loadMyLeave = jest.fn();
jest.mock("@/lib/timepay/leave-page", () => ({
  loadMyLeave: (...a: unknown[]) => loadMyLeave(...a),
}));
jest.mock("@/components/timepay/my-leave", () => ({
  MyLeave: (p: { today: string }) => <div data-testid="leave">{p.today}</div>,
}));

beforeEach(() => loadMyLeave.mockReset());

it("draws your leave from what loadMyLeave loaded", async () => {
  loadMyLeave.mockResolvedValue({ today: "2026-10-24" });
  render(await MyLeavePage());
  expect(screen.getByTestId("leave")).toHaveTextContent("2026-10-24");
});

it("says what is missing when there is no staff card, and leads to your card", async () => {
  loadMyLeave.mockResolvedValue(null);
  render(await MyLeavePage());
  expect(screen.getByRole("heading", { level: 1, name: "Leave" })).toBeInTheDocument();
  expect(screen.getByText("No staff card yet")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open your card" })).toHaveAttribute("href", "/dashboard/profile");
  expect(screen.queryByTestId("leave")).toBeNull();
});

it("is no longer a face of the old Me card", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/app/dashboard/(me)/my-leave/page.tsx"), "utf8");
  expect(src).not.toMatch(/MeScreen|loadMe\b|me-screen/);
});
