/* Design Studio — system-module registry.
   The system TYPE decides how its indoor units are gathered (one pair, a head
   per zone, or an air handler with grilles), which coverage, pipe sizing and
   placement read through moduleFor. Pure config — no React. */

import type { SystemType } from "./document";
import { hasDuctAirway } from "./form-factors";

/** THE SYSTEM COLOURS ARE THE PALETTE'S, the values a job's card wears
    (docs/design.md, rule 18a; Isaac, 7 November 2026: "Follow the lead of job
    card session. Stick to our pallete"): green, pink, purple, yellow, then
    blue, in the order a design's systems are made. Never red, which is a
    riser and what's wrong; never orange, the one colour of a zone nobody has
    claimed; never grey, which reads as nothing. Blue comes last, as blue is
    the press. The builder and the zones flow hand them out through
    nextSystemColour. */
export const SYSTEM_COLOURS = ["#15803D", "#DB2777", "#7E22CE", "#EAB308", "#2563EB"];

/** the colour a new system takes: the first one no system has, else round
    the wheel by count, so a deleted system's colour comes back into use */
export function nextSystemColour(systems: readonly { colour: string }[]): string {
  const used = new Set(systems.map((s) => s.colour.toUpperCase()));
  return (
    SYSTEM_COLOURS.find((c) => !used.has(c.toUpperCase())) ??
    SYSTEM_COLOURS[systems.length % SYSTEM_COLOURS.length]
  );
}

/** Words in a system's colour take its hue's word value, as a job's words
    do: the card's pink and yellow are for marks, not text. */
const SYSTEM_WORD: Record<string, string> = {
  "#15803D": "#15803D",
  "#DB2777": "#9D174D",
  "#7E22CE": "#7E22CE",
  "#EAB308": "#A16207",
  "#2563EB": "#2563EB",
};
export function systemWordColour(colour: string): string {
  return SYSTEM_WORD[colour.trim().toUpperCase()] ?? colour;
}

/** The colours handed out before 7 November 2026, in their order, each to
    the new colour of its place in the list: a design's first system was
    blue and is green, its second was teal and is pink. Indigo, the sixth, has
    no place, so it goes by its hue, to blue. */
const OLD_SYSTEM_COLOURS: Record<string, string> = {
  "#2E68FF": "#15803D",
  "#17A398": "#DB2777",
  "#9B5DE5": "#7E22CE",
  "#D63384": "#EAB308",
  "#1F8A4C": "#2563EB",
};

/** any other colour by its hue, as a job's category snaps (rule 18): a red or
    an orange is pink, and too little colour to have a hue is none at all */
function byHue(colour: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim());
  if (!m) return null;
  const hex = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const chroma = max - Math.min(r, g, b);
  if (chroma < 0.12) return null;
  let h = max === r ? ((g - b) / chroma) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
  h = (h * 60 + 360) % 360;
  if (h < 40 || h >= 290) return "#DB2777";
  if (h < 70) return "#EAB308";
  if (h < 170) return "#15803D";
  if (h < 255) return "#2563EB";
  return "#7E22CE";
}

/** A design's systems with every colour on the palette. A colour already on
    it stays, even shared; any other goes to its place in the old list, or by
    hue, and to the first colour no other system has when that one is taken.
    The same array back when nothing moved, so it runs on every open. Pure. */
export function systemColoursOnPalette<T extends { colour: string }>(systems: readonly T[]): readonly T[] {
  const on = new Set(SYSTEM_COLOURS);
  /* a stored system can come without a colour (an old golden file): it gets
     the first one free rather than drawing in nothing */
  const up = (c: unknown) => (typeof c === "string" ? c.trim().toUpperCase() : "");
  if (systems.every((s) => on.has(up(s.colour)))) return systems;
  const used = new Set(systems.map((s) => up(s.colour)).filter((c) => on.has(c)));
  return systems.map((s) => {
    const c = up(s.colour);
    if (on.has(c)) return s;
    const free = SYSTEM_COLOURS.find((x) => !used.has(x));
    let to = OLD_SYSTEM_COLOURS[c] ?? byHue(c) ?? free ?? SYSTEM_COLOURS[0]!;
    if (used.has(to) && free) to = free;
    used.add(to);
    return { ...s, colour: to };
  });
}

/** How a type gathers indoor units once zones are configured. */
export type UnitFlow =
  | "pair" // split 1:1 — one IDU + one ODU, placed separately
  | "per-room" // multi / vrf — an IDU per zone, one (suggested) ODU
  | "ducted"; // one air handler + grilles per zone

export interface SystemModule {
  type: SystemType;
  label: string;
  unitFlow: UnitFlow;
}

export const SYSTEM_MODULES: Record<SystemType, SystemModule> = {
  split: { type: "split", label: "Split (1:1)", unitFlow: "pair" },
  "multi-split": { type: "multi-split", label: "Multi-split", unitFlow: "per-room" },
  ducted: { type: "ducted", label: "Ducted", unitFlow: "ducted" },
  /* VRF is the type for every brand; "VRV" is Daikin's own name for it */
  vrf: { type: "vrf", label: "VRF", unitFlow: "per-room" },
  ventilation: { type: "ventilation", label: "Ventilation", unitFlow: "per-room" },
  "sheet-metal": { type: "sheet-metal", label: "Sheet metal ductwork", unitFlow: "ducted" },
};

export function moduleFor(type: SystemType): SystemModule {
  return SYSTEM_MODULES[type];
}

/* ── Air capability (shared air side — ducted spec §11.1) ──
   Any unit whose pack row is a ducted/vent form WITH rated airflow is an
   "air handler node": it can host plenums and unlocks the Duct + Component
   tools for its system. Keyed to unit DATA, not system type, so
   multi-split / VRF / ventilation reuse it untouched. */

export function isAirCapable(unit: {
  form_factor: string;
  airflow_ls?: number;
}): boolean {
  return hasDuctAirway(unit.form_factor) && unit.airflow_ls != null;
}
