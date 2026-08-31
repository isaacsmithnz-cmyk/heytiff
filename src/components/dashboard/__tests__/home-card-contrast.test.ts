import { readFileSync } from "fs";
import { join } from "path";

/* THE QUIET TEXT ON HOME'S CARD STAYS READABLE.

   THE CARD IS DAYLIGHT NOW (Isaac, 2026-08-30). It was smoked glass, and the
   six labels below were measured as WHITE-alpha steps against it. The ground
   flipped; the failure mode flipped with it, and this suite had to be
   re-derived rather than deleted — the labels are still the smallest type on
   the screen, which is still where a guess costs the most.

   What replaces "is the white bright enough" is "is the grey dark enough",
   plus a new guard the ink version never needed: NO WHITE TEXT MAY SURVIVE on
   a light card. That is the exact bug this conversion could leave behind, and
   it is invisible in jsdom.

   The original reasoning, kept because it is the same argument:

   Six labels on that card were set by eye and every one came out under AA —
   the section headings at 3.29, the day labels at 3.48, the entry times at
   3.68, the Calendar's weekday header at 3.01 and its month tags at 3.16,
   with the chip rows' subject line scraping a pass at 4.56. They are also the
   smallest type on the screen (9.5–12.5px), which is where a guess costs the
   most.

   EYEBALLING FAILED FOR A REASON, and it is worth knowing before changing any
   of this: the card has no single ground. It is `--hm-ink` over a
   BACKDROP-BLUR of the well, and Home's well carries three coloured washes, so
   the same rgba paints anywhere from rgb(38,45,51) to rgb(45,48,54) depending
   where on the page the card sits. A value that looks fine over the teal wash
   can fail over plain daylight.

   So the maths is done here rather than in someone's eye, against the
   LIGHTEST ground the card can have — itself over pure white. Pass there and
   it passes everywhere on the well.

   This reads the STYLESHEET, not a render: jsdom performs no layout and
   computes no composite, so nothing at runtime can see this. Verified by
   measuring all 126 text elements across the six tabs in a browser; the two
   assertions below are what stops it drifting back. */

const CSS = join(__dirname, "..", "..", "..", "app", "dashboard", "shell.css");

/** WCAG relative luminance. */
function luminance([r, g, b]: number[]): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** `fg` painted onto `bg`, honouring fg's alpha. */
function over(fg: number[], bg: number[]): number[] {
  const a = fg[3] ?? 1;
  return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
}

function contrast(a: number[], b: number[]): number {
  const [hi, lo] = luminance(a) > luminance(b) ? [luminance(a), luminance(b)] : [luminance(b), luminance(a)];
  return (hi + 0.05) / (lo + 0.05);
}

/** The rgba(...) a custom property is declared as. */
function token(css: string, name: string): number[] {
  const m = new RegExp(`${name}\\s*:\\s*rgba?\\(([^)]+)\\)`).exec(css);
  if (!m) throw new Error(`${name} is not declared in shell.css`);
  return m[1].split(",").map((n) => Number(n.trim()));
}

/** Rules whose selector matches, with their declarations. */
function declarationsFor(css: string, test: (selector: string) => boolean): string {
  let out = "";
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (test(m[1].trim().replace(/\s+/g, " "))) out += m[2] + ";";
  }
  return out;
}

/** `#rrggbb`, or the rgba(...) a custom property is declared as. */
function colour(css: string, name: string): number[] {
  const rgba = new RegExp(`${name}\\s*:\\s*rgba?\\(([^)]+)\\)`).exec(css);
  if (rgba) return rgba[1].split(",").map((n) => Number(n.trim()));
  const hex = new RegExp(`${name}\\s*:\\s*#([0-9a-f]{6})`, "i").exec(css);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
  throw new Error(`${name} is not declared in shell.css`);
}

describe("Home's card", () => {
  const css = readFileSync(CSS, "utf8");

  it("keeps its quiet text above AA on the darkest ground the card can have", () => {
    /* The card is `--hm-ink` — a white glass — over the well, and the well is
       `#EDEFF4` with three coloured washes on it. For DARK text the hardest
       case is the darkest the card can paint, which is the card over the
       well's own base rather than over white. Pass there and it passes
       wherever on the page the card sits. */
    const card = colour(css, "--hm-ink");
    const quiet = colour(css, "--q");

    const ground = over(card, [237, 239, 244]);
    const ratio = contrast(over(quiet, ground), ground);

    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("leaves no white text sitting on the light card itself", () => {
    /* THE BUG THIS CONVERSION COULD LEAVE. Every one of these rules used to
       be correct — white on smoked glass — and each is invisible now. jsdom
       computes no colour, so only reading the sheet can catch a straggler.

       WHITE IS STILL ALLOWED ON SOMETHING THAT BRINGS ITS OWN GROUND: the
       debrief's button is a teal-to-blue gradient and its label must be
       white. So the test is not "no white on Home" — it is "no white on a
       rule that paints no background of its own", which is exactly the rule
       whose ground is the card. */
    const offenders: string[] = [];
    for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selector = m[1].trim().replace(/\s+/g, " ");
      const decls = m[2];
      const onTheCard =
        /\.hm-(card|jr|jrs|jrt|jro|jd|jdh|none|adde|dbf)/.test(selector) &&
        !selector.includes(".hm-cal");
      if (!onTheCard) continue;
      const white = /color\s*:\s*(#fff\b|rgba\(255,\s*255,\s*255)/.test(decls);
      const bringsItsOwnGround = /background(-color|-image)?\s*:/.test(decls);
      if (white && !bringsItsOwnGround) offenders.push(selector);
    }
    expect(offenders).toEqual([]);
  });

  /* The token only helps while it is the thing being used. Each of these was
     a hand-picked rgba that measured under AA; a new one appearing here is
     the same mistake with a different number. */
  it.each([
    [".hm-card .wb2-sect", "section headings"],
    [".hm-jd:not(.first) .hm-jdh > span", "older day labels"],
    [".hm-jrt", "entry times"],
    [".hm-rmain em", "row subject lines"],
    [".hm-card .wb2-mcdow", "the Calendar's weekday header"],
    [".hm-card .wb2-mcn em", "the Calendar's month tags"],
  ])("uses the measured step for %s (%s)", (selector) => {
    const decls = declarationsFor(css, (s) => s.includes(selector));
    expect(decls).toContain("var(--hm-quiet)");
    /* and not a literal alongside it — a rule can carry both, and the last
       one written is the one that paints */
    expect(decls).not.toMatch(/color\s*:\s*rgba\(\d/);
  });
});
