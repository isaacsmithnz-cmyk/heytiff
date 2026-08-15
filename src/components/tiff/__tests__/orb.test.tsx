import { render, screen } from "@testing-library/react";
import { DOTS, TiffOrb, TiffWorking } from "../orb";

/* The orb.

   THE PROJECTION IS UNPROVABLE HERE and deliberately untested — jsdom has no
   layout, no `perspective` and no compositor, so where a dot LANDS is the
   browser's answer and nothing in this file can ask the question. That is the
   same line the search lines draw (`research-lines.tsx`): the geometry is the
   renderer's, the choreography is ours, and only the second one is asserted.

   What IS provable is the shell handed to the renderer — that the sphere is a
   sphere and not a heap, that every dot carries the two angles the stylesheet
   places it by, and that the moving part says nothing to a screen reader
   while the word beside it says everything. */

describe("the shell of dots", () => {
  it("is a closed sphere — five rings, poles left bare", () => {
    const lats = [...new Set(DOTS.map((d) => d.lat))].sort((a, b) => a - b);
    expect(lats).toEqual([-60, -30, 0, 30, 60]);
  });

  /* A dot ON the spin axis would sit dead still while everything around it
     moved, which is the one thing that reads as a bug rather than as depth. */
  it("puts nothing on the axis it turns around", () => {
    expect(DOTS.some((d) => Math.abs(d.lat) === 90)).toBe(false);
  });

  /* Rings near the poles are SHORT. A constant dot count would bunch them up
     there and leave the equator sparse — the giveaway that a sphere was drawn
     as a stack of identical circles. */
  it("thins each ring toward the poles so the spacing stays even", () => {
    const perRing = (lat: number) => DOTS.filter((d) => d.lat === lat).length;
    expect(perRing(0)).toBeGreaterThan(perRing(30));
    expect(perRing(30)).toBeGreaterThan(perRing(60));
    expect(perRing(60)).toBe(perRing(-60));
    expect(perRing(30)).toBe(perRing(-30));
  });

  it("spaces one ring evenly all the way round, ending before it repeats", () => {
    const equator = DOTS.filter((d) => d.lat === 0).map((d) => d.lon);
    const step = 360 / equator.length;
    expect(equator).toEqual(equator.map((_, i) => step * i));
    expect(Math.max(...equator)).toBeLessThan(360);
  });

  it("is the same sphere every time — no randomness to shimmer between renders", () => {
    const { container: a } = render(<TiffOrb />);
    const { container: b } = render(<TiffOrb />);
    expect(a.innerHTML).toBe(b.innerHTML);
  });
});

describe("rendering it", () => {
  const dots = (root: HTMLElement) => [...root.querySelectorAll(".tk-orb-shell i")];

  it("hands the stylesheet a longitude and a latitude for every dot", () => {
    const { container } = render(<TiffOrb />);
    const rendered = dots(container);

    expect(rendered).toHaveLength(DOTS.length);
    for (const dot of rendered) {
      const style = dot.getAttribute("style") ?? "";
      expect(style).toMatch(/--lat:\s*-?\d+deg/);
      expect(style).toMatch(/--lon:\s*\d+(\.\d+)?deg/);
    }
  });

  /* One number moves fifty dots: the radius each one is pushed out by is
     half this, and the stylesheet does that arithmetic. A size passed down
     to every dot instead would be fifty inline styles to keep in step. */
  it("takes its size as one custom property on the frame", () => {
    const { container } = render(<TiffOrb size={44} />);
    expect(container.querySelector(".tk-orb")).toHaveStyle({ "--tk-orb": "44px" });
  });

  it("says nothing at all to a screen reader", () => {
    const { container } = render(<TiffOrb />);
    expect(container.querySelector(".tk-orb")).toHaveAttribute("aria-hidden", "true");
  });
});

/* THE WORD IS THE LABEL, AND THE LABEL IS THE WORD. The indicator this
   replaced carried its meaning in an `aria-label` on a decorative span — a
   sentence written for screen readers about a state no sighted reader could
   name. Now there is one string, on the page, inside the live region. */
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
    expect(container.querySelectorAll("[aria-hidden='true'] .tk-orb-shell")).toHaveLength(1);
  });
});
