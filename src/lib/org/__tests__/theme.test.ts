import { readFileSync } from "fs";
import { join } from "path";
import {
  contrast,
  documentTheme,
  parseHex,
  THEME_CONTRACT,
  themeVars,
  type DocumentTheme,
} from "../theme";

/* THE GUARD FOR A COLOUR NOBODY HAS PICKED YET.

   Every other contrast test in this repo reads a stylesheet off disk and scans
   it. None of them can see this feature: the colour arrives from a customer at
   runtime, so there is no literal in any sheet to find. The only thing left to
   assert is the DERIVATION — so this sweeps the colour space instead of
   checking examples, and the claim it makes is total: whatever anyone picks,
   the band clears the floor against the paper it is printed on.

   The floor comes from THEME_CONTRACT rather than being restated here. A test
   carrying its own copy of 4.5 can agree with itself perfectly while
   disagreeing with the code it is guarding. */

const { PAPER, TEXT_FLOOR } = THEME_CONTRACT;

/** HSL is fine for GENERATING seeds — the point is to spray the space, not to
    make claims about perceived lightness (which is exactly what HSL cannot
    do, and why the derivation itself never touches it). */
function hslHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x];
  const hex = (v: number) =>
    Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** The whole space, coarsely — 36 hues x 3 saturations x 5 lightnesses. */
const SWEEP: string[] = [];
for (let h = 0; h < 360; h += 10)
  for (const s of [0.15, 0.5, 1])
    for (const l of [0.1, 0.3, 0.5, 0.7, 0.9]) SWEEP.push(hslHex(h, s, l));

/* The ones that break naive implementations, named so a failure says which.
   Yellow is the important one: it is the brightest hue there is, so a brand
   colour of #ffff00 measures 1.07:1 on paper and has to travel furthest. */
const PATHOLOGICAL: [string, string][] = [
  ["pure white", "#ffffff"],
  ["pure black", "#000000"],
  ["pure yellow — 1.07:1 on paper", "#ffff00"],
  ["pure cyan", "#00ffff"],
  ["pure green", "#00ff00"],
  ["pure magenta", "#ff00ff"],
  ["mid grey, no hue at all", "#808080"],
  ["one step off white", "#fefefe"],
  ["one step off black", "#010101"],
  ["the app's own teal", "#00e5c0"],
];

const rgb = (hex: string) => parseHex(hex)!;
const theme = (seed: string): DocumentTheme => {
  const t = documentTheme(seed);
  if (!t) throw new Error(`documentTheme returned null for ${seed}`);
  return t;
};

/* Every claim the derivation makes, in one place, so the sweep and the named
   cases test exactly the same thing.

   Returns the breaches rather than asserting them: across 540 seeds a bare
   `toBeGreaterThanOrEqual` names the ratio and not the COLOUR, and "4.31 is
   not >= 4.5" with no seed attached is most of a debugging session. The caller
   asserts on the list, so a failure prints which colours broke and by how
   much. */
function breaches(seed: string, t: DocumentTheme): string[] {
  const checks: [string, number, number][] = [
    // the band is a fill on white paper; the floor is what keeps a pale brand
    // colour from printing a band nobody can see
    ["ink on paper", contrast(rgb(t.ink), PAPER), TEXT_FLOOR],
  ];
  return checks
    .filter(([, got, floor]) => got < floor)
    .map(([role, got, floor]) => seed + " -> " + role + ": " + got.toFixed(2) + ":1, needs " + floor + ":1");
}

describe("documentTheme — legible whatever anyone picks", () => {
  it("clears every floor across the whole colour space", () => {
    // the sweep is worthless if it silently shrank
    expect(SWEEP).toHaveLength(540);
    expect(SWEEP.flatMap((seed) => breaches(seed, theme(seed)))).toEqual([]);
  });

  it.each(PATHOLOGICAL)("clears every floor for %s", (_name, seed) => {
    expect(breaches(seed, theme(seed))).toEqual([]);
  });

  /* The floor is the POINT, so widening it has to fail loudly rather than
     quietly making every other test in here easier — the sweep reads the floor
     from the contract, so a wider one passes all 540 seeds vacuously. */
  it("holds the floor it was written against", () => {
    expect(TEXT_FLOOR).toBe(4.5);
  });
});

describe("documentTheme — least change that works", () => {
  /* A colour that already reads on paper must come back UNTOUCHED. Without
     this the derivation is free to return near-black for everything and pass
     every contrast assertion above — legible, and no longer anybody's brand. */
  it("returns the seed unchanged when it already clears the floor", () => {
    const dark = "#1a2b4c"; // navy, ~11:1 on white
    expect(contrast(rgb(dark), PAPER)).toBeGreaterThan(TEXT_FLOOR);
    expect(theme(dark).ink).toBe(dark);
  });

  it("moves a colour only as far as it has to", () => {
    /* Yellow cannot stay yellow-bright and be read on paper, but it must not
       be dragged past the floor either — one step lighter should fail. */
    const ink = rgb(theme("#ffff00").ink);
    expect(contrast(ink, PAPER)).toBeGreaterThanOrEqual(TEXT_FLOOR);
    expect(contrast(ink, PAPER)).toBeLessThan(TEXT_FLOOR + 0.6);
  });

  /* DARKENING HAPPENS IN LINEAR LIGHT, and this is the assertion that says so.

     Scaling the LINEAR channels by k leaves their ratios untouched, so the
     chromaticity — the hue and the saturation — survives exactly; only the
     luminance moves. Scaling the sRGB channels instead looks like it should do
     the same and does not, because gamma is not linear: the linear ratios
     shift, and the colour drifts as it darkens.

     A loose "is it still colourful" check cannot tell the two apart — that was
     the first version of this test, and rewriting `darken` to scale in sRGB
     sailed straight through it. So this runs the wrong method alongside the
     right one and requires the right one to win. */
  it("holds a colour's chromaticity better than sRGB scaling would", () => {
    const lin = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const lum = (c: readonly number[]) =>
      0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    const onPaper = (c: readonly number[]) => (1.05) / (lum(c) + 0.05);
    /** where the colour sits on the hue/saturation plane, luminance divided out */
    const chroma = (c: readonly number[]) => {
      const l = c.map(lin);
      const sum = l[0] + l[1] + l[2] || 1e-9;
      return l.map((v) => v / sum);
    };
    const drift = (a: readonly number[], b: readonly number[]) =>
      Math.max(...chroma(a).map((v, i) => Math.abs(v - chroma(b)[i])));

    /* THE RIVAL. Scaling the sRGB channels is the obvious way to darken and
       the wrong one: gamma is not linear, so the linear ratios shift and the
       colour drifts as it goes down. Rather than pick a magic threshold that
       happens to sit between the two, the test runs the rival and requires the
       real thing to beat it — an assertion that recalibrates itself if either
       the floors or the seeds ever change. */
    const srgbRival = (c: readonly number[]) => {
      if (onPaper(c) >= TEXT_FLOOR) return c;
      let lo = 0, hi = 1;
      for (let i = 0; i < 24; i++) {
        const m = (lo + hi) / 2;
        const t = c.map((v) => Math.round(v * (1 - m)));
        if (onPaper(t) >= TEXT_FLOOR) hi = m;
        else lo = m;
      }
      return c.map((v) => Math.round(v * (1 - hi)));
    };

    /* Light, saturated, all three channels lit — the colours that have to
       TRAVEL to reach the floor, which is where the two methods diverge. A
       dark seed barely moves and the methods agree, so a set of those would
       prove nothing. */
    const seeds = ["#e5a04b", "#4bb3a0", "#3d9be0", "#f0c674", "#9ad1e8",
                   "#d98cb3", "#b7d97a", "#ffcc66", "#88ddcc", "#e8a0a0"];
    const mine: number[] = [];
    const theirs: number[] = [];
    for (const seed of seeds) {
      const s = rgb(seed);
      mine.push(drift(s, rgb(theme(seed).ink)));
      theirs.push(drift(s, srgbRival(s)));
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

    // measured 0.0022 vs 0.0076 — a 3.5x gap, asserted at 2x for headroom
    expect(mean(mine) * 2).toBeLessThan(mean(theirs));
    // and no single colour drifts far enough to read as a different colour
    for (const d of mine) expect(d).toBeLessThan(0.005);
  });

  it("does not grey out a saturated colour", () => {
    for (const seed of ["#ffff00", "#00ff00", "#ff0000", "#00e5c0"]) {
      const [r, g, b] = rgb(theme(seed).ink);
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeGreaterThan(20);
    }
  });


});

describe("documentTheme — refusing rather than throwing", () => {
  /* These land inside a PRINT path. A bad value has to degrade to the
     unthemed document, which is what every org has today, not throw halfway
     through rendering a customer's handover sheet. */
  it.each([["empty", ""], ["not a colour", "rebeccapurple"], ["short", "#ff"], ["junk", "#gggggg"], ["overlong", "#1234567"]])(
    "returns null for %s rather than throwing",
    (_name, bad) => {
      expect(documentTheme(bad)).toBeNull();
    }
  );

  it("takes a short hex and a bare one, because a picker may hand back either", () => {
    expect(documentTheme("#abc")).toEqual(documentTheme("#aabbcc"));
    expect(documentTheme("aabbcc")).toEqual(documentTheme("#aabbcc"));
  });

  it("is deterministic — the same seed twice is the same document", () => {
    for (const seed of ["#ffff00", "#1a2b4c", "#00e5c0"]) {
      expect(documentTheme(seed)).toEqual(documentTheme(seed));
    }
  });
});

/* RULE 1, ASSERTED RATHER THAN WRITTEN DOWN: the brand colour never becomes
   state. ok #00A389 and danger #e0264f mean one thing across the whole app,
   and a business with a red brand must not turn "paid" into "overdue". The
   module has no business knowing those values at all. */
describe("documentTheme — never state", () => {
  it("does not export, or derive, the semantic state colours", () => {
    const src = readFileSync(join(__dirname, "../theme.ts"), "utf8");
    // comments stripped: this file's own header NAMES both literals, and
    // matching that prose would pass against code that used them
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const state of ["#00A389", "#00a389", "#e0264f", "#E0264F"]) {
      expect(code).not.toContain(state);
    }
  });
});

/* HOW A DOCUMENT RECEIVES THE THEME.

   The promise this pins is the one that is easiest to break and hardest to
   notice: a business with no colour must get the document it has today. That
   works by NOT SETTING THE VARIABLE — every themed declaration is written
   `var(--doc-ink, <the value it already had>)`, so "unthemed" is the absence
   of a code path rather than a branch somebody has to keep correct. An empty
   object here is the whole mechanism. */
describe("themeVars", () => {
  it("sets nothing at all when there is no colour", () => {
    expect(themeVars(null)).toEqual({});
    expect(themeVars("")).toEqual({});
  });

  it("sets nothing for a value it cannot read, rather than throwing in a print path", () => {
    expect(themeVars("rebeccapurple")).toEqual({});
    expect(themeVars("#gggggg")).toEqual({});
  });

  it("hands the document the derived colour, never the raw seed", () => {
    // yellow cannot be printed as picked; the variable must carry what the
    // derivation returned, not what the owner chose
    const v = themeVars("#ffff00") as Record<string, string>;
    expect(v["--doc-ink"]).toBe(documentTheme("#ffff00")!.ink);
    expect(v["--doc-ink"]).not.toBe("#ffff00");
  });

  it("passes a colour that already reads on paper straight through", () => {
    const v = themeVars("#004885") as Record<string, string>;
    expect(v["--doc-ink"]).toBe("#004885");
  });

  /* `--doc-*`, not `--brand-*`: these reach documents only, and a token named
     for the brand would eventually be reached for inside `.fg`, which is the
     one place the rules say a customer's colour must never go. */
  it("names every variable for the document, not for the brand", () => {
    for (const k of Object.keys(themeVars("#004885"))) {
      expect(k.startsWith("--doc-")).toBe(true);
    }
  });

  /* THE GEOMETRY TRAVELS WITH THE COLOUR, and this is the guard for the half
     of it that got missed. The band needs the sheet padded clear of it, and
     that padding was written into the stylesheets as a constant — so it
     applied to every document, and an org that had set no colour silently
     gained 22mm of white space at each end. A document this design promised
     not to touch.

     The fix is that the depth ships through the same object as the colour, so
     the two cannot get out of step. Which makes the claim testable: no colour,
     no variables of ANY kind. */
  it("sets no geometry either when there is no colour", () => {
    expect(themeVars(null)).toEqual({});
    expect(themeVars("not a colour")).toEqual({});
  });

  it("ships the band's depth and its clearance alongside the colour", () => {
    const v = themeVars("#004885") as Record<string, string>;
    expect(Object.keys(v).sort()).toEqual(
      ["--doc-band", "--doc-gutter", "--doc-ink", "--doc-pad", "--doc-radius"]
    );
    // the shell's own 30px corner at 96dpi, carried across as a measurement
    expect(v["--doc-radius"]).toBe("7.94mm");
    // and the depth at the page edge is gutter + radius, because the well's
    // corner is what carves the middle away
    expect(v["--doc-band"]).toContain(v["--doc-gutter"]);
    expect(v["--doc-band"]).toContain(v["--doc-radius"]);
  });
});
