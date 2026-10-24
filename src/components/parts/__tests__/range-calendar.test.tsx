/* The calendar to pick days on (range-calendar.tsx; Isaac's mock of 24
   October 2026, sections 6 and 7): Monday first, a day off the roster grey,
   today ringed thin, public holidays struck through with a dot and named
   under the months, the days picked blue discs and the run between them a
   light blue fill, never ink. What it promises is tested here, and its
   rules in patterns.css are read the way design-ratchets.test.ts reads
   every sheet. */
import fs from "node:fs";
import path from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { RangeCalendar, dayWords, pickDay, type DaySpan } from "../range-calendar";

const HOLIDAYS = new Map([
  ["2026-12-25", "Christmas Day"],
  ["2026-12-26", "Boxing Day"],
  ["2026-12-28", "Boxing Day (additional day)"],
  ["2027-01-01", "New Year's Day"],
]);

/** The calendar with the presses wired through `pickDay`, as the leave form wires it. */
function Picker({ today, open = { start: null, end: null }, ...rest }: { today: string; open?: DaySpan } & Partial<React.ComponentProps<typeof RangeCalendar>>) {
  const [span, setSpan] = useState<DaySpan>(open);
  return (
    <>
      <RangeCalendar label="Pick your days off" today={today} span={span} onPick={(iso) => setSpan((s) => pickDay(s, iso))} holidays={HOLIDAYS} {...rest} />
      <output data-testid="span">{`${span.start ?? "-"}..${span.end ?? "-"}`}</output>
    </>
  );
}

const day = (name: string) => screen.getByRole("button", { name });
const spanNow = () => screen.getByTestId("span").textContent;

describe("pickDay", () => {
  it("picks the first day, then the last, and a third press starts again", () => {
    const one = pickDay({ start: null, end: null }, "2026-12-21");
    expect(one).toEqual({ start: "2026-12-21", end: null });
    const two = pickDay(one, "2027-01-01");
    expect(two).toEqual({ start: "2026-12-21", end: "2027-01-01" });
    // later or earlier, a third press is a new first day, never a longer span
    expect(pickDay(two, "2027-01-08")).toEqual({ start: "2027-01-08", end: null });
    expect(pickDay(two, "2026-12-10")).toEqual({ start: "2026-12-10", end: null });
  });

  it("takes a second press before the first day as the new first day, never a backwards span", () => {
    expect(pickDay({ start: "2026-12-21", end: null }, "2026-12-14")).toEqual({ start: "2026-12-14", end: null });
  });

  it("makes one day of the same day pressed twice", () => {
    expect(pickDay({ start: "2026-12-21", end: null }, "2026-12-21")).toEqual({ start: "2026-12-21", end: "2026-12-21" });
  });
});

describe("dayWords", () => {
  it("writes a day the way en-AU writes it", () => {
    expect(dayWords("2026-12-21")).toBe("Mon 21 Dec");
    expect(dayWords("2026-09-05")).toBe("Sat 5 Sept");
    expect(dayWords("2027-01-01")).toBe("Fri 1 Jan");
  });
});

describe("the months", () => {
  it("shows two months side by side, each named, Monday first", () => {
    render(<Picker today="2026-12-01" months={2} />);
    const dec = screen.getByRole("group", { name: "December 2026" });
    expect(screen.getByRole("group", { name: "January 2027" })).toBeInTheDocument();
    const grid = dec.querySelector(".pt-cal-grid")!;
    const heads = [...grid.querySelectorAll(".pt-cal-wd")].map((h) => h.textContent);
    expect(heads).toEqual(["M", "T", "W", "T", "F", "S", "S"]);
    // 1 December 2026 is a Tuesday: one empty cell under Monday, then the 1st
    const cells = [...grid.querySelectorAll(".pt-cal-cell")];
    expect(cells[0]!.querySelector("button")).toBeNull();
    expect(cells[1]!.querySelector("button")).toHaveAccessibleName("Tue 1 Dec, today");
  });

  it("greys the days off the roster, the weekend for Monday to Friday, and rings today thin", () => {
    render(<Picker today="2026-12-01" months={2} />);
    expect(day("Sat 5 Dec")).toHaveClass("pt-cal-day--off");
    expect(day("Sun 6 Dec")).toHaveClass("pt-cal-day--off");
    expect(day("Mon 7 Dec")).not.toHaveClass("pt-cal-day--off");
    expect(day("Tue 1 Dec, today")).toHaveClass("pt-cal-day--today");
  });

  it("greys a part-timer's days off, not only the weekend", () => {
    render(<Picker today="2026-12-01" months={2} workDays={[0, 1, 3]} />);
    expect(day("Wed 2 Dec")).toHaveClass("pt-cal-day--off");
    expect(day("Thu 3 Dec")).not.toHaveClass("pt-cal-day--off");
  });

  it("strikes a public holiday through, with a dot, names it to a screen reader, and lists the ones on screen", () => {
    render(<Picker today="2026-12-01" months={2} />);
    const xmas = day("Fri 25 Dec, public holiday");
    expect(xmas).toHaveClass("pt-cal-day--hol");
    expect(xmas.querySelector(".pt-cal-mark")).not.toBeNull();
    expect(document.querySelector(".pt-cal-hols")).toHaveTextContent(
      "Public holidays, not counted: Fri 25 Dec Christmas Day, Sat 26 Dec Boxing Day, Mon 28 Dec Boxing Day (additional day) and Fri 1 Jan New Year's Day",
    );
  });

  it("names no holiday line when none is on screen", () => {
    render(<Picker today="2026-10-01" />);
    expect(document.querySelector(".pt-cal-hols")).toBeNull();
  });

  it("fades the days that can't be picked", () => {
    render(<Picker today="2026-12-10" months={2} min="2026-12-10" />);
    expect(day("Wed 9 Dec")).toBeDisabled();
    expect(day("Thu 10 Dec, today")).toBeEnabled();
  });

  it("pages a month at a time, inside its bounds", async () => {
    const user = userEvent.setup();
    render(<Picker today="2026-10-24" max="2026-10-24" min="2026-07-24" />);
    expect(screen.getByRole("button", { name: "Later month" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Earlier month" }));
    expect(screen.getByRole("group", { name: "September 2026" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Earlier month" }));
    await user.click(screen.getByRole("button", { name: "Earlier month" }));
    expect(screen.getByRole("group", { name: "July 2026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Earlier month" })).toBeDisabled();
  });
});

describe("picking a span", () => {
  it("draws the first and last days as blue discs and the run between them as a light fill, in two presses", async () => {
    const user = userEvent.setup();
    render(<Picker today="2026-12-01" months={2} />);
    await user.click(day("Mon 21 Dec"));
    expect(spanNow()).toBe("2026-12-21..-");
    expect(day("Mon 21 Dec")).toHaveClass("pt-cal-day--picked");
    expect(day("Mon 21 Dec")).toHaveAttribute("aria-pressed", "true");
    // one day picked is a disc, not a run
    expect(document.querySelector(".pt-cal-cell--run")).toBeNull();

    await user.click(day("Fri 1 Jan, public holiday"));
    expect(spanNow()).toBe("2026-12-21..2027-01-01");
    expect(day("Fri 1 Jan, public holiday")).toHaveClass("pt-cal-day--picked");
    expect(day("Wed 23 Dec")).not.toHaveClass("pt-cal-day--picked");
    expect(day("Wed 23 Dec")).toHaveAttribute("aria-pressed", "true");
    expect(day("Wed 23 Dec").parentElement).toHaveClass("pt-cal-cell--run");
    expect(day("Mon 21 Dec").parentElement).toHaveClass("pt-cal-cell--run", "pt-cal-cell--first");
    expect(day("Fri 1 Jan, public holiday").parentElement).toHaveClass("pt-cal-cell--run", "pt-cal-cell--last");
    // the holidays inside the run are in it, and still struck through
    expect(day("Fri 25 Dec, public holiday").parentElement).toHaveClass("pt-cal-cell--run");
    expect(day("Sat 2 Jan")).toHaveAttribute("aria-pressed", "false");
  });

  it("starts again on a third press", async () => {
    const user = userEvent.setup();
    render(<Picker today="2026-12-01" months={2} />);
    await user.click(day("Mon 21 Dec"));
    await user.click(day("Thu 24 Dec"));
    await user.click(day("Tue 29 Dec"));
    expect(spanNow()).toBe("2026-12-29..-");
    expect(day("Mon 21 Dec")).not.toHaveClass("pt-cal-day--picked");
    expect(document.querySelector(".pt-cal-cell--run")).toBeNull();
  });

  it("paints no picked day with an inline colour", async () => {
    const user = userEvent.setup();
    render(<Picker today="2026-12-01" months={2} />);
    await user.click(day("Mon 21 Dec"));
    await user.click(day("Thu 31 Dec"));
    for (const el of document.querySelectorAll(".pt-cal-day, .pt-cal-cell")) expect(el.getAttribute("style")).toBeNull();
  });
});

describe("the keys", () => {
  it("makes the months one Tab stop, and the arrows move a day or a week", async () => {
    const user = userEvent.setup();
    render(<Picker today="2026-12-01" months={2} />);
    const stops = [...document.querySelectorAll<HTMLButtonElement>(".pt-cal-day")].filter((b) => b.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveAccessibleName("Tue 1 Dec, today");
    stops[0]!.focus();
    await user.keyboard("{ArrowRight}");
    expect(day("Wed 2 Dec")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(day("Wed 9 Dec")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(spanNow()).toBe("2026-12-09..-");
  });

  it("pages to the month an arrow walks into", async () => {
    const user = userEvent.setup();
    render(<Picker today="2026-10-30" />);
    day("Fri 30 Oct, today").focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("group", { name: "November 2026" })).toBeInTheDocument();
    expect(day("Fri 6 Nov")).toHaveFocus();
  });
});

/* THE SHEET: blue is a selection (rule 17), so nothing picked is ink. */
const SHEET = fs.readFileSync(path.join(process.cwd(), "src/components/parts/patterns.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const RULES = Array.from(SHEET.matchAll(/([^{}]+)\{([^{}]*)\}/g), (m) => [m[1]!.trim(), m[2]!] as const);
const rule = (sel: string) => RULES.find(([s]) => s === sel)?.[1] ?? "";

describe("the calendar's rules", () => {
  it("draws a picked day as a blue disc with white numbers", () => {
    const picked = rule(".pt-cal-day.pt-cal-day.pt-cal-day--picked");
    expect(picked).toMatch(/background:var\(--press\)/);
    expect(picked).toMatch(/color:var\(--white\)/);
  });

  it("fills the run with a light blue, the press blue at a tenth", () => {
    expect(rule(".pt-cal-cell.pt-cal-cell--run")).toMatch(/background:color-mix\(in srgb, var\(--press\) 10%, transparent\)/);
  });

  it("never fills a day, a cell or the run with ink", () => {
    const cal = RULES.filter(([sel]) => /\.pt-cal/.test(sel));
    expect(cal.length).toBeGreaterThan(10);
    for (const [, body] of cal) expect(body).not.toMatch(/background(?:-color)?\s*:\s*[^;]*(?:--ink|#050505|#000|black)/);
  });

  it("rings today thin, in ink, without a fill", () => {
    const today = rule(".pt-cal-day.pt-cal-day--today");
    expect(today).toMatch(/border-color:var\(--ink\)/);
    expect(today).not.toMatch(/background/);
  });
});

it("keeps the days in a named group for a screen reader", () => {
  render(<Picker today="2026-12-01" months={2} />);
  const group = screen.getByRole("group", { name: "Pick your days off" });
  expect(within(group).getAllByRole("button", { name: /Dec/ }).length).toBeGreaterThan(28);
});
