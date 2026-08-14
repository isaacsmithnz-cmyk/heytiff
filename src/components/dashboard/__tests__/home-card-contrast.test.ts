import { readFileSync } from "fs";
import { join } from "path";

/* THE QUIET TEXT ON HOME'S INK CARD STAYS READABLE.

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

describe("Home's ink card", () => {
  const css = readFileSync(CSS, "utf8");

  it("keeps its quiet text above AA on the lightest ground it can have", () => {
    const ink = token(css, "--hm-ink");
    const quiet = token(css, "--hm-quiet");

    /* The card over pure white — brighter than any real point on the well,
       so this is the hardest case for white text and a safe bound. */
    const ground = over(ink, [255, 255, 255]);
    const ratio = contrast(over(quiet, ground), ground);

    expect(ratio).toBeGreaterThanOrEqual(4.5);
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
    expect(decls).not.toMatch(/color\s*:\s*rgba\(255,\s*255,\s*255,\s*\.[0-4]?\d\)/);
  });
});
