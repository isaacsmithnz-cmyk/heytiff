import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DAY_LEGEND, DayLegend, MY_DAY_LEGEND, Tile } from "../tiles";
import { DEFAULT_SETTINGS, type DayEntry, type WeekCtx, type WeekDay } from "../logic";

/* The shared day-language primitives. Both Time & Pay screens render these,
   so a change here shows up on someone's pay review AND on their own week. */

const WEEK: WeekDay[] = [
  ["MON", 29, "Jun"],
  ["TUE", 30, "Jun"],
  ["WED", 1, "Jul"],
  ["THU", 2, "Jul"],
  ["FRI", 3, "Jul"],
  ["SAT", 4, "Jul"],
  ["SUN", 5, "Jul"],
];
const ctx: WeekCtx = { week: WEEK, today: 4 };

const W = (h: number): DayEntry => ({ t: "work", in: "7:00 AM", out: "3:30 PM", h });

const tileClass = (d: DayEntry, i: number) => {
  const { container, unmount } = render(<Tile d={d} i={i} settings={DEFAULT_SETTINGS} ctx={ctx} />);
  const cls = (container.firstElementChild as HTMLElement).className;
  unmount();
  return cls;
};

describe("Tile", () => {
  it("takes its colour from the same split rules pay does", () => {
    expect(tileClass(W(8), 0)).toContain("std");
    expect(tileClass(W(11), 0)).toContain("over");
    expect(tileClass(W(6), 0)).toContain("under");
    expect(tileClass({ t: "leave", h: 8 }, 0)).toContain("leave");
    expect(tileClass({ t: "sick", h: 8 }, 0)).toContain("sick");
    expect(tileClass({ t: "ph", h: 8 }, 0)).toContain("ph");
    // a weekday past with nothing on it is a chase; a weekend one is just blank
    expect(tileClass({ t: "empty" }, 0)).toContain("miss");
    expect(tileClass({ t: "empty" }, 5)).toContain("empty");
  });

  it("a short Saturday is not an under day — weekend rules key off the weekday", () => {
    expect(tileClass(W(4), 5)).toContain("over"); // Sat penalty, not "under"
  });

  it("rings today", () => {
    expect(tileClass(W(8), 4)).toContain("today");
    expect(tileClass(W(8), 3)).not.toContain("today");
  });

  it("is a plain div until it is given something to do", () => {
    const { container } = render(<Tile d={W(8)} i={0} settings={DEFAULT_SETTINGS} ctx={ctx} />);
    expect(container.querySelector("button")).toBeNull();
    expect(container.firstElementChild?.tagName).toBe("DIV");
  });

  it("with onClick it becomes a button that reports its own index", async () => {
    const user = userEvent.setup();
    const onClick = jest.fn();
    render(<Tile d={W(8)} i={3} settings={DEFAULT_SETTINGS} ctx={ctx} onClick={onClick} />);
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledWith(3);
  });

  it("carries the selected state, and keeps the colour class while selected", () => {
    const { container } = render(
      <Tile d={W(11)} i={2} settings={DEFAULT_SETTINGS} ctx={ctx} onClick={jest.fn()} selected />,
    );
    const btn = container.querySelector("button") as HTMLElement;
    expect(btn.className).toContain("sel");
    expect(btn.className).toContain("over");
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });
});

describe("DayLegend", () => {
  it("defaults to the reviewed-day colours", () => {
    const { container } = render(<DayLegend />);
    expect(container.querySelectorAll(".lg")).toHaveLength(DAY_LEGEND.length);
    expect(container.querySelector(".sw.miss")).toBeNull();
    expect(screen.getByText("Day colour")).toBeInTheDocument();
  });

  it("takes a different set of items — your own week names the missing days", () => {
    const { container } = render(<DayLegend items={MY_DAY_LEGEND} />);
    expect(container.querySelector(".sw.miss")).not.toBeNull();
    expect(screen.getByText("Missing")).toBeInTheDocument();
  });
});
