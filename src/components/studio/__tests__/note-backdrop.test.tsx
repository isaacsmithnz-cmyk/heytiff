import { fireEvent, render, screen } from "@testing-library/react";
import { NoteBackdrop, NoteBlurControl } from "../note-backdrop";

describe("the note's blur control", () => {
  it("is off with no slider, and clicking it turns it on", () => {
    const onCommit = jest.fn();
    render(<NoteBlurControl blur={0} onLive={() => {}} onCommit={onCommit} />);
    expect(screen.queryByRole("slider")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Blur behind" }));
    expect(onCommit).toHaveBeenCalledWith(0.5);
  });

  it("shows the slider when on, and clicking again turns it off", () => {
    const onCommit = jest.fn();
    render(<NoteBlurControl blur={0.5} onLive={() => {}} onCommit={onCommit} />);
    expect(screen.getByRole("slider")).toHaveProperty("value", "50");
    fireEvent.click(screen.getByRole("switch", { name: "Blur behind" }));
    expect(onCommit).toHaveBeenCalledWith(0);
  });

  it("shows a drag live and writes only when let go", () => {
    const onLive = jest.fn();
    const onCommit = jest.fn();
    render(<NoteBlurControl blur={0.5} onLive={onLive} onCommit={onCommit} />);
    const slider = screen.getByRole("slider") as HTMLInputElement;
    fireEvent.input(slider, { target: { value: "80" } });
    expect(onLive).toHaveBeenLastCalledWith(0.8);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent(slider, new Event("change", { bubbles: false }));
    expect(onCommit).toHaveBeenCalledWith(0.8);
  });
});

describe("the blur itself", () => {
  it("draws the work under the notes again through its own filter", () => {
    const { container } = render(
      <svg>
        <NoteBackdrop id="f1" under="work" box={{ x: 0, y: 0, w: 10, h: 10 }} fontSize={10} blur={0.5} />
      </svg>
    );
    const use = container.querySelector("use")!;
    expect(use.getAttribute("href")).toBe("#work");
    expect(use.getAttribute("filter")).toBe("url(#f1)");
    expect(container.querySelector("filter#f1 feGaussianBlur")?.getAttribute("stdDeviation")).toBe("2.5");
  });
});
