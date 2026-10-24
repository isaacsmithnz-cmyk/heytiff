/* THE PATTERNS: the row, the three states, the fade, and the two pages
   that wear Wrong. What these pin is what docs/design.md promises: a row's
   order and its one target, an `end` that stays its own button, nothing on
   screen in a load's first half second, a red word with no red box, a fade
   only on text that overflows, and a sheet that speaks only in tokens and
   on the scales. */

import fs from "node:fs";
import path from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Fade } from "../fade";
import { Dot, Row, RowList } from "../row";
import { Empty, Loading, Wrong } from "../states";
import NotFound from "@/app/not-found";
import RootError from "@/app/error";
import DashboardError from "@/app/dashboard/error";

/* A ResizeObserver jsdom lacks, which hands its callback to the test. */
let observed: Array<() => void> = [];
class FakeResizeObserver {
  cb: () => void;
  constructor(cb: () => void) {
    this.cb = cb;
  }
  observe() {
    observed.push(this.cb);
  }
  disconnect() {
    observed = observed.filter((c) => c !== this.cb);
  }
  unobserve() {}
}

function size(el: Element, dims: Partial<Record<"scrollWidth" | "clientWidth" | "scrollHeight" | "clientHeight", number>>) {
  for (const [k, v] of Object.entries(dims)) Object.defineProperty(el, k, { configurable: true, value: v });
}

beforeEach(() => {
  observed = [];
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
});
afterEach(() => {
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
});

describe("Fade (rule 50)", () => {
  it("is plain text that fits, with the whole of it in the page and no tooltip", () => {
    render(<Fade>Fujitsu ducted, 27 Milroy Street</Fade>);
    const el = screen.getByText("Fujitsu ducted, 27 Milroy Street");
    expect(el).toHaveClass("pt-fade");
    expect(el).not.toHaveClass("pt-fade--on");
    expect(el).not.toHaveAttribute("title");
  });

  it("fades only while the text overflows, measured again when it is resized", () => {
    render(<Fade>A long name</Fade>);
    const el = screen.getByText("A long name");
    size(el, { scrollWidth: 300, clientWidth: 120 });
    act(() => observed.forEach((cb) => cb()));
    expect(el).toHaveClass("pt-fade--on");
    size(el, { scrollWidth: 120, clientWidth: 120 });
    act(() => observed.forEach((cb) => cb()));
    expect(el).not.toHaveClass("pt-fade--on");
  });

  it("measures two lines by their height", () => {
    render(<Fade lines={2}>Two lines of words</Fade>);
    const el = screen.getByText("Two lines of words");
    expect(el).toHaveClass("pt-fade", "pt-fade--2");
    size(el, { scrollWidth: 100, clientWidth: 100, scrollHeight: 60, clientHeight: 40 });
    act(() => observed.forEach((cb) => cb()));
    expect(el).toHaveClass("pt-fade--on");
  });

  it("works without a ResizeObserver", () => {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    render(<Fade>Still here</Fade>);
    expect(screen.getByText("Still here")).toHaveClass("pt-fade");
  });
});

describe("Row (rule 39)", () => {
  it("holds lead, dot, name, line and end in that order, in a list", () => {
    render(
      <RowList label="Today's visits">
        <Row lead="9:00 am" dot="blue" name="Install at Milroy" line="Sam and Alex" end="Booked" />
      </RowList>,
    );
    const list = screen.getByRole("list", { name: "Today's visits" });
    expect(list).toHaveClass("pt-rows");
    const row = screen.getByRole("listitem");
    expect(row).toHaveClass("pt-row");
    expect(row).not.toHaveClass("pt-row--click");
    const parts = Array.from(row.children).map((c) => c.className);
    expect(parts).toEqual(["pt-row-lead", "pt-dot pt-dot--blue", "pt-row-text", "pt-row-end"]);
    expect(row.querySelector(".pt-row-name")).toHaveTextContent("Install at Milroy");
    expect(row.querySelector(".pt-row-line")).toHaveTextContent("Sam and Alex");
    expect(row.querySelectorAll(".pt-fade")).toHaveLength(2);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("leaves out what it isn't given", () => {
    render(<RowList><Row name="Just a name" /></RowList>);
    const row = screen.getByRole("listitem");
    expect(Array.from(row.children).map((c) => c.className)).toEqual(["pt-row-text"]);
  });

  it("opens with a link when it has an href, named by the row's name", () => {
    render(<RowList><Row name="Job 3395" href="/dashboard/workboard?job=3395" /></RowList>);
    const link = screen.getByRole("link", { name: "Job 3395" });
    expect(link).toHaveAttribute("href", "/dashboard/workboard?job=3395");
    expect(link).toHaveClass("pt-row-hit");
    expect(screen.getByRole("listitem")).toHaveClass("pt-row--click");
  });

  it("is a button with onClick, pressed by the keyboard, and its end button stays its own", async () => {
    const open = jest.fn();
    const call = jest.fn();
    render(
      <RowList>
        <Row name="Ring the client" onClick={open} end={<button type="button" onClick={call}>Call client</button>} />
      </RowList>,
    );
    const user = userEvent.setup();
    const hit = screen.getByRole("button", { name: "Ring the client" });
    expect(hit).toHaveAttribute("type", "button");
    await user.click(screen.getByRole("button", { name: "Call client" }));
    expect(call).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    hit.focus();
    await user.keyboard("{Enter}");
    expect(open).toHaveBeenCalledTimes(1);
    // the end button is not inside the covering button
    expect(hit.contains(screen.getByRole("button", { name: "Call client" }))).toBe(false);
  });

  it("draws a dot in its hue's bright value, hidden beside its words", () => {
    const { container } = render(<Dot hue="green" />);
    const dot = container.querySelector(".pt-dot")!;
    expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(dot).toHaveClass("pt-dot--green");
  });
});

describe("Empty (rule 40)", () => {
  it("says what's missing, then its line, then the action, and draws no picture", () => {
    const { container } = render(
      <Empty what="No visits yet" line="Book the first one for this job." action={<button type="button">Book a visit</button>} />,
    );
    const box = container.querySelector(".pt-empty")!;
    expect(Array.from(box.children).map((c) => c.className)).toEqual(["pt-empty-what", "pt-empty-line", "pt-empty-act"]);
    expect(screen.getByText("No visits yet")).toHaveClass("pt-empty-what");
    expect(screen.getByRole("button", { name: "Book a visit" })).toBeInTheDocument();
    expect(container.querySelector("img, svg")).toBeNull();
  });

  it("can stand without a line or an action, for a viewer who can't make the thing", () => {
    const { container } = render(<Empty what="No visits yet" action={null} />);
    expect(container.querySelector(".pt-empty")!.children).toHaveLength(1);
  });
});

describe("Loading (rule 41)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("shows nothing for half a second, then Tiff's mark and what is loading", () => {
    const { container } = render(<Loading what="Loading visits" />);
    const box = container.querySelector(".pt-load")!;
    expect(box).toHaveAttribute("aria-busy", "true");
    expect(box).toBeEmptyDOMElement();
    act(() => jest.advanceTimersByTime(499));
    expect(box).toBeEmptyDOMElement();
    act(() => jest.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toHaveTextContent("Loading visits");
    expect(screen.getByRole("status")).toHaveClass("pt-load-sr");
    /* the mark, turning, and never a skeleton (rule 41) */
    expect(box.querySelector(".tiffmk.working")).toHaveAttribute("aria-hidden", "true");
    expect(box.querySelector(".pt-load-shape, .pt-load-bar")).toBeNull();
  });

  it("stops its timer when it leaves", () => {
    const { unmount } = render(<Loading what="Loading visits" />);
    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe("Wrong (rule 42)", () => {
  it("is a red dot and a word, what it means, and what to do", () => {
    const { container } = render(
      <Wrong word="Didn't send" means="The client hasn't got the quote." action={<button type="button">Send quote</button>} />,
    );
    const box = container.querySelector(".pt-wrong")!;
    expect(Array.from(box.children).map((c) => c.className)).toEqual(["pt-wrong-word", "pt-wrong-means", "pt-wrong-act"]);
    const word = screen.getByText("Didn't send");
    expect(word).toHaveClass("pt-wrong-word");
    const dot = word.querySelector(".pt-dot") as HTMLElement;
    expect(dot).toHaveClass("pt-dot--red");
    expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "Send quote" })).toBeInTheDocument();
  });
});

describe("the not-found and error pages", () => {
  let err: jest.SpyInstance;
  beforeEach(() => {
    err = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => err.mockRestore());

  it("not found: the word, what it means, and a link Home", () => {
    render(<NotFound />);
    expect(screen.getByRole("main")).toHaveClass("pt-wrong-page");
    expect(screen.getByText("Not found")).toHaveClass("pt-wrong-word");
    expect(screen.getByRole("link", { name: "Go to Home" })).toHaveAttribute("href", "/dashboard");
  });

  it("an error: Try again fetches the page again, and Home is a link", async () => {
    const reset = jest.fn();
    const retry = jest.fn();
    const boom = new Error("boom");
    render(<RootError error={boom} reset={reset} unstable_retry={retry} />);
    expect(screen.getByRole("main")).toHaveClass("pt-wrong-page");
    expect(screen.getByText("Something went wrong")).toHaveClass("pt-wrong-word");
    expect(screen.getByRole("link", { name: "Go to Home" })).toHaveAttribute("href", "/dashboard");
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledWith(boom);
  });

  it("falls back to reset, and the dashboard's keeps the frame's own <main>", () => {
    const reset = jest.fn();
    const { container } = render(<DashboardError error={new Error("x")} reset={reset} />);
    expect(screen.queryByRole("main")).toBeNull();
    expect(container.firstElementChild).toHaveClass("pt-wrong-page");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("Next finds them where it looks", () => {
    for (const f of ["src/app/not-found.tsx", "src/app/error.tsx", "src/app/dashboard/error.tsx"]) {
      expect(fs.existsSync(path.join(process.cwd(), f))).toBe(true);
    }
    for (const f of ["src/app/error.tsx", "src/app/dashboard/error.tsx"]) {
      expect(fs.readFileSync(path.join(process.cwd(), f), "utf8")).toMatch(/^"use client";/);
    }
  });
});

/* THE SHEET, read the way design-ratchets.test.ts reads every sheet: the
   comments carry the reasons, only declarations count. */
const SHEET = fs
  .readFileSync(path.join(process.cwd(), "src/components/parts/patterns.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");
const RULES = Array.from(SHEET.matchAll(/([^{}]+)\{([^{}]*)\}/g), (m) => [m[1]!.trim(), m[2]!] as const);

/* The tokens a part may name: v2's colours and scales, and two aliases
   that are v2's by definition. `--press` is the blue of pressing (the
   accent ratchet counts `var(--blue)` in a rule), and `--link` is the one
   link token. */
const TOKENS = new Set([
  "ink", "white", "q", "blue", "red", "red-w", "orange", "orange-w", "green", "green-w", "yellow", "yellow-w",
  "purple", "purple-w", "pink", "pink-w", "grey", "line", "edge", "sel", "hov", "soft", "scrim", "shadow-overlay", "ring",
  "r-control", "r-button", "r-card", "r-pill", "t-fast", "t-move", "t-slide", "ease", "z-overlay", "z-modal", "z-toast", "z-raised",
  "font", "press", "link",
]);

describe("patterns.css", () => {
  it("is found and read", () => {
    expect(RULES.length).toBeGreaterThan(20);
  });

  it("names only pt- classes", () => {
    for (const [sel] of RULES) {
      for (const m of sel.matchAll(/\.([\w-]+)/g)) expect(m[1]).toMatch(/^pt-/);
    }
  });

  it("speaks only in tokens: no hex, no rgb or hsl, no colour by name", () => {
    expect(SHEET).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(SHEET).not.toMatch(/\b(?:rgba?|hsla?)\(/);
    expect(SHEET).not.toMatch(/:\s*(?:black|white|red|blue|grey|gray)\b/);
    for (const m of SHEET.matchAll(/var\(--([\w-]+)/g)) expect(TOKENS).toContain(m[1]);
  });

  it("keeps type, weight, spacing and corners on the scales", () => {
    for (const m of SHEET.matchAll(/font-size\s*:\s*(\d+)px|font\s*:\s*\d{3}\s+(\d+)px/g)) {
      expect([12, 13, 14, 16, 20, 24, 32]).toContain(Number(m[1] ?? m[2]));
    }
    for (const m of SHEET.matchAll(/font-weight\s*:\s*(\d+)|font\s*:\s*(\d{3})\s/g)) {
      expect([400, 500, 600, 700]).toContain(Number(m[1] ?? m[2]));
    }
    for (const m of SHEET.matchAll(/(?:padding|margin|gap)(?:-[a-z]+)?\s*:\s*([^;]+)/g)) {
      for (const t of m[1]!.trim().split(/\s+/)) {
        const px = /^(-?\d+)px$/.exec(t);
        if (px && Number(px[1]) !== -1) expect([0, 2, 4, 8, 12, 16, 24, 32, 48]).toContain(Number(px[1]));
      }
    }
    for (const m of SHEET.matchAll(/border-radius\s*:\s*([^;]+)/g)) expect(m[1]!.trim()).toMatch(/^var\(--r-(?:control|button|card|pill)\)$/);
  });

  it("is flat and still: no paint gradient, no shadow but the ring, no loop, no cut with an ellipsis", () => {
    const paint = SHEET.replace(/(?:-webkit-)?mask-image\s*:[^;}]*/g, "");
    expect(paint).not.toMatch(/gradient\(/);
    for (const m of SHEET.matchAll(/box-shadow\s*:\s*([^;]+)/g)) expect(m[1]!.trim()).toBe("var(--ring)");
    expect(SHEET).not.toMatch(/animation|@keyframes/);
    expect(SHEET).not.toMatch(/text-overflow|line-clamp/);
    expect(SHEET).not.toMatch(/transition\s*:\s*all\b/);
    expect(SHEET).not.toMatch(/z-index\s*:\s*\d/);
  });

  /* `.fg button:where(…)` is (0,1,1) and resets font, colour and fill on
     every button in the frame, so each rule on a control names two classes. */
  it("beats the frame's button reset on every control it styles", () => {
    const controls = /\.pt-(?:row-hit|row-name)\b/;
    let seen = 0;
    for (const [list] of RULES) {
      for (const sel of list.split(",")) {
        if (!controls.test(sel)) continue;
        seen++;
        const classes = (sel.replace(/::?[\w-]+(?:\([^)]*\))?/g, (p) => (p.startsWith("::") ? "" : ".x")).match(/\.[\w-]+/g) ?? []).length;
        if (classes < 2) throw new Error(`${sel.trim()} names one class, and .fg button's reset beats it`);
      }
    }
    expect(seen).toBeGreaterThan(2);
  });
});
