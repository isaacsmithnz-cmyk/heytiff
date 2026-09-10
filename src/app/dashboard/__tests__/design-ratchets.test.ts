import fs from "node:fs";
import path from "node:path";

/* THE NUMBERS ONLY GO DOWN.

   docs/design.md sets four radii, eight type sizes, four weights, one accent
   and one shadow. The stylesheets were written before any of that existed, so
   a guard that demanded the scales today would fail on every file and be
   skipped by everyone. This one counts instead. Each ratchet below records
   how many times the sheets break a law, as of the day the law was written,
   and holds the count exactly there.

   A PR that removes some of them lowers the number in this file. A PR that
   adds one fails here, with the count in the message. The number is therefore
   always the truth, and reading this file tells you how far the fold has got.
   Equality, not "at most": a count that drops without the number following it
   is a change nobody wrote down, which is how the sheets got here.

   Every ratchet was watched failing before it was trusted: the baselines were
   first set wrong on purpose, the run printed the real counts, and only then
   were they recorded. Do the same when you add one.

   The three paper stylesheets are left out on purpose. The design sheet, the
   letterhead and the live sheet are documents set for print, with type sizes
   that belong to paper, not to the screen scales. */

const SRC = path.join(process.cwd(), "src");
const PAPER = new Set([
  "src/components/studio/summary/sheet-doc.css",
  "src/components/org/letterhead.css",
  "src/app/live/[token]/live-sheet.css",
]);

function sheets(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      sheets(p, out);
    } else if (p.endsWith(".css") && !PAPER.has(path.relative(process.cwd(), p))) {
      out.push(p);
    }
  }
  return out.sort();
}

// comments carry the history; only declarations count
const CSS = sheets(SRC)
  .map((f) => fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, ""))
  .join("\n");

const count = (re: RegExp) => (CSS.match(re) ?? []).length;

/* The radius scale from docs/design.md, plus the two values that are not a
   radius at all. A shorthand like `12px 12px 0 0` is one declaration and one
   hit if any of its parts is off the scale. Tokens and calc() are trusted:
   they are how the fold will express the scale. */
const RADII = new Set(["0", "6px", "10px", "16px", "999px", "50%", "inherit", "initial"]);
function offScaleRadii(): number {
  let n = 0;
  for (const m of CSS.matchAll(/border-radius\s*:\s*([^;}]+)/g)) {
    const parts = m[1].trim().split(/[\s/]+/);
    if (parts.some((t) => !RADII.has(t) && !t.startsWith("var(") && !t.startsWith("calc("))) n++;
  }
  return n;
}

/* A focus ring is `0 0 0 Npx` and is the accent doing its job; an inset is a
   hairline drawn the long way. Everything else is a shadow. */
function shadows(): number {
  let n = 0;
  for (const m of CSS.matchAll(/box-shadow\s*:\s*([^;}]+)/g)) {
    const v = m[1].trim();
    if (v !== "none" && !/^0 0 0 \d/.test(v) && !/^inset/.test(v)) n++;
  }
  return n;
}

/* A coloured line down the left edge: a border, an inset shadow that only
   paints on the left, or a pseudo-element two to six pixels wide pinned to
   the left with a height. Selection is a fill and state is a word, so none of
   these has a job. Widths under 2px are dividers, not bars, and are not
   counted. Isaac named this one himself: "the vertical line at the start of
   lots of different buttons or cards. the nav bar items are an easy example." */
function leftBars(): number {
  let n = 0;
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(CSS))) {
    const sel = m[1];
    const body = m[2];
    const border = body.match(/border-(?:left|inline-start)\s*:\s*([^;]+)/);
    if (border && parseFloat(border[1]) >= 2 && !/transparent|none/.test(border[1])) n++;
    const inset = body.match(/box-shadow\s*:\s*inset\s+(\d+(?:\.\d+)?)px\s+0\b/);
    if (inset && Number(inset[1]) >= 2) n++;
    if (/::?(before|after)\b/.test(sel)) {
      const w = body.match(/\bwidth\s*:\s*(\d+(?:\.\d+)?)px/);
      const width = w ? Number(w[1]) : 0;
      if (width >= 2 && width <= 6 && /\bleft\s*:\s*(0|-1px)\b/.test(body) && /\b(top|bottom|inset|height)\s*:/.test(body)) n++;
    }
  }
  return n;
}

function small(): number {
  let n = 0;
  for (const m of CSS.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g)) if (Number(m[1]) < 12) n++;
  return n;
}

const RATCHETS: Array<{ law: string; now: () => number; baseline: number }> = [
  { law: "type below 12px — the floor", now: small, baseline: 545 },
  { law: "weight 800 or 900 — retired", now: () => count(/font-weight\s*:\s*(800|900)\b/g), baseline: 625 },
  { law: "`transition: all` — a transition names what moves", now: () => count(/transition\s*:\s*all\b/g), baseline: 96 },
  { law: "`text-transform: uppercase` — the eyebrow is retired", now: () => count(/text-transform\s*:\s*uppercase/g), baseline: 202 },
  { law: "radius off the scale — four radii and a circle", now: offScaleRadii, baseline: 748 },
  { law: "ambient `infinite` animation — motion is feedback or state", now: () => count(/animation(?:-iteration-count)?\s*:[^;}]*\binfinite\b/g), baseline: 45 },
  { law: "gradients — one accent, flat surfaces", now: () => count(/(?:linear|radial|conic)-gradient\(/g), baseline: 136 },
  { law: "shadows that are not a focus ring — one shadow, overlays only", now: shadows, baseline: 291 },
  { law: "bars at the left edge — selection is a fill, state is a word", now: leftBars, baseline: 27 },
];

describe("the design ratchets only go down", () => {
  it("reads every screen stylesheet and none of the paper ones", () => {
    const files = sheets(SRC).map((f) => path.relative(process.cwd(), f));
    expect(files).toContain("src/app/dashboard/shell.css");
    expect(files).toContain("src/components/studio/studio.css");
    for (const paper of PAPER) expect(files).not.toContain(paper);
  });

  for (const r of RATCHETS) {
    it(r.law, () => {
      const n = r.now();
      const verdict =
        n < r.baseline
          ? `${r.law}: ${n} now, the baseline says ${r.baseline}. You removed some — lower the baseline in design-ratchets.test.ts to ${n}.`
          : `${r.law}: ${n} now, the baseline says ${r.baseline}. Something added ${n - r.baseline} — take it out, or if it is a spinner or the orb, name it in docs/design.md and lower the count another way.`;
      expect({ count: n, verdict }).toEqual({ count: r.baseline, verdict: expect.any(String) });
    });
  }
});
