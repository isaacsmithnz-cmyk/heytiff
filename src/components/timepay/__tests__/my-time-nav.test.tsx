import { cleanup, render, screen } from "@testing-library/react";
import { MyTimeNav } from "../my-time-nav";
import { NAV_ROWS } from "@/components/shell/nav";

afterEach(cleanup);

/* Leave lost its row in the rail, so this tab bar IS its front door. These
   tests guard the two ways that quietly breaks: the tabs pointing somewhere
   the nav no longer agrees with, and the active face not being marked. */

describe("MyTimeNav", () => {
  it("offers both faces of your own time", () => {
    render(<MyTimeNav active="timesheet" />);
    expect(screen.getByText("Timesheet")).toBeTruthy();
    expect(screen.getByText("Leave")).toBeTruthy();
  });

  it("links each tab at its own route, so both stay linkable", () => {
    const { container } = render(<MyTimeNav active="timesheet" />);
    const hrefs = [...container.querySelectorAll("a.tp-tab")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/dashboard/my-timesheet", "/dashboard/my-leave"]);
  });

  it("marks only the active face", () => {
    const { container, rerender } = render(<MyTimeNav active="timesheet" />);
    const on = () => [...container.querySelectorAll("a.tp-tab.on")].map((a) => a.textContent);
    expect(on()).toEqual(["Timesheet"]);

    rerender(<MyTimeNav active="leave" />);
    expect(on()).toEqual(["Leave"]);
  });

  it("points at the same routes the nav folded together", () => {
    // The tab bar and nav.ts are two records of one decision. If someone moves
    // the leave route in the nav and not here, the folded screen is orphaned:
    // no rail row, and a tab that goes to the old address.
    const sheet = NAV_ROWS.find((n) => n.key === "mytimesheet")!;
    const { container } = render(<MyTimeNav active="timesheet" />);
    const hrefs = [...container.querySelectorAll("a.tp-tab")].map((a) => a.getAttribute("href"));

    expect(hrefs).toContain(sheet.href);
    for (const sub of sheet.subItems ?? []) expect(hrefs).toContain(sub.href);
    expect(hrefs).toHaveLength(1 + (sheet.subItems ?? []).length);
  });
});
