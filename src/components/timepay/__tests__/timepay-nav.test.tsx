import { cleanup, render, screen } from "@testing-library/react";
import { TimepayHead } from "../timepay-nav";

let path = "/dashboard/timepay";
jest.mock("next/navigation", () => ({ usePathname: () => path }));

afterEach(cleanup);
beforeEach(() => {
  path = "/dashboard/timepay";
});

/* The three faces of team Time & Pay, and the heading above them.

   Each face used to write its own header and no two agreed — 38px "Time & Pay"
   on Timesheets, 44px "Expenses" on Expenses, and on Leave a `.rhead` on a root
   with no `tpr`, which selected nothing at all and fell back to a bare h1. So
   the title changed its words, its size and its position across a single tab
   row. One header, above all three routes, is the fix; these pin it. */

describe("TimepayHead", () => {
  it("offers all three faces, each at its own real URL", () => {
    render(<TimepayHead />);
    expect(screen.getByRole("link", { name: "Timesheets" })).toHaveAttribute(
      "href",
      "/dashboard/timepay",
    );
    expect(screen.getByRole("link", { name: "Leave" })).toHaveAttribute(
      "href",
      "/dashboard/timepay/leave",
    );
    expect(screen.getByRole("link", { name: "Expenses" })).toHaveAttribute(
      "href",
      "/dashboard/timepay/expenses",
    );
  });

  /* ONE TITLE, and it stays put. It names the screen rather than the face
     because the tab row directly beneath already says which face you are on —
     unlike MyTimeHead, where the two routes are separate nav destinations. */
  it("titles all three the same, in the shape they now share", () => {
    const { container, rerender } = render(<TimepayHead />);
    const title = () => container.querySelector(".rhead h1")?.textContent;
    expect(title()).toBe("Time & Pay");

    path = "/dashboard/timepay/leave";
    rerender(<TimepayHead />);
    expect(title()).toBe("Time & Pay");

    path = "/dashboard/timepay/expenses";
    rerender(<TimepayHead />);
    expect(title()).toBe("Time & Pay");
    // no page writes its own any more
    expect(container.querySelector(".v2head")).toBeNull();
  });

  /* Longest match first: all three paths start with the sheets href, so
     testing that one first would claim the other two. */
  it("marks the live tab from the path, not the prefix", () => {
    const { container, rerender } = render(<TimepayHead />);
    const on = () => [...container.querySelectorAll(".wb2-vt.on")].map((b) => b.textContent);
    expect(on()).toEqual(["Timesheets"]);

    path = "/dashboard/timepay/leave";
    rerender(<TimepayHead />);
    expect(on()).toEqual(["Leave"]);

    path = "/dashboard/timepay/expenses";
    rerender(<TimepayHead />);
    expect(on()).toEqual(["Expenses"]);
  });

  it("survives the period query string the timesheets tab pushes", () => {
    path = "/dashboard/timepay";
    const { container } = render(<TimepayHead />);
    expect([...container.querySelectorAll(".wb2-vt.on")].map((b) => b.textContent)).toEqual([
      "Timesheets",
    ]);
  });

  it("wears the board's tab row, not a control of its own", () => {
    const { container } = render(<TimepayHead />);
    expect(container.querySelector(".wb2-vtabs")).not.toBeNull();
    expect(container.querySelectorAll(".wb2-vt")).toHaveLength(3);
  });
});
