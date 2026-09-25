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
     that starts lit is motion-only. */

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const TOKENS = read("src/app/tokens.css");
const CSS = read("src/app/dashboard/shell.css");

/** Every rule as [selector, body]; nested blocks are read at their own level. */
const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1]!.trim(), m[2]!] as const);
const tmRules = rules.filter(([sel]) => /(^|[\s,.])\.?tm(-[a-z-]+)?\b/.test(sel) && /\.tm\b|\.tm-/.test(sel));
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
