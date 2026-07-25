import { render, screen } from "@testing-library/react";
import { Plate } from "../plate";

describe("Plate", () => {
  it("uppercases whatever was typed", () => {
    render(<Plate plate="mkt482" />);
    expect(screen.getByText("MKT482")).toBeInTheDocument();
  });

  it("trims stray whitespace off the plate", () => {
    render(<Plate plate="  1TG 4ZR  " />);
    expect(screen.getByText("1TG 4ZR")).toBeInTheDocument();
  });

  it("shows the state tag when one is recorded", () => {
    const { container } = render(<Plate plate="MKT482" state="vic" />);
    expect(container.querySelector(".au-plate .st")?.textContent).toBe("VIC");
  });

  it("renders no tag at all rather than an empty one", () => {
    // AU plates are only unique within a state, but plenty of records simply
    // don't have it — a blank divider would read as missing data, not absent data
    for (const state of [undefined, null, "", "   "]) {
      const { container } = render(<Plate plate="MKT482" state={state} />);
      expect(container.querySelector(".st")).toBeNull();
    }
  });

  it("carries the size as a class, defaulting to md", () => {
    const { container: md } = render(<Plate plate="MKT482" />);
    expect(md.querySelector(".au-plate")?.className).toBe("au-plate");
    const { container: sm } = render(<Plate plate="MKT482" size="sm" />);
    expect(sm.querySelector(".au-plate")?.className).toBe("au-plate sm");
  });

  it("is styled by an UNSCOPED class, because fleet modals portal outside .fg", () => {
    const { container } = render(<Plate plate="MKT482" />);
    expect(container.querySelector(".au-plate")).not.toBeNull();
  });
});
