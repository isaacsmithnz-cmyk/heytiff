import type { CSSProperties } from "react";

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

   3. PRINT IS ITS OWN BUDGET, and the band spends it. `ink` is a FILL, which
      a browser drops unless told otherwise, so the surfaces painting it owe a
      print-color-adjust. Measured on the treatment we shipped it covers 3.29%
      of an A4 sheet — against 13.3% for the letterhead band that carried the
      logo, which is the version this one replaced. */

/** The paper every one of these documents is printed on. */
const PAPER: RGB = [255, 255, 255];

/** WCAG 2.1 AA body-text contrast. The band is decoration and is not held to
    this by the standard — it is held to it here so a pale brand colour still
    produces a band you can see on white paper. */
const TEXT_FLOOR = 4.5;

type RGB = readonly [number, number, number];

/** What a document may paint with. ONE role, because the treatment turned out
    to need one: the band at the head and foot of the sheet carries nothing —
    no text, no logo — so `ink` is the only value any surface asks for.

    `wash` and `rule` were here and are gone. They were derived for a design
    that put the brand colour into panel fills and section rules, which is the
    design we did not build: the band replaced it precisely to keep the colour
    away from text and away from every contrast question that follows. Roles
    kept "in case" are how a palette rots. */
export type DocumentTheme = {
  /** The brand colour, darkened only as far as it must be to clear 4.5:1 on
      paper. The band is decorative and WCAG asks nothing of it, but the floor
      is kept anyway: it is what stops a business that picks pale yellow from
      printing a band nobody can see. */
  ink: string;
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
   direction and termination is provable: at 1 the value is black, which clears
   the floor against paper by a mile. */
function leastChange(
  apply: (amount: number) => RGB,
  passes: (c: RGB) => boolean
): RGB {
  if (passes(apply(0))) return apply(0);

  let lo = 0; // known to fail
  let hi = 1; // known to pass: at 1 the value is black, 21:1 on paper
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
  return {
    ink: toHex(
      leastChange(
        (k) => darken(rgb, 1 - k),
        (c) => contrast(c, PAPER) >= TEXT_FLOOR
      )
    ),
  };
}

/* HOW A DOCUMENT RECEIVES THE THEME, and why it is variables rather than
   inline colours on every element.

   EVERY DOCUMENT GETS THE BAND. A business that has chosen no colour gets it
   in the ink the sheet already prints in, so the treatment is part of the
   document rather than a reward for visiting a settings page. Setting a colour
   changes what the band is, never whether there is one.

   That is a deliberate reversal. This used to return an EMPTY object with no
   colour, so an unthemed sheet was byte-for-byte the one it had always been —
   safe, and it meant most orgs never saw the design at all.

   THE GEOMETRY TRAVELS WITH THE COLOUR, and that is not decoration. The band
   takes space: the sheet has to be padded clear of it, and the two must never
   disagree. Written into the stylesheets as a constant, the padding once
   applied to every document while the band did not — 22mm of white space at
   each end of a sheet with nothing at the top of it. Shipping both through
   this one object is what makes that impossible.

   The names are `--doc-*` and not `--brand-*`: these reach documents only. The
   app's own chrome must never resolve them, and a token called `--brand-ink`
   would eventually be reached for inside `.fg` by someone reading the name
   rather than this comment.

   A `import type` only — this stays a pure module with no runtime React, so
   the client components that print can still import it. The cast is needed
   because React types custom properties as unknown keys. */
export function themeVars(seed: string | null): CSSProperties {
  const t = seed ? documentTheme(seed) : null;
  return {
    "--doc-ink": t ? t.ink : BAND.default,
    "--doc-gutter": BAND.gutter,
    "--doc-radius": BAND.radius,
    "--doc-band": `calc(${BAND.gutter} + ${BAND.radius})`,
    /* what the SHEET must pad to clear the band. Computed here rather than in
       CSS because `calc(var(--doc-band, 0px) + 6mm)` is 6mm when the variable
       is absent, not 0 — and 6mm of new white space on every unthemed document
       is exactly the bug this object exists to prevent. */
    "--doc-pad": `calc(${BAND.gutter} + ${BAND.radius} + ${BAND.clear})`,
  } as CSSProperties;
}

/* THE BAND'S GEOMETRY, in one place because three stylesheets draw it.

   `radius` is the app shell's own corner, converted rather than guessed:
   `.fg .outlet` is `border-radius: 40px 30px 30px 30px`, and 30px at 96dpi is
   7.94mm. It is a LITERAL match, not a proportional one — the same measurement
   is a bigger corner on paper (30px is 2.08% of a 1440px viewport and 3.78% of
   a 210mm page) and that is the intended reading, because a radius is an
   absolute token here and this one has to survive being printed at A5 or A3.

   `gutter` is the band's depth across the middle of the page, and is NOT the
   shell's 4.23mm (its 16px): at that figure the band read as a hairline on a
   sheet this size. Its depth at the page edge is gutter + radius, because the
   well's corner is what carves the middle away. */
const BAND = {
  gutter: "16mm",
  radius: "7.94mm",
  /** breathing room between the band and the first line of the document */
  clear: "6mm",
  /* THE DEFAULT BAND, for a business that has chosen no colour.

     Not #000000. This is the ink the letterhead and the handover sheet already
     print their headings in, so the band reads as part of the document instead
     of as a black bar laid on top of one. Pure black matches nothing else on
     these sheets — the design sheet's own body ink is #050505 and the
     handover sheet's is this — and on a solid 24mm band the difference between
     black and near-black is the difference between a funeral notice and a
     letterhead.

     It is also the one value to change if true black is ever wanted. */
  default: "#16181d",
} as const;

/** The grounds and floors, exported for the guard that proves the derivation
    — a test that restated them could agree with itself while disagreeing with
    the code. */
export const THEME_CONTRACT = {
  PAPER,
  TEXT_FLOOR,
} as const;
