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

  it("gives each face its own real URL", () => {
    render(<MyTimeNav active="timesheet" />);
    expect(screen.getByRole("link", { name: "Leave" })).toHaveAttribute(
      "href",
      "/dashboard/my-leave",
    );
    expect(screen.getByRole("link", { name: "Timesheet" })).toHaveAttribute(
      "href",
      "/dashboard/my-timesheet",
    );
  });

  it("marks only the active face, and says so to assistive tech", () => {
    const { container, rerender } = render(<MyTimeNav active="timesheet" />);
    const on = () => [...container.querySelectorAll(".tp-tab.on")].map((b) => b.textContent);
    expect(on()).toEqual(["Timesheet"]);
    expect(screen.getByRole("link", { name: "Timesheet" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    rerender(<MyTimeNav active="leave" />);
    expect(on()).toEqual(["Leave"]);
    expect(screen.getByRole("link", { name: "Timesheet" })).not.toHaveAttribute("aria-current");
  });

  it("wears the team screen's tab bar, not a control of its own", () => {
    // The whole point of the last change: one Time & Pay tab bar, whether it
    // is your time or the team's. A local class here means it has drifted.
    const { container } = render(<MyTimeNav active="timesheet" />);
    expect(container.querySelector(".tp-tabs")).not.toBeNull();
    expect(container.querySelectorAll(".tp-tab")).toHaveLength(2);
  });

  it("points at the same routes the nav folded together", () => {
    // The switcher and nav.ts are two records of one decision. If someone moves
    // the leave route in the nav and not here, the folded screen is orphaned:
    // no rail row, and a tab that goes to the old address.
    const sheet = NAV_ROWS.find((n) => n.key === "mytimesheet")!;
    render(<MyTimeNav active="timesheet" />);

    const expected = [sheet.href, ...(sheet.subItems ?? []).map((s) => s.href)];
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));

    expect(hrefs.sort()).toEqual([...expected].sort());
  });
});
