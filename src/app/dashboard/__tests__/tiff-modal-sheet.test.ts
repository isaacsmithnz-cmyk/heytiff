import fs from "node:fs";
import path from "node:path";

/* THE TIFF MODAL'S STYLESHEET, held to what docs/design.md and the spec say
   about it. A stylesheet-text guard, like its neighbours: it cannot resolve a
   cascade, but it can hold the facts the modal stands on.

   - It floats: paper, the card radius, the one overlay shadow, the one scrim,
     the modal layer (the layer itself is held in sheet-overlay-layers).
   - Its words are readable: every colour a `.tm-` rule sets on text is one of
     four tokens, and each clears 4.5:1 on paper and on the hover tint.
   - The tick on a row it will file is ink: colour only where it means
     something, and the OK colour is a state.
   - The dots may leave it while they gather from the button, and the arrival
     that starts lit is motion-only.
   - Every control in it wears the ring from the keyboard (law 32), and
     nothing in it slides under reduced motion.
   - The view and the sheet agree both ways, and a finished thing is not
     dressed as a warning. */

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const TOKENS = read("src/app/tokens.css");
const CSS = read("src/app/dashboard/shell.css");

/** Every rule as [selector, body]; nested blocks are read at their own level. */
const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1]!.trim(), m[2]!] as const);
const tmRules = rules.filter(([sel]) => /(^|[\s,.])\.?tm(-[a-z-]+)?\b/.test(sel) && /\.tm\b|\.tm-/.test(sel));
/** The rules inside every `@media` block whose query matches. */
function mediaRules(query: RegExp): (readonly [string, string])[] {
  const out: (readonly [string, string])[] = [];
  for (const m of CSS.matchAll(/@media([^{]*)\{/g)) {
    if (!query.test(m[1]!)) continue;
    let depth = 1;
    let i = m.index! + m[0].length;
    const start = i;
    while (depth && i < CSS.length) {
      if (CSS[i] === "{") depth++;
      else if (CSS[i] === "}") depth--;
      i++;
    }
    for (const r of CSS.slice(start, i - 1).matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push([r[1]!.trim(), r[2]!]);
  }
  return out;
}
const VIEW = fs.readFileSync(path.join(process.cwd(), "src/components/tiff/modal/tiff-modal.tsx"), "utf8");
const selectors = (sel: string) => sel.split(",").map((s) => s.trim());

const body = (selector: string) => {
  const hit = rules.filter(([sel]) => sel === selector);
  if (hit.length !== 1) throw new Error(`${selector}: ${hit.length} rules, expected 1`);
  return hit[0]![1];
};

function token(name: string): string {
  const m = TOKENS.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`--${name} is not declared`);
  const raw = m[1]!.trim();
  const alias = raw.match(/^var\(--([a-z0-9-]+)\)$/i);
  return alias ? token(alias[1]!) : raw;
}
const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const lum = ([r, g, b]: number[]) => 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
const ratio = (a: number[], b: number[]) => {
  const [l1, l2] = [lum(a), lum(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbaOver = (v: string, bg: number[]) => {
  const m = v.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/)!;
  const a = Number(m[4]);
  return [1, 2, 3].map((i, k) => Number(m[i]) * a + bg[k]! * (1 - a));
};
const colour = (name: string) => {
  const v = token(name);
  if (!v.startsWith("#")) throw new Error(`--${name} is ${v}, not a hex`);
  return hex(v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v);
};
const PAPER = [255, 255, 255];
const HOVER = rgbaOver(token("tint"), PAPER);

describe("the Tiff modal floats", () => {
  it("is paper on the card radius, on the modal layer", () => {
    const tm = body(".tm");
    expect(tm).toMatch(/background:var\(--paper\)/);
    expect(tm).toMatch(/border-radius:var\(--r-card\)/);
    expect(tm).toMatch(/z-index:var\(--z-modal\)/);
    expect(tm).toMatch(/top:104px/);
    expect(tm).toMatch(/width:min\(600px/);
  });

  it("wears the one overlay shadow over the one scrim", () => {
    expect(rules.some(([sel, b]) => sel.split(",").map((s) => s.trim()).includes(".tm") && /box-shadow:var\(--shadow-overlay\)/.test(b))).toBe(true);
    expect(body(".tm-scrim")).toMatch(/background:var\(--scrim\)/);
  });

  it("is never given a height: its parts open and close by their own", () => {
    expect(body(".tm")).not.toMatch(/(^|[;\s])height\s*:/);
  });
});

describe("its words are readable", () => {
  const ALLOWED = ["ink", "q", "warn-t", "bad-t"];

  it("sets text only in the four tokens", () => {
    const set = new Set<string>();
    for (const [, b] of tmRules) for (const m of b.matchAll(/(?:^|[;\s{])color\s*:\s*([^;]+)/g)) set.add(m[1]!.trim());
    expect(set.size).toBeGreaterThan(0);
    for (const v of set) expect(ALLOWED.map((t) => `var(--${t})`)).toContain(v);
  });

  it.each(ALLOWED)("--%s clears 4.5:1 on paper and on the hover tint", (name) => {
    expect(ratio(colour(name), PAPER)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(colour(name), HOVER)).toBeGreaterThanOrEqual(4.5);
  });

  it("draws the tick of a row it will file in ink, not the OK colour", () => {
    expect(body(".fg .tm-ok")).toMatch(/color:var\(--ink\)/);
    for (const [, b] of tmRules) expect(b).not.toMatch(/var\(--ok(-t)?\)/);
  });
});

describe("the view and the sheet agree", () => {
  /* A class the view names and no rule styles is a control drawn as the
     browser's default — the kind of slip only a rendered page shows. */
  const named = new Set([...VIEW.matchAll(/["` ](tm-[a-z-]+)/g)].map((m) => m[1]!));

  it("styles every .tm- class the modal names", () => {
    expect(named.size).toBeGreaterThan(10);
    for (const cls of named) expect(`${cls}: ${new RegExp(`\\.${cls}(?![a-z-])`).test(CSS)}`).toBe(`${cls}: true`);
  });

  /* And the other way: a rule no element wears is either dead or the rule an
     element was MEANT to wear. "In the Library" wore the warning's class
     while the quiet rule written for it sat unused. */
  it("names every .tm- class the sheet styles", () => {
    const styled = new Set([...CSS.matchAll(/\.(tm-[a-z-]+)/g)].map((m) => m[1]!));
    expect(styled.size).toBeGreaterThan(10);
    for (const cls of styled) expect(`${cls}: ${named.has(cls)}`).toBe(`${cls}: true`);
  });

  it("says a library entry is in the Library quietly, not in the warning's colour", () => {
    expect(VIEW).toMatch(/className="tm-added">In the Library</);
    expect(body(".fg .tm-added")).toMatch(/color:var\(--q\)/);
    expect(body(".fg .tm-added")).not.toMatch(/--(warn|bad|ok)/);
  });

  it("gives the live words the live type on the element the settle reads", () => {
    expect(rules.some(([sel, b]) => sel.includes(".tm-turn.live .tm-words") && /font-size:20px/.test(b))).toBe(true);
  });
});

describe("the keyboard and reduced motion", () => {
  /* Every control in the modal, and the words you click into to fix. */
  const RINGED = [".fg .tm-aimx", ".fg .tm-x", ".fg .tm-clear", ".fg .tm-rm", ".fg .tm-undo", ".fg .tm-words", ".fg .tm .pbtn"];

  it.each(RINGED)("%s wears the ring from the keyboard (law 32)", (control) => {
    const ringed = rules.some(
      ([sel, b]) => selectors(sel).includes(`${control}:focus-visible`) && /box-shadow:var\(--ring\)/.test(b)
    );
    expect(ringed).toBe(true);
  });

  /* The frame's reduced-motion rule shortens animations only; a transition
     that moves something has to be taken off by name. */
  it("takes off every transition that moves something", () => {
    const still = mediaRules(/prefers-reduced-motion:\s*reduce/);
    const moving = tmRules.filter(([, b]) =>
      /transition\s*:[^;]*\b(width|height|margin[a-z-]*|padding[a-z-]*|transform|top|left)\b/.test(b)
    );
    expect(moving.length).toBeGreaterThan(0);
    for (const [sel] of moving) {
      for (const one of selectors(sel)) {
        const off = still.some(([s, b]) => selectors(s).includes(one) && /transition\s*:\s*none/.test(b));
        expect(`${one}: ${off}`).toBe(`${one}: true`);
      }
    }
  });
});

describe("the dots leave the button", () => {
  it("may leave the modal and its face while they gather", () => {
    const opened = rules.filter(([sel, b]) => /overflow:visible/.test(b) && /dotf\[data-stage="gather"\]/.test(sel));
    const sels = opened.flatMap(([sel]) => sel.split(",").map((s) => s.trim()));
    expect(sels).toContain('.tm:has(.dotf[data-stage="gather"])');
    expect(sels).toContain('.tm-face:has(.dotf[data-stage="gather"])');
  });

  it("start lit only where motion is allowed", () => {
    const at = CSS.indexOf("animation-name:tmArrive");
    expect(at).toBeGreaterThan(-1);
    const media = CSS.lastIndexOf("@media", at);
    expect(CSS.slice(media, at)).toMatch(/prefers-reduced-motion:\s*no-preference/);
  });
});
