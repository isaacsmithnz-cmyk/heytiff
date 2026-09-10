import fs from "node:fs";
import path from "node:path";

/* THE NUMBERS ONLY GO DOWN.

   docs/design.md sets four radii, eight type sizes, four weights, no accent
   (ink does the accent's jobs) and one shadow. The stylesheets were written
   before any of that existed, so a guard that demanded the scales today would
   fail on every file and be skipped by everyone. This one counts instead. Each ratchet below records
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
   they are how the fold will express the scale, and a `calc(6px - 3.5px)` is
   an inner well concentric with its swatch — geometry, read off the rule. */
const RADII = new Set(["0", "6px", "10px", "16px", "999px", "50%", "inherit", "initial"]);
function offScaleRadii(): number {
  let n = 0;
  for (const m of CSS.matchAll(/border-radius\s*:\s*([^;}]+)/g)) {
    const parts = m[1].replace(/\b(?:var|calc|clamp|min|max)\([^)]*\)/g, "").trim().split(/[\s/]+/).filter(Boolean);
    if (parts.some((t) => !RADII.has(t))) n++;
  }
  return n;
}

/* A focus ring is `0 0 0 Npx`, or the ring token since the tokens landed, and
   is ink doing its job; an inset is a hairline drawn the long way. Everything
   else is a shadow. */
function shadows(): number {
  let n = 0;
  for (const m of CSS.matchAll(/box-shadow\s*:\s*([^;}]+)/g)) {
    const v = m[1].trim();
    if (v !== "none" && !/^0 0 0 \d/.test(v) && !/^inset/.test(v) && !/^var\(--ring/.test(v)) n++;
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

/* ROUND TWO, 2026-09-10. Fifteen more tells, found by a second research pass
   and approved together. The countable ones are below; the rest (spinners,
   footers, Open Graph) are laws and a task in docs/design.md.

   Some of these read the components, not the stylesheets: the arrow on a
   button and the middot chain live in JSX text and string literals. The same
   comment-stripping applies, so a comment that quotes a tell is not a tell. */
const TSX = (() => {
  const files: string[] = [];
  (function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".") || e.name === "__tests__") continue;
        walk(p);
      } else if (p.endsWith(".tsx")) files.push(p);
    }
  })(SRC);
  return files
    .sort()
    .map((f) => fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""))
    .join("\n");
})();
const countTsx = (re: RegExp) => (TSX.match(re) ?? []).length;

/* Every rule block as [selector, body], for the counts that need both. */
function blocks(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(CSS))) out.push([m[1], m[2]]);
  return out;
}

/* Tailwind's palette, by value. The app's greys were these before anyone
   chose a grey, and the state colours are Tailwind's red, green, teal and
   amber. docs/design.md names the replacements. */
const TAILWIND = [
  "#f9fafb", "#f3f4f6", "#e5e7eb", "#d1d5db", "#9ca3af", "#6b7280", "#4b5563", "#374151", "#1f2937", "#111827",
  "#f8fafc", "#f1f5f9", "#e2e8f0", "#cbd5e1", "#94a3b8", "#64748b", "#475569", "#334155", "#1e293b", "#0f172a",
  "#fafafa", "#f4f4f5", "#e4e4e7", "#d4d4d8", "#a1a1aa", "#71717a", "#52525b", "#3f3f46", "#27272a", "#18181b",
  "#f5f5f5", "#e5e5e5", "#d4d4d4", "#a3a3a3", "#737373", "#525252", "#404040", "#262626", "#171717",
  "#6366f1", "#4f46e5", "#8b5cf6", "#7c3aed", "#3b82f6", "#2563eb", "#10b981", "#059669", "#22c55e", "#16a34a", "#ef4444", "#dc2626", "#f59e0b", "#d97706", "#0ea5e9", "#14b8a6",
];
function tailwindHexes(): number {
  const low = CSS.toLowerCase();
  let n = 0;
  for (const h of TAILWIND) n += (low.match(new RegExp(h, "g")) ?? []).length;
  return n;
}

/* The spacing scale from docs/design.md. 2 is the hairline gap between
   chips; everything else is 4 and its multiples up to 48. Three kinds are not
   rhythm and are not counted, by law 17: 1px, an optical nudge; anything above
   48, a layout offset such as a rail's width or a footer's clearance; and any
   negative value, an offset that centres a disc or hides a border. */
const SPACING = new Set([0, 2, 4, 8, 12, 16, 24, 32, 48]);
function offScaleSpacing(): number {
  let n = 0;
  for (const m of CSS.matchAll(/(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z]+)?\s*:\s*([^;}]+)/g)) {
    // a `calc()` sum is geometry — a neighbour's padding plus its border, a
    // disc's offset plus its width — and the guard that owns the neighbour
    // reads its parts; the sum itself is not rhythm
    for (const t of m[1].replace(/\b(?:calc|clamp|min|max)\([^)]*\)/g, "").split(/\s+/)) {
      const v = t.match(/^(-?\d+(?:\.\d+)?)px$/);
      if (!v) continue;
      const a = Math.abs(Number(v[1]));
      if (Number(v[1]) < 0 || a === 1 || a > 48) continue; // an offset, a nudge, a layout width
      if (!SPACING.has(a)) n++;
    }
  }
  return n;
}

function distinctZ(): number {
  const z = new Set<string>();
  for (const m of CSS.matchAll(/z-index\s*:\s*(-?\d+)/g)) z.add(m[1]);
  return z.size;
}

/* On screen only: JSX text or a string literal on one line, never code. The
   line bound matters — without it a quote that opens on one line and closes
   on another swallows the code in between and counts it. */
const onScreen = (ch: string) => new RegExp(`>[^<{\\n]*${ch}[^<{\\n]*<|"[^"\\n]*${ch}[^"\\n]*"|'[^'\\n]*${ch}[^'\\n]*'|\`[^\`\\n]*${ch}[^\`\\n]*\``, "g");

function hoverBlocks(test: (body: string) => boolean): number {
  let n = 0;
  for (const [sel, body] of blocks()) if (/:hover/.test(sel) && test(body)) n++;
  return n;
}

/* A button whose only content is an icon, unless it is a close cross or the
   clear cross in a search field — the two the law allows. */
function iconOnlyButtons(): number {
  let n = 0;
  for (const m of TSX.matchAll(/<button\b([^>]*)>\s*(?:<span[^>]*>\s*)?<Icon\b[^>]*\/>\s*(?:<\/span>\s*)?<\/button>/g)) {
    if (/aria-label=\{?["'`](Close|Clear)\b/.test(m[1])) continue;
    n++;
  }
  return n;
}

/* Every size a rule sets, whether as `font-size` or inside a `font:`
   shorthand (`font: 800 9.5px var(--font)`), which the first cut of this
   ratchet did not read. */
function sizes(): number[] {
  const out: number[] = [];
  for (const m of CSS.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g)) out.push(Number(m[1]));
  for (const m of CSS.matchAll(/(?<![-a-z])font\s*:\s*(?:[a-z]+\s+)*(?:\d{3}\s+)?(\d+(?:\.\d+)?)px/g)) out.push(Number(m[1]));
  return out;
}
function small(): number {
  return sizes().filter((n) => n < 12).length;
}

/* The type scale from docs/design.md: eight sizes, and a rule picks one by
   role. Relative sizes (`0.86em` on inline code) are not on it and not counted:
   they follow the text they sit in. */
const TYPE = new Set([12, 13, 14, 16, 20, 24, 32, 40]);
function offScaleType(): number {
  return sizes().filter((n) => !TYPE.has(n)).length;
}

/* A weight is 400, 500, 600 or 700, declared either way. 650 and 750 were the
   variable font's in-between stops, typed by feel. */
function heavy(): number {
  return count(/font-weight\s*:\s*(650|750|800|900)\b/g) + count(/(?<![-a-z])font\s*:\s*(?:[a-z]+\s+)*(650|750|800|900)\s+\d/g);
}

/* INK AND PAPER, decided 2026-09-10. There is no accent: ink does the four
   jobs, colour appears only where it means something. Three of round three's
   findings follow from that decision and are counted here.

   A focus ring drawn as an alpha tint cannot reach 3:1 on a light ground; the
   ring is 2px of solid ink. Anything `0 0 0 Npx rgba(…, a)` with a under .6
   is the old kind. */
function faintRings(): number {
  let n = 0;
  for (const m of CSS.matchAll(/box-shadow\s*:\s*0 0 0 [2-4]px rgba\([^)]*,\s*(0?\.\d+|1|0)\s*\)/g)) {
    if (Number(m[1]) < 0.6) n++;
  }
  return n;
}

/* A `color` set on an anchor by selector that is not the link token and not
   `inherit`. Links are one token, ink and underlined, so every other value
   here is a place still choosing its own. (`inherit` is a row or a chip that
   happens to be an anchor and takes its parent's colour on purpose.) */
function anchorColours(): number {
  let n = 0;
  for (const [sel, body] of blocks()) {
    const isAnchor = sel.split(",").some((s) => /(^|[\s>+~])a(?=$|[\s.:#[>+~])/.test(s.trim()));
    if (!isAnchor) continue;
    for (const m of body.matchAll(/(^|[^-])color\s*:\s*([^;]+)/g)) {
      const v = m[2].trim();
      if (v !== "inherit" && v !== "var(--link)") n++;
    }
  }
  return n;
}

const RATCHETS: Array<{ law: string; now: () => number; baseline: number }> = [
  { law: "type below 12px — the floor", now: small, baseline: 0 },
  { law: "type off the scale — 12, 13, 14, 16, 20, 24, 32, 40", now: offScaleType, baseline: 0 },
  { law: "weight off 400, 500, 600, 700 — 800 is retired", now: heavy, baseline: 0 },
  { law: "`transition: all` — a transition names what moves", now: () => count(/transition\s*:\s*all\b/g), baseline: 94 },
  { law: "`text-transform: uppercase` — the eyebrow is retired", now: () => count(/text-transform\s*:\s*uppercase/g), baseline: 201 },
  { law: "radius off the scale — four radii and a circle", now: offScaleRadii, baseline: 0 },
  { law: "ambient `infinite` animation — motion is feedback or state", now: () => count(/animation(?:-iteration-count)?\s*:[^;}]*\binfinite\b/g), baseline: 42 },
  { law: "gradients — one accent, flat surfaces", now: () => count(/(?:linear|radial|conic)-gradient\(/g), baseline: 114 },
  { law: "shadows that are not a focus ring — one shadow, overlays only", now: shadows, baseline: 284 },
  { law: "bars at the left edge — selection is a fill, state is a word", now: leftBars, baseline: 25 },
  // round two
  { law: "Tailwind palette hexes — colour comes from the tokens", now: tailwindHexes, baseline: 2 },
  { law: "spacing off the scale — 2, 4, 8, 12, 16, 24, 32, 48", now: offScaleSpacing, baseline: 0 },
  { law: "cubic-bezier — two motion tokens, no custom curves", now: () => count(/cubic-bezier\(/g), baseline: 0 },
  { law: "distinct z-index values — six layers", now: distinctZ, baseline: 36 },
  { law: "arrows on buttons — the word is the button", now: () => countTsx(onScreen("→")), baseline: 18 },
  { law: "middot chains — a sentence, or a label and a value", now: () => countTsx(onScreen("·")), baseline: 242 },
  { law: "inner-highlight glass edges — no glass", now: () => count(/inset 0 1px 0 rgba\(255/g), baseline: 6 },
  { law: "white-alpha hairlines on the dark chrome — one hairline token", now: () => count(/border(?:-[a-z]+)?\s*:\s*1px solid rgba\(255,\s*255,\s*255,\s*0?\.[0-2]\d*\)/g), baseline: 38 },
  { law: "stacked hovers — a hover is one change", now: () => hoverBlocks((b) => /transform/.test(b) && /box-shadow/.test(b)), baseline: 34 },
  { law: "hover nudges — nothing slides on hover", now: () => hoverBlocks((b) => /translateX\([1-6]px\)/.test(b)), baseline: 10 },
  { law: "hover-revealed controls — shown on focus too, or not hidden", now: () => hoverBlocks((b) => /\bopacity\s*:\s*1\b/.test(b)), baseline: 25 },
  { law: "pill, chip, tag and badge rules — state is a word", now: () => count(/\.[a-z0-9-]*(pill|tag|badge|chip)[a-z0-9-]*\s*[{,]/g), baseline: 139 },
  { law: "letter-spacing — display titles only", now: () => count(/letter-spacing\s*:/g), baseline: 450 },
  { law: "icon-only buttons that are not a close or clear cross — every other button carries its word", now: iconOnlyButtons, baseline: 34 },
  // ink and paper
  /* The OK colour on a selector that is not a state. It began as a count of
     every use (88), then the accent migration named accent-on-state as state
     and the plain count rose while the law was better kept; so it counts
     what the law forbids. A state is named in the selector: ok, done, paid,
     verified, live, synced, past, active, now, and their kin. */
  { law: "the OK colour off a state selector — colour only where it means something", now: () => {
      const STATE = /\.(ok|done|paid|verified|verify|waiting|live|now|synced|presumed|reimbursed|past|active|green|okw)\b|\.dchip2?\.ok|\.lv-cert\.on|\.vm-progress|\.wb2-waiting/;
      let n = 0;
      for (const [sel, body] of blocks()) if (!STATE.test(sel)) n += (body.match(/var\(--ok-t\)/g) ?? []).length;
      return n;
    }, baseline: 10 },
  { law: "focus rings drawn as an alpha tint — 2px of solid ink", now: faintRings, baseline: 0 },
  { law: "colour declared on anchors — one link token", now: anchorColours, baseline: 19 },
  /* THE ACCENT. Teal, blue and violet in any spelling, doing any job, in a
     rule body. Ink and paper says none of it belongs on a working screen
     except the wordmark's "Tiff" and the drawing; what remains is the dark
     chrome, the home diary's dark card, Time & Pay's day vocabulary and the
     Studio, each settled in its own fold. The token definitions on :root are
     not uses and are not counted. */
  { law: "accent colour uses — ink does the accent's jobs", now: () => {
      let n = 0;
      for (const [sel, body] of blocks()) {
        if (/^\s*:root\s*$/.test(sel)) continue;
        n += (body.match(/var\(--(?:teal|teal-d|blue|violet|violet-d|hm-teal|tool-accent)\b|#00e5c0|#00a389|#2e68ff|#8a2be2|#007fa8|#0089b8|rgba\(0,\s*229,\s*192,|rgba\(0,\s*163,\s*137,|rgba\(46,\s*104,\s*255,|rgba\(138,\s*43,\s*226,/gi) ?? []).length;
      }
      return n;
    }, baseline: 468 },
];

describe("the design ratchets only go down", () => {
  /* The tokens docs/design.md names exist, on :root, in shell.css. Not a
     ratchet: a token that goes missing is a build that lost a decision. */
  it("defines every token the design doc names", () => {
    const root = fs.readFileSync(path.join(process.cwd(), "src/app/dashboard/shell.css"), "utf8");
    for (const name of [
      "paper", "ground", "line", "tint", "tint-2", "link", "ring", "ring-bad", "ring-warn", "shadow-overlay", "ok-t", "ok-tint",
      "on-ink-line", "t-fast", "t-move", "ease", "z-raised", "z-sticky", "z-overlay", "z-modal", "z-toast",
      "r-control", "r-button", "r-card", "r-pill", "s-1", "s-8", "fs-1", "fs-8", "fw-body", "fw-display",
    ]) {
      expect(root).toMatch(new RegExp(`--${name}\\s*:`));
    }
    expect(root).toMatch(/--ok-t\s*:\s*#196B2D/);
  });

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
