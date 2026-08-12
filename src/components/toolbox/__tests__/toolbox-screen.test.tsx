/* Toolbox screen — category cards render from the registry, live tools link
   to their pages, empty categories keep their hint, and the
   search box filters rows / hides cards with no matches. */

import { render, screen, fireEvent } from "@testing-library/react";
import { ToolboxScreen } from "../toolbox-screen";
import { NEW_FOR_DAYS, TOOL_CATEGORIES, toolBadge, toolMatches } from "../tools";

/* A fixed "today" so these never drift: the registry's real ship dates age
   past the New window as the calendar moves, and a test reading the wall
   clock would quietly start asserting something different next month. */
const TODAY = "2026-08-05";

describe("ToolboxScreen", () => {
  it("renders a card for every category that HAS a tool, plus the search", () => {
    render(<ToolboxScreen today={TODAY} />);
    expect(screen.getByRole("heading", { name: "Toolbox" })).toBeInTheDocument();
    expect(screen.getByLabelText("Search tools")).toBeInTheDocument();
    for (const cat of TOOL_CATEGORIES.filter((c) => c.tools.length > 0)) {
      expect(screen.getByText(cat.title)).toBeInTheDocument();
    }
  });

  it("links the live tools to their routes", () => {
    render(<ToolboxScreen today={TODAY} />);
    expect(screen.getByRole("link", { name: /Heat Load/ })).toHaveAttribute(
      "href",
      "/dashboard/toolbox/heat-load"
    );
    expect(screen.getByRole("link", { name: /Running Pressures/ })).toHaveAttribute(
      "href",
      "/dashboard/toolbox/running-pressures"
    );
    expect(screen.getByRole("link", { name: /Fault Finder/ })).toHaveAttribute(
      "href",
      "/dashboard/toolbox/troubleshooting"
    );
    expect(screen.getByRole("link", { name: /Outdoor Unit Placement/ })).toHaveAttribute(
      "href",
      "/dashboard/toolbox/outdoor-unit"
    );
  });

  /* A CATEGORY WITH NO TOOLS IS NOT A CARD. "Design Tools" was a permanently
     empty quarter of the grid reading "Nothing here yet", and it collided with
     "Design Studio · VRF design canvas" — a live rail row two items above it.
     Someone hunting for a design tool clicked the empty card while the real
     one sat in the nav. The registry entry stays; the card returns with the
     first tool that lands on it. */
  it("does not render a category that has no tools", () => {
    render(<ToolboxScreen today={TODAY} />);
    const empty = TOOL_CATEGORIES.filter((c) => c.tools.length === 0);
    expect(empty.length).toBeGreaterThan(0); // or this test proves nothing
    for (const cat of empty) {
      expect(screen.queryByText(cat.title)).not.toBeInTheDocument();
    }
    expect(screen.queryByText("Nothing here yet")).not.toBeInTheDocument();
  });

  it("search filters rows and drops categories with no matches", () => {
    render(<ToolboxScreen today={TODAY} />);
    fireEvent.change(screen.getByLabelText("Search tools"), { target: { value: "pressure" } });
    expect(screen.getByRole("link", { name: /Running Pressures/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Heat Load/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Calculators")).not.toBeInTheDocument();
  });

  it("no-match search shows the global empty state", () => {
    render(<ToolboxScreen today={TODAY} />);
    fireEvent.change(screen.getByLabelText("Search tools"), { target: { value: "zzzz" } });
    expect(screen.getByText(/No tools match/)).toBeInTheDocument();
  });

  it("toolMatches is case-insensitive across name + desc", () => {
    const t = { name: "Running Pressures", desc: "R32 / R410A reference", href: "/x" };
    expect(toolMatches(t, "r410")).toBe(true);
    expect(toolMatches(t, "RUNNING")).toBe(true);
    expect(toolMatches(t, "duct")).toBe(false);
    expect(toolMatches(t, "  ")).toBe(true);
  });
});

/* The New badge.

   Every tool in the registry used to carry a hand-set `badge: "New"` — all
   four, indefinitely. A mark every row wears is not a mark, it is a column,
   and it can never come off because nothing behind it can change. These pin
   the two properties that stop it coming back: New is DERIVED from a ship
   date, and it EXPIRES. */
describe("toolBadge", () => {
  const tool = { name: "T", desc: "d", href: "/x" };

  it("says New inside the window and nothing after it", () => {
    expect(NEW_FOR_DAYS).toBe(14);
    expect(toolBadge({ ...tool, addedOn: "2026-08-05" }, TODAY)).toBe("New"); // today
    expect(toolBadge({ ...tool, addedOn: "2026-07-23" }, TODAY)).toBe("New"); // 13 days
    expect(toolBadge({ ...tool, addedOn: "2026-07-22" }, TODAY)).toBeNull(); // 14 — done
    expect(toolBadge({ ...tool, addedOn: "2026-01-01" }, TODAY)).toBeNull();
  });

  it("wears nothing at all when a tool declares no date and no badge", () => {
    expect(toolBadge(tool, TODAY)).toBeNull();
  });

  it("keeps the hand-set badges, which are judgements not facts", () => {
    expect(toolBadge({ ...tool, badge: "Beta" }, TODAY)).toBe("Beta");
    expect(toolBadge({ ...tool, badge: "Popular" }, TODAY)).toBe("Popular");
  });

  it("lets New win while it lasts, then falls back to the hand-set one", () => {
    // a tool can be both new and in beta; "just landed" is the more useful
    const beta = { ...tool, badge: "Beta" as const };
    expect(toolBadge({ ...beta, addedOn: "2026-08-01" }, TODAY)).toBe("New");
    expect(toolBadge({ ...beta, addedOn: "2026-01-01" }, TODAY)).toBe("Beta");
  });

  it("no longer lets the whole registry wear one at once", () => {
    /* The actual complaint, asserted against the real registry: on any given
       day the badge has to mean something, which it cannot if every tool has
       it. Ship four tools in one week and they will all say New, which is
       true — but they will also all stop. */
    const all = TOOL_CATEGORIES.flatMap((c) => c.tools);
    expect(all.length).toBeGreaterThan(0);
    const farFuture = "2027-01-01";
    expect(all.every((t) => toolBadge(t, farFuture) === null)).toBe(true);
  });
});
