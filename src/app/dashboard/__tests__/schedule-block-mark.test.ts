import fs from "node:fs";
import path from "node:path";
import { contrastRatio, scheduleBlockPaint } from "@/lib/workboard/schedule-colour";

/* A BLOCK KEEPS ITS CATEGORY, AND ONLY A PROBLEM WEARS A MARK.

   The Schedule rail had three ways of arriving at near-white and used all of
   them at once. A booking nobody had clocked on to took `background:#fff`; a
   closed job took the neutral pale; and the live blocks in between were a 94%
   wash. On a real morning — 21 bookings, 10 unstarted, 7 closed — that put 17
   white rectangles on the rail and made the 3 blocks somebody was actually
   working on the hardest ones to find.

   White was never the problem it looked like: "booked, nobody on it yet" is
   the ORDINARY state of most of a day, not an exception. So the ground stays
   the category, hollow/filled moves entirely to the 4px cap, and the one
   genuine exception — past its start with nothing recorded — takes a mark in
   the corner instead of the ring, the red client name AND the white ground it
   used to take all three of.

   This reads the sheet rather than a screenshot, because none of it is
   reachable from jsdom: jest never loads CSS, so a rule that reappears here is
   invisible to every component test on this tab. The contrast is COMPUTED
   against `scheduleBlockPaint`'s own output rather than pinned, so retuning
   the wash re-checks the mark that sits on it. */

const CSS = fs
  .readFileSync(path.join(process.cwd(), "src/app/dashboard/shell.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** Every innermost rule in the sheet. `[^{}]` stops at the brace, so an
    @media wrapper contributes its own opening line and never a body. */
const RULES = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: m[1]!.split(",").map((s) => s.trim()),
  decls: m[2]!
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean),
}));

const rulesFor = (test: (selector: string) => boolean) =>
  RULES.filter((r) => r.selectors.some(test));

const declsOf = (test: (selector: string) => boolean) =>
  rulesFor(test).flatMap((r) => r.decls);

const prop = (decls: string[], name: string): string | null => {
  const hit = decls.find((d) => d.split(":")[0]!.trim() === name);
  return hit ? hit.slice(hit.indexOf(":") + 1).trim() : null;
};

const hex = (h: string): [number, number, number] => {
  const s = h.trim().replace(/^#/, "");
  const full = s.length === 3 ? s.replace(/./g, (c) => c + c) : s;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
};

const rgb = (css: string): [number, number, number] => {
  const m = css.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) throw new Error(`not an rgb() colour: ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};

function token(name: string): string {
  const m = CSS.match(new RegExp(`--${name}: *([^;]+);`));
  if (!m) throw new Error(`--${name} is not declared in shell.css`);
  return m[1]!.trim();
}

/** A ServiceM8-shaped category colour at one hue. Theirs arrive around 85%
    light — the input `scheduleBlockPaint` was written against — and the hue is
    the only thing that survives into the wash, so sweeping it sweeps every
    ground the mark can ever land on. */
function categoryHex(hue: number): string {
  const [s, l] = [0.8, 0.85];
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hue < 60 ? [c, x, 0]
    : hue < 120 ? [x, c, 0]
    : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c]
    : hue < 300 ? [x, 0, c]
    : [c, 0, x];
  return `#${[r, g, b]
    .map((v) => Math.round((v! + m) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

const isBlock = (sel: string) => sel.startsWith(".wb2-schb");
const mentions = (sel: string, cls: string) => new RegExp(`\\.${cls}\\b`).test(sel);

describe("a Schedule block never goes white for being unstarted", () => {
  it("gives an unstarted block no ground of its own", () => {
    /* The cap's `background:none` is the hollow itself and belongs to
       ::before; what must not come back is a ground on the block. */
    const grounds = rulesFor((s) => isBlock(s) && mentions(s, "idle") && !s.includes("::"))
      .flatMap((r) => r.decls)
      .filter((d) => /^background(-color)?\s*:/.test(d));
    expect(grounds).toEqual([]);
  });

  it("paints no block white by any other route", () => {
    const white = declsOf(isBlock)
      .filter((d) => /^background(-color)?\s*:/.test(d))
      .filter((d) => /#fff\b|#ffffff\b|\bwhite\b|rgb\(\s*255\s*,\s*255\s*,\s*255/i.test(d));
    expect(white).toEqual([]);
  });

  it("still hollows the cap, because that is the whole of the distinction now", () => {
    const cap = rulesFor((s) => s === ".wb2-schb.idle::before");
    expect(cap).toHaveLength(1);
    expect(prop(cap[0]!.decls, "background")).toBe("none");
    expect(prop(cap[0]!.decls, "box-shadow")).toMatch(/inset 0 0 0 1\.5px var\(--bar/);
  });
});

describe("the one block that is actually wrong wears a mark", () => {
  const mark = rulesFor((s) => s === ".wb2-schb.late::after");

  it("marks it with a disc in the done tick's slot", () => {
    expect(mark).toHaveLength(1);
    expect(prop(mark[0]!.decls, "content")).toBe('"!"');
    expect(prop(mark[0]!.decls, "background")).toBe("var(--wb2-dan)");
    /* the same geometry as `.done::after`, so "look at this" and "this is
       finished" are read in one place rather than two */
    expect(prop(mark[0]!.decls, "width")).toBe("14px");
    expect(prop(mark[0]!.decls, "border-radius")).toBe("50%");
    expect(prop(mark[0]!.decls, "right")).toBe("8px");
  });

  it("says it once — no ring, no red client name", () => {
    /* the disc's own `background` is the mark; a ring or a recoloured name
       would be the same fact said a second and third time, which is what this
       block wore before. */
    const shouting = rulesFor((s) => isBlock(s) && mentions(s, "late"))
      .flatMap((r) => r.decls)
      .filter((d) => /^(box-shadow|color)\s*:/.test(d) && d.includes("--wb2-dan"));
    expect(shouting).toEqual([]);
  });

  it("keeps its corner clear of the text at every width", () => {
    expect(prop(rulesFor((s) => s === ".wb2-schb.late")[0]!.decls, "padding-right")).toBe("26px");
    const tight = rulesFor((s) => s === ".wb2-schb.late.tight");
    expect(tight).toHaveLength(1);
    expect(prop(tight[0]!.decls, "padding-right")).toBe("26px");
  });

  it("clears every wash the paint module can build, at the graphic floor", () => {
    const disc = hex(token("wb2-dan"));
    const worst = { ratio: Infinity, hue: -1 };
    for (let hue = 0; hue < 360; hue += 1) {
      const wash = rgb(scheduleBlockPaint(categoryHex(hue)).fill);
      const ratio = contrastRatio(disc, wash);
      if (ratio < worst.ratio) Object.assign(worst, { ratio, hue });
    }
    /* 3:1 is WCAG's floor for a graphic that carries meaning, and the mark is
       the only thing carrying this one on the rail. */
    expect(worst.ratio).toBeGreaterThanOrEqual(3);
    /* and the glyph inside it is text on that disc */
    expect(contrastRatio(hex(prop(mark[0]!.decls, "color")!), disc)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the key describes the board the blocks are actually wearing", () => {
  it("draws 'not started' as the cap gone hollow, not as a white rectangle", () => {
    const swatch = rulesFor((s) => s === ".wb2-schkey i.hollow");
    expect(swatch).toHaveLength(1);
    expect(prop(swatch[0]!.decls, "background")).toBe("none");
    expect(prop(swatch[0]!.decls, "box-shadow")).toMatch(/inset 0 0 0 1\.5px var\(--kcap/);
  });

  it("draws the issue key as the mark itself", () => {
    const key = rulesFor((s) => s === ".wb2-schkey i.mark");
    expect(key).toHaveLength(1);
    expect(prop(key[0]!.decls, "background")).toBe("var(--wb2-dan)");
    expect(prop(key[0]!.decls, "border-radius")).toBe("50%");
  });
});
