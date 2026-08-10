import { cleanup, render, screen } from "@testing-library/react";
import { MyTimeHead } from "../my-time-nav";
import { NAV_ROWS } from "@/components/shell/nav";

let path = "/dashboard/my-timesheet";
jest.mock("next/navigation", () => ({ usePathname: () => path }));

afterEach(cleanup);
beforeEach(() => {
  path = "/dashboard/my-timesheet";
});

/* Leave lost its row in the rail, so this tab bar IS its front door. These
   tests guard the three ways that quietly breaks: the tabs pointing somewhere
   the nav no longer agrees with, the active face not being marked, and — since
   the header moved above both routes into `(my-time)/layout.tsx` — the title
   and the live tab disagreeing about which page you are on. */

describe("MyTimeHead", () => {
  it("offers both faces of your own time", () => {
    render(<MyTimeHead />);
    expect(screen.getByText("Timesheet")).toBeTruthy();
    expect(screen.getByText("Leave")).toBeTruthy();
  });

  it("gives each face its own real URL", () => {
    render(<MyTimeHead />);
    expect(screen.getByRole("link", { name: "Leave" })).toHaveAttribute(
      "href",
      "/dashboard/my-leave",
    );
    expect(screen.getByRole("link", { name: "Timesheet" })).toHaveAttribute(
      "href",
      "/dashboard/my-timesheet",
    );
  });

  /* ONE HEADING FOR BOTH ROUTES. Each page used to write its own, and they
     disagreed: `.rhead` with a 38px h1 here, a `.v2head` with a 44px one
     inline and twelve fewer pixels under it there. Clicking a tab resized the
     title and moved the row you had just clicked. */
  it("titles the page from the path, in the shape both pages now share", () => {
    const { container, rerender } = render(<MyTimeHead />);
    expect(container.querySelector(".rhead h1")?.textContent).toBe("My timesheet");

    path = "/dashboard/my-leave";
    rerender(<MyTimeHead />);
    expect(container.querySelector(".rhead h1")?.textContent).toBe("My leave");
    // one heading shape, not two: no page writes its own any more
    expect(container.querySelector(".v2head")).toBeNull();
  });

  it("marks only the active face, and says so to assistive tech", () => {
    const { container, rerender } = render(<MyTimeHead />);
    const on = () => [...container.querySelectorAll(".wb2-vt.on")].map((b) => b.textContent);
    expect(on()).toEqual(["Timesheet"]);
    expect(screen.getByRole("link", { name: "Timesheet" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    path = "/dashboard/my-leave";
    rerender(<MyTimeHead />);
    expect(on()).toEqual(["Leave"]);
    expect(screen.getByRole("link", { name: "Timesheet" })).not.toHaveAttribute("aria-current");
  });

  it("keeps the timesheet live under its own query string", () => {
    // the period switcher pushes ?period=, and startsWith has to survive it
    path = "/dashboard/my-timesheet";
    const { container } = render(<MyTimeHead />);
    expect([...container.querySelectorAll(".wb2-vt.on")].map((b) => b.textContent)).toEqual([
      "Timesheet",
    ]);
  });

  it("wears the board's tab row, not a control of its own", () => {
    // The whole point: ONE tab row, whether it's your time, the team's or a
    // board. This screen has had three controls of its own already (.segsw,
    // then .tp-tabs); a local class here means it has drifted a fourth time.
    const { container } = render(<MyTimeHead />);
    expect(container.querySelector(".wb2-vtabs")).not.toBeNull();
    expect(container.querySelectorAll(".wb2-vt")).toHaveLength(2);
    expect(container.querySelector(".wb2-vslide")).not.toBeNull();
  });

  it("points at the same routes the nav folded together", () => {
    // The switcher and nav.ts are two records of one decision. If someone moves
    // the leave route in the nav and not here, the folded screen is orphaned:
    // no rail row, and a tab that goes to the old address.
    const sheet = NAV_ROWS.find((n) => n.key === "mytimesheet")!;
    render(<MyTimeHead />);

    const expected = [sheet.href, ...(sheet.subItems ?? []).map((s) => s.href)];
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));

    expect(hrefs.sort()).toEqual([...expected].sort());
  });
});
