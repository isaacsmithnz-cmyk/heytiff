/* A DUCT'S COLOUR IS ITS SIZE (Isaac, 2026-11-01: "Duct should be sized by
   color. And a small label. Let's do purple for 16-inch. Some sort of whitey
   color for 14-inch. Green for 12-inch. Yellow for 10-inch. And blue for
   8-inch. And then pink for 6-inch. Anything smaller or bigger than that can
   be probably just black and white"). Only a duct with a form, the next
   flow's, is painted; the current flow's keeps its stream's ink. Flex has ribs
   across it so it reads as flex at a glance; rigid is smooth. */

import type { DesignObject } from "./document";
import { attachOf } from "./graph";

export interface DuctPaint {
  body: string;
  edge: string;
  rib: string;
}

const BY_INCHES: Record<number, DuctPaint> = {
  16: { body: "#A855F7", edge: "#7E22CE", rib: "#7E22CE" },
  14: { body: "#F5F5F4", edge: "#4B5563", rib: "#9CA3AF" },
  12: { body: "#22C55E", edge: "#15803D", rib: "#15803D" },
  10: { body: "#FACC15", edge: "#A16207", rib: "#A16207" },
  8: { body: "#2563EB", edge: "#1E3A8A", rib: "#1E3A8A" },
  6: { body: "#EC4899", edge: "#9D174D", rib: "#9D174D" },
};
const ANY_OTHER: DuctPaint = { body: "#050505", edge: "#050505", rib: "#FFFFFF" };

/** 25 mm to the inch, as the trade rounds */
export const ductPaint = (diaMm: number): DuctPaint => BY_INCHES[diaMm / 25] ?? ANY_OTHER;

/** a painted duct's small label: its colour says the rest, so only return says which air */
export function ductLabel(props: Record<string, unknown>, metres: number | null): string {
  const size = `Ø${Number(props.diaMm) || 250}${props.stream === "return" ? " return" : ""}`;
  return metres == null ? size : `${size}, ${metres.toFixed(1)} m`;
}

/** its words stay ink, whichever system it is on */
export const DUCT_LABEL_STYLE = { fill: "#050505", fontWeight: 600 };

/** a flex rib and the gap to the next, mm */
const RIB_MM = 20;
const RIB_GAP_MM = 80;
/** ribs closer than this on screen are a smear: the duct goes plain */
const RIB_MIN_PITCH_PX = 3;

/** the dash that draws the ribs, or null when they would be too fine to see */
export function ribDash(mmPerUnit: number, pxPerUnit: number): string | null {
  if (((RIB_MM + RIB_GAP_MM) / mmPerUnit) * pxPerUnit < RIB_MIN_PITCH_PX) return null;
  return `${RIB_MM / mmPerUnit} ${RIB_GAP_MM / mmPerUnit}`;
}

/** the ink of a grille's supply side: the colour of the duct on it, if there is one */
export function supplyInkOf(objects: readonly DesignObject[], grilleId: string): string | null {
  for (const r of objects) {
    if (r.type !== "duct-run" || !r.props.form || r.props.stream === "return") continue;
    const on = [attachOf(r.props.startAttach), attachOf(r.props.endAttach)].some((a) => a?.kind === "grille" && a.id === grilleId);
    if (on) return ductPaint(Number(r.props.diaMm) || 250).edge;
  }
  return null;
}

/** the ink of a plenum its ducts made: its biggest duct's. Null on a placed plenum */
export function plenumInkOf(props: Record<string, unknown>): string | null {
  if (props.fromDucts !== true || !Array.isArray(props.spigots)) return null;
  const dias = (props.spigots as { diaMm?: unknown }[]).map((s) => Number(s.diaMm) || 0);
  return dias.length ? ductPaint(Math.max(...dias)).edge : null;
}

/** a duct as drawn: its true width until it would be thinner than 4 px */
export const ductWidth = (diaMm: number, mmPerUnit: number, pen: number): number => Math.max(diaMm / mmPerUnit, 4 * pen);

/* A FITTING IS GREY METAL, whatever goes through it: the ducts carry the sizes */
export const FITTING_PAINT = { body: "#D1D5DB", edge: "#374151" };

/* A RISER SAYS WHAT GOES UP IT (Isaac, 2026-11-01: "risers should be red with an
   R on it… PR is pipe riser, DR is duct riser"): a duct riser is DR, a pipe riser
   PR on a smaller circle. A riser's pair on the other floor counts: the duct may
   only be on one of them. */
export const RISER_PAINT = { body: "#BE123C", word: "#FFFFFF" };

export interface RiserMark {
  word: "DR" | "PR";
  /** the biggest duct up it, so its circle is never lost inside the duct */
  diaMm: number | null;
}

export function riserMark(objects: readonly DesignObject[], riser: DesignObject): RiserMark {
  const group = String(riser.props.group ?? "A");
  const pair = new Set(
    objects
      .filter((o) => o.type === "riser" && o.systemId === riser.systemId && String(o.props.group ?? "A") === group)
      .map((o) => o.id)
  );
  const dias = objects
    .filter(
      (o) =>
        o.type === "duct-run" &&
        [attachOf(o.props.startAttach), attachOf(o.props.endAttach)].some((a) => a?.kind === "riser" && pair.has(a.id))
    )
    .map((o) => Number(o.props.diaMm) || 250);
  return dias.length ? { word: "DR", diaMm: Math.max(...dias) } : { word: "PR", diaMm: null };
}
