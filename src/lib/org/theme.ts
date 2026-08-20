/* THE DOCUMENT THEME — a business's brand colour, made safe to print on.

   WHY THIS IS A FUNCTION AND NOT A SETTING. Every contrast guard in this repo
   (app/dashboard/__tests__/text-contrast, studio/__tests__/palette-contrast,
   dashboard/__tests__/home-card-contrast) works the same way: read the
   stylesheet off disk and scan it. That can only ever see colours a developer
   typed. A colour a customer picks arrives at runtime, so not one of those
   guards can see it — by construction, not by oversight.

   So the seed colour is NEVER USED RAW. A business picks one colour; this
   derives the roles a document is allowed to paint with, each one pushed until
   it MEASURES against the ground it will actually sit on. Contrast becomes a
   property of this function, which is testable, instead of a property of what
   somebody chose in a colour picker, which is not.

   Pure module — no I/O, no React, no tokens — so the client components that
   print can import it, same constraint as brand.ts.

   THREE RULES THIS MODULE EXISTS TO KEEP:

   1. THE BRAND COLOUR NEVER TOUCHES STATE. ok #00A389 and danger #e0264f are
      fixed and are not exported from here. A business with a red brand must
      not make "paid" read as "overdue" — semantic state is never the accent.

   2. THE BRAND COLOUR NEVER TOUCHES APP CHROME. The dashboard is HeyTiff's
      product; the documents are the business's. Nothing in here is for `.fg`.

   3. PRINT IS ITS OWN BUDGET. `ink` and `rule` are nearly free on paper.
      `ink` used as a large FILL is not, and a browser drops backgrounds unless
      told otherwise — a surface using it that way owes a print-color-adjust. */

/** The paper every one of these documents is printed on. */
const PAPER: RGB = [255, 255, 255];

/** The documents' own body ink — the literal in letterhead.css and in the
    handover sheet's stylesheet. `wash` is derived to carry THIS, so if that
    value ever moves, this moves with it or the wash quietly stops passing. */
const DOC_INK: RGB = [0x16, 0x18, 0x1d];

/** WCAG 2.1 AA: 4.5:1 for body text, 3:1 for a boundary that carries meaning. */
const TEXT_FLOOR = 4.5;
const GRAPHIC_FLOOR = 3;

/** How far a wash is mixed into the paper before legibility is even asked
    about — see the note in `documentTheme`. Not a contrast number and not
    derived from one: it is what makes a tint a tint rather than a fill. */
const TINT_FLOOR = 0.88;

type RGB = readonly [number, number, number];

/** What a document may paint with. Three roles, because there are only three
    distinct EQUATIONS — see `documentTheme`. */
export type DocumentTheme = {
  /** The brand colour as text on paper, and as a fill under white text. Both
      readings are the same equation, so they are deliberately the same value:
      a heading and a block in "the brand colour" that disagreed would be two
      brand colours. */
  ink: string;
  /** A tint pale enough to lay the document's own near-black ink on top of. */
  wash: string;
  /** Hairlines and boundaries. Never darker than `ink`, and lighter whenever
      the seed had to travel to reach the text floor — a colour that already
      cleared both floors is simply itself in both roles, which is right: it is
      the brand colour, and nothing asked for two of them. */
  rule: string;
};

/* ── colour maths ─────────────────────────────────────────────────────────
   The WCAG formulae themselves, not an approximation of them: the whole
   design is "measure the thing the standard measures", so measuring something
   adjacent would defeat the point. */

const toLinear = (c: number): number => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

const toSrgb = (l: number): number => {
  const s = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(s * 255)));
};

const luminance = (c: RGB): number =>
  0.2126 * toLinear(c[0]) + 0.7152 * toLinear(c[1]) + 0.0722 * toLinear(c[2]);

/** WCAG contrast ratio. Order-independent, as the standard's is. */
export function contrast(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return la > lb ? (la + 0.05) / (lb + 0.05) : (lb + 0.05) / (la + 0.05);
}

/** `#rgb` or `#rrggbb`, with or without the hash. Null for anything else —
    a caller with a bad value renders the unthemed document rather than
    throwing inside a print path. */
export function parseHex(input: string): RGB | null {
  const s = input.trim().replace(/^#/, "");
  const full = s.length === 3 ? s.replace(/./g, (d) => d + d) : s;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

const toHex = (c: RGB): string =>
  "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");

/* DARKENING SCALES IN LINEAR LIGHT, and that is the one interesting choice in
   this file. Multiplying the linear channels by k multiplies luminance by
   EXACTLY k — luminance is linear in linear-RGB — so the search below is
   strictly monotonic, and chromaticity is untouched: the ratios between the
   channels do not move, so the hue and the saturation survive being darkened.

   Doing this in sRGB instead would drag colours toward grey as they darken,
   which is how a brand colour becomes a brand-ish colour. The trap is already
   written down in this repo from the other direction: `hsl(H s 52%)` is not a
   fixed perceived lightness, and a hashed avatar built on that ran 1.52–6.9:1. */
const darken = (c: RGB, k: number): RGB =>
  [toSrgb(toLinear(c[0]) * k), toSrgb(toLinear(c[1]) * k), toSrgb(toLinear(c[2]) * k)] as const;

/* Lightening mixes toward white in sRGB, deliberately NOT in linear light: a
   tint is supposed to lose chroma as it approaches paper, and linear-light
   mixing holds saturation so hard that a pale wash comes out fluorescent. */
const lighten = (c: RGB, t: number): RGB =>
  [
    Math.round(c[0] + (255 - c[0]) * t),
    Math.round(c[1] + (255 - c[1]) * t),
    Math.round(c[2] + (255 - c[2]) * t),
  ] as const;

/* Find the least modification that still clears the floor.

   THE SEARCH RUNS ON QUANTISED VALUES, which is the detail that makes this
   safe: `apply` rounds to 8-bit before `passes` ever sees the colour, so every
   ratio measured here is measured on the exact hex that ships. There is no
   float that clears 4.5 and a rounded hex underneath it that does not — the
   usual way a contrast guard passes while the artefact fails.

   (An earlier version walked the quantised result upward after the search, to
   cover exactly that. It was dead code: `apply` already quantises, so the walk
   returned the search's own answer on its first iteration every time. Removing
   it changed no test, which is the only reason to believe it did nothing.)

   `amount` runs 0 → 1 as "more modification", so both roles search the same
   direction and termination is provable: at 1 the value is black (for darken)
   or white (for lighten), and both of those clear every floor used here. */
function leastChange(
  apply: (amount: number) => RGB,
  passes: (c: RGB) => boolean
): RGB {
  if (passes(apply(0))) return apply(0);

  let lo = 0; // known to fail
  let hi = 1; // known to pass: at 1 the value is black (darken) or white
  //            (lighten), which are 21:1 on paper and ~16:1 under DOC_INK
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (passes(apply(mid))) hi = mid;
    else lo = mid;
  }
  return apply(hi);
}

/** The roles a document may paint with, derived from the business's one
    chosen colour. Null when the colour cannot be read, which every caller
    should treat as "no theme" — the unthemed document is always a valid
    document, and is exactly what every org gets today. */
export function documentTheme(seed: string): DocumentTheme | null {
  const rgb = parseHex(seed);
  if (!rgb) return null;

  /* `ink` and `wash` search in opposite directions from the same seed, and
     `rule` is `ink`'s equation at the graphic floor — which is why it lands
     lighter, not by being told to. */
  const ink = leastChange(
    (k) => darken(rgb, 1 - k),
    (c) => contrast(c, PAPER) >= TEXT_FLOOR
  );
  const rule = leastChange(
    (k) => darken(rgb, 1 - k),
    (c) => contrast(c, PAPER) >= GRAPHIC_FLOOR
  );
  /* THE WASH STARTS AT THE TINT FLOOR, and does not get to skip it.

     Every other role here follows "least change", because for those, staying
     close to the chosen colour is the goal and legibility is the constraint.
     For a wash it is the other way round: a wash IS a pale tint, and 4.5:1 is
     a floor rather than a target.

     Least change alone got this wrong in a way no contrast test could catch.
     A light seed already carries DOC_INK — #ffff00 under #16181d measures
     16:1 — so the search stopped at t=0 and the "wash" was the raw brand
     colour. Rendered, the panel on a handover sheet was a full sheet of
     highlighter yellow. Legible, passing, and not something anyone would send
     a customer. It took drawing the document to see it.

     So the search runs over the range ABOVE the floor: t=0 is a colour already
     mixed 88% into the paper, and the seed itself is no longer reachable. */
  const wash = leastChange(
    (t) => lighten(rgb, TINT_FLOOR + (1 - TINT_FLOOR) * t),
    (c) => contrast(DOC_INK, c) >= TEXT_FLOOR
  );

  return { ink: toHex(ink), wash: toHex(wash), rule: toHex(rule) };
}

/** The grounds and floors, exported for the guard that proves the derivation
    — a test that restated them could agree with itself while disagreeing with
    the code. */
export const THEME_CONTRACT = {
  PAPER,
  DOC_INK,
  TEXT_FLOOR,
  GRAPHIC_FLOOR,
  TINT_FLOOR,
} as const;
