/* What colour the capacity month's percentage figure is — the grid's one
   paint decision, pure so jest can sweep every step of it (the schedule.ts /
   schedule-query.ts split, applied to paint, exactly as schedule-colour.ts).

   THE NUMBER CARRIES THE RAMP; THE CELL STAYS WHITE. Isaac's call: no filled
   swatch behind the figure, the figure itself deepens as the day fills. That
   moves the contrast question — the type sits on white, and white never
   moves, so every step of the ramp is measured against white and nothing
   else.

   FULLNESS IS CHROMA, NOT LIGHTNESS. Text on white cannot run pale-to-deep
   the way a background swatch would: a 5% day at a background ramp's pale end
   would be near-invisible type. So both ends are dark enough to read and the
   axis that moves is saturation — an empty day is a muted slate with almost
   no colour in it, a full day is the deep saturated green. Empty is quiet,
   full is green, over breaks to amber: deliberately the INVERSE of a traffic
   light, because a full day is the week's revenue, not a fault. The danger
   red appears nowhere on this grid — this session started because a routine
   job was painted rgb(235, 0, 0) and read as an emergency.

   THE GREEN IS THE TEXT-SAFE ONE. The board's green FILL token --wb2-ok
   #00A389 measures ~2.9:1 on white — fine as a swatch, unreadable as type —
   and the app-wide rule is that state ink comes from a `-t` token and a fill
   token never paints text. So the ramp lands on the ink token's value,
   --ok-t #00735f (~5.8:1 on white). Both greens are written here as literals
   because this module has no cascade to read; the component hands the result
   to a custom property on the cell.

   AND EVERY STEP IS WALKED, NOT TRUSTED. A fixed lightness is not a fixed
   contrast — schedule-colour.ts measured purple at 6.12:1 and yellow-green
   at 2.22:1 at the same L. The band below clears 4.5:1 on white at every
   step of this hue as tuned today; the walk is what keeps that true when the
   endpoints are next fiddled with. The figure qualifies as WCAG large text
   and would earn a 3:1 floor — it is held to 4.5:1 anyway, so the question
   cannot come back. */

import { contrastRatio } from "./schedule-colour";

const WHITE: readonly [number, number, number] = [255, 255, 255];
/** Body-text floor, applied even though the figure is large type. */
const TEXT = 4.5;

/** hsl → rgb. A private copy, as schedule-colour.ts keeps its own: neither
    module exports arithmetic that only means something beside the constants
    tuned around it. */
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

/** --ok-t's own hue: at (H, s 1, l .226) the full end computes rgb(0, 115, 96)
    — #00735f to within one channel. */
const H = 170;
/** Chroma is one axis that carries fullness; LIGHTNESS IS THE OTHER, and the
    first cut of this got that wrong in an instructive way. It shaped the ramp
    with the contrast walk below — darkening every step until it cleared 4.5:1
    — which NORMALISED the whole scale: measured on the live month, every step
    from 0% to 100% landed between 5.29:1 and 5.80:1. On white, contrast IS
    perceived lightness, so holding contrast flat held lightness flat, and the
    ramp varied only in chroma. Walked on real data the effect was plain: 43%
    drew rgb(41, 119, 106) and 88% drew rgb(7, 118, 99) — the same colour
    twice, across the entire band this business actually operates in.

    So the band is stated, wide, and deliberately NOT flat: the empty end sits
    just above the text floor and the full end runs far darker. */
const S_EMPTY = 0.06;
const S_FULL = 1;
const L_EMPTY = 0.44;
const L_FULL = 0.19;
const L_FLOOR = 0.1;

/** Smoothstep. REAL DAYS CLUSTER BETWEEN 40% AND 90% — the live month runs
    43–88 — so a linear ramp spends most of its travel on values a dispatcher
    never sees. This eases the change into the middle, where the difference
    between a 60% day and an 80% day is the thing being asked. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Over capacity — the grid's one qualitative break — takes the WARN family's
    INK, never its fill: --wb2-warn-t #B45309 is ~5.0:1 on white, while
    --wb2-warn #FF8A00 is ~2.4:1 and never paints text. Not --wb2-dan,
    anywhere on this grid: an over-booked day is a scheduling fact, not a
    fault. */
export const OVER_INK = "rgb(180, 83, 9)";

/** The figure's colour for a scored day: slate at 0%, the text-safe green at
    100%, walked darker wherever a step would miss 4.5:1 on white. Callers
    only ever pass a real `fillPct` — a null day has no figure to paint. */
export function capacityInk(fillPct: number): string {
  const t = ease(Math.min(100, Math.max(0, fillPct)) / 100);
  const s = S_EMPTY + (S_FULL - S_EMPTY) * t;
  let l = L_EMPTY + (L_FULL - L_EMPTY) * t;
  let rgb = toRgb(H, s, l);
  /* A GUARD, NOT THE SHAPE. The band above already clears 4.5:1 at every step
     (4.66:1 at its worst, which is 13%), so this loop does not fire as tuned —
     it is here so that moving an endpoint later cannot quietly ship type
     nobody can read, which is the failure the endpoints themselves replaced. */
  while (contrastRatio(rgb, WHITE) < TEXT && l > L_FLOOR) {
    l -= 0.005;
    rgb = toRgb(H, s, l);
  }
  return `rgb(${rgb.join(", ")})`;
}
