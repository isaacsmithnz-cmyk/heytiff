import fs from "node:fs";
import path from "node:path";
import { useRef, useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { overlayOpen } from "@/components/overlay/use-overlay";
import { Chooser, ChooserMany, type ChooserOption } from "../chooser";
import { Field, TextArea, TextInput } from "../field";
import { Menu, type MenuItem } from "../menu";
import { TimeField } from "../time-field";

/* THE FIELDS GROUP: what rules 28, 33, 34, 36 and 53 promise, held here.

   A field is tied to its label and says why it is wrong; a menu floats on
   <body>, moves by the keys and gives focus back; a chooser is a listbox
   that still posts with a plain form; a time opens the timesheet's wheel.
   The sheet is read the way design-ratchets reads the sheets: tokens only,
   on the scales, every class a part's. */

const focused = () => document.activeElement as HTMLElement;
const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(focused(), { key: k, ...init });

describe("Field, TextInput and TextArea", () => {
  it("ties the label to the control", () => {
    render(
      <Field label="Customer name">
        <TextInput />
      </Field>,
    );
    const input = screen.getByLabelText("Customer name");
    expect(input.tagName).toBe("INPUT");
    expect(input).toHaveClass("pt-input");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(document.querySelector(".pt-field-error")).toBeNull();
    expect(document.querySelector(".pt-field-label")).toHaveTextContent("Customer name");
  });

  it("says why a wrong field is wrong, and points at it", () => {
    render(
      <Field label="Email" error="An email needs an @">
        <TextInput defaultValue="isaac" />
      </Field>,
    );
    const input = screen.getByLabelText("Email");
    const error = screen.getByText("An email needs an @");
    expect(error).toHaveClass("pt-field-error");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveClass("pt-input--invalid");
    expect(input.getAttribute("aria-describedby")).toBe(error.id);
    expect(input).toHaveAccessibleDescription("An email needs an @");
  });

  it("keeps an own aria-describedby beside the error's", () => {
    render(
      <>
        <p id="extra">Extra</p>
        <Field label="Code" error="Too short">
          <TextInput aria-describedby="extra" />
        </Field>
      </>,
    );
    expect(screen.getByLabelText("Code").getAttribute("aria-describedby")).toMatch(/^extra \S+$/);
  });

  it("takes the three heights, 36 by default", () => {
    render(
      <>
        <TextInput aria-label="Small" size={32} />
        <TextInput aria-label="Default" />
        <TextInput aria-label="Phone" size={44} />
      </>,
    );
    expect(screen.getByLabelText("Small")).toHaveClass("pt-input pt-input--32");
    expect(screen.getByLabelText("Default").className).toBe("pt-input");
    expect(screen.getByLabelText("Phone")).toHaveClass("pt-input pt-input--44");
  });

  it("wires a text area the same way", () => {
    render(
      <Field label="Notes" error="Say what was done">
        <TextArea />
      </Field>,
    );
    const area = screen.getByLabelText("Notes");
    expect(area.tagName).toBe("TEXTAREA");
    expect(area).toHaveClass("pt-textarea pt-textarea--invalid");
    expect(area).toHaveAccessibleDescription("Say what was done");
  });
});

const ITEMS: MenuItem[] = [
  { key: "delete", label: "Delete job", danger: true },
  { key: "pin", label: "Pin", lead: <span data-testid="dot" />, count: 3 },
  { key: "copy", label: "Copy the link" },
  { key: "print", label: "Print", disabled: true },
  { key: "stage", label: "Stage" },
];

function MenuHarness({ onSelect = () => {}, chosen, inDialog }: { onSelect?: (k: string) => void; chosen?: string; inDialog?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const body = (
    <>
      <button ref={ref} type="button" onClick={() => setOpen((o) => !o)}>
        Open actions
      </button>
      <Menu open={open} anchor={ref} label="Actions" items={ITEMS} chosen={chosen} onSelect={onSelect} onClose={() => setOpen(false)} />
    </>
  );
  return inDialog ? <div role="dialog" aria-modal="true" aria-label="Job">{body}</div> : body;
}

const openMenu = () => {
  const trigger = screen.getByRole("button", { name: "Open actions" });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
};

describe("Menu", () => {
  it("floats on <body>, white list of 32-tall menu items, the danger item last under a line", () => {
    const { container } = render(<MenuHarness />);
    openMenu();
    const menu = screen.getByRole("menu", { name: "Actions" });
    expect(container.contains(menu)).toBe(false);
    expect(menu.closest(".pt-menu")?.parentElement).toBe(document.body);
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Pin3", "Copy the link", "Print", "Stage", "Delete job"]);
    expect(items[4]).toHaveClass("pt-menu-item--danger", "pt-menu-item--ruled");
    expect(items[1]).not.toHaveClass("pt-menu-item--ruled");
    expect(within(items[0]!).getByTestId("dot").parentElement).toHaveClass("pt-menu-lead");
    expect(within(items[0]!).getByText("3")).toHaveClass("pt-menu-count");
    expect(items[2]).toHaveAttribute("aria-disabled", "true");
    expect(focused()).toBe(menu);
  });

  it("marks the chosen item and starts on it", () => {
    render(<MenuHarness chosen="copy" />);
    openMenu();
    const copy = screen.getByRole("menuitem", { name: "Copy the link" });
    expect(copy).toHaveClass("pt-menu-item--chosen");
    expect(copy).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("menu").getAttribute("aria-activedescendant")).toBe(copy.id);
  });

  it("moves by the arrows, Home and End, past a disabled item, and wraps", () => {
    render(<MenuHarness />);
    openMenu();
    const menu = screen.getByRole("menu");
    const on = () => document.getElementById(menu.getAttribute("aria-activedescendant") ?? "")?.textContent;
    expect(on()).toBe("Pin3");
    key("ArrowDown");
    expect(on()).toBe("Copy the link");
    key("ArrowDown");
    expect(on()).toBe("Stage");
    key("End");
    expect(on()).toBe("Delete job");
    key("ArrowDown");
    expect(on()).toBe("Pin3");
    key("ArrowUp");
    expect(on()).toBe("Delete job");
    key("Home");
    expect(on()).toBe("Pin3");
    expect(document.querySelector(".pt-menu")).toHaveClass("pt-menu--keys");
    expect(document.querySelector(".pt-menu-item--active")).toHaveTextContent("Pin");
  });

  it("jumps by a first letter, to the next item that starts with it", () => {
    render(<MenuHarness />);
    openMenu();
    const menu = screen.getByRole("menu");
    const on = () => document.getElementById(menu.getAttribute("aria-activedescendant") ?? "")?.textContent;
    key("s");
    expect(on()).toBe("Stage");
    key("d");
    expect(on()).toBe("Delete job");
    key("P");
    expect(on()).toBe("Pin3");
  });

  it("picks with Enter, closes, and gives focus back to the trigger", () => {
    const onSelect = jest.fn();
    render(<MenuHarness onSelect={onSelect} />);
    const trigger = openMenu();
    key("ArrowDown");
    key("Enter");
    expect(onSelect).toHaveBeenCalledWith("copy");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(focused()).toBe(trigger);
  });

  it("picks with a click, and a disabled item does nothing", () => {
    const onSelect = jest.fn();
    render(<MenuHarness onSelect={onSelect} />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Print" }));
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete job" }));
    expect(onSelect).toHaveBeenCalledWith("delete");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape with focus back, and the Escape goes no further", () => {
    const outer = jest.fn();
    document.addEventListener("keydown", outer);
    render(<MenuHarness />);
    const trigger = openMenu();
    key("Escape");
    document.removeEventListener("keydown", outer);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(focused()).toBe(trigger);
    expect(outer).not.toHaveBeenCalled();
  });

  it("closes on Tab with focus back on the trigger", () => {
    render(<MenuHarness />);
    const trigger = openMenu();
    key("Tab");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(focused()).toBe(trigger);
  });

  it("closes on a press outside, and the trigger closes it once", () => {
    render(
      <>
        <MenuHarness />
        <p>Elsewhere</p>
      </>,
    );
    const trigger = openMenu();
    fireEvent.pointerDown(screen.getByText("Elsewhere"));
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("joins the overlay stack while it is open", () => {
    render(<MenuHarness />);
    expect(overlayOpen()).toBe(false);
    openMenu();
    expect(overlayOpen()).toBe(true);
    key("Escape");
    expect(overlayOpen()).toBe(false);
  });

  it("stands on the dialog's layer when opened from a dialog", () => {
    render(<MenuHarness inDialog />);
    openMenu();
    expect(document.querySelector(".pt-menu")).toHaveClass("pt-menu--over-modal");
  });

  it("stands on the overlay layer anywhere else", () => {
    render(<MenuHarness />);
    openMenu();
    expect(document.querySelector(".pt-menu")).not.toHaveClass("pt-menu--over-modal");
  });
});

const FEW: ChooserOption[] = [
  { value: "split", label: "Split system" },
  { value: "ducted", label: "Ducted", hint: "Return air in the ceiling" },
  { value: "multi", label: "Multi-head" },
];
const MANY: ChooserOption[] = ["Adelaide", "Brisbane", "Canberra", "Darwin", "Hobart", "Melbourne", "Perth", "Sydney", "Townsville", "Wollongong"].map((c) => ({
  value: c.toLowerCase(),
  label: c,
}));

describe("Menu, reaching out of the sidebar", () => {
  it("stands beside the sidebar, level with its trigger, not over the rows below it", () => {
    function Beside() {
      const ref = useRef<HTMLButtonElement>(null);
      return (
        <aside>
          <button ref={ref} type="button">
            New
          </button>
          <Menu open anchor={ref} label="New" items={ITEMS.slice(1, 3)} align="out" tone="ink" onSelect={() => {}} onClose={() => {}} />
        </aside>
      );
    }
    const box = (x: number, y: number, w: number, h: number) => ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}) }) as DOMRect;
    const rect = jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.tagName === "ASIDE" ? box(0, 0, 256, 800) : box(16, 76, 224, 32);
    });
    try {
      render(<Beside />);
      const panel = screen.getByRole("menu", { name: "New" }).closest(".pt-menu") as HTMLElement;
      expect(panel.style.left).toBe("256px");
      expect(panel.style.top).toBe("76px");
    } finally {
      rect.mockRestore();
    }
  });
});

function ChooserHarness({ options = FEW, start = null, name, error }: { options?: ChooserOption[]; start?: string | null; name?: string; error?: string }) {
  const [value, setValue] = useState<string | null>(start);
  return (
    <form data-testid="form">
      <Field label="System" error={error}>
        <Chooser options={options} value={value} onChange={setValue} placeholder="Choose a system" name={name} />
      </Field>
    </form>
  );
}

describe("ChooserMany (Book a visit's Who, 25 October 2026)", () => {
  function Many() {
    const [v, setV] = useState<string[]>([]);
    return (
      <Field label="Who">
        <ChooserMany options={[{ value: "lj", label: "Louis Jones" }, { value: "lm", label: "Leonardo Martins" }, { value: "dh", label: "David Hann" }]} value={v} placeholder="Pick who" onChange={setV} />
      </Field>
    );
  }
  it("takes several, says them as a sentence in the list's order, and stays open while you pick", () => {
    render(<Many />);
    const box = screen.getByRole("combobox", { name: "Who" });
    expect(box).toHaveTextContent("Pick who");
    fireEvent.click(box);
    const list = screen.getByRole("listbox");
    expect(list).toHaveAttribute("aria-multiselectable", "true");
    fireEvent.click(within(list).getByRole("option", { name: "Leonardo Martins" }));
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Louis Jones" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.getAttribute("aria-selected"))).toEqual(["true", "true", "false"]);
    expect(box).toHaveTextContent("Louis Jones and Leonardo Martins");
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "David Hann" }));
    expect(box).toHaveTextContent("Louis Jones, Leonardo Martins and David Hann");
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Louis Jones" }));
    expect(box).toHaveTextContent("Leonardo Martins and David Hann");
  });
});

describe("Menu, a line before an item", () => {
  it("rules a line above an item that asks for one, without making it red", () => {
    const anchor = { current: document.body };
    render(<Menu open anchor={anchor} onClose={() => {}} onSelect={() => {}} label="How far" items={[{ key: "25", label: "Started, 25%" }, { key: "issue", label: "Issue", rule: true }]} />);
    const issue = screen.getByRole("menuitem", { name: "Issue" });
    expect(issue).toHaveClass("pt-menu-item--ruled");
    expect(issue).not.toHaveClass("pt-menu-item--danger");
    expect(screen.getByRole("menuitem", { name: "Started, 25%" })).not.toHaveClass("pt-menu-item--ruled");
  });
});

describe("Menu, grouped, with items made from the filter (a document's tags, 27 October 2026)", () => {
  const TAGS = [
    { key: "d", label: "Daikin", group: "Manufacturers" },
    { key: "m", label: "Mitsubishi Electric", group: "Manufacturers" },
    { key: "s", label: "Multi-split", group: "System types" },
  ];
  const make = (q: string) => (q ? [{ key: `new:${q}`, label: `Create “${q}”`, rule: true }] : []);

  it("labels each group once, above its first item, and the label is not an option", () => {
    const anchor = { current: document.body };
    render(<Menu open anchor={anchor} kind="listbox" filter extra={make} onClose={() => {}} onSelect={() => {}} label="Tags" items={TAGS} />);
    expect(screen.getAllByText("Manufacturers")).toHaveLength(1);
    expect(screen.getByText("System types")).toHaveClass("pt-menu-group");
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("adds what the filter makes after what it narrowed, and names its box", () => {
    const anchor = { current: document.body };
    const onSelect = jest.fn();
    render(<Menu open anchor={anchor} kind="listbox" filter filterLabel="Find or create a tag" extra={make} onClose={() => {}} onSelect={onSelect} label="Tags" items={TAGS} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Find or create a tag" }), { target: { value: "mul" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Multi-split", "Create “mul”"]);
    expect(screen.queryByText("Manufacturers")).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: "Create “mul”" }));
    expect(onSelect).toHaveBeenCalledWith("new:mul");
  });
});

describe("Chooser", () => {
  it("looks like a field: the chosen word or the placeholder, and the chevron", () => {
    render(<ChooserHarness />);
    const box = screen.getByRole("combobox", { name: "System" });
    expect(box.tagName).toBe("BUTTON");
    expect(box).toHaveClass("pt-chooser");
    expect(box).toHaveAttribute("aria-haspopup", "listbox");
    expect(box).toHaveAttribute("aria-expanded", "false");
    expect(within(box).getByText("Choose a system")).toHaveClass("pt-chooser-value--empty");
    expect(box.querySelector("svg.pt-chooser-chev")).not.toBeNull();
  });

  it("opens a listbox of options, the chosen one selected", () => {
    render(<ChooserHarness start="ducted" />);
    const box = screen.getByRole("combobox");
    expect(box).toHaveTextContent("Ducted");
    fireEvent.click(box);
    const list = screen.getByRole("listbox");
    expect(box).toHaveAttribute("aria-expanded", "true");
    expect(box.getAttribute("aria-controls")).toBe(list.id);
    const options = within(list).getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options.map((o) => o.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(within(options[1]!).getByText("Return air in the ceiling")).toHaveClass("pt-menu-hint");
    expect(screen.queryByRole("combobox", { name: /filter/i })).toBeNull();
  });

  it("picks an option, closes, and gives focus back", () => {
    render(<ChooserHarness />);
    const box = screen.getByRole("combobox");
    box.focus();
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    key("ArrowDown");
    key("ArrowDown");
    key("Enter");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(box).toHaveTextContent("Multi-head");
    expect(focused()).toBe(box);
  });

  it("posts its value with a plain form, as a select does", () => {
    render(<ChooserHarness name="system" start="split" />);
    const form = screen.getByTestId("form") as HTMLFormElement;
    expect(new FormData(form).get("system")).toBe("split");
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: /^Ducted/ }));
    expect(new FormData(form).get("system")).toBe("ducted");
  });

  it("posts an empty value before anything is chosen, and nothing without a name", () => {
    const { unmount } = render(<ChooserHarness name="system" />);
    expect(new FormData(screen.getByTestId("form") as HTMLFormElement).get("system")).toBe("");
    unmount();
    render(<ChooserHarness />);
    expect(screen.getByTestId("form").querySelector("input[type='hidden']")).toBeNull();
  });

  it("gets a filter box past eight options", () => {
    render(<ChooserHarness options={MANY} />);
    fireEvent.click(screen.getByRole("combobox", { name: "System" }));
    const filter = screen.getByRole("combobox", { name: "Filter system" });
    expect(focused()).toBe(filter);
    fireEvent.change(filter, { target: { value: "bri" } });
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Brisbane"]);
    expect(filter.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "Brisbane" }).id);
    key("Enter");
    expect(screen.getByRole("combobox", { name: "System" })).toHaveTextContent("Brisbane");
  });

  it("says when nothing matches the filter", () => {
    render(<ChooserHarness options={MANY} />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.change(screen.getByRole("combobox", { name: "Filter system" }), { target: { value: "zz" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(document.querySelector(".pt-menu-empty")).toHaveTextContent("Nothing matches “zz”");
  });

  it("is wrong with a red edge and the error, and takes the sizes", () => {
    render(
      <>
        <ChooserHarness error="Choose the system to quote" />
        <Chooser aria-label="Row" options={FEW} value={null} onChange={() => {}} size={32} />
      </>,
    );
    const box = screen.getByRole("combobox", { name: "System" });
    expect(box).toHaveClass("pt-chooser--invalid");
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveAccessibleDescription("Choose the system to quote");
    expect(screen.getByRole("combobox", { name: "Row" })).toHaveClass("pt-chooser pt-chooser--32");
  });

  it("does not open when disabled", () => {
    render(<Chooser aria-label="Off" options={FEW} value={null} onChange={() => {}} disabled />);
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

function TimeHarness({ start = null, name }: { start?: string | null; name?: string }) {
  const [value, setValue] = useState<string | null>(start);
  return (
    <form data-testid="form">
      <Field label="Start">
        <TimeField value={value} onChange={setValue} name={name} />
      </Field>
    </form>
  );
}

describe("TimeField", () => {
  it("looks like a field with the time or a placeholder, and a chevron", () => {
    render(<TimeHarness />);
    const box = screen.getByRole("combobox", { name: "Start" });
    expect(box).toHaveClass("pt-timefield");
    expect(box).toHaveAttribute("aria-haspopup", "dialog");
    expect(within(box).getByText("Choose a time")).toHaveClass("pt-timefield-value--empty");
    expect(box.querySelector("svg.pt-timefield-chev")).not.toBeNull();
  });

  it("opens the timesheet's wheel in a floating panel and keeps its format", () => {
    render(<TimeHarness start="7:05 AM" name="start" />);
    const box = screen.getByRole("combobox", { name: "Start" });
    expect(box).toHaveTextContent("7:05 AM");
    fireEvent.click(box);
    const panel = screen.getByRole("dialog", { name: "Start" });
    expect(panel).toHaveClass("pt-timefield-panel");
    expect(panel.parentElement).toBe(document.body);
    expect(box.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.querySelector(".tw")).not.toBeNull();
    expect(focused()).toHaveTextContent("7");
    fireEvent.click(within(within(panel).getByRole("listbox", { name: "Hour" })).getByRole("option", { name: "9" }));
    fireEvent.click(within(within(panel).getByRole("listbox", { name: "AM/PM" })).getByRole("option", { name: "PM" }));
    expect(box).toHaveTextContent("9:05 PM");
    expect(new FormData(screen.getByTestId("form") as HTMLFormElement).get("start")).toBe("9:05 PM");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes on Escape with focus back, and on a press outside", () => {
    render(
      <>
        <TimeHarness />
        <p>Elsewhere</p>
      </>,
    );
    const box = screen.getByRole("combobox", { name: "Start" });
    box.focus();
    fireEvent.click(box);
    expect(overlayOpen()).toBe(true);
    key("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(focused()).toBe(box);
    fireEvent.click(box);
    act(() => {
      fireEvent.pointerDown(screen.getByText("Elsewhere"));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(overlayOpen()).toBe(false);
  });
});

/* ---- the sheet ---- */

const SHEET = fs.readFileSync(path.join(process.cwd(), "src/components/parts/fields.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const BLOCKS = [...SHEET.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1]!.trim(), m[2]!] as const);
const decls = (prop: RegExp) => BLOCKS.flatMap(([, body]) => [...body.matchAll(new RegExp(`(?:^|[;\\s])${prop.source}\\s*:\\s*([^;]+)`, "g"))].map((m) => m[1]!.trim()));

const TOKENS = new Set([
  "ink", "white", "q", "blue", "red", "red-w", "orange", "orange-w", "green", "green-w", "yellow", "yellow-w", "purple", "purple-w",
  "pink", "pink-w", "grey", "line", "edge", "sel", "hov", "soft", "scrim", "shadow-overlay", "ring",
  "r-control", "r-button", "r-card", "t-fast", "t-move", "t-slide", "ease", "z-overlay", "z-modal", "z-toast", "font",
  // New's dark panel (rule 44) takes the ink sidebar's own white tints
  "on-ink-tint-2", "on-ink-q",
]);

describe("fields.css", () => {
  it("is read at all", () => {
    expect(BLOCKS.length).toBeGreaterThan(30);
  });

  it("names only parts' classes, and the wheel's only under the time panel", () => {
    for (const [sel] of BLOCKS) {
      for (const part of sel.split(",")) {
        const classes = [...part.matchAll(/\.([\w-]+)/g)].map((m) => m[1]!);
        expect(classes.length).toBeGreaterThan(0);
        expect(classes[0]).toMatch(/^pt-/);
        for (const c of classes.slice(1)) if (!c.startsWith("pt-")) expect(part).toMatch(/^\s*\.pt-timefield-panel \.tw/);
      }
    }
  });

  it("takes colour only from the tokens", () => {
    expect(SHEET).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(SHEET).not.toMatch(/\b(?:rgba?|hsla?)\(/);
    for (const m of SHEET.matchAll(/var\(--([\w-]+)\)/g)) expect(TOKENS).toContain(m[1]);
  });

  it("stays on the scales: type, weight, corner, spacing, layers", () => {
    for (const v of decls(/font-size/)) expect(["12px", "13px", "14px", "16px"]).toContain(v);
    for (const v of decls(/font-weight/)) expect(["400", "500", "600"]).toContain(v);
    for (const v of decls(/border-radius/)) expect(v).toMatch(/^var\(--r-(control|button|card)\)$/);
    for (const v of decls(/z-index/)) expect(v).toMatch(/^var\(--z-(overlay|modal)\)$/);
    for (const v of decls(/(?:padding|margin|gap)(?:-[a-z]+)?/)) {
      for (const t of v.split(/\s+/)) {
        const n = /^(\d+)px$/.exec(t)?.[1];
        // 49 is the wheel's own geometry: the band on the centre row
        if (n) expect([0, 2, 4, 8, 12, 16, 24, 32, 48, 49]).toContain(Number(n));
      }
    }
  });

  it("is flat: no gradient, no ellipsis, no transition on all, and the one shadow only where it floats", () => {
    expect(SHEET).not.toMatch(/gradient\(/);
    expect(SHEET).not.toMatch(/text-overflow/);
    expect(SHEET).not.toMatch(/transition\s*:\s*all/);
    for (const [sel, body] of BLOCKS) {
      const shadow = /box-shadow\s*:\s*([^;]+)/.exec(body)?.[1]?.trim();
      if (!shadow) continue;
      if (shadow === "var(--shadow-overlay)") expect(sel.split(",").map((s) => s.trim())).toEqual([".pt-menu", ".pt-timefield-panel"]);
      // the keys' ring, drawn inward: ink then white, or white then ink on New's dark panel
      else expect(["var(--ring)", "inset 0 0 0 2px var(--ink), inset 0 0 0 4px var(--white)", "inset 0 0 0 2px var(--white), inset 0 0 0 4px var(--ink)"]).toContain(shadow);
    }
  });

  it("focuses with the ink ring, never an alpha tint", () => {
    const focus = BLOCKS.filter(([sel]) => sel.includes(":focus-visible"));
    expect(focus.length).toBeGreaterThan(0);
    for (const [, body] of focus) expect(body).toMatch(/box-shadow\s*:\s*(var\(--ring\)|inset 0 0 0 2px var\(--ink\))/);
  });

  /* `.fg button` and `.fg input` are (0,1,1): a control's own rule needs two
     classes to beat them inside the dashboard. */
  it("beats the dashboard's button and input reset on every control", () => {
    const specificity = (s: string) => (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
    const CONTROLS = /^\.(pt-input|pt-textarea|pt-chooser|pt-timefield|pt-menu-filter-input)(?![\w-])/;
    let seen = 0;
    for (const [sel, body] of BLOCKS) {
      if (!/(?:^|[;\s])(?:font|color|background|border)[\w-]*\s*:/.test(body)) continue;
      for (const part of sel.split(",").map((s) => s.trim())) {
        if (!CONTROLS.test(part) || part.includes("::placeholder")) continue;
        seen++;
        expect([part, specificity(part) >= 2]).toEqual([part, true]);
      }
    }
    expect(seen).toBeGreaterThan(8);
  });
});
