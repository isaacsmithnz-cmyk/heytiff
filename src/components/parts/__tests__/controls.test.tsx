/* The controls parts: the buttons and links (rules 22 to 28), ticks and
   switches (32), the state dot and word (16 to 18) and initials (38). What
   the rules promise is tested here, and the sheet is read the way
   design-ratchets.test.ts reads every sheet. */
import fs from "node:fs";
import path from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type FormEvent } from "react";
import { Button, IconButton, LinkButton } from "../button";
import { Initials } from "../initials";
import { Dot, StateWord, stateTone } from "../state";
import { Switch, Tick } from "../tick";

const SHEET = fs.readFileSync(path.join(process.cwd(), "src/components/parts/controls.css"), "utf8");
const CSS = SHEET.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every rule as [selector, body], with any @media wrapper opened up. */
function rules(css = CSS): Array<[string, string]> {
  const flat = css.replace(/@media[^{]*\{([\s\S]*?\})\s*\}/g, "$1");
  return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
}

describe("Button", () => {
  it("is a real button that never submits by accident, second at 36 by default", () => {
    render(<Button>Save note</Button>);
    const b = screen.getByRole("button", { name: "Save note" });
    expect(b).toHaveAttribute("type", "button");
    expect(b).toHaveClass("pt-btn", "pt-btn--36", "pt-btn--second");
  });

  it.each(["main", "second", "quiet", "delete", "danger", "xero"] as const)("wears the %s kind", (kind) => {
    render(<Button kind={kind}>Add visit</Button>);
    expect(screen.getByRole("button")).toHaveClass(`pt-btn--${kind}`);
  });

  it.each([32, 36, 44] as const)("comes at %s", (size) => {
    render(<Button size={size}>Add visit</Button>);
    expect(screen.getByRole("button")).toHaveClass(`pt-btn--${size}`);
  });

  it("presses, and a disabled one does not", () => {
    const onClick = jest.fn();
    const { rerender } = render(<Button onClick={onClick}>Send quote</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<Button onClick={onClick} disabled>Send quote</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("keeps submit when a form asks for it", () => {
    render(<Button type="submit" kind="main">Save job</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });

  it("puts a leading glyph before its word, hidden from a screen reader", () => {
    render(<Button icon="plus">Add task</Button>);
    const b = screen.getByRole("button", { name: "Add task" });
    const glyph = b.querySelector(".pt-btn__icon");
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    expect(glyph?.querySelector("svg")).not.toBeNull();
    expect(b.firstElementChild).toBe(glyph);
  });

  it("is a link when it goes somewhere, inside the app or out of it", () => {
    render(
      <>
        <Button href="/dashboard/jobs" kind="main">Open jobs</Button>
        <Button href="https://example.com/manual.pdf">Open manual</Button>
      </>,
    );
    expect(screen.getByRole("link", { name: "Open jobs" })).toHaveAttribute("href", "/dashboard/jobs");
    expect(screen.getByRole("link", { name: "Open jobs" })).toHaveClass("pt-btn", "pt-btn--main");
    expect(screen.getByRole("link", { name: "Open manual" })).toHaveAttribute("href", "https://example.com/manual.pdf");
  });

  it("a disabled link has no href to follow", () => {
    render(<Button href="/dashboard/jobs" disabled>Open jobs</Button>);
    const a = screen.getByText("Open jobs").closest("a")!;
    expect(a).not.toHaveAttribute("href");
    expect(a).toHaveAttribute("aria-disabled", "true");
  });
});

describe("LinkButton", () => {
  it("is ink and underlined, an anchor that goes somewhere", () => {
    render(<LinkButton href="/dashboard/team">See the team</LinkButton>);
    const a = screen.getByRole("link", { name: "See the team" });
    expect(a).toHaveClass("pt-link");
    expect(a).toHaveAttribute("href", "/dashboard/team");
    const body = rules().find(([sel]) => sel === ".pt-link")![1];
    expect(body).toMatch(/color:\s*var\(--ink\)/);
    expect(body).toMatch(/text-decoration:\s*underline/);
  });
});

describe("IconButton", () => {
  it.each([
    ["close", "Close the panel"],
    ["clear", "Clear the search"],
    ["mic", "Start dictating"],
    ["earlier", "Earlier week"],
    ["later", "Later week"],
  ] as const)("draws %s, named by its label, square and quiet", (glyph, label) => {
    render(<IconButton glyph={glyph} label={label} />);
    const b = screen.getByRole("button", { name: label });
    expect(b).toHaveClass("pt-btn", "pt-btn--quiet", "pt-btn--icon", "pt-btn--36");
    expect(b.textContent).toBe("");
    expect(b.querySelector("svg")).not.toBeNull();
    expect(b).not.toHaveAttribute("title");
  });

  it("is square at each size", () => {
    for (const size of [32, 36, 44]) {
      expect(CSS).toMatch(new RegExp(`\\.pt-btn\\.pt-btn--icon\\.pt-btn--${size}\\s*\\{\\s*width:\\s*${size}px`));
      expect(CSS).toMatch(new RegExp(`\\.pt-btn\\.pt-btn--${size}\\s*\\{\\s*height:\\s*${size}px`));
    }
  });
});

describe("Tick", () => {
  it("is a checkbox named by the word beside it, ticked by the word or by Space", async () => {
    const user = userEvent.setup();
    const seen: boolean[] = [];
    function Host() {
      const [on, setOn] = useState(false);
      return <Tick label="Email the customer" checked={on} onChange={(v) => { seen.push(v); setOn(v); }} />;
    }
    render(<Host />);
    const box = screen.getByRole("checkbox", { name: "Email the customer" });
    expect(box).not.toBeChecked();
    await user.click(screen.getByText("Email the customer"));
    expect(box).toBeChecked();
    box.focus();
    await user.keyboard(" ");
    expect(box).not.toBeChecked();
    expect(seen).toEqual([true, false]);
  });

  it("can't be ticked when disabled", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<Tick label="Email the customer" disabled onChange={onChange} />);
    await user.click(screen.getByRole("checkbox"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("is a 16 box at the fields' 6 corner, blue when on", () => {
    const input = rules().find(([sel]) => sel === ".pt-tick__input")![1];
    expect(input).toMatch(/width:\s*16px/);
    expect(input).toMatch(/height:\s*16px/);
    expect(input).toMatch(/border-radius:\s*var\(--r-control\)/);
    expect(rules().find(([sel]) => sel === ".pt-tick__input:checked")![1]).toMatch(/background:\s*var\(--press\)/);
  });
});

describe("Switch", () => {
  it("says it is a switch, and saves itself by click, Space or Enter without submitting a form", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn((e: FormEvent) => e.preventDefault());
    const seen: boolean[] = [];
    function Host() {
      const [on, setOn] = useState(false);
      return (
        <form onSubmit={onSubmit}>
          <Switch label="Remind me" checked={on} onChange={(v) => { seen.push(v); setOn(v); }} />
        </form>
      );
    }
    render(<Host />);
    const sw = screen.getByRole("switch", { name: "Remind me" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    await user.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "true");
    await user.keyboard(" ");
    expect(sw).toHaveAttribute("aria-checked", "false");
    await user.keyboard("{Enter}");
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(seen).toEqual([true, false, true]);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(sw).toHaveAttribute("type", "button");
  });

  it("does nothing when disabled", () => {
    const onChange = jest.fn();
    render(<Switch label="Remind me" checked={false} onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("is a 32 by 20 track with a round knob, blue when on", () => {
    const track = rules().find(([sel]) => sel === ".pt-switch__track")![1];
    expect(track).toMatch(/width:\s*32px/);
    expect(track).toMatch(/height:\s*20px/);
    expect(rules().find(([sel]) => sel === ".pt-switch__knob")![1]).toMatch(/border-radius:\s*var\(--r-pill\)/);
    expect(rules().find(([sel]) => sel === '.pt-switch[role="switch"][aria-checked="true"] .pt-switch__track')![1]).toMatch(/background:\s*var\(--press\)/);
  });
});

describe("state", () => {
  it("maps each tone to its hue, and none to blue", () => {
    expect(stateTone("wrong")).toBe("red");
    expect(stateTone("look")).toBe("orange");
    expect(stateTone("good")).toBe("green");
    expect(stateTone("info")).toBe("grey");
  });

  it("draws a dot in any of the eight, hidden because a word beside it says what it means", () => {
    const { container } = render(<Dot hue="purple" />);
    const dot = container.firstElementChild!;
    expect(dot).toHaveClass("pt-dot", "pt-dot--purple");
    expect(dot).toHaveAttribute("aria-hidden", "true");
    for (const hue of ["red", "orange", "yellow", "green", "blue", "purple", "pink", "grey"]) {
      expect(CSS).toMatch(new RegExp(`\\.pt-dot\\.pt-dot--${hue}\\s*\\{`));
    }
  });

  it.each([
    ["wrong", "Overdue", "red", "--red-w"],
    ["look", "Check the date", "orange", "--orange-w"],
    ["good", "Paid", "green", "--green-w"],
    ["info", "Draft", "grey", "--q"],
  ] as const)("writes %s as a dot and a word in its word value", (tone, word, hue, ink) => {
    render(<StateWord tone={tone}>{word}</StateWord>);
    const el = screen.getByText(word).parentElement!;
    expect(el).toHaveClass("pt-state", `pt-state--${tone}`);
    expect(el.querySelector(`.pt-dot--${hue}`)).not.toBeNull();
    expect(rules().find(([sel]) => sel === `.pt-state.pt-state--${tone}`)![1]).toMatch(new RegExp(`color:\\s*var\\(${ink}\\)`));
  });

  it("is never a pill: no box, fill or corner on the word (rule 47)", () => {
    for (const [sel, body] of rules()) {
      if (!/\.pt-state/.test(sel)) continue;
      expect(body).not.toMatch(/border|background|padding|radius/);
    }
    expect(rules().find(([sel]) => sel === ".pt-state")![1]).toMatch(/font-size:\s*13px[\s\S]*font-weight:\s*500/);
  });
});

describe("Initials", () => {
  it.each([
    ["Isaac Smith", "IS"],
    ["  isaac   smith  ", "IS"],
    ["Mary Jane Watson", "MJ"],
    ["Cher", "CH"],
    ["", "?"],
  ])("writes %j as %s", (name, letters) => {
    const { container } = render(<Initials name={name} beside />);
    expect(container.textContent).toBe(letters);
  });

  it("stands alone as an image named for the person, and hides beside their name", () => {
    render(
      <>
        <Initials name="Isaac Smith" size={40} />
        <Initials name="Alex Lee" size={24} beside />
      </>,
    );
    const img = screen.getByRole("img", { name: "Isaac Smith" });
    expect(img).toHaveClass("pt-initials", "pt-initials--40");
    expect(screen.getByText("AL")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("AL")).toHaveClass("pt-initials--24");
  });

  it("is ink at 600 on a light grey disc", () => {
    const body = rules().find(([sel]) => sel === ".pt-initials")![1];
    expect(body).toMatch(/background:\s*var\(--sel\)/);
    expect(body).toMatch(/color:\s*var\(--ink\)/);
    expect(body).toMatch(/font-weight:\s*600/);
    expect(body).toMatch(/border-radius:\s*var\(--r-pill\)/);
  });
});

/* THE SHEET, read as the ratchets read every sheet. */
describe("controls.css", () => {
  const TOKENS = new Set([
    "ink", "white", "q", "red", "red-w", "orange", "orange-w", "green", "green-w", "yellow", "purple", "pink", "grey",
    "edge", "sel", "hov", "soft", "ring", "press",
    "r-control", "r-button", "r-pill", "t-fast", "t-move", "ease", "font",
  ]);

  it("takes its colours, corners, motion and font only from the tokens", () => {
    const used = [...CSS.matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1]);
    expect(used.filter((t) => !TOKENS.has(t))).toEqual([]);
    // Xero's blue is the one hex, on its own button, named in docs/design.md
    const xero = /\.pt-btn\.pt-btn--xero\s*\{[^}]*\}/;
    expect(CSS).toMatch(xero);
    expect(CSS.replace(xero, "")).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(CSS).not.toMatch(/\b(?:rgba?|hsla?)\(/);
    // blue only means press, spelled as the press (rule 17)
    expect(CSS).not.toMatch(/var\(--blue\)/);
  });

  it("names a pt- class on every selector and no bare class", () => {
    for (const [sel] of rules()) {
      for (const m of sel.matchAll(/\.([\w-]+)/g)) expect(m[1]).toMatch(/^pt-/);
    }
  });

  it("keeps to the scales", () => {
    for (const m of CSS.matchAll(/font-size:\s*(\d+)px/g)) expect([12, 13, 14, 16, 20, 24, 32]).toContain(Number(m[1]));
    for (const m of CSS.matchAll(/font-weight:\s*(\d+)/g)) expect([400, 500, 600, 700]).toContain(Number(m[1]));
    for (const m of CSS.matchAll(/border-radius:\s*([^;}]+)/g)) expect(m[1].trim()).toMatch(/^var\(--r-(control|button|card|pill)\)$/);
    for (const m of CSS.matchAll(/(?:padding|margin|gap)(?:-[a-z]+)?:\s*([^;}]+)/g)) {
      for (const t of m[1].trim().split(/\s+/)) expect(["0", "2px", "4px", "8px", "12px", "16px", "24px", "32px", "48px"]).toContain(t);
    }
    for (const m of CSS.matchAll(/(?:^|[\s;{])height:\s*(\d+)px/g)) expect([8, 16, 20, 24, 32, 36, 40, 44]).toContain(Number(m[1]));
  });

  it("names what moves, at the three speeds, and moves 1px on a press", () => {
    for (const m of CSS.matchAll(/transition:\s*([^;}]+)/g)) {
      if (m[1].trim() === "none") continue;
      for (const part of m[1].split(",")) expect(part.trim()).toMatch(/^[a-z-]+ var\(--t-(fast|move|slide)\) var\(--ease\)$/);
      expect(m[1]).not.toMatch(/\ball\b/);
    }
    const press = rules().find(([sel]) => sel.startsWith(".pt-btn:active"))![1];
    expect(press.trim()).toBe("transform: translateY(1px);");
    // a hover is one change, a fill; the main and danger blocks keep their colour
    for (const [sel, body] of rules()) {
      if (!/:hover/.test(sel)) continue;
      expect(sel).not.toMatch(/--main|--danger/);
      expect(body.split(";").filter((d) => d.trim()).length).toBe(1);
      expect(body).not.toMatch(/transform|box-shadow|opacity/);
    }
  });

  it("is flat: the ring is the one shadow, and nothing glows, fades or is cut", () => {
    for (const m of CSS.matchAll(/box-shadow:\s*([^;}]+)/g)) expect(m[1].trim()).toBe("var(--ring)");
    expect(CSS).not.toMatch(/gradient\(|text-shadow|text-overflow|letter-spacing|text-transform|!important|z-index|backdrop-filter/);
  });

  it("focuses with the ink ring on :focus-visible, never an outline tint", () => {
    for (const sel of [".pt-btn:focus-visible", ".pt-tick__input:focus-visible", '.pt-switch[role="switch"]:focus-visible .pt-switch__track', ".pt-link:focus-visible"]) {
      expect(rules().find(([s]) => s === sel)?.[1]).toMatch(/box-shadow:\s*var\(--ring\)/);
    }
  });

  /* `.fg button` is (0,1,1) and clears font, colour, fill, border and the
     cursor. Each rule that sets one of those on a button part must outrank
     it, or the button renders bare inside the frame. */
  it("outranks the .fg button reset wherever it sets what the reset clears", () => {
    const specificity = (sel: string): [number, number, number] => {
      let s = sel.replace(/::[\w-]+/g, "").replace(/:where\([^)]*\)/g, "");
      s = s.replace(/:not\(([^)]*)\)/g, " $1 ");
      const ids = (s.match(/#[\w-]+/g) ?? []).length;
      const cls = (s.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) ?? []).length;
      const els = (s.replace(/\[[^\]]*\]/g, "").match(/(?:^|[\s>+~])[a-z]+/g) ?? []).length;
      return [ids, cls, els];
    };
    const beats = ([a, b, c]: number[], [x, y, z]: number[]) => a > x || (a === x && (b > y || (b === y && c > z)));
    const RESET = [0, 1, 1];
    const CLEARED = /(?:^|;)\s*(font(?:-[a-z]+)?|color|background(?:-[a-z]+)?|border(?!-radius)(?:-[a-z]+)?|cursor)\s*:/;
    let checked = 0;
    for (const [list, body] of rules()) {
      if (!CLEARED.test(body)) continue;
      for (const sel of list.split(",").map((x) => x.trim())) {
        const subject = sel.split(/[\s>+~]+/).pop()!;
        if (!/\.pt-(?:btn|switch)(?:--[a-z0-9-]+)?(?![\w-])/.test(subject)) continue;
        checked++;
        expect([sel, beats(specificity(sel), RESET)]).toEqual([sel, true]);
      }
    }
    expect(checked).toBeGreaterThan(10);
    expect(specificity(".fg button")).toEqual([0, 1, 1]);
    expect(specificity(".pt-btn.pt-btn--main")).toEqual([0, 2, 0]);
  });
});
