import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HolidaySection } from "../holiday-section";
import type { Holiday } from "@/lib/timepay/leave-query";

const addHoliday = jest.fn(async () => ({ ok: true as const }));
const removeHoliday = jest.fn(async (..._a: unknown[]) => ({ ok: true as const }));
const restoreHoliday = jest.fn(async (..._a: unknown[]) => ({ ok: true as const }));
const refresh = jest.fn();

jest.mock("@/app/actions/holidays", () => ({
  addHoliday: (...a: unknown[]) => addHoliday(...(a as [])),
  removeHoliday: (...a: unknown[]) => removeHoliday(...a),
  restoreHoliday: (...a: unknown[]) => restoreHoliday(...a),
  getHolidayManagerData: jest.fn(),
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

type Data = { holidays: Holiday[]; orgState: string | null; today: string };

/* The holidays group of Settings › Pay and holidays. Without `initial` the
   section reads its own calendar on mount, so these cases inject a `load`
   and wait for the form before asserting. */
async function renderSection(over: Partial<Data> = {}) {
  const load = jest.fn(async () => ({ holidays: [], orgState: "WA", today: TODAY, ...over }));
  const result = render(<HolidaySection load={load} />);
  await screen.findByLabelText("Holiday name");
  return { ...result, load };
}

beforeEach(() => {
  provisional.mockReset();
  provisional.mockReturnValue([]);
  [addHoliday, removeHoliday, restoreHoliday, refresh].forEach((m) => m.mockClear());
});

it("says nothing when the state has no proclamation-dependent days", async () => {
  await renderSection({ orgState: "QLD" });
  expect(screen.queryByText("Worth confirming")).not.toBeInTheDocument();
});

it("asks nothing when there is no state to ask about", async () => {
  provisional.mockReturnValue([KINGS]);
  await renderSection({ orgState: null });
  expect(screen.queryByText("Worth confirming")).not.toBeInTheDocument();
  expect(provisional).not.toHaveBeenCalled();
});

it("suggests this year and next, with the timing hint", async () => {
  provisional.mockReturnValue([KINGS]);
  await renderSection();

  expect(screen.getByRole("heading", { name: "Worth confirming" })).toBeInTheDocument();
  expect(provisional).toHaveBeenCalledWith("WA", 2026);
  expect(provisional).toHaveBeenCalledWith("WA", 2027);

  const list = screen.getByRole("list", { name: "Worth confirming" });
  expect(within(list).getAllByText("King's Birthday")).toHaveLength(2);
  expect(within(list).getByText("2026")).toBeInTheDocument();
  expect(within(list).getByText("2027")).toBeInTheDocument();
  expect(within(list).getAllByText(/proclaimed each year/)).toHaveLength(2);
});

it("drops one already on the calendar for that year — including a removed one", async () => {
  provisional.mockReturnValue([KINGS]);
  await renderSection({
    holidays: [
      hol({ id: "kb26", date: "2026-09-28", name: "King's Birthday", source: "manual" }),
      hol({ id: "kb27", date: "2027-09-27", name: "King's Birthday", suppressed: true }),
    ],
  });
  expect(screen.queryByText("Worth confirming")).not.toBeInTheDocument();
});

it("keeps suggesting when the same name exists only under another state", async () => {
  provisional.mockReturnValue([KINGS]);
  await renderSection({
    holidays: [hol({ id: "nsw-kb", state: "NSW", date: "2026-06-08", name: "King's Birthday" })],
  });
  expect(screen.getAllByText("King's Birthday")).toHaveLength(3); // the calendar row + two suggestions
});

it("Add the date prefills the form's state and name, and leaves the date to the admin", async () => {
  const user = userEvent.setup();
  provisional.mockImplementation((_s: string, y: number) => (y === 2027 ? [KINGS] : []));
  await renderSection({ orgState: "WA" });

  await user.click(screen.getByRole("button", { name: "Add the date of King's Birthday, 2027" }));

  expect(screen.getByLabelText<HTMLInputElement>("Holiday name").value).toBe("King's Birthday");
  expect(screen.getByLabelText("State")).toHaveTextContent("WA");
  expect(screen.getByLabelText("Date")).toHaveTextContent("dd/mm/yyyy");
  // the date is where the admin goes next
  expect(screen.getByLabelText("Date")).toHaveFocus();
  // nothing is written until a date is supplied
  expect(screen.getByRole("button", { name: "Add holiday" })).toBeDisabled();
  expect(addHoliday).not.toHaveBeenCalled();
});

/* The date is picked off a calendar, never typed — a gazetted date read off a
   notice and keyed as 09/28 instead of 28/09 is the exact mistake this costs
   nothing to make impossible. */
it("still writes through the normal add path once the gazetted date is picked", async () => {
  const user = userEvent.setup();
  provisional.mockReturnValue([KINGS]);
  const { load } = await renderSection();

  await user.click(screen.getAllByRole("button", { name: /^Add the date/ })[0]);
  await user.click(screen.getByLabelText("Date"));
  await user.click(screen.getByRole("button", { name: "Next month" }));
  await user.click(screen.getByRole("button", { name: "Next month" }));
  await user.click(screen.getByRole("button", { name: "Monday 28 September 2026" }));
  expect(screen.getByLabelText("Date")).toHaveTextContent("28/09/2026");

  await user.click(screen.getByRole("button", { name: "Add holiday" }));

  expect(addHoliday).toHaveBeenCalledWith({
    state: "WA",
    date: "2026-09-28",
    name: "King's Birthday",
  });
  // the list is client-held, so it is read again; the timesheets behind it are refreshed too
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(load).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText<HTMLInputElement>("Holiday name").value).toBe("");
});

it("adds for the state picked, not only the business's own", async () => {
  const user = userEvent.setup();
  await renderSection({ orgState: "WA" });
  await user.click(screen.getByLabelText("State"));
  await user.click(screen.getByRole("option", { name: "VIC" }));
  expect(screen.getByLabelText("State")).toHaveTextContent("VIC");
});

/* The year's opening day is the floor — the manager is for this year on, not
   for backfilling last year's calendar. */
it("locks the picker out of the years before this one", async () => {
  const user = userEvent.setup();
  await renderSection();

  await user.click(screen.getByLabelText("Date"));
  await user.click(screen.getByRole("button", { name: "Previous month" })); // June 2026
  await user.click(screen.getByRole("button", { name: "Previous month" })); // May
  expect(screen.getByText("May 2026")).toBeInTheDocument();

  for (let i = 0; i < 4; i++) {
    await user.click(screen.getByRole("button", { name: "Previous month" }));
  }
  expect(screen.getByText("January 2026")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Previous month" })).toBeDisabled();
});

describe("the calendar", () => {
  it("lists each year's days as rows: the name, then the date and the state", async () => {
    await renderSection({
      holidays: [
        hol(),
        hol({ id: "pd", date: "2026-08-03", name: "Picnic Day", source: "manual" }),
        hol({ id: "ny27", date: "2027-01-01" }),
      ],
    });
    const y26 = screen.getByRole("list", { name: "Public holidays in 2026" });
    expect(within(y26).getByText("New Year's Day")).toBeInTheDocument();
    expect(within(y26).getByText("Thu 1 Jan 2026, WA")).toBeInTheDocument();
    // a day someone added says so; a day the calendar filled in doesn't
    expect(within(y26).getByText("Mon 3 Aug 2026, WA, added by hand")).toBeInTheDocument();
  });

  /* Three years of a state's calendar is forty rows: the years after this
     one wait behind one button (the Settings walk, 26 October 2026). */
  it("folds the years after this one until asked for", async () => {
    const user = userEvent.setup();
    await renderSection({ holidays: [hol(), hol({ id: "ny27", date: "2027-01-01" }), hol({ id: "ny28", date: "2028-01-01" })] });
    expect(screen.queryByRole("list", { name: "Public holidays in 2027" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show 2027 and 2028" }));
    expect(screen.getByRole("list", { name: "Public holidays in 2027" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Public holidays in 2028" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Show/ })).not.toBeInTheDocument();
  });

  it("says Remove as a red word, as every delete is", async () => {
    await renderSection({ holidays: [hol()] });
    expect(screen.getByRole("button", { name: "Remove New Year's Day" })).toHaveClass("pt-btn--delete");
  });

  it("removes a day this business works, and reads the calendar again", async () => {
    const user = userEvent.setup();
    const { load } = await renderSection({ holidays: [hol()] });
    await user.click(screen.getByRole("button", { name: "Remove New Year's Day" }));
    expect(removeHoliday).toHaveBeenCalledWith("h1");
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it("keeps a removed day listed under its own heading, to restore", async () => {
    const user = userEvent.setup();
    await renderSection({ holidays: [hol({ suppressed: true })] });
    expect(screen.getByRole("heading", { name: "Removed, worked as normal days" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restore New Year's Day" }));
    expect(restoreHoliday).toHaveBeenCalledWith("h1");
  });

  it("says what's missing when there's nothing on it", async () => {
    await renderSection();
    expect(screen.getByText("No public holidays yet")).toBeInTheDocument();
  });

  it("says what went wrong when a change is refused, and keeps the list", async () => {
    const user = userEvent.setup();
    removeHoliday.mockResolvedValueOnce({ ok: false, error: "Only an admin can manage public holidays." } as never);
    await renderSection({ holidays: [hol()] });
    await user.click(screen.getByRole("button", { name: "Remove New Year's Day" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only an admin can manage public holidays.");
    expect(screen.getByText("New Year's Day")).toBeInTheDocument();
  });
});

describe("what the page hands it", () => {
  it("draws the calendar the page read, without reading it again", () => {
    const load = jest.fn();
    render(<HolidaySection initial={{ holidays: [hol()], orgState: "WA", today: TODAY }} load={load} />);
    expect(screen.getByText("New Year's Day")).toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
  });

  it("says so when the calendar can't be read", async () => {
    render(<HolidaySection load={async () => null} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the holiday calendar.");
  });
});
