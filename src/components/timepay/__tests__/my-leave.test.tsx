import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MyLeave } from "../my-leave";
import type { BalanceView, LeaveRequest } from "@/lib/timepay/leave";

/* Booking leave is choosing a shape on a calendar.

   These tests are all one question: does the grid and do the two fields say
   the same thing, whichever one you touch — and does a public holiday inside
   the span show up as a day you keep rather than one you spend. */

const requestLeave = jest.fn(async () => ({ ok: true as const }));
const cancelLeave = jest.fn(async () => ({ ok: true as const }));

jest.mock("@/app/actions/leave", () => ({
  requestLeave: (...a: unknown[]) => requestLeave(...(a as [])),
  cancelLeave: (...a: unknown[]) => cancelLeave(...(a as [])),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));

const TODAY = "2026-07-20"; // a Monday
// the first Monday in August — a real one-day-off shape to plan around
const HOLIDAYS = [{ date: "2026-08-03", name: "Picnic Day" }];

const ANNUAL: BalanceView = {
  kind: "annual",
  balanceHours: 152,
  asAt: "2026-07-01",
  source: "manual",
  booked: 0,
  available: 152,
};

function setup(over: Partial<React.ComponentProps<typeof MyLeave>> = {}) {
  const view = render(
    <MyLeave
      today={TODAY}
      standard={7.6}
      balances={[ANNUAL]}
      requests={[] as LeaveRequest[]}
      holidays={HOLIDAYS}
      {...over}
    />,
  );
  const user = userEvent.setup();
  /* the inline month grid, scoped: the From/To popovers draw the SAME
     calendar, so an unscoped day lookup finds two of everything */
  const side = () => view.container.querySelector<HTMLElement>(".lv-calside")!;
  const grid = () => within(side());
  const day = (name: string) => grid().getByRole("button", { name });
  const shownMonth = () => side().querySelector(".cal-mo")!.textContent;
  const nextMonth = () => user.click(grid().getByRole("button", { name: "Next month" }));
  const field = (label: string) => screen.getByLabelText(label);
  const openForm = () => user.click(screen.getByRole("button", { name: /Request leave/ }));
  return { ...view, user, grid, day, shownMonth, nextMonth, field, openForm };
}

const meta = () => document.querySelector(".lv-fmeta > span")!.textContent;

beforeEach(() => {
  requestLeave.mockClear();
});

describe("the calendar and the fields are one control", () => {
  it("click, click draws the range and fills From and To", async () => {
    const { user, day, field, openForm } = setup();
    await openForm();

    await user.click(day("Wednesday 22 July 2026"));
    // the first click is a one-day range, not a half-drawn nothing
    expect(field("From")).toHaveTextContent("22/07/2026");
    expect(field("To")).toHaveTextContent("22/07/2026");

    await user.click(day("Friday 24 July 2026"));
    expect(field("From")).toHaveTextContent("22/07/2026");
    expect(field("To")).toHaveTextContent("24/07/2026");
    // and the days between are banded, which is the whole point of the grid
    expect(day("Thursday 23 July 2026").className).toContain("rng");
  });

  it("orders the two clicks however they came", async () => {
    const { user, day, field, openForm } = setup();
    await openForm();

    await user.click(day("Friday 24 July 2026"));
    await user.click(day("Wednesday 22 July 2026")); // backwards
    expect(field("From")).toHaveTextContent("22/07/2026");
    expect(field("To")).toHaveTextContent("24/07/2026");
  });

  it("a third click starts a new range rather than stretching the old one", async () => {
    const { user, day, field, openForm } = setup();
    await openForm();

    await user.click(day("Wednesday 22 July 2026"));
    await user.click(day("Friday 24 July 2026"));
    await user.click(day("Monday 27 July 2026"));

    expect(field("From")).toHaveTextContent("27/07/2026");
    expect(field("To")).toHaveTextContent("27/07/2026");
    expect(day("Thursday 23 July 2026").className).not.toContain("rng");
  });

  it("moves the band when the From field is edited instead", async () => {
    const { user, day, field, openForm } = setup();
    await openForm();

    await user.click(field("From"));
    // the popover is its own calendar — pick inside it, not on the grid
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Thursday 30 July 2026" }),
    );

    expect(field("From")).toHaveTextContent("30/07/2026");
    expect(day("Thursday 30 July 2026").className).toContain("rng");
  });

  it("follows the From field into another month", async () => {
    const { user, day, field, shownMonth, openForm } = setup();
    await openForm();

    await user.click(field("From"));
    const pop = within(screen.getByRole("dialog"));
    await user.click(pop.getByRole("button", { name: "Next month" }));
    await user.click(pop.getByRole("button", { name: "Monday 10 August 2026" }));

    // the grid paged itself, so the band is on screen rather than a month away
    expect(shownMonth()).toBe("August 2026");
    expect(day("Monday 10 August 2026").className).toContain("rng");
  });

  it("says which click it is waiting for", async () => {
    const { user, day, openForm } = setup();
    await openForm();
    expect(screen.getByText("Pick the first day off, then the last")).toBeInTheDocument();

    await user.click(day("Wednesday 22 July 2026"));
    expect(screen.getByText("Now pick the last day off")).toBeInTheDocument();

    await user.click(day("Friday 24 July 2026"));
    expect(screen.getByText("Pick the first day off, then the last")).toBeInTheDocument();
  });

  it("refuses days that have already been", async () => {
    const { day, openForm } = setup();
    await openForm();
    expect(day("Sunday 19 July 2026")).toBeDisabled();
    expect(day("Monday 20 July 2026")).toBeEnabled();
  });
});

describe("public holidays inside the span", () => {
  it("marks the holiday on the grid and names it", async () => {
    const { grid, nextMonth, openForm } = setup();
    await openForm();
    await nextMonth();

    const picnic = grid().getByRole("button", { name: "Monday 3 August 2026, Picnic Day" });
    expect(picnic.className).toContain("hol");
  });

  it("counts the working days and says which day it gave back", async () => {
    const { user, day, nextMonth, openForm } = setup();
    await openForm();
    await nextMonth();

    // Mon 3 Aug – Fri 7 Aug, with the Monday a public holiday. The grid names
    // it in the cell itself, so the day you're clicking says what it is.
    await user.click(day("Monday 3 August 2026, Picnic Day"));
    await user.click(day("Friday 7 August 2026"));

    expect(meta()).toContain("4 working days");
    expect(meta()).toContain("1 public holiday skipped (Picnic Day)");
    expect(meta()).toContain("152h available");
  });

  it("counts holidays it cannot name in a line", async () => {
    const { user, day, nextMonth, openForm } = setup({
      holidays: [
        { date: "2026-08-03", name: "Picnic Day" },
        { date: "2026-08-05", name: "Show Day" },
        { date: "2026-08-07", name: "Cup Day" },
      ],
    });
    await openForm();
    await nextMonth();
    await user.click(day("Monday 3 August 2026, Picnic Day"));
    await user.click(day("Friday 7 August 2026, Cup Day"));

    expect(meta()).toContain("2 working days");
    expect(meta()).toContain("3 public holidays skipped");
    expect(meta()).not.toContain("Picnic Day");
  });

  it("says nothing about holidays when the span passes none", async () => {
    const { user, day, openForm } = setup();
    await openForm();
    await user.click(day("Wednesday 22 July 2026"));
    await user.click(day("Thursday 23 July 2026"));

    expect(meta()).toContain("2 working days");
    expect(meta()).not.toContain("public holiday");
  });
});

describe("submitting", () => {
  it("sends the dates the calendar drew, with the suggested hours", async () => {
    const { user, day, openForm } = setup();
    await openForm();
    await user.click(day("Wednesday 22 July 2026"));
    await user.click(day("Friday 24 July 2026"));
    await user.click(screen.getByRole("button", { name: /Submit request/ }));

    expect(requestLeave).toHaveBeenCalledWith({
      kind: "annual",
      startDate: "2026-07-22",
      endDate: "2026-07-24",
      hours: 22.8, // 3 working days × 7.6
      note: undefined,
    });
  });

  it("still lets the hours be overridden for a part day", async () => {
    const { user, day, field, openForm } = setup();
    await openForm();
    await user.click(day("Wednesday 22 July 2026"));
    // the suggestion is only ever the placeholder
    expect(field("Hours")).toHaveAttribute("placeholder", "7.6");
    await user.type(field("Hours"), "4");
    await user.click(screen.getByRole("button", { name: /Submit request/ }));

    expect(requestLeave).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: "2026-07-22", endDate: "2026-07-22", hours: 4 }),
    );
  });
});
