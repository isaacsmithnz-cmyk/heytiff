import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeCalendar } from "../home-calendar";
import { buildCalendar } from "@/lib/dashboard/calendar";
import type { LeaveRequest } from "@/lib/timepay/leave";

/* The grid is the maintenance board's, reused whole. What this suite is for is
   the three things Home added on top of it and the one thing it deliberately
   took away — the tones. */

const TODAY = "2026-08-10"; // a Monday
const leave = (over: Partial<LeaveRequest> = {}): LeaveRequest => ({
  id: "l1",
  staffId: "me",
  staffName: "Isaac Smith",
  kind: "annual",
  startDate: "2026-08-19",
  endDate: "2026-08-25",
  hours: 38,
  status: "approved",
  ...over,
});

const draw = (
  requests: LeaveRequest[] = [],
  holidays: { date: string; name: string }[] = [],
  viewer: string | null = "me",
) => render(<HomeCalendar cal={buildCalendar(requests, holidays, TODAY, viewer)} today={TODAY} />);

const cells = () => [...document.querySelectorAll<HTMLElement>(".wb2-mc > *")];
const cellFor = (iso: string) =>
  document.querySelector<HTMLElement>(`.wb2-mc [data-day="${iso}"]`)!;

describe("the band", () => {
  it("marks every day of the run, weekend included", () => {
    draw([leave()]);
    for (const iso of ["2026-08-19", "2026-08-22", "2026-08-23", "2026-08-25"]) {
      expect(cellFor(iso).querySelector(".hm-calmine")).not.toBeNull();
    }
    expect(cellFor("2026-08-26").querySelector(".hm-calmine")).toBeNull();
  });

  it("rounds only its true ends, and squares where the run carries on", () => {
    draw([leave()]);
    const band = (iso: string) => cellFor(iso).querySelector(".hm-calmine")!.className;
    expect(band("2026-08-19")).toContain(" s"); // Wed, the first day
    expect(band("2026-08-19")).not.toContain(" e");
    expect(band("2026-08-20")).toBe("hm-calmine"); // mid-run: neither cap
    expect(band("2026-08-25")).toContain(" e"); // Tue, the last day
  });

  it("re-opens on Monday and closes on Sunday, because the row broke it", () => {
    /* Not a cap on the run — a cap on the ROW. Without it the band would run
       to the right edge of Sunday and start hard against Monday's left. */
    draw([leave()]);
    expect(cellFor("2026-08-23").className).toContain("we"); // Sunday
    expect(cellFor("2026-08-23").querySelector(".hm-calmine")!.className).toContain(" e");
    expect(cellFor("2026-08-24").querySelector(".hm-calmine")!.className).toContain(" s");
  });

  it("says what it is once a row, not once a day", () => {
    draw([leave()]);
    expect(cellFor("2026-08-19").textContent).toContain("You — Annual leave");
    expect(cellFor("2026-08-20").textContent).not.toContain("Annual leave");
    // the second row re-says it, or a run crossing Sunday would go unlabelled
    expect(cellFor("2026-08-24").textContent).toContain("You — Annual leave");
  });
});

describe("the other two facts", () => {
  it("tints a closed day and names the holiday", () => {
    draw([], [{ date: "2026-08-26", name: "Bank Holiday" }]);
    const c = cellFor("2026-08-26");
    expect(c.className).toContain("hm-calph");
    expect(c.textContent).toContain("Bank Holiday — closed");
  });

  it("keeps both when a day is yours and closed", () => {
    draw(
      [leave({ startDate: "2026-08-24", endDate: "2026-08-28" })],
      [{ date: "2026-08-26", name: "Bank Holiday" }],
    );
    const c = cellFor("2026-08-26");
    expect(c.className).toContain("hm-calph");
    expect(c.querySelector(".hm-calmine")).not.toBeNull();
  });

  it("shows a colleague as a pill with their initials", () => {
    draw([leave({ id: "l2", staffId: "s2", staffName: "Dane Whitcombe", startDate: TODAY, endDate: TODAY })]);
    const pill = cellFor(TODAY).querySelector(".hm-caloff")!;
    // first name in the cell, the whole of it on the title — a surname does
    // not fit a seventh of the card and used to clip mid-word
    expect(pill.querySelector("b")!.textContent).toBe("Dane");
    expect(pill.querySelector("i")!.textContent).toBe("DW");
    expect(pill).toHaveAttribute("title", "Dane Whitcombe — Annual leave");
  });
});

describe("what it refuses to borrow", () => {
  it("never tones a day", () => {
    /* On the maintenance board a cell's colour says how READY the day is —
       green is the goal, red is the queue. Leave has no such axis, and in this
       app ok/warn/danger only ever mean state. If a data-tone appears here,
       somebody has reached for the board's palette to say something else. */
    draw([leave()], [{ date: "2026-08-26", name: "Bank Holiday" }]);
    expect(document.querySelector(".wb2-mc [data-tone]")).toBeNull();
  });

  it("draws days as cells, not buttons — there is nothing to open", () => {
    draw([leave()]);
    expect(document.querySelectorAll(".wb2-mc button")).toHaveLength(0);
  });
});

describe("the stepper", () => {
  it("shows four weeks from this Monday", () => {
    draw();
    expect(cells()).toHaveLength(28);
    expect(screen.getByText("10 Aug – 6 Sept")).toBeInTheDocument();
  });

  it("stops at the loaded span rather than walking off it", async () => {
    const user = userEvent.setup();
    draw();
    const back = screen.getByLabelText("A week earlier");
    // one week of history is loaded, so the second press must be impossible
    await user.click(back);
    expect(screen.getByText("3 Aug – 30 Aug")).toBeInTheDocument();
    expect(back).toBeDisabled();
    // and a way home appears the moment you have moved
    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByText("10 Aug – 6 Sept")).toBeInTheDocument();
  });

  it("counts the window it is showing, not the span it loaded", async () => {
    const user = userEvent.setup();
    draw([leave({ id: "l2", staffId: "s2", staffName: "Zoe Park", startDate: "2026-10-05", endDate: "2026-10-06" })]);
    expect(screen.queryByText(/1 person off/)).toBeNull();
    for (let i = 0; i < 8; i += 1) await user.click(screen.getByLabelText("A week later"));
    expect(screen.getByText("1 person off")).toBeInTheDocument();
  });
});

it("still draws the grid for an org with nothing booked", () => {
  // the empty four weeks ARE the answer to "is anyone off"
  draw();
  expect(cells()).toHaveLength(28);
  expect(document.querySelectorAll(".hm-calmine, .hm-caloff, .hm-calph")).toHaveLength(0);
});

it("marks today", () => {
  draw();
  expect(cellFor(TODAY).className).toContain("today");
  expect(cellFor(TODAY).textContent).toContain("Today");
});
