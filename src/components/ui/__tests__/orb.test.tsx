import { render, screen } from "@testing-library/react";
import { DOTS, Orb, Waiting } from "../orb";

/* The orb.

   THE PROJECTION IS UNPROVABLE HERE and deliberately untested — jsdom has no
   layout, no `perspective` and no compositor, so where a dot LANDS is the
   browser's answer and nothing in this file can ask the question. That is the
   same line the search lines draw (tiff/research-lines.tsx): the geometry is
   the renderer's, the choreography is ours, and only the second one is
   asserted.

   What IS provable is the shell handed to the renderer — that the sphere is a
   sphere and not a heap, that every dot carries the two angles the stylesheet
   places it by, that the level has exactly one element to move, and that the
   moving part says nothing to a screen reader. */

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

  /* Density is what buys the silhouette. Sparser forms were tried against the
     real meter sizes and every one of them reads as an arc or a pair of arcs
     rather than as a ball, which is why the 18px meter gets the same sphere
     the 30px transcript does. */
  it("keeps enough dots to read as a ball at meter sizes", () => {
    expect(DOTS.length).toBeGreaterThanOrEqual(48);
  });

  it("is the same sphere every time — no randomness to shimmer between renders", () => {
    const { container: a } = render(<Orb />);
    const { container: b } = render(<Orb />);
    expect(a.innerHTML).toBe(b.innerHTML);
  });
});

describe("rendering it", () => {
  it("hands the stylesheet a longitude and a latitude for every dot", () => {
    const { container } = render(<Orb />);
    const rendered = [...container.querySelectorAll(".orb-ball i")];

    expect(rendered).toHaveLength(DOTS.length);
    for (const dot of rendered) {
      const style = dot.getAttribute("style") ?? "";
      expect(style).toMatch(/--lat:\s*-?\d+deg/);
      expect(style).toMatch(/--lon:\s*\d+(\.\d+)?deg/);
    }
  });

  /* ONE ELEMENT MOVES WITH THE VOICE, and this is the assertion that keeps it
     that way. Scaling each dot's own transform instead would be 54 style
     recalculations per animation frame, on the one screen already running an
     AudioContext and a speech socket. The ball is the only thing between the
     spin and the dots, and the level scales it alone. */
  it("gives the level exactly one element to scale", () => {
    const { container } = render(<Orb />);
    expect(container.querySelectorAll(".orb-ball")).toHaveLength(1);
    expect(container.querySelectorAll(".orb-spin > .orb-ball")).toHaveLength(1);
  });

  /* One number moves fifty-four dots: the radius each one is pushed out by is
     half this, and the stylesheet does that arithmetic. */
  it("takes a size as one custom property on the frame", () => {
    const { container } = render(<Orb size={44} />);
    expect(container.querySelector(".orb")).toHaveStyle({ "--orb": "44px" });
  });

  /* THE METER'S SIZE IS THE STYLESHEET'S, and it changes in four rows. An
     inline style — even the component's own default — would win over every
     one of them, so no size prop must mean no style attribute at all. */
  it("writes no inline size when the caller leaves it to the stylesheet", () => {
    const { container } = render(<Orb />);
    expect(container.querySelector(".orb")).not.toHaveAttribute("style");
  });

  it("takes an extra class without losing its own", () => {
    const { container } = render(<Orb className="wb-lvl-orb" />);
    const frame = container.querySelector(".orb");
    expect(frame).toHaveClass("orb");
    expect(frame).toHaveClass("wb-lvl-orb");
  });

  /* Every caller already labels the region it sits in — "Listening", or the
     phase name beside it — and a sphere has nothing to add to either. */
  it("says nothing at all to a screen reader", () => {
    const { container } = render(<Orb />);
    expect(container.querySelector(".orb")).toHaveAttribute("aria-hidden", "true");
  });
});

/* THE WAIT, NAMED. The indicator this replaced carried its meaning in an
   `aria-label` on a decorative span — a sentence written for screen readers
   about a state no sighted reader could name. Now there is one string, on the
   page, inside the live region. */

describe("the wait, named", () => {
  it("announces the phase as text rather than as a hidden label", () => {
    render(<Waiting note="Searching the library" />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Searching the library");
    expect(status).not.toHaveAttribute("aria-label");
  });

  /* The vocabulary carries no punctuation; `.orb-say b::after` supplies the
     ellipsis, so a test matches the sentence and not a run of dots. */
  it("renders the wait verbatim", () => {
    render(<Waiting note="Reading it back" />);
    expect(screen.getByRole("status").textContent).toBe("Reading it back");
  });

  it("keeps the orb decorative — the sphere is not a second announcement", () => {
    const { container } = render(<Waiting note="Thinking" />);
    expect(container.querySelectorAll("[aria-hidden='true'] .orb-ball")).toHaveLength(1);
  });

  /* Callers pass the class of the slot the plain grey line used to hold —
     `tvsay` under Tiff's ask bar, `wb2-dicthint` on the note postures — so
     the chip inherits those margins and nothing around the control moves. */
  it("takes the caller's slot class without losing its own", () => {
    const { container } = render(<Waiting note="Reading it back" className="wb2-dicthint" />);
    const chip = container.querySelector(".orb-say");
    expect(chip).toHaveClass("orb-say");
    expect(chip).toHaveClass("wb2-dicthint");
  });
});
