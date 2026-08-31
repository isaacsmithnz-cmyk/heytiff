import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { DOTS } from "@/components/ui/orb";
import { LevelOrb } from "../dictation";

/* The microphone meter.

   WHAT THIS FILE IS ACTUALLY GUARDING is a wiring contract, not a picture.
   The meter loop in `startMeter` writes `--lvl` onto ONE element sixty times
   a second — `barsRef.current.style.setProperty("--lvl", …)` — and never
   touches React again while a recording is open. Everything the meter shows
   therefore depends on two things being true at once: the ref lands on the
   element the loop writes to, and the orb sits inside that element so the
   property inherits down to the ball the stylesheet scales.

   Neither is visible in a rendered picture and neither is checkable here by
   looking at sizes — jsdom has no layout, does not resolve custom properties
   through inheritance, and never evaluates the `calc()` that turns the level
   into a scale. What IS checkable is that the two elements are still nested
   the right way round,
   which is the whole failure mode: the ref pointing at a sibling, or the orb
   being lifted out to a wrapper, would both leave a meter that renders
   perfectly and never moves. That shipped once as the old bars' `.tmb.ttyping`
   selector and took a live walk to notice.

   The sphere's own geometry is pinned next to it, in ui/__tests__/orb.test. */

describe("wiring the level to the sphere", () => {
  it("puts the ref on the element the meter loop writes, with the orb inside it", () => {
    const ref = createRef<HTMLSpanElement>();
    render(<LevelOrb innerRef={ref} />);

    // the loop's target: `--lvl` is set here and nowhere else
    expect(ref.current).toHaveClass("wb-lvl");
    // …and the ball that reads it is a descendant, so it inherits
    expect(ref.current?.querySelectorAll(".orb-ball")).toHaveLength(1);
    expect(ref.current?.querySelectorAll(".orb-ball i")).toHaveLength(DOTS.length);
  });

  /* The link itself, in the two halves that can actually be checked here: a
     level written the way the meter loop writes it lands on the ref's own
     inline style, and the ball is inside that element so CSS inheritance
     carries it the rest of the way.

     THE REST IS THE BROWSER'S and is not asserted. jsdom does not resolve
     custom properties through inheritance and does not evaluate the `calc()`
     that turns the level into a scale, so a test claiming to read `--lvl` off
     the ball would be testing jsdom's shrug, not our wiring. Containment is
     the real invariant; the cascade needs no test of ours. */
  it("takes the level on the element the loop writes, above the ball that reads it", () => {
    const ref = createRef<HTMLSpanElement>();
    const { container } = render(<LevelOrb innerRef={ref} />);

    ref.current?.style.setProperty("--lvl", "0.42");
    expect(ref.current?.style.getPropertyValue("--lvl")).toBe("0.42");

    const ball = container.querySelector(".orb-ball");
    expect(ball).not.toBeNull();
    expect(ref.current?.contains(ball!)).toBe(true);
  });

  /* THE SIZE IS THE STYLESHEET'S. Four rows set `--orb` — the ask bar, the
     add row, the dictation bar and the capture stage — and an inline style
     from the component would beat all four. */
  it("leaves the diameter to the row it is sitting in", () => {
    const ref = createRef<HTMLSpanElement>();
    const { container } = render(<LevelOrb innerRef={ref} />);
    expect(container.querySelector(".orb")).not.toHaveAttribute("style");
  });

  /* The region is labelled once, on the outside. The sphere is decoration. */
  it("is announced as listening, and only once", () => {
    const ref = createRef<HTMLSpanElement>();
    const { container } = render(<LevelOrb innerRef={ref} />);

    expect(screen.getByRole("status")).toHaveAccessibleName("Listening");
    expect(container.querySelector(".orb")).toHaveAttribute("aria-hidden", "true");
  });
});
