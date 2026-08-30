import { render, within } from "@testing-library/react";
import { LeaveRows } from "../home-leave-list";
import { buildCalendar, leaveList } from "@/lib/dashboard/calendar";
import type { LeaveRequest } from "@/lib/timepay/leave";

/* FOUR WEEKS, READ DOWNWARD.

   The grid this replaces spent seven columns saying which weekday a date was,
   and opened on the Monday you were in so its first row was whole. A list
   needs neither: it says the weekday in three letters and starts today,
   because "who is off, from here on" is a sequence and days that have gone
   are not part of the answer.

   What is pinned here is the reading, not the markup: the first row is today,
   the order is forward, a run of leave appears on every day it covers, and
   nothing on this face borrows a state colour — leave is not a readiness
   problem, so ok/warn/danger keep meaning what they mean everywhere else. */

const TODAY = "2026-09-01"; // a Tuesday
const ME = "s1";

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
  viewer: string | null = ME,
) => {
  const cal = buildCalendar(requests, holidays, TODAY, viewer);
  return render(<LeaveRows days={leaveList(cal, TODAY)} today={TODAY} />);
};

const rows = () => [...document.querySelectorAll<HTMLElement>(".hm-lvr")];

describe("the calendar list", () => {
  it("starts at today and runs four weeks forward, one day after the next", () => {
    draw();
    const isos = rows().map((r) => r.dataset.iso!);
    expect(isos).toHaveLength(28);
    expect(isos[0]).toBe(TODAY);
    expect(isos[27]).toBe("2026-09-28");
    // strictly ascending, no gaps and no repeats
    expect([...isos].sort()).toEqual(isos);
  });

  it("does not show the days that have gone", () => {
    /* The window the grid used reached a week back so its arrows had
       somewhere to walk. A list has no arrows, and yesterday is not an
       answer to "who is off from here". */
    draw();
    expect(rows().some((r) => r.dataset.iso! < TODAY)).toBe(false);
  });

  it("marks today, and only today", () => {
    draw();
    const marked = rows().filter((r) => r.classList.contains("today"));
    expect(marked).toHaveLength(1);
    expect(marked[0].dataset.iso).toBe(TODAY);
  });

  it("names a colleague on every day their leave covers", () => {
    /* A run is one decision, so it appears on each day of it — three rows,
       not one row saying "3 days". */
    draw([leave({ startDate: TODAY, endDate: "2026-09-03" })]);
    const covered = rows().filter((r) => r.textContent!.includes("Lorenz"));
    expect(covered.map((r) => r.dataset.iso)).toEqual([TODAY, "2026-09-02", "2026-09-03"]);
  });

  it("says YOUR leave as yours, with the kind of leave it is", () => {
    draw([leave({ id: "l2", staffId: ME, staffName: "Isaac Smith" })]);
    const row = rows()[0];
    expect(within(row).getByText(/You/)).toBeInTheDocument();
    expect(row.textContent).toContain("Annual leave");
  });

  it("shows a closed office by name", () => {
    draw([], [{ date: "2026-09-07", name: "Labour Day" }]);
    const row = rows().find((r) => r.dataset.iso === "2026-09-07")!;
    expect(row.textContent).toContain("Labour Day");
  });

  it("still draws the month when nobody is off — the empty rows ARE the answer", () => {
    /* A sentence saying "nobody is off" would be one more thing to read than
       28 dates with nothing beside them. */
    draw();
    expect(rows()).toHaveLength(28);
    expect(document.querySelectorAll(".hm-lvp")).toHaveLength(0);
  });

  it("keeps the weekend in, quieter", () => {
    /* A run of leave crosses it, and a Saturday callout is a real thing that
       would otherwise have nowhere to draw. */
    draw();
    const sat = rows().find((r) => r.dataset.iso === "2026-09-05")!;
    expect(sat).toBeDefined();
    expect(sat.classList.contains("wknd")).toBe(true);
  });
});
