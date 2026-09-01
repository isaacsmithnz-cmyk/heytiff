/* The brand, as values Auth0 can be told.

   WHY THIS FILE IS ALLOWED TO EXIST. Every colour here is already written
   down — in `app/globals.css` (@theme) and `app/dashboard/shell.css` (.fg).
   A second copy of a palette is normally how two palettes get born. It is
   copied anyway because the thing being coloured is NOT this app: Auth0
   renders the sign-in widget on its own domain and an email client renders
   the mail, and neither can read a stylesheet of ours. They take hex, over
   an API, or not at all.

   THE COPY IS NOT TRUSTED — IT IS CHECKED. `__tests__/palette.test.ts`
   parses both stylesheets and asserts every value below still matches the
   token it claims to be. Re-point `--q` in shell.css without coming here and
   the suite fails by name. That test is the only reason this file is safe.

   AA IS ALREADY DECIDED, UPSTREAM. shell.css carries a long measured
   argument about which greys and which teals clear 4.5:1 and on what grounds
   (`--q`, `--gray500`, the whole `-t` family). None of that is re-litigated
   here: this file picks from those tokens, it does not invent a shade. If a
   colour is wanted that no token supplies, the token is what needs adding. */

/** Ink, greys and state — the values, keyed by the CSS token they come from.
    The comment on each names where it is written down, because that is the
    file the test reads. */
export const BRAND = {
  /* globals.css @theme */
  /** --color-brand-teal — the primary accent. Screen only, never words. */
  teal: "#00E5C0",
  /** --color-brand-teal-dark — teal at display size on light (3.2:1, so
      large/bold text and graphics only; it is the "Tiff" of the wordmark). */
  tealDark: "#00A389",
  /** --color-brand-blue — the far end of the mark's gradient. */
  blue: "#2E68FF",
  /** --color-ink-2 — headings, and the primary button's ground. */
  ink: "#0A0B10",
  /** --color-surface — the app's page ground, and the sign-in page's. */
  surface: "#F0F2F5",
  /** --color-surface-line — card hairline. */
  line: "#F0F0F2",

  /* shell.css .fg */
  /** --gray700 — body text (9.4:1 on white). */
  body: "#374151",
  /** --q — the ONE quiet tier; the lightest grey that clears AA on every
      ground this app puts it over. Labels and placeholders. */
  quiet: "#5F6A79",
  /** --ok-t — success AS WORDS. A state colour, never the accent. */
  okText: "#00735F",
  /** --bad-t — danger AS WORDS. */
  badText: "#C81A41",
} as const;

/** White, named, because "widget background" and "button label" are two
    different decisions that happen to share a value. */
export const WHITE = "#FFFFFF";

/* THE INPUT BORDER IS THE ONE COMPUTED VALUE.

   The app draws it as `rgba(10,11,16,.14)` — an alpha over whatever is
   behind. Auth0's theme API takes hex and nothing else, so the app's rule is
   flattened onto the only ground the widget ever has (white):

     255 + (channel - 255) x 0.14

   Written as arithmetic rather than as a magic hex so the next person can
   see it is the app's border and not a grey somebody liked. The test
   re-derives it from the same rule. */
export const inputBorderOnWhite = flattenOnWhite(BRAND.ink, 0.14);

export function flattenOnWhite(hex: string, alpha: number): string {
  const ch = (i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const mix = (c: number) => Math.round(255 + (c - 255) * alpha);
  return (
    "#" +
    [0, 1, 2]
      .map((i) => mix(ch(i)).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

/** The mark's gradient, as the two stops every renderer of it uses.
    Kept beside the palette because an email cannot draw it — it links the
    PNG instead — and the page template can. */
export const MARK_GRADIENT = [BRAND.teal, BRAND.blue] as const;
