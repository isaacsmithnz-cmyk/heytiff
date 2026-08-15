import { render, screen } from "@testing-library/react";
import { TiffWorking } from "../orb";

/* THE WORD IS THE LABEL, AND THE LABEL IS THE WORD. The indicator this
   replaced carried its meaning in an `aria-label` on a decorative span — a
   sentence written for screen readers about a state no sighted reader could
   name. Now there is one string, on the page, inside the live region.

   The sphere itself is tested next to where it lives (components/ui/orb.tsx);
   what these pin is the chip around it. */

describe("the wait, named", () => {
  it("announces the phase as text rather than as a hidden label", () => {
    render(<TiffWorking note="Searching the library" />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Searching the library");
    expect(status).not.toHaveAttribute("aria-label");
  });

  it("renders the phase verbatim, so the ellipsis stays the stylesheet's", () => {
    render(<TiffWorking note="Thinking" />);
    expect(screen.getByRole("status").textContent).toBe("Thinking");
  });

  it("keeps the orb decorative — the sphere is not a second announcement", () => {
    const { container } = render(<TiffWorking note="Thinking" />);
    expect(container.querySelectorAll("[aria-hidden='true'] .orb-ball")).toHaveLength(1);
  });

  /* The composer passes `tvsay` so the chip lands in the slot the plain grey
     voice line used to hold, and the stylesheet sizes it down from there. */
  it("takes the caller's class without losing its own", () => {
    const { container } = render(<TiffWorking note="Reading it back" className="tvsay" />);
    const chip = container.querySelector(".tk-work");
    expect(chip).toHaveClass("tk-work");
    expect(chip).toHaveClass("tvsay");
  });
});
