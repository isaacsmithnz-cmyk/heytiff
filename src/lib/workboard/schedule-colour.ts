/* What colour a Schedule block is, and what colour its words are — the one
   decision on that tab that is wrong in a way nobody notices until they are
   squinting at a screen in a ute. Pure, so jest can hold it still (the
   schedule.ts / schedule-query.ts split, applied to paint).

   SERVICEM8 PICKS ITS CATEGORY COLOURS TO SIT BEHIND BLACK TEXT. They arrive
   around 85% lightness — a wash, not an accent. The first cut of this tab
   took that hex, knocked it to 50% alpha (landing it near white) and then
   added a 4px bar to recover the hue the fill had lost. The bar was computed
   by multiplying each channel by 0.55, and multiplying RGB darkens TOWARD
   GREY: a lilac category and a blue one both came out slate, and from a metre
   away the whole rail was one colour.

   So take the HUE and rebuild the swatch, rather than pushing the pixel
   around. Floor the saturation (the pale pick carries almost none), then walk
   lightness DOWN from a true mid until white measurably clears 4.5:1 against
   the result. The text colour is not a search result here — it is white on
   every block, and the fill is what moves to earn it, so the rail reads as one
   thing instead of a row that disagrees with itself. The 4px bar retires
   because the fill is doing its job.

   AND NOT `opacity` FOR THE CLOSED ONES. A finished block used to be
   `opacity:.58`, which is de-emphasis by arithmetic: over a saturated fill it
   drags the label toward the ground behind it. `pale` is a stated colour with
   its own measured ink — a closed block reads BETTER than a live one, which
   is the right way round for something you may still need to read. */

/** Relative luminance, sRGB. The one piece of arithmetic everything else here
    is asking a question about. */
function luminance(rgb: readonly [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast between two colours, either order. */
export function contrastRatio(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** '#abc' | '#aabbcc' | '#aabbccdd' → channels. Alpha is DROPPED, not
    composited: these blocks sit on white and an alpha we quietly multiplied
    in would be the old bug in a new place. Null for anything else. */
function channelsOf(hex: string): [number, number, number] | null {
  const s = hex.trim().replace(/^#/, "").toLowerCase();
  if (!/^([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(s)) return null;
  const full = s.length === 3 ? s.replace(/./g, (c) => c + c) : s;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function toHsl(rgb: readonly [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb.map((v) => v / 255) as [number, number, number];
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  const l = (mx + mn) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return [(h + 360) % 360, s, l];
}

function toRgb(h: number, s: number, l: number): [number, number, number] {
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
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

const css = (rgb: readonly [number, number, number]) => `rgb(${rgb.join(", ")})`;

/** `t` of the way from `a` to `b`. */
function mix(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number
): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

const WHITE: [number, number, number] = [255, 255, 255];
/** The sheet's --ink. Written out because this file has no cascade to read. */
const INK: [number, number, number] = [10, 11, 16];
/** AA for the block's smallest line, which is 10.5px — so the whole label. */
const AA = 4.5;

/** How a block is painted. Every value is a plain CSS colour: the component
    hands them straight to custom properties and the sheet does the rest. */
export type BlockPaint = {
  /** A booking still in play — the category's hue at full strength. */
  fill: string;
  /** The label on `fill`. Always white for a category — the fill is darkened
      until white clears 4.5:1 rather than the label switching to suit the hue.
      Named `ink` because it is the block's text colour, not because it is. */
  ink: string;
  /** The job-number chip's own ground. It sits ON the fill and under the same
      label, so it has to move AWAY from it — the obvious tint (a wash of the
      text colour) walks the chip toward its own words and takes them under
      4.5:1, which is the whole bug this module exists to stop. */
  chip: string;
  /** Finished and closed. Always takes ink, and by a wide margin. */
  pale: string;
  /** The closed block's own hairline, so it keeps an edge once it recedes. */
  paleEdge: string;
};

/** No category, or a colour ServiceM8 gave us that we cannot read. Grey, and
    deliberately the same grey the rest of the board uses for "unset". */
export const NO_CATEGORY_PAINT: BlockPaint = {
  fill: "rgb(226, 228, 233)",
  ink: "rgb(10, 11, 16)",
  chip: "rgb(243, 244, 246)",
  pale: "rgb(244, 245, 247)",
  paleEdge: "rgb(219, 222, 228)",
};

/** Where the search for a usable fill starts: a true mid, the most saturated
    a hue gets. It only ever walks DOWN from here — see `scheduleBlockPaint`. */
const START_L = 0.55;
/** How far down it will go. Every real hue clears white long before this;
    the floor exists so the loop is bounded rather than trusting arithmetic. */
const FLOOR_L = 0.12;
/** ServiceM8's washes carry almost no chroma; below this a "colour" is grey. */
const MIN_SATURATION = 0.55;

/**
 * The paint for one category colour. `hex` is ServiceM8's own value, already
 * sanitised by `sm8CategoryColour`; null (or unreadable) gets the grey pair.
 */
export function scheduleBlockPaint(hex: string | null | undefined): BlockPaint {
  const raw = typeof hex === "string" ? channelsOf(hex) : null;
  if (!raw) return NO_CATEGORY_PAINT;

  const [h, s0] = toHsl(raw);
  const s = Math.max(s0, MIN_SATURATION);

  /* Closed work: same hue, most of the way to white, chroma pulled back so a
     row of finished jobs reads as one quiet band rather than a pastel
     rainbow. Ink on this runs 13–15:1 for every hue ServiceM8 can hand us,
     so there is nothing to search for — but the test measures it anyway. */
  const pale = css(toRgb(h, Math.min(s, 0.62), 0.92));
  const paleEdge = css(toRgb(h, Math.min(s, 0.55), 0.82));

  /* WHITE ON EVERY BLOCK. The first cut took whichever of white or ink cleared
     at a true mid, and that made the rail's text colour a property of the hue:
     purple and blue came out white, mint and yellow came out ink. Both were
     legible and the board still looked like two designs, because a row of
     blocks that disagree about their text colour reads as an accident rather
     than a rule.

     So pick the text first and let the fill move: hold the hue and walk
     lightness down until WHITE clears 4.5:1 against it. Darkening always gets
     there, so every category ends up white-on-colour and the rail is one
     thing. What it costs is lightness on the bright hues — a mint that was
     #4dcb7b becomes a deep #27864a, and a pale yellow becomes an olive. That
     is the trade: hue fidelity for a rail that reads as one system. The
     category is written on the block in words, so the hue was never carrying
     the meaning on its own. */
  for (let l = START_L; l >= FLOOR_L; l -= 0.01) {
    const rgb = toRgb(h, s, l);
    if (contrastRatio(rgb, WHITE) >= AA) {
      return {
        fill: css(rgb),
        ink: css(WHITE),
        // away from the label, which is now always white — so always darker
        chip: css(mix(rgb, INK, 0.24)),
        pale,
        paleEdge,
      };
    }
  }
  /* Unreachable: at the floor every hue is dark enough for white by a wide
     margin. Kept so the function is total rather than nearly total. */
  const last = toRgb(h, s, FLOOR_L);
  return { fill: css(last), ink: css(WHITE), chip: css(mix(last, INK, 0.24)), pale, paleEdge };
}
