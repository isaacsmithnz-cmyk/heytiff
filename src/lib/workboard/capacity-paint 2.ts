/* What one capacity cell wears — the grid's one paint decision, pure so jest
   can sweep every step of it (the schedule.ts / schedule-query.ts split,
   applied to paint, exactly as schedule-colour.ts).

   THE CELL IS A GAUGE NOW. Isaac's call (2026-08-24), and it REVERSES the
   previous design on purpose: the figure used to carry the ramp on a white
   cell, and the ramp ran quiet-to-green because "a full day is revenue". The
   new reading is the tank: the cell fills from the bottom as the day fills,
   GREEN WHEN THERE IS ROOM and RED AS IT APPROACHES CAPACITY — the question
   being asked is "where can I put work", and room is the good news. If a
   future session finds a test pinning green-at-full, this is why it's gone.

   THE FILL IS A WASH THAT DEEPENS, NOT AN ALARM AT EVERY STEP. The category
   palette taught this the hard way: full-chroma paint made a routine job read
   as an emergency. So an empty day is a pale green wash and the colour only
   approaches the danger family's weight as the day actually runs out of
   room — saturation stays moderate the whole way, and the hue walks green →
   amber → red.

   THE FIGURE'S INK IS BLACK OR WHITE, MEASURED, NEVER GUESSED. The number
   sits mid-cell, so its ground depends on how high the gauge reaches: below
   the figure it sits on white and stays dark; once the fill covers it, the
   ink is whichever of black or white actually clears the fill — a fixed
   lightness is not a fixed contrast, twice over, so every step is walked
   against the ground it really sits on and darkened until the winner clears
   4.5:1. The date label at the top of the cell gets the same treatment at
   its own, higher, waterline. */

import { contrastRatio } from "./schedule-colour";

const WHITE: readonly [number, number, number] = [255, 255, 255];
/** The board's ink token, as channels — the dark ink the sheet already uses. */
const DARK: readonly [number, number, number] = [10, 11, 16];
/** Body-text floor, applied even though the figure is large type. */
const TEXT = 4.5;

/** hsl → rgb. A private copy, as schedule-colour.ts keeps its own: neither
    module exports arithmetic that only means something beside the constants
    tuned around it. */
function toRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hh < 60 ? [c, x, 0]
    : hh < 120 ? [x, c, 0]
    : hh < 180 ? [0, c, x]
    : hh < 240 ? [0, x, c]
    : hh < 300 ? [x, 0, c]
    : [c, 0, x];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

/* The band. Hue walks DOWN from the ok family's green through amber into the
   danger family's red — H_FULL is −13°, which is 347° (#e0264f's own hue),
   written negative so the walk passes through yellow and orange rather than
   round the other way through blue; toRgb wraps it. Lightness deepens with
   fullness so a nearly-full day carries weight a pale wash can't. */
const H_EMPTY = 160;
const H_FULL = -13;
const S_EMPTY = 0.45;
const S_FULL = 0.72;
const L_EMPTY = 0.87;
const L_FULL = 0.52;
const L_FLOOR = 0.2;

/** Smoothstep. REAL DAYS CLUSTER BETWEEN 40% AND 90% — the live month ran
    43–88 — so a linear ramp spends most of its travel on values a dispatcher
    never sees. This eases the change into the middle, where the difference
    between a 60% day and an 80% day is the thing being asked. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/** The gauge covers the centred figure once it reaches about here. */
const FIGURE_WATERLINE = 55;
/** …and the date label, pinned to the top of the cell, only near the brim. */
const DATE_WATERLINE = 85;

/** Over capacity breaks to the danger fill itself — past the brim is the one
    state on this grid that IS the alarm, and the gauge is already full. */
const OVER_FILL: readonly [number, number, number] = [224, 38, 79];

export type CapacityCellPaint = {
  /** The gauge's colour. */
  fill: string;
  /** How far up the cell the gauge reaches, 0–100. */
  level: number;
  /** The figure's ink — black or white, whichever clears its real ground. */
  ink: string;
  /** The date label's ink, or null to leave the sheet's quiet default —
      non-null only once the gauge has climbed under it. */
  dateInk: string | null;
};

const asCss = (rgb: readonly [number, number, number]) => `rgb(${rgb.join(", ")})`;

/** Black or white against `ground`, whichever measures better — walked darker
    if neither clears the floor, which the band as tuned never needs (the
    guard exists so moving an endpoint later cannot ship an unreadable step). */
function inkOn(ground: [number, number, number]): { ink: string; ok: boolean } {
  const white = contrastRatio(WHITE, ground);
  const dark = contrastRatio(DARK, ground);
  return {
    ink: white >= dark ? asCss(WHITE) : asCss(DARK),
    ok: Math.max(white, dark) >= TEXT,
  };
}

/** One scored day's paint. Callers only ever pass a real `fillPct` — a null
    day has no gauge and no figure. */
export function capacityCellPaint(fillPct: number, over: boolean): CapacityCellPaint {
  const level = over ? 100 : Math.min(100, Math.max(0, Math.round(fillPct)));

  let rgb: [number, number, number];
  if (over) {
    rgb = [...OVER_FILL];
  } else {
    const t = ease(level / 100);
    const s = S_EMPTY + (S_FULL - S_EMPTY) * t;
    let l = L_EMPTY + (L_FULL - L_EMPTY) * t;
    rgb = toRgb(H_EMPTY + (H_FULL - H_EMPTY) * t, s, l);
    /* A GUARD, NOT THE SHAPE: darken until black-or-white clears the floor.
       The band crosses the mid-luminance trough (where NEITHER ink reads)
       near its red end, and this walk is what carries those steps through it
       — the sweep in the tests holds the outcome to 4.5:1 at every step. */
    while (!inkOn(rgb).ok && l > L_FLOOR) {
      l -= 0.005;
      rgb = toRgb(H_EMPTY + (H_FULL - H_EMPTY) * ease(level / 100), s, l);
    }
  }

  const onFill = inkOn(rgb).ink;
  const darkCss = asCss(DARK);
  return {
    fill: asCss(rgb),
    level,
    /* the figure's ground is white until the gauge reaches it */
    ink: level >= FIGURE_WATERLINE ? onFill : darkCss,
    dateInk: level >= DATE_WATERLINE ? onFill : null,
  };
}
