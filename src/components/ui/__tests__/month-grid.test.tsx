import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MonthGrid, dayTitle, monthCells, shiftMonth } from "../month-grid";

/* September 2026 is the fixture month: it starts on a Tuesday, so the
   Monday-first grid has to lead in with 31 August — a raw getDay() ordering
   would put the 1st in the wrong column and shift the whole month. */
const MONTH = "2026-09";
const TODAY = "2026-09-15";

const onMonthChange = jest.fn();

function grid(over: Partial<React.ComponentProps<typeof MonthGrid>> = {}) {
  const utils = render(
    <MonthGrid month={MONTH} today={TODAY} onMonthChange={onMonthChange} {...over} />,
  );
  const cell = (iso: string) =>
    utils.container.querySelector<HTMLButtonElement>(`[data-iso="${iso}"]`)!;
  return { ...utils, cell };
}

beforeEach(() => onMonthChange.mockClear());

describe("the grid itself", () => {
  it("is six Monday-first weeks, leading in and out of the month", () => {
    const cells = monthCells(MONTH);
    expect(cells).toHaveLength(42);
    expect(cells[0]).toMatchObject({ iso: "2026-08-31", day: 31, out: true, weekend: false });
    expect(cells[1]).toMatchObject({ iso: "2026-09-01", day: 1, out: false });
    expect(cells[41]).toMatchObject({ iso: "2026-10-11", out: true, weekend: true });
    // the 6th and 7th columns are the weekend, every row
    expect(cells.filter((c) => c.weekend)).toHaveLength(12);
  });

  it("labels the weekdays Mo-first and heads with the month and year", () => {
    const { container } = grid();
    expect([...container.querySelectorAll(".cal-wd span")].map((s) => s.textContent)).toEqual([
      "Mo",
      "Tu",
      "We",
      "Th",
      "Fr",
      "Sa",
      "Su",
    ]);
    expect(screen.getByText("September 2026")).toBeInTheDocument();
    expect(container.querySelectorAll(".cal-d")).toHaveLength(42);
  });

  it("names every day in full, so the control can be driven without sight", () => {
    expect(dayTitle("2026-09-28")).toBe("Monday 28 September 2026");
    grid();
    expect(screen.getByRole("button", { name: "Tuesday 1 September 2026" })).toBeInTheDocument();
  });

  it("mutes the days either side without locking them out", () => {
    const { cell } = grid();
    expect(cell("2026-08-31").className).toContain("out");
    expect(cell("2026-08-31")).toBeEnabled();
    expect(cell("2026-09-01").className).not.toContain("out");
  });
});

describe("what a cell says about itself", () => {
  it("rings today", () => {
    const { cell } = grid();
    expect(cell(TODAY).className).toContain("today");
    expect(cell(TODAY)).toHaveAttribute("aria-current", "date");
    expect(cell("2026-09-16").className).not.toContain("today");
  });

  it("fills the selected day and marks it pressed", () => {
    const { cell } = grid({ value: "2026-09-03" });
    expect(cell("2026-09-03").className).toContain("on");
    expect(cell("2026-09-03")).toHaveAttribute("aria-pressed", "true");
    expect(cell("2026-09-04")).toHaveAttribute("aria-pressed", "false");
  });

  it("tints a holiday violet and names it, in the tooltip and out loud", () => {
    const { cell } = grid({ holidays: new Map([["2026-09-07", "Father's Day (obs)"]]) });
    const hol = cell("2026-09-07");
    expect(hol.className).toContain("hol");
    expect(hol).toHaveAttribute("title", "Father's Day (obs)");
    expect(hol).toHaveAccessibleName("Monday 7 September 2026, Father's Day (obs)");
    expect(cell("2026-09-08").className).not.toContain("hol");
  });
});

describe("a range across the month", () => {
  const range = { start: "2026-09-07", end: "2026-09-11" };

  it("bands the middle and solidifies the ends", () => {
    const { cell } = grid({ range });
    expect(cell("2026-09-07").className).toContain("rng-s");
    expect(cell("2026-09-11").className).toContain("rng-e");
    for (const iso of ["2026-09-08", "2026-09-09", "2026-09-10"]) {
      expect(cell(iso).className).toContain("rng");
      expect(cell(iso).className).not.toContain("rng-s");
    }
    expect(cell("2026-09-12").className).not.toContain("rng");
  });

  /* The band means "days you're taking". A public holiday inside it isn't one,
     so it keeps its violet — that's the whole reason to draw both at once. */
  it("keeps a holiday violet inside the band", () => {
    const { cell } = grid({ range, holidays: new Map([["2026-09-09", "Show Day"]]) });
    const hol = cell("2026-09-09");
    expect(hol.className).toContain("rng");
    expect(hol.className).toContain("hol");
  });
});

describe("bounds", () => {
  it("disables days outside min/max but still draws them", () => {
    const { cell } = grid({ min: "2026-09-05", max: "2026-09-20" });
    expect(cell("2026-09-04")).toBeDisabled();
    expect(cell("2026-09-05")).toBeEnabled();
    expect(cell("2026-09-20")).toBeEnabled();
    expect(cell("2026-09-21")).toBeDisabled();
    expect(cell("2026-09-04")).toBeInTheDocument();
  });

  it("stops the month arrows at the edge of the allowed range", () => {
    grid({ min: "2026-09-05", max: "2026-09-20" });
    expect(screen.getByRole("button", { name: "Previous month" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
  });
});

describe("what it reports", () => {
  it("picks in ISO, whichever month the day belongs to", async () => {
    const user = userEvent.setup();
    const onPick = jest.fn();
    grid({ onPick });

    await user.click(screen.getByRole("button", { name: "Wednesday 9 September 2026" }));
    expect(onPick).toHaveBeenCalledWith("2026-09-09");

    await user.click(screen.getByRole("button", { name: "Monday 31 August 2026" }));
    expect(onPick).toHaveBeenLastCalledWith("2026-08-31");
  });

  it("asks the caller to change month — it never moves itself", async () => {
    const user = userEvent.setup();
    grid();

    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(onMonthChange).toHaveBeenCalledWith("2026-10");

    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(onMonthChange).toHaveBeenLastCalledWith("2026-08");

    // still on September: the month is the caller's state, not the grid's
    expect(screen.getByText("September 2026")).toBeInTheDocument();
  });

  it("rolls the year over in both directions", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-09", -14)).toBe("2025-07");
  });
});
