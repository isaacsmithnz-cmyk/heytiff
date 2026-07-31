import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MyTimeNav } from "../my-time-nav";
import { NAV_ROWS } from "@/components/shell/nav";

const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: (h: string) => push(h) }) }));

afterEach(() => {
  cleanup();
  push.mockClear();
});

/* Leave lost its row in the rail, so this tab bar IS its front door. These
   tests guard the two ways that quietly breaks: the tabs pointing somewhere
   the nav no longer agrees with, and the active face not being marked. */

describe("MyTimeNav", () => {
  it("offers both faces of your own time", () => {
    render(<MyTimeNav active="timesheet" />);
    expect(screen.getByText("Timesheet")).toBeTruthy();
    expect(screen.getByText("Leave")).toBeTruthy();
  });

  it("navigates to each face's own route, so both stay real URLs", async () => {
    const user = userEvent.setup();
    render(<MyTimeNav active="timesheet" />);

    await user.click(screen.getByRole("button", { name: "Leave" }));
    expect(push).toHaveBeenCalledWith("/dashboard/my-leave");

    await user.click(screen.getByRole("button", { name: "Timesheet" }));
    expect(push).toHaveBeenCalledWith("/dashboard/my-timesheet");
  });

  it("marks only the active face, and says so to assistive tech", () => {
    const { container, rerender } = render(<MyTimeNav active="timesheet" />);
    const on = () => [...container.querySelectorAll(".segsw-b.on")].map((b) => b.textContent);
    expect(on()).toEqual(["Timesheet"]);
    expect(screen.getByRole("button", { name: "Timesheet" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    rerender(<MyTimeNav active="leave" />);
    expect(on()).toEqual(["Leave"]);
  });

  it("drives the sliding thumb from the active index, not a hopping class", () => {
    // .segsw positions one travelling thumb off data-active; without the index
    // the thumb parks at 0 and the control silently stops tracking the tab.
    const { container, rerender } = render(<MyTimeNav active="timesheet" />);
    const seg = () => container.querySelector(".segsw")!;
    expect(seg().getAttribute("data-active")).toBe("0");
    expect(seg().querySelector(".segsw-thumb")).not.toBeNull();

    rerender(<MyTimeNav active="leave" />);
    expect(seg().getAttribute("data-active")).toBe("1");
  });

  it("points at the same routes the nav folded together", async () => {
    // The switcher and nav.ts are two records of one decision. If someone moves
    // the leave route in the nav and not here, the folded screen is orphaned:
    // no rail row, and a tab that goes to the old address.
    const user = userEvent.setup();
    const sheet = NAV_ROWS.find((n) => n.key === "mytimesheet")!;
    render(<MyTimeNav active="timesheet" />);

    const expected = [sheet.href, ...(sheet.subItems ?? []).map((s) => s.href)];
    for (const b of screen.getAllByRole("button")) await user.click(b);

    expect(push.mock.calls.map(([h]) => h).sort()).toEqual([...expected].sort());
  });
});
