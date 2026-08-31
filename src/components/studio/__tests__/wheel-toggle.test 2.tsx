/* The scroll-wheel setting. The DEFAULT is the whole reason this file exists:
   it shipped as "zoom" for a day and left a trackpad unable to cross a plan,
   because two fingers zoomed and a pad has no other pan gesture. */

import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WheelModeToggle, useWheelMode } from "../wheel-toggle";

/** the control plus a live readout of what the store currently says */
function Harness() {
  const mode = useWheelMode();
  return (
    <>
      <WheelModeToggle value={mode} />
      <output data-testid="mode">{mode}</output>
    </>
  );
}

const pressed = (name: string) =>
  screen.getByRole("button", { name }).getAttribute("aria-pressed");

beforeEach(() => {
  localStorage.clear();
});

describe("wheel mode", () => {
  it("defaults to pan, so a trackpad can cross the plan out of the box", () => {
    render(<Harness />);
    expect(screen.getByTestId("mode")).toHaveTextContent("pan");
    expect(pressed("Scroll to pan")).toBe("true");
    expect(pressed("Scroll to zoom")).toBe("false");
  });

  it("takes the stored choice on the next visit", () => {
    localStorage.setItem("ht-wheel", "zoom");
    render(<Harness />);
    expect(screen.getByTestId("mode")).toHaveTextContent("zoom");
    expect(pressed("Scroll to zoom")).toBe("true");
  });

  it("treats anything it doesn't recognise as the default", () => {
    localStorage.setItem("ht-wheel", "sideways");
    render(<Harness />);
    expect(screen.getByTestId("mode")).toHaveTextContent("pan");
  });

  it("a click switches the mode and remembers it", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Scroll to zoom" }));

    expect(screen.getByTestId("mode")).toHaveTextContent("zoom");
    expect(localStorage.getItem("ht-wheel")).toBe("zoom");

    await user.click(screen.getByRole("button", { name: "Scroll to pan" }));

    expect(screen.getByTestId("mode")).toHaveTextContent("pan");
    expect(localStorage.getItem("ht-wheel")).toBe("pan");
  });

  /* every canvas on the page reads one store, and a second tab writing the key
     has to land here too — that is what the storage subscription is for */
  it("follows the same choice made in another tab", () => {
    render(<Harness />);
    expect(screen.getByTestId("mode")).toHaveTextContent("pan");

    act(() => {
      localStorage.setItem("ht-wheel", "zoom");
      window.dispatchEvent(new StorageEvent("storage", { key: "ht-wheel" }));
    });

    expect(screen.getByTestId("mode")).toHaveTextContent("zoom");
  });

  it("both halves stay on screen, so the choice is visible", () => {
    render(<Harness />);
    expect(screen.getByRole("group", { name: "Scroll wheel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scroll to zoom" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scroll to pan" })).toBeInTheDocument();
  });
});
