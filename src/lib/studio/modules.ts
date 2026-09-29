/* Design Studio — system-module registry.
   The system TYPE decides how its indoor units are gathered (one pair, a head
   per zone, or an air handler with grilles), which coverage, pipe sizing and
   placement read through moduleFor. Pure config — no React. */

import type { SystemType } from "./document";
import { hasDuctAirway } from "./form-factors";

/** The system colours: blue, teal, violet, pink, green, indigo. None of them
    is near orange, because orange is the one colour of a zone nobody has
    claimed (the two oranges that were here, #E4572E and #F5A623, went for
    that reason on 2026-09-20). The builder and the zones flow hand them out
    through nextSystemColour. */
export const SYSTEM_COLOURS = ["#2E68FF", "#17A398", "#9B5DE5", "#D63384", "#1F8A4C", "#4F46E5"];

/** the colour a new system takes: the first one no system has, else round
    the wheel by count, so a deleted system's colour comes back into use */
export function nextSystemColour(systems: readonly { colour: string }[]): string {
  const used = new Set(systems.map((s) => s.colour.toUpperCase()));
  return (
    SYSTEM_COLOURS.find((c) => !used.has(c.toUpperCase())) ??
    SYSTEM_COLOURS[systems.length % SYSTEM_COLOURS.length]
  );
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
  vrf: { type: "vrf", label: "VRF / VRV", unitFlow: "per-room" },
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
