/* Toolbox screen — category cards render from the registry, live tools link
   to their pages, empty categories keep their hint, and the
   search box filters rows / hides cards with no matches. */

import { render, screen, fireEvent } from "@testing-library/react";
import { ToolboxScreen } from "../toolbox-screen";
import { TOOL_CATEGORIES, toolMatches } from "../tools";

describe("ToolboxScreen", () => {
  it("renders all four category cards with title + search", () => {
    render(<ToolboxScreen />);
    expect(screen.getByRole("heading", { name: "Toolbox" })).toBeInTheDocument();
    expect(screen.getByLabelText("Search tools")).toBeInTheDocument();
    for (const cat of TOOL_CATEGORIES) {
      expect(screen.getByText(cat.title)).toBeInTheDocument();
    }
  });

  it("links the live tools to their routes", () => {
    render(<ToolboxScreen />);
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

  it("empty categories show the empty hint", () => {
    render(<ToolboxScreen />);
    // Design Tools is the only category with no built tools yet
    expect(screen.getAllByText("Nothing here yet")).toHaveLength(1);
  });

  it("search filters rows and drops categories with no matches", () => {
    render(<ToolboxScreen />);
    fireEvent.change(screen.getByLabelText("Search tools"), { target: { value: "pressure" } });
    expect(screen.getByRole("link", { name: /Running Pressures/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Heat Load/ })).not.toBeInTheDocument();
    // empty-category hints hidden while searching
    expect(screen.queryByText("Nothing here yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Calculators")).not.toBeInTheDocument();
  });

  it("no-match search shows the global empty state", () => {
    render(<ToolboxScreen />);
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
