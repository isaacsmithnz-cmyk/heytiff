/* What colour a Schedule block is, and what colour its words are — the one
   decision on that tab that is wrong in a way nobody notices until they are
   squinting at a screen in a ute. Pure, so jest can hold it still (the
   schedule.ts / schedule-query.ts split, applied to paint).

   SERVICEM8 PICKS ITS CATEGORY COLOURS TO SIT BEHIND BLACK TEXT. They arrive
   around 85% lightness — a wash, not an accent. Two treatments have now been
   tried on that fact and both failed in the same direction: at 50% alpha the
   wash landed near white and lost its hue, so a 4px bar was added to recover
   it — and the bar multiplied each channel by 0.55, which darkens toward GREY,
   so a lilac category and a blue one both came out slate. Then the fill was
   rebuilt from the hue at FULL chroma and walked down until white cleared
   4.5:1, which fixed the greyness and created a worse problem: every category
   shipped at 1.00 saturation while the board's own alarm colour sits at 0.75.
   A pale pink Service Call came out rgb(235, 0, 0). Ordinary work was painted
   louder than the exception, and a completed job the crew were returning to
   read as an emergency.

   SO THE FILL STOPS CARRYING THE HUE. The block is a near-white wash of its
   category with ink on it, and the hue moves to a 4px cap on the leading edge.
   The wash cannot be an alarm — it is 94% light by construction, for every hue
   ServiceM8 can invent — so the loudest thing on the rail is once again the
   thing that is actually wrong. Ink on the wash measures 16:1 at worst, against
   the 4.7:1 the saturated fill managed.

   AND THE CAP WALKS, BECAUSE A FIXED LIGHTNESS IS NOT A FIXED CONTRAST. The
   first cut pinned the cap at L=0.42 and measured it: purple cleared its wash
   6.12:1 and yellow-green cleared it 2.22:1, because HSL lightness is not
   perceived lightness. So the cap does what the fill used to do — hold the hue
   and walk down until it measures 3:1 against its own wash. Green and yellow
   end up darker than blue and purple, which is exactly right and is not
   something an eye would have caught on a screenshot.

   AND A COLOUR WITH NO HUE KEEPS NONE. Flooring the saturation of something
   that is already grey does not rescue a wash, it fabricates a hue — see
   MIN_SOURCE_CHROMA. Those fall to the neutral pair instead.

   AND A CLOSED JOB KEEPS NO HUE EITHER. `pale` used to be the category at 92%
   lightness, which under a 94% wash is the same colour twice: done work and
   live work became indistinguishable at a glance. Finished work is neutral
   now, and carries no cap — colour on this rail means "still to do". */

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

/** The sheet's --ink. Written out because this file has no cascade to read. */
const INK: [number, number, number] = [10, 11, 16];

/** How a block is painted. Every value is a plain CSS colour: the component
    hands them straight to custom properties and the sheet does the rest. */
export type BlockPaint = {
  /** The block's ground — a near-white wash of the category's hue. It is the
      one value here that is guaranteed not to be able to shout: 94% light for
      every hue there is. */
  fill: string;
  /** The label on `fill`. Ink on every block, because every ground is a wash —
      the rail's text colour is a rule, not a property of the category. */
  ink: string;
  /** The job-number chip's own ground: a deeper step of the same wash, so it
      reads as a patch on the block rather than a second colour. */
  chip: string;
  /** The 4px cap on the leading edge — where the category's hue actually lives
      now. Walked down until it clears 3:1 against `fill`, so it is legible as
      a graphic for every hue rather than only the dark half of the wheel. */
  bar: string;
  /** Finished and closed. NEUTRAL, and the same neutral for every category:
      colour on this rail means work still to do. */
  pale: string;
  /** The closed block's own hairline, so it keeps an edge once it recedes. */
  paleEdge: string;
};

/** Finished work, whatever it was. Stated once, here, because every category
    closes to the same neutral — see the header. */
const DONE_PALE = "rgb(244, 245, 247)";
const DONE_EDGE = "rgb(219, 222, 228)";

/** No category, or a colour ServiceM8 gave us that we cannot read. Grey, and
    deliberately the same grey the rest of the board uses for "unset". */
export const NO_CATEGORY_PAINT: BlockPaint = {
  fill: "rgb(244, 245, 247)",
  ink: "rgb(10, 11, 16)",
  chip: "rgb(226, 228, 233)",
  bar: "rgb(122, 129, 140)",
  pale: DONE_PALE,
  paleEdge: DONE_EDGE,
};

/** A job promoted onto one of our boards leaves the category palette for the
    tracked blue — the All jobs rows' chip, at block weight. STATED, not
    derived: this hue is ours and never arrives from ServiceM8. It lives here
    beside the other paints because three surfaces now draw it — the rail, the
    focus card and the capacity day — and a fourth copy is a fourth chance to
    drift. */
export const TRACKED_PAINT: BlockPaint = {
  fill: "rgb(231, 244, 248)",
  ink: "rgb(10, 11, 16)",
  chip: "rgb(201, 228, 237)",
  /* the ONE cap that is not derived: this hue is ours, and it clears its own
     wash 5.43:1 without needing to be walked anywhere */
  bar: "rgb(0, 106, 140)",
  pale: DONE_PALE,
  paleEdge: DONE_EDGE,
};

/** The wash: light enough that no hue can arrive as an alarm, saturated enough
    that the category is still nameable at a glance. */
const WASH_L = 0.94;
const WASH_S = 0.55;
/** The number chip — the same wash, one step deeper, under the same ink. */
const CHIP_L = 0.86;
const CHIP_S = 0.5;
/** The cap. It starts here and only ever walks DOWN — see `capFor`. */
const BAR_S = 0.62;
const BAR_START_L = 0.46;
const BAR_FLOOR_L = 0.1;
/** WCAG's floor for a graphic that carries meaning. The cap is the only thing
    naming the category by colour, so it is held to it. */
const GRAPHIC = 3;

/** Below this much chroma in the SOURCE, there is no hue to rescue.

    Stating a wash's saturation rather than searching for it (see
    `scheduleBlockPaint`) would otherwise give a colour somebody set to grey a
    confident hue: #D9D9DE came out blue-violet on 240° of arbitrary rounding,
    and black and white both came out RED — neither has a hue, both compute 0°.

    Measured, the gap is wide and there is no judgement in the middle of it:

      black, white   0.000        mint    0.485
      #D9D9DE grey   0.070        lilac   0.690
                                  teal    1.000

    The line sits at 0.10 rather than in the middle, deliberately. Turning a
    colour somebody chose into grey is the worse of the two mistakes, so this
    errs toward keeping a hue: a deliberately muted pick like a dusty sage
    (~0.12) still gets one. */
const MIN_SOURCE_CHROMA = 0.1;

/**
 * The cap's colour for one hue: hold the hue, walk lightness DOWN until the
 * cap clears 3:1 against the wash it sits on.
 *
 * A FIXED LIGHTNESS IS NOT A FIXED CONTRAST — this walk exists because the
 * first cut pinned the cap at 0.42 and measured 6.12:1 for purple against
 * 2.22:1 for yellow-green. The wash is the ground it actually sits on and is
 * darker than the card, so clearing the wash clears white too.
 */
function capFor(h: number, wash: readonly [number, number, number]): [number, number, number] {
  for (let l = BAR_START_L; l >= BAR_FLOOR_L; l -= 0.01) {
    const rgb = toRgb(h, BAR_S, l);
    if (contrastRatio(rgb, wash) >= GRAPHIC) return rgb;
  }
  /* Unreachable: every hue is dark enough by the floor. Kept so the function
     is total rather than nearly total. */
  return toRgb(h, BAR_S, BAR_FLOOR_L);
}

/**
 * The paint for one category colour. `hex` is ServiceM8's own value, already
 * sanitised by `sm8CategoryColour`; null (or unreadable) gets the grey pair.
 */
export function scheduleBlockPaint(hex: string | null | undefined): BlockPaint {
  const raw = typeof hex === "string" ? channelsOf(hex) : null;
  if (!raw) return NO_CATEGORY_PAINT;

  const [h, s0] = toHsl(raw);
  /* No hue to rescue — take the same grey a job with no category gets, rather
     than inventing one. Black, white and a picked grey all land here. */
  if (s0 < MIN_SOURCE_CHROMA) return NO_CATEGORY_PAINT;

  /* THE WASH IS NOT A SEARCH. Its saturation is stated rather than taken from
     the source, because the source's own chroma is the thing that went wrong
     twice: a category ServiceM8 set to a fully-saturated pink is not a louder
     category than one set to a muted sage, it is the same category wearing a
     different swatch. Every wash is the same distance from white, so the rail
     reads as one system without any hue being able to shout. */
  const wash = toRgb(h, WASH_S, WASH_L);

  return {
    fill: css(wash),
    /* INK ON EVERY BLOCK. The text colour is a rule, not a property of the
       category — a row of blocks that disagree about it reads as an accident.
       On a 94%-light ground that rule costs nothing: 16:1 at the worst hue. */
    ink: css(INK),
    /* The chip sits ON the wash under the SAME ink, so it moves AWAY from the
       label rather than toward it — the trap this module was written for. */
    chip: css(toRgb(h, CHIP_S, CHIP_L)),
    bar: css(capFor(h, wash)),
    /* Neutral, and the same neutral whatever the category was: colour on this
       rail means work still to do. */
    pale: DONE_PALE,
    paleEdge: DONE_EDGE,
  };
}
