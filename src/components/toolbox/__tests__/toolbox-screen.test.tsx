/* Toolbox screen — one tile per TOOL, a filter chip per non-empty category,
   live tools linking to their pages, and search narrowing both. */

import { render, screen, fireEvent } from "@testing-library/react";
import { ToolboxScreen } from "../toolbox-screen";
import {
  NEW_FOR_DAYS,
  TOOL_CATEGORIES,
  allTools,
  categoryChips,
  toolBadge,
  toolIcon,
  toolMatches,
  visibleTools,
} from "../tools";

/* A fixed "today" so these never drift: the registry's real ship dates age
   past the New window as the calendar moves, and a test reading the wall
   clock would quietly start asserting something different next month. */
const TODAY = "2026-08-05";

describe("ToolboxScreen", () => {
  it("renders a tile for every tool in the registry, plus the search", () => {
    render(<ToolboxScreen today={TODAY} />);
    expect(screen.getByRole("heading", { name: /Toolbox/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Search tools")).toBeInTheDocument();
    const tools = allTools();
    for (const { tool } of tools) {
      expect(screen.getByRole("link", { name: new RegExp(tool.name) })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("link")).toHaveLength(tools.length);
  });

  /* THE TILE IS THE TOOL. The count in the title is the one number on the
     screen that says how much is here, and it used to be four separate pills
     reading "1", "2", "1" on cards you could count by eye. */
  it("counts the tools once, in the title", () => {
    render(<ToolboxScreen today={TODAY} />);
    expect(screen.getByRole("heading", { name: /Toolbox/ })).toHaveTextContent(
      `${allTools().length} field tools`
    );
  });

  it("gives every category with tools a filter chip, and All to get back", () => {
    render(<ToolboxScreen today={TODAY} />);
    const chips = screen.getAllByRole("button");
    expect(chips.map((b) => b.textContent)).toEqual([
      "All 4",
      "Calculators 1",
      "Troubleshooting 2",
      "Reference 1",
    ]);
    expect(screen.getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("a chip filters the grid down to its own tools", () => {
    render(<ToolboxScreen today={TODAY} />);
    fireEvent.click(screen.getByRole("button", { name: /^Troubleshooting/ }));
    expect(screen.getByRole("link", { name: /Running Pressures/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Fault Finder/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Heat Load/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Troubleshooting/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    // and All takes you back
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    expect(screen.getByRole("link", { name: /Heat Load/ })).toBeInTheDocument();
  });

  /* A FILTER YOU CANNOT SEE IS A FILTER YOU CANNOT UNDO. Search runs first, so
     it can empty the category the chip row is standing on — and when it does,
     that chip leaves the row. Honouring the click at that point would leave a
     screen filtered by something with no control left on it. */
  it("falls back to All when the search empties the chosen category", () => {
    render(<ToolboxScreen today={TODAY} />);
    fireEvent.click(screen.getByRole("button", { name: /^Calculators/ }));
    fireEvent.change(screen.getByLabelText("Search tools"), { target: { value: "pressure" } });
    expect(screen.queryByRole("button", { name: /^Calculators/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Running Pressures/ })).toBeInTheDocument();
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

  /* A CATEGORY WITH NO TOOLS IS NOT A SHELF. "Design Tools" was a permanently
     empty quarter of the grid reading "Nothing here yet", and it collided with
     "Design Studio · VRF design canvas" — a live rail row two items above it.
     Someone hunting for a design tool clicked the empty card while the real
     one sat in the nav. The registry entry stays; it gets a chip with the
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

  it("search filters tiles and drops the chips with no matches", () => {
    render(<ToolboxScreen today={TODAY} />);
    fireEvent.change(screen.getByLabelText("Search tools"), { target: { value: "pressure" } });
    expect(screen.getByRole("link", { name: /Running Pressures/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Heat Load/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Calculators/ })).not.toBeInTheDocument();
  });

  /* One chip left is not a choice, and a row containing only "All" and the
     category you are already looking at is chrome describing itself. */
  it("hides the whole chip row when the search leaves one category standing", () => {
    render(<ToolboxScreen today={TODAY} />);
    fireEvent.change(screen.getByLabelText("Search tools"), { target: { value: "pressure" } });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
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

/* The shape the landing screen reads. Pure functions over the real registry,
   so the rules are testable without rendering and the screen can only draw
   what they return. */
describe("the tool shelf", () => {
  it("counts chips off the SEARCH, never the registry", () => {
    expect(categoryChips("").map((c) => [c.title, c.count])).toEqual([
      ["Calculators", 1],
      ["Troubleshooting", 2],
      ["Reference", 1],
    ]);
    // one of Troubleshooting's two matches, so the chip must say 1, not 2
    expect(categoryChips("pressure")).toEqual([
      { key: "troubleshooting", title: "Troubleshooting", accent: "#2E68FF", count: 1 },
    ]);
    expect(categoryChips("zzzz")).toEqual([]);
  });

  it("honours a category only while the search leaves something in it", () => {
    expect(visibleTools("", "troubleshooting").map((s) => s.tool.name)).toEqual([
      "Running Pressures",
      "Fault Finder",
    ]);
    expect(visibleTools("", "all").map((s) => s.tool.name)).toHaveLength(4);
    // "calculators" has no match for "pressure", so the request is dropped
    // rather than rendering an empty grid under a chip that is no longer there
    expect(visibleTools("pressure", "calculators").map((s) => s.tool.name)).toEqual([
      "Running Pressures",
    ]);
    expect(visibleTools("zzzz", "all")).toEqual([]);
  });

  /* TWO TILES, ONE ICON reads as a rendering fault. Running Pressures and
     Fault Finder are the only pair in one category today, and they were the
     pair that proved it — both wore the Troubleshooting warning triangle. */
  it("never gives two tools in one category the same glyph", () => {
    for (const cat of TOOL_CATEGORIES) {
      const icons = cat.tools.map((tool) => toolIcon({ tool, cat }));
      expect(new Set(icons).size).toBe(icons.length);
    }
  });

  /* SEMANTIC STATE IS NEVER A PAGE ACCENT. Troubleshooting shipped as
     #FF3366 — the app's danger red — so two working tools rendered as an
     alert. Categories are identity; ok-teal and danger-red mean something. */
  it("keeps category accents out of the semantic set, and off each other", () => {
    const semantic = ["#FF3366", "#e0264f", "#00A389", "#FF8A00"];
    const accents = TOOL_CATEGORIES.map((c) => c.accent);
    for (const a of accents) expect(semantic).not.toContain(a);
    expect(new Set(accents).size).toBe(accents.length);
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
