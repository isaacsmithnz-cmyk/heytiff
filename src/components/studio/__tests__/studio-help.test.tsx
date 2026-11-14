/* How to design's panel (studio-help.tsx): the step you're on is the
   current step, a done one is ticked and drops its line, ✕ closes it. */

import { fireEvent, render, screen } from "@testing-library/react";
import { createDesign } from "@/lib/studio/document";
import { StudioHelp } from "../studio-help";

describe("StudioHelp", () => {
  it("marks where you're up to, lists the keys, and closes", () => {
    const onClose = jest.fn();
    render(<StudioHelp doc={createDesign({ name: "x", mode: "blank" })} pack={null} onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "How to design" });
    expect(dialog).toBeInTheDocument();
    const current = dialog.querySelector('[aria-current="step"]')!;
    expect(current.textContent).toContain("Plans");
    expect(screen.getByText("Turn the unit you picked")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
