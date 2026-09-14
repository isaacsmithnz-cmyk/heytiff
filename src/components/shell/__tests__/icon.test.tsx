import { render } from "@testing-library/react";
import { iconSvg, ICON_PATHS, Icon } from "../icon";

describe("iconSvg", () => {
  it("wraps a known icon's path in a sized svg", () => {
    const svg = iconSvg("dashboard", 16, 2.5);
    expect(svg).toContain("<svg");
    expect(svg).toContain('width="16"');
    expect(svg).toContain('stroke-width="2.5"');
    expect(svg).toContain(ICON_PATHS.dashboard);
  });

  it("returns an empty svg for an unknown icon", () => {
    const svg = iconSvg("does-not-exist");
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).not.toContain("<path");
  });

  it("includes the icons added for the Team update", () => {
    for (const name of ["clock", "truck", "calendar", "receipt", "box"]) {
      expect(ICON_PATHS[name]).toBeTruthy();
    }
  });
});

describe("Icon component", () => {
  it("renders an svg element", () => {
    const { container } = render(<Icon name="users" />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  /* Step 5: the chevron's language. The default stroke is the mark's 7% on a
     24 grid with butt caps; a chosen tail is drawn at 55%; an icon not listed
     has none; and the two glyphs law 5 names are not in the set. */
  it("draws in the chevron's language by default", () => {
    const svg = iconSvg("search");
    expect(svg).toContain('stroke-width="1.7"');
    expect(svg).toContain('stroke-linecap="butt"');
    expect(svg).toContain('stroke-linejoin="round"');
  });
  it("dims the chosen tail and only the chosen tail", () => {
    expect(iconSvg("search").match(/opacity="\.55"/g)).toHaveLength(1);
    expect(iconSvg("search")).toMatch(/<path[^>]*opacity="\.55"\/>/); // the handle, not the lens
    expect(iconSvg("upload")).toMatch(/^<svg[^>]*><path[^>]*opacity="\.55"\/><path/); // the tray, first
    expect(iconSvg("x")).not.toContain("opacity"); // the close cross has no tail
  });
  it("carries no robot and no sparkle", () => {
    expect(ICON_PATHS.bot).toBeUndefined();
    expect(ICON_PATHS.sparkles).toBeUndefined();
  });
});
