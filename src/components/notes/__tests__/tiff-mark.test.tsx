import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { TiffGlyph, TiffMark } from "../tiff-mark";

const Span = ({ children }: { children: ReactNode }) => <span className="tiffmk">{children}</span>;
import { LAND_MS, LAP_MS, OPEN_MS, THROW_MS } from "../tiff-flight";

/* THE BOOMERANG'S CLOCK (Isaac, 20 November 2026: "it should stay in air
   while thinking"). Jest draws no CSS, so this holds the half that is
   code: which phase the mark is in, and what moves it on. The flight's
   own keyframes are the stylesheet's, held by tiff-button-motion. */

afterEach(cleanup);
afterEach(() => jest.useRealTimers());

const st = (c: HTMLElement) => c.querySelector(".tiffbtn-st") as HTMLElement;
const boom = (c: HTMLElement) => c.querySelector(".tiffbtn-boom") as HTMLElement;
/** The browser's own animation events, as React hears them. */
function fire(el: HTMLElement, type: "animationend" | "animationiteration", animationName: string) {
  const e = new Event(type, { bubbles: true });
  Object.defineProperty(e, "animationName", { value: animationName });
  act(() => {
    el.dispatchEvent(e);
  });
}

describe("the mark's flight", () => {
  it("is still at rest", () => {
    const { container } = render(<TiffGlyph size={24} />);
    expect(st(container)).toHaveClass("rest");
    expect(st(container).className).not.toMatch(/fly-/);
  });

  it("throws the boomerang when she starts, keeps it up while she works, and lands it on the lap after she's done", () => {
    const { container, rerender } = render(<TiffGlyph size={24} working />);
    expect(st(container)).toHaveClass("fly-throw");
    fire(boom(container), "animationend", "tiffThrow");
    expect(st(container)).toHaveClass("fly-orbit");
    // a lap ends while she is still working: it stays up
    fire(boom(container), "animationiteration", "tiffOrbit");
    expect(st(container)).toHaveClass("fly-orbit");
    // she's done: it finishes the lap it is on, then lands
    rerender(<TiffGlyph size={24} />);
    expect(st(container)).toHaveClass("fly-orbit");
    fire(boom(container), "animationiteration", "tiffOrbit");
    expect(st(container)).toHaveClass("fly-land");
    fire(boom(container), "animationend", "tiffLand");
    expect(st(container)).toHaveClass("rest", "caught");
  });

  it("lands straight from the throw when the work is over before the throw is", () => {
    const { container, rerender } = render(<TiffGlyph size={24} working />);
    rerender(<TiffGlyph size={24} />);
    fire(boom(container), "animationend", "tiffThrow");
    expect(st(container)).toHaveClass("fly-land");
  });

  it("hears only its own flight, not the lean or the spin inside it", () => {
    const { container } = render(<TiffGlyph size={24} working />);
    fire(container.querySelector(".tiffbtn-spin") as HTMLElement, "animationend", "tiffThrowSpin");
    expect(st(container)).toHaveClass("fly-throw");
  });

  /* a mark inside something hidden runs no animation, so no event comes */
  it("moves on by its own clock when no animation event comes", () => {
    jest.useFakeTimers();
    const { container, rerender } = render(<TiffGlyph size={24} working />);
    act(() => void jest.advanceTimersByTime(THROW_MS + 300));
    expect(st(container)).toHaveClass("fly-orbit");
    rerender(<TiffGlyph size={24} />);
    act(() => void jest.advanceTimersByTime(LAP_MS + 300));
    expect(st(container)).toHaveClass("fly-land");
    act(() => void jest.advanceTimersByTime(LAND_MS + 300));
    expect(st(container)).toHaveClass("rest");
  });

  /* rule 8's one exception: Home's mark throws one lap now and then */
  it("on Home, throws one lap every ten seconds at rest, and nowhere else", () => {
    jest.useFakeTimers();
    const home = render(<TiffGlyph size={96} alive />);
    const other = render(<TiffGlyph size={24} />);
    act(() => void jest.advanceTimersByTime(10_000));
    expect(st(home.container)).toHaveClass("fly-throw");
    expect(st(other.container)).toHaveClass("rest");
    act(() => void jest.advanceTimersByTime(THROW_MS + 300));
    expect(st(home.container)).toHaveClass("fly-land");
  });

  /* "on opening tiff, fast release, double spin behind her and back to rest" */
  it("plays the opening once for each new opening, then rests with the catch", () => {
    const { container, rerender } = render(<TiffMark opened={0} />, { wrapper: Span });
    expect(st(container)).toHaveClass("rest");
    rerender(<TiffMark opened={1} />);
    expect(st(container)).toHaveClass("fly-open");
    fire(boom(container), "animationend", "tiffOpen");
    expect(st(container)).toHaveClass("rest", "caught");
    // the same count again plays nothing
    rerender(<TiffMark opened={1} />);
    expect(st(container)).toHaveClass("rest");
  });

  it("finishes the opening by its own clock when no event comes", () => {
    jest.useFakeTimers();
    const { container, rerender } = render(<TiffMark opened={0} />, { wrapper: Span });
    rerender(<TiffMark opened={1} />);
    act(() => void jest.advanceTimersByTime(OPEN_MS + 300));
    expect(st(container)).toHaveClass("rest");
  });

  it("never leaves its place when motion is reduced", () => {
    const was = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("reduce"), media: q })) as unknown as typeof window.matchMedia;
    try {
      const { container } = render(<TiffGlyph size={24} working />);
      expect(st(container)).toHaveClass("rest");
    } finally {
      window.matchMedia = was;
    }
  });

  it("flies a smaller circle when it is small", () => {
    expect(render(<TiffGlyph size={24} />).container.querySelector(".tiffmk")).toHaveClass("small");
    expect(render(<TiffGlyph size={96} />).container.querySelector(".tiffmk")).not.toHaveClass("small");
  });
});
