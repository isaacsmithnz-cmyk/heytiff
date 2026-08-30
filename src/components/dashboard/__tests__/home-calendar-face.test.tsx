import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeCalendarFace } from "../home-calendar-face";
import { buildCalendar } from "@/lib/dashboard/calendar";
import type { LeaveRequest } from "@/lib/timepay/leave";

/* ONE WINDOW, THREE READINGS.

   A list answers "who is off, from here on" and a grid answers "what does
   this fortnight look like" — both are right, so the view is a choice. What
   this suite holds still is that the WINDOW is shared: the arrows belong to
   the face, they step in the unit the current view is named after, and they
   stop at the days actually loaded rather than paging onto nothing. */

const TODAY = "2026-09-01"; // a Tuesday

const leave = (over: Partial<LeaveRequest> = {}): LeaveRequest => ({
  id: "l1",
  staffId: "s2",
  staffName: "Lorenz Weber",
  kind: "annual",
  startDate: TODAY,
  endDate: TODAY,
  hours: 8,
  status: "approved",
  ...over,
});

const draw = (
  requests: LeaveRequest[] = [],
  holidays: { date: string; name: string }[] = [],
) =>
  render(
    <HomeCalendarFace cal={buildCalendar(requests, holidays, TODAY, "s1")} today={TODAY} />,
  );

const rows = () => [...document.querySelectorAll<HTMLElement>(".hm-lvr")];
const cells = () => [...document.querySelectorAll<HTMLElement>(".wb2-mc > *")];
const label = () => document.querySelector(".hm-calstep b")!.textContent;
const view = (name: RegExp) => screen.getByRole("button", { name });

describe("the views", () => {
  it("opens on four weeks from today, as a list", () => {
    draw();
    expect(rows()).toHaveLength(28);
    expect(rows()[0].dataset.iso).toBe(TODAY);
    expect(cells()).toHaveLength(0);
  });

  it("swaps to the grid the card used to wear, same four weeks", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(view(/^Grid$/));
    /* The grid must start on a Monday — seven columns cannot begin midweek —
       so it aligns where the list does not, and that is the point of it. */
    expect(cells()).toHaveLength(28);
    expect(rows()).toHaveLength(0);
  });

  it("shows a whole calendar month when asked for one", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(view(/^Month$/));
    expect(label()).toBe("September 2026");
    expect(rows()).toHaveLength(30);
    expect(rows()[0].dataset.iso).toBe("2026-09-01");
  });
});

describe("the stepper", () => {
  it("moves a week on the week views", async () => {
    const user = userEvent.setup();
    draw();
    const first = rows()[0].dataset.iso;
    await user.click(screen.getByRole("button", { name: "A week later" }));
    expect(rows()[0].dataset.iso).toBe("2026-09-08");
    expect(rows()[0].dataset.iso).not.toBe(first);
  });

  it("moves a MONTH on the month view — the arrow means the view's own unit", async () => {
    /* Stepping seven days on a page titled "September" would be the control
       lying about what it does. */
    const user = userEvent.setup();
    draw();
    await user.click(view(/^Month$/));
    await user.click(screen.getByRole("button", { name: "The month after" }));
    expect(label()).toBe("October 2026");
  });

  it("stops at the loaded span rather than walking off it", async () => {
    /* The loader reaches a week back and eight weeks ahead; an arrow that
       walked past that would page onto an empty month. */
    const user = userEvent.setup();
    draw();
    const back = screen.getByRole("button", { name: "A week earlier" });
    await user.click(back);
    expect(back).toBeDisabled();
  });

  it("offers a way home once you have wandered, and not before", async () => {
    const user = userEvent.setup();
    draw();
    expect(screen.queryByRole("button", { name: "Today" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "A week later" }));
    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(rows()[0].dataset.iso).toBe(TODAY);
  });

  it("returns to now when the step changes meaning under you", async () => {
    /* Weeks → month with the shift kept would land an arbitrary distance from
       where you were looking. */
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByRole("button", { name: "A week later" }));
    await user.click(view(/^Month$/));
    expect(label()).toBe("September 2026");
  });
});

describe("the summary", () => {
  it("counts public holidays in the window — and yes, they are shown", async () => {
    draw([], [{ date: "2026-09-07", name: "Labour Day" }]);
    expect(screen.getByText("1 public holiday")).toBeInTheDocument();
    const row = rows().find((r) => r.dataset.iso === "2026-09-07")!;
    expect(row.textContent).toContain("Labour Day");
  });

  it("counts the window on show, never the whole loaded span", async () => {
    /* Leave three weeks out is not in this month's window; the chips have to
       describe the days you can actually see. */
    const user = userEvent.setup();
    draw([leave({ startDate: "2026-10-20", endDate: "2026-10-21" })]);
    expect(screen.queryByText(/person off/)).toBeNull();
    await user.click(view(/^Month$/));
    await user.click(screen.getByRole("button", { name: "The month after" }));
    expect(screen.getByText("1 person off")).toBeInTheDocument();
  });

  it("says nothing at all on an empty window", () => {
    draw();
    expect(document.querySelector(".hm-calsum")).toBeNull();
  });
});
