import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HolidaySection } from "../holiday-section";
import type { Holiday } from "@/lib/timepay/leave-query";

const addHoliday = jest.fn(async () => ({ ok: true as const }));
const removeHoliday = jest.fn(async () => ({ ok: true as const }));
const restoreHoliday = jest.fn(async () => ({ ok: true as const }));
const refresh = jest.fn();

jest.mock("@/app/actions/holidays", () => ({
  addHoliday: (...a: unknown[]) => addHoliday(...(a as [])),
  removeHoliday: (...a: unknown[]) => removeHoliday(...(a as [])),
  restoreHoliday: (...a: unknown[]) => restoreHoliday(...(a as [])),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh }) }));

// the suggestions come from the rules module; mock it so this test pins the
// SECTION's behaviour, not the statutory tables (those have their own suite)
jest.mock("@/lib/timepay/holiday-rules", () => ({
  provisionalHolidays: jest.fn(),
}));
import { provisionalHolidays } from "@/lib/timepay/holiday-rules";

const provisional = provisionalHolidays as jest.Mock;

const KINGS = {
  name: "King's Birthday",
  usual: "A Monday in late September or early October — proclaimed each year in the Government Gazette.",
};

const TODAY = "2026-07-25";

const hol = (over: Partial<Holiday> = {}): Holiday => ({
  id: "h1",
  state: "WA",
  date: "2026-01-01",
  name: "New Year's Day",
  source: "auto",
  suppressed: false,
  ...over,
});

function renderSection(over: Partial<React.ComponentProps<typeof HolidaySection>> = {}) {
  return render(<HolidaySection holidays={[]} orgState="WA" today={TODAY} {...over} />);
}

beforeEach(() => {
  provisional.mockReset();
  provisional.mockReturnValue([]);
  addHoliday.mockClear();
});

it("says nothing when the state has no proclamation-dependent days", () => {
  renderSection({ orgState: "QLD" });
  expect(screen.queryByText("Worth confirming")).not.toBeInTheDocument();
});

it("asks nothing when there is no state to ask about", () => {
  provisional.mockReturnValue([KINGS]);
  renderSection({ orgState: null });
  expect(screen.queryByText("Worth confirming")).not.toBeInTheDocument();
  expect(provisional).not.toHaveBeenCalled();
});

it("suggests this year and next, with the timing hint", () => {
  provisional.mockReturnValue([KINGS]);
  renderSection();

  expect(screen.getByText("Worth confirming")).toBeInTheDocument();
  expect(provisional).toHaveBeenCalledWith("WA", 2026);
  expect(provisional).toHaveBeenCalledWith("WA", 2027);

  expect(screen.getAllByText("King's Birthday")).toHaveLength(2);
  expect(screen.getByText("2026")).toBeInTheDocument();
  expect(screen.getByText("2027")).toBeInTheDocument();
  expect(screen.getAllByText(/proclaimed each year/)).toHaveLength(2);
});

it("drops one already on the calendar for that year — including a removed one", () => {
  provisional.mockReturnValue([KINGS]);
  renderSection({
    holidays: [
      hol({ id: "kb26", date: "2026-09-28", name: "King's Birthday", source: "manual" }),
      hol({ id: "kb27", date: "2027-09-27", name: "King's Birthday", suppressed: true }),
    ],
  });
  expect(screen.queryByText("Worth confirming")).not.toBeInTheDocument();
});

it("keeps suggesting when the same name exists only under another state", () => {
  provisional.mockReturnValue([KINGS]);
  renderSection({
    holidays: [hol({ id: "nsw-kb", state: "NSW", date: "2026-06-08", name: "King's Birthday" })],
  });
  expect(screen.getAllByText("King's Birthday")).toHaveLength(3); // the calendar row + two suggestions
});

it("Add prefills the form's state and name, and leaves the date to the admin", async () => {
  const user = userEvent.setup();
  provisional.mockImplementation((_s: string, y: number) => (y === 2027 ? [KINGS] : []));
  renderSection({ orgState: "WA" });

  const row = screen.getByText("2027").closest(".hol-sugrow") as HTMLElement;
  await user.click(within(row).getByRole("button", { name: /add/i }));

  expect(screen.getByLabelText<HTMLInputElement>("Holiday name").value).toBe("King's Birthday");
  expect(screen.getByLabelText<HTMLSelectElement>("State").value).toBe("WA");
  expect(screen.getByLabelText<HTMLInputElement>("Date").value).toBe("");
  // nothing is written until a date is supplied
  expect(screen.getByRole("button", { name: /add holiday/i })).toBeDisabled();
  expect(addHoliday).not.toHaveBeenCalled();
});

it("still writes through the normal add path once the gazetted date is typed", async () => {
  const user = userEvent.setup();
  provisional.mockReturnValue([KINGS]);
  renderSection();

  await user.click(screen.getAllByRole("button", { name: /^add$/i })[0]);
  await user.type(screen.getByLabelText("Date"), "2026-09-28");
  await user.click(screen.getByRole("button", { name: /add holiday/i }));

  expect(addHoliday).toHaveBeenCalledWith({
    state: "WA",
    date: "2026-09-28",
    name: "King's Birthday",
  });
});
