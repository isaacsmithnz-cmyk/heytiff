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
});
