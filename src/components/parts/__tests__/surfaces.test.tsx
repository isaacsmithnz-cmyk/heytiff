import fs from "node:fs";
import path from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ConfirmDialog, Dialog } from "../dialog";
import { ToastProvider, useToast, type ToastInput } from "../toast";
import { SectionTabs, Tray, ViewTabs } from "../tabs";

/* THE SURFACES: the dialog (rule 36), the toast (rule 37), and the soft
   tabs, the section tabs and the tray (rules 29, 31, 30). What each rule
   promises is tested here: the roles, the keys, the states and the classes,
   and the sheet holds to the tokens and the scales. */

describe("Dialog", () => {
  function Host({ dismissable, width }: { dismissable?: boolean; width?: 400 | 560 | 720 }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open dialog</button>
        <Dialog
          open={open}
          heading="Rename file"
          onClose={() => setOpen(false)}
          dismissable={dismissable}
          width={width}
          foot={
            <>
              <button onClick={() => setOpen(false)}>Keep it</button>
              <button>Rename file</button>
            </>
          }
        >
          <input aria-label="Name" />
        </Dialog>
      </>
    );
  }

  it("is a modal dialog on <body>, named by its title", async () => {
    const { container } = render(<Host />);
    await userEvent.click(screen.getByText("Open dialog"));
    const dialog = screen.getByRole("dialog", { name: "Rename file" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.parentElement).toHaveClass("pt-scrim");
    expect(dialog.parentElement!.parentElement).toBe(document.body);
    const title = document.getElementById(dialog.getAttribute("aria-labelledby")!);
    expect(title).toHaveTextContent("Rename file");
    expect(title).toHaveClass("pt-dialog-title");
    expect(dialog).toHaveClass("pt-dialog", "pt-dialog--400");
    expect(dialog.querySelector(".pt-dialog-foot")).toHaveTextContent("Keep itRename file");
  });

  it.each([560, 720] as const)("comes %ipx wide", async (w) => {
    render(<Host width={w} />);
    await userEvent.click(screen.getByText("Open dialog"));
    expect(screen.getByRole("dialog")).toHaveClass(`pt-dialog--${w}`);
  });

  it("draws nothing while shut", () => {
    render(<Host />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector(".pt-scrim")).toBeNull();
  });

  it("takes focus, keeps Tab inside, and gives it back on Escape", async () => {
    render(<Host />);
    const opener = screen.getByText("Open dialog");
    await userEvent.click(opener);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByLabelText("Name")).toHaveFocus();
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Rename file" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByLabelText("Name")).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("closes on a click on the scrim, not on one inside it", async () => {
    render(<Host />);
    await userEvent.click(screen.getByText("Open dialog"));
    await userEvent.click(screen.getByLabelText("Name"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.click(document.querySelector(".pt-scrim")!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not close on a press that began inside and ended on the scrim", async () => {
    render(<Host />);
    await userEvent.click(screen.getByText("Open dialog"));
    const scrim = document.querySelector(".pt-scrim")!;
    fireEvent.mouseDown(screen.getByLabelText("Name"));
    fireEvent.click(scrim);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("stays open on the scrim when it is not dismissable, and Escape still closes it", async () => {
    render(<Host dismissable={false} />);
    await userEvent.click(screen.getByText("Open dialog"));
    await userEvent.click(document.querySelector(".pt-scrim")!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("ConfirmDialog", () => {
  it("asks with a red block and a second button, and starts on the one that keeps things", async () => {
    const onConfirm = jest.fn();
    const onClose = jest.fn();
    render(
      <ConfirmDialog heading="Delete this visit?" confirm="Delete visit" onConfirm={onConfirm} onClose={onClose}>
        The crew loses it from their day.
      </ConfirmDialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Delete this visit?" });
    expect(dialog).toHaveAccessibleDescription("The crew loses it from their day.");
    const keep = screen.getByRole("button", { name: "Keep it" });
    const del = screen.getByRole("button", { name: "Delete visit" });
    expect(keep).toHaveClass("pt-btn", "pt-btn--second");
    expect(del).toHaveClass("pt-btn", "pt-btn--danger");
    expect(keep).toHaveFocus();
    // the safe one first, the red one at the right end of the foot
    expect(keep.compareDocumentPosition(del) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(del);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await userEvent.click(keep);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("takes the main button when nothing is lost, and holds it while busy", () => {
    render(
      <ConfirmDialog heading="Send the quote?" confirm="Send quote" cancel="Not yet" danger={false} busy onConfirm={() => {}} onClose={() => {}} />,
    );
    const send = screen.getByRole("button", { name: "Send quote" });
    expect(send).toHaveClass("pt-btn", "pt-btn--main");
    expect(send).not.toHaveClass("pt-btn--danger");
    expect(send).toBeDisabled();
    expect(screen.getByRole("button", { name: "Not yet" })).toHaveClass("pt-btn--second");
  });
});

describe("Toast", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  let raise: (t: ToastInput) => () => void = () => () => {};
  function Raiser() {
    raise = useToast();
    return null;
  }
  const mount = () =>
    render(
      <ToastProvider>
        <Raiser />
      </ToastProvider>,
    );
  const show = (t: ToastInput) => {
    let dismiss = () => {};
    act(() => {
      dismiss = raise(t);
    });
    return dismiss;
  };
  const later = (ms: number) => act(() => jest.advanceTimersByTime(ms));

  it("speaks from a polite live region on <body>, there before the words are", () => {
    mount();
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveClass("pt-toasts");
    expect(region.parentElement).toBe(document.body);
    show({ text: "Visit booked" });
    expect(region).toHaveTextContent("Visit booked");
    expect(screen.getByText("Visit booked").closest(".pt-toast")).toBeInTheDocument();
  });

  it("goes after five seconds", () => {
    mount();
    show({ text: "Visit booked" });
    later(4_900);
    expect(screen.queryByText("Visit booked")).toBeInTheDocument();
    later(200);
    expect(screen.queryByText("Visit booked")).toBeNull();
  });

  it("stops its clock while the pointer is on it, and carries on from where it was", () => {
    mount();
    show({ text: "Visit booked" });
    later(3_000);
    const toast = screen.getByText("Visit booked").closest(".pt-toast")!;
    fireEvent.mouseEnter(toast);
    later(20_000);
    expect(screen.queryByText("Visit booked")).toBeInTheDocument();
    fireEvent.mouseLeave(toast);
    later(1_900);
    expect(screen.queryByText("Visit booked")).toBeInTheDocument();
    later(200);
    expect(screen.queryByText("Visit booked")).toBeNull();
  });

  it("stops its clock while the focus is on it", () => {
    mount();
    show({ text: "Visit moved", undo: () => {} });
    const undo = screen.getByRole("button", { name: "Undo" });
    act(() => undo.focus());
    later(20_000);
    expect(screen.queryByText("Visit moved")).toBeInTheDocument();
    act(() => undo.blur());
    later(5_100);
    expect(screen.queryByText("Visit moved")).toBeNull();
  });

  it("undoes its own action and goes", () => {
    mount();
    const undo = jest.fn();
    show({ text: "Visit deleted", undo });
    const button = screen.getByRole("button", { name: "Undo" });
    expect(button).toHaveClass("pt-toast-undo");
    fireEvent.click(button);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Visit deleted")).toBeNull();
  });

  it("has no Undo when there is nothing to undo", () => {
    mount();
    show({ text: "Link copied" });
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("stacks three at most, the oldest leaving first", () => {
    mount();
    show({ text: "One saved" });
    show({ text: "Two saved" });
    show({ text: "Three saved" });
    show({ text: "Four saved" });
    const texts = [...document.querySelectorAll(".pt-toast")].map((t) => t.textContent);
    expect(texts).toEqual(["Two saved", "Three saved", "Four saved"]);
  });

  it("returns its own dismiss", () => {
    mount();
    const dismiss = show({ text: "One saved" });
    show({ text: "Two saved" });
    act(() => dismiss());
    expect(screen.queryByText("One saved")).toBeNull();
    expect(screen.queryByText("Two saved")).toBeInTheDocument();
  });

  it("asks for its provider", () => {
    const quiet = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Raiser />)).toThrow(/ToastProvider/);
    quiet.mockRestore();
  });
});

describe("ViewTabs", () => {
  const items = [
    { key: "open", label: "Open" },
    { key: "quoted", label: "Quoted", tone: "look" as const },
    { key: "done", label: "Done" },
  ];
  function Host() {
    const [on, setOn] = useState("open");
    return <ViewTabs items={items} current={on} onGo={setOn} ariaLabel="Jobs" idPrefix="jt" panelPrefix="jp" />;
  }

  it("is a tablist of soft tabs, no numbers, a waiting view's word in amber", () => {
    render(<Host />);
    const list = screen.getByRole("tablist", { name: "Jobs" });
    expect(list).toHaveClass("pt-vtabs");
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Open", "Quoted, something to look at", "Done"]);
    for (const t of tabs) expect(t).toHaveClass("pt-vtab");
    expect(tabs[1]).toHaveClass("pt-vtab--look");
    expect(tabs[0]).not.toHaveClass("pt-vtab--look");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("id", "jt-open");
    expect(tabs[0]).toHaveAttribute("aria-controls", "jp-open");
  });

  it("is one tab stop, and the arrows walk it, round the ends", async () => {
    render(<Host />);
    const [open, quoted, done] = screen.getAllByRole("tab");
    expect(open!.tabIndex).toBe(0);
    expect(quoted!.tabIndex).toBe(-1);
    await userEvent.tab();
    expect(open).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    expect(quoted).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(done).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    expect(open).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(done).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(open).toHaveFocus();
  });

  it("goes where you press", async () => {
    render(<Host />);
    await userEvent.click(screen.getByRole("tab", { name: /Quoted/ }));
    expect(screen.getByRole("tab", { name: /Quoted/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Open/ })).toHaveAttribute("aria-selected", "false");
  });

  it("is a link when it has an address", () => {
    render(
      <ViewTabs
        ariaLabel="Jobs"
        current="open"
        items={[
          { key: "open", label: "Open", href: "/dashboard/jobs?view=open" },
          { key: "done", label: "Done", href: "/dashboard/jobs?view=done" },
        ]}
      />,
    );
    const tab = screen.getByRole("tab", { name: "Done" });
    expect(tab.tagName).toBe("A");
    expect(tab).toHaveAttribute("href", "/dashboard/jobs?view=done");
    expect(tab).toHaveAttribute("aria-selected", "false");
  });
});

describe("SectionTabs", () => {
  it("underlines the one you're on, with no numbers, a wrong section's word in red", async () => {
    const onGo = jest.fn();
    render(
      <SectionTabs
        ariaLabel="Job"
        current="visits"
        onGo={onGo}
        items={[
          { key: "overview", label: "Overview" },
          { key: "visits", label: "Visits" },
          { key: "photos", label: "Photos", tone: "wrong" },
        ]}
      />,
    );
    expect(screen.getByRole("tablist", { name: "Job" })).toHaveClass("pt-stabs");
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Overview", "Visits", "Photos, something wrong"]);
    for (const t of tabs) expect(t).toHaveClass("pt-stab");
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[2]).toHaveClass("pt-stab--wrong");
    act(() => tabs[1]!.focus());
    await userEvent.keyboard("{ArrowRight}");
    expect(tabs[2]).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onGo).toHaveBeenCalledWith("photos");
  });
});

describe("Tray", () => {
  const options = [
    { value: "day", label: "Day" },
    { value: "week", label: "Week" },
    { value: "month", label: "Month" },
  ] as const;
  function Host() {
    const [v, setV] = useState<"day" | "week" | "month">("week");
    return <Tray options={options} value={v} onChange={setV} ariaLabel="Range" />;
  }

  it("is a radiogroup with one chosen", () => {
    render(<Host />);
    expect(screen.getByRole("radiogroup", { name: "Range" })).toHaveClass("pt-tray");
    const radios = screen.getAllByRole("radio");
    for (const r of radios) expect(r).toHaveClass("pt-tray-opt");
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("moves the choice with the arrows, as radios do", async () => {
    render(<Host />);
    await userEvent.tab();
    expect(screen.getByRole("radio", { name: "Week" })).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Month" })).toHaveFocus();
    expect(screen.getByRole("radio", { name: "Month" })).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: "Day" })).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getByRole("radio", { name: "Month" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("radio", { name: "Week" }));
    expect(screen.getByRole("radio", { name: "Week" })).toHaveAttribute("aria-checked", "true");
  });
});

/* THE SHEET. Read the way design-ratchets.test.ts reads every sheet: comments
   out, declarations counted. */
describe("surfaces.css", () => {
  const raw = fs.readFileSync(path.join(process.cwd(), "src/components/parts/surfaces.css"), "utf8");
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const tokens = fs.readFileSync(path.join(process.cwd(), "src/app/tokens.css"), "utf8");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => [m[1]!.trim(), m[2]!] as const)
    .filter(([sel]) => !/^(from|to|\d+%)$/.test(sel));
  const decls = rules.flatMap(([, body]) =>
    body
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const at = d.indexOf(":");
        return [d.slice(0, at).trim(), d.slice(at + 1).trim()] as const;
      }),
  );
  const values = (prop: RegExp) => decls.filter(([p]) => prop.test(p)).map(([, v]) => v);

  const ALLOWED = new Set([
    "ink", "white", "q", "line", "edge", "sel", "hov", "soft", "scrim", "shadow-overlay", "ring", "ring-ink",
    "r-control", "r-button", "r-card", "t-fast", "t-move", "ease", "z-modal", "z-toast", "font",
    // a section tab's word in its state (rule 31): amber, red when wrong
    "orange-w", "red-w",
  ]);

  it("writes no colour of its own: no hex, no rgb, no named colour", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch)\(/);
    for (const v of values(/^(color|background|background-color|border(-[a-z]+)*)$/)) {
      for (const word of v.replace(/var\([^)]*\)/g, "").split(/[\s,]+/).filter(Boolean)) {
        expect(["transparent", "inherit", "currentColor", "solid", "0", "1px", "2px", "none"]).toContain(word);
      }
    }
  });

  it("takes every value it names from the tokens", () => {
    const used = new Set([...css.matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1]!));
    for (const name of used) {
      expect(ALLOWED).toContain(name);
      expect(tokens).toMatch(new RegExp(`--${name}\\s*:`));
    }
  });

  it("names every class pt- and the part", () => {
    const classes = [...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]!);
    expect(classes.length).toBeGreaterThan(10);
    for (const c of classes) expect(c).toMatch(/^pt-(dialog|scrim|toast|toasts|vtab|vtabs|stab|stabs|tray|tabs|tip)(-|$)/);
  });

  it("keeps to the scales: type, weights, spacing, corners, layers, motion", () => {
    for (const v of values(/^font-size$/)) expect(["12px", "13px", "14px", "16px", "20px", "24px", "32px"]).toContain(v);
    for (const v of values(/^font-weight$/)) expect(["400", "500", "600", "700"]).toContain(v);
    for (const v of values(/^(padding|margin|gap)(-[a-z]+)?$/)) {
      for (const t of v.split(/\s+/)) expect(["0", "-1px", "2px", "4px", "8px", "12px", "16px", "24px", "32px", "48px"]).toContain(t);
    }
    for (const v of values(/^border-radius$/)) expect(v.replace(/var\(--r-(control|button|card)\)/g, "").trim()).toMatch(/^(0\s*)*$/);
    for (const v of values(/^z-index$/)) expect(v).toMatch(/^var\(--z-(modal|toast)\)$/);
    for (const v of values(/^transition$/).filter((t) => t !== "none")) {
      for (const part of v.split(",")) expect(part.trim()).toMatch(/^[a-z-]+ var\(--t-(fast|move)\) var\(--ease\)$/);
      expect(v).not.toMatch(/\ball\b/);
    }
    for (const v of values(/^animation$/).filter((a) => a !== "none")) {
      expect(v).toMatch(/^pt-[\w-]+ var\(--t-move\) var\(--ease\) both$/);
    }
  });

  it("is flat: one shadow, on the dialog, and nothing cut with an ellipsis", () => {
    expect(css).not.toMatch(/gradient\(|text-shadow|drop-shadow|backdrop-filter|letter-spacing|text-transform|text-overflow|cubic-bezier/);
    const shadows = rules.filter(([, b]) => /box-shadow\s*:\s*var\(--shadow-overlay\)/.test(b)).map(([s]) => s);
    expect(shadows).toEqual([".pt-scrim .pt-dialog"]);
    for (const v of values(/^box-shadow$/)) expect(v).toMatch(/^var\(--(shadow-overlay|ring|ring-ink)\)$/);
  });

  it("rings the focus, never outlines it in a tint", () => {
    for (const cls of ["pt-vtab", "pt-stab", "pt-tray-opt", "pt-toast-undo"]) {
      const ring = rules.find(([s]) => s.split(",").some((p) => p.includes(`.${cls}:focus-visible`)));
      expect(ring?.[1]).toMatch(/box-shadow:\s*var\(--ring(-ink)?\)/);
    }
  });

  /* `.fg button:where(…)` is the frame's button reset, (0,1,1). Every rule
     that dresses a button part must outrank it with two classes. */
  it("outranks the frame's button reset on every button part", () => {
    const specificity = (sel: string) => {
      const s = sel.replace(/:where\([^)]*\)/g, "").replace(/::[\w-]+/g, "");
      const b = (s.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g) ?? []).length;
      const c = (s.replace(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g, " ").match(/(^|[\s>+~])[a-z]+/g) ?? []).length;
      return b * 100 + c;
    };
    const reset = specificity(".fg button");
    let checked = 0;
    for (const [sel] of rules) {
      for (const part of sel.split(",").map((p) => p.trim())) {
        if (!/\.pt-(vtab|stab|tray-opt|toast-undo)\b(?![\w-])/.test(part)) continue;
        checked++;
        expect([part, specificity(part) > reset]).toEqual([part, true]);
      }
    }
    expect(checked).toBeGreaterThan(8);
  });

  it("stops every motion under reduced motion", () => {
    const at = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(at).toBeGreaterThan(-1);
    const still = css.slice(at);
    for (const cls of [".pt-scrim", ".pt-dialog", ".pt-toast"]) expect(still).toContain(cls);
    expect(still).toMatch(/animation:\s*none/);
    for (const cls of [".pt-vtab", ".pt-stab", ".pt-tray-opt"]) expect(still).toContain(cls);
    expect(still).toMatch(/transition:\s*none/);
  });

  it("draws the tray as an edge and never a fill as well, 32 tall", () => {
    const tray = rules.find(([s]) => s === ".pt-tray")![1];
    expect(tray).toMatch(/border:\s*1px solid var\(--edge\)/);
    expect(tray).not.toMatch(/background/);
    expect(tray).toMatch(/height:\s*32px/);
    expect(rules.find(([s]) => s === '.pt-tray .pt-tray-opt[aria-checked="true"]')![1]).toMatch(/background:\s*var\(--sel\)/);
  });

  it("puts the toast on the ink, bottom left, over everything", () => {
    const stack = rules.find(([s]) => s === ".pt-toasts")![1];
    expect(stack).toMatch(/left:\s*24px/);
    expect(stack).toMatch(/bottom:\s*24px/);
    expect(stack).toMatch(/z-index:\s*var\(--z-toast\)/);
    const toast = rules.find(([s]) => s === ".pt-toasts .pt-toast")![1];
    expect(toast).toMatch(/background:\s*var\(--ink\)/);
    expect(toast).toMatch(/color:\s*var\(--white\)/);
    expect(toast).toMatch(/border-radius:\s*var\(--r-button\)/);
  });
});

describe("Tooltip", () => {
  // imported here so the rest of the suite stays as it was written
  const { Tooltip } = jest.requireActual("../tooltip") as typeof import("../tooltip");

  it("describes the control it names, and never labels it", () => {
    render(
      <Tooltip label="Close the card">
        <button type="button" aria-label="Close" />
      </Tooltip>,
    );
    const btn = screen.getByRole("button", { name: "Close" });
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Close the card");
    expect(btn).toHaveAttribute("aria-describedby", tip.id);
    expect(btn).toHaveAccessibleDescription("Close the card");
    expect(btn).not.toHaveAttribute("title");
  });

  it("keeps a description the control already had", () => {
    render(
      <>
        <p id="own">Saved a minute ago</p>
        <Tooltip label="Save the visit">
          <button type="button" aria-describedby="own">
            Save
          </button>
        </Tooltip>
      </>,
    );
    expect(screen.getByRole("button", { name: "Save" }).getAttribute("aria-describedby")).toMatch(/^own \S+$/);
  });
});
