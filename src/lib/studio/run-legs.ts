/* A LINE'S STRAIGHT LEGS (Isaac, 2026-11-01: "Holding shift should make lines
   straight, freeform otherwise"). In the next flow every drawn line goes where
   the dots are put; a dot placed with Shift held makes the leg up to it
   straight and square to the plan. A curved line (flex, soft pipe, cable) has
   to remember which of its legs those were or the curve would bend them, so it
   carries their indexes in props.straight: leg i runs from dot i to dot i + 1.
   Anything that adds or takes away dots moves the indexes with them. */

import type { Point } from "./document";
import { orthoSnap, polylineLength, sampleSmoothed, smoothedLength } from "./geometry";

export type StraightLegs = readonly number[];

/** does this run render as a smoothed curve? cables always; pipe when soft; duct when flex */
export const isCurvedRun = (o: { type: string; props: Record<string, unknown> }): boolean =>
  o.type === "cable-run" ||
  (o.type === "pipe-run" && o.props.form === "soft") ||
  (o.type === "duct-run" && o.props.form === "flex");

export function straightLegsOf(props: Record<string, unknown>): StraightLegs | undefined {
  const legs = props.straight;
  return Array.isArray(legs) && legs.length > 0 ? (legs as number[]) : undefined;
}

/** the length of a run as it is drawn, in plan units */
export function runLengthUnits(r: { type: string; props: Record<string, unknown> }, pts: Point[]): number {
  return isCurvedRun(r) ? smoothedLength(pts, straightLegsOf(r.props)) : polylineLength(pts);
}

/** where the next dot goes: Shift holds it square to the last one */
export function nextDot(prev: Point, w: Point, straight: boolean): Point {
  return straight ? orthoSnap(prev, w) : w;
}

/** the legs a run of `dots` dots keeps, as the props to store (none, none stored) */
export function legsProp(legs: StraightLegs, dots: number): { straight?: number[] } {
  const kept = [...new Set(legs)].filter((l) => l >= 0 && l < dots - 1).sort((a, b) => a - b);
  return kept.length > 0 ? { straight: kept } : {};
}

/** a dot taken out: the two legs either side of it become one, which goes back to a curve */
export function legsWithoutDot(legs: StraightLegs, dot: number): number[] {
  return legs.filter((l) => l < dot - 1 || l > dot).map((l) => (l > dot ? l - 1 : l));
}

/** a run cut on leg `seg`: both pieces of that leg stay as it was */
export function legsOfCut(legs: StraightLegs, seg: number): { first: number[]; second: number[] } {
  return {
    first: legs.filter((l) => l <= seg),
    second: legs.filter((l) => l >= seg).map((l) => l - seg),
  };
}

/** two pieces back as one, the second's legs following the first's `firstDots` dots */
export function legsJoined(first: StraightLegs, firstDots: number, second: StraightLegs): number[] {
  return [...first, ...second.map((l) => l + firstDots - 1)];
}

/* WHERE DUCTS MEET (Isaac, 2026-10-28: "anything that is a BTO or a Y… can just
   be a circle and ducts attached to that circle"; 2026-11-01: "Dropping a duct
   onto the circle would create the shape"). A free end of one of the next
   flow's ducts is a circle; a second duct dropped on it, of the same stream on
   the same floor, makes a fitting (duct-fitting.ts). Nothing is stored, it is
   where the ends are. */
export interface DuctEnd {
  diaMm: number;
  /** the duct as drawn, from this end */
  path: Point[];
  runId?: string;
  fromEnd?: "start" | "end";
}

export interface DuctJunction {
  at: Point;
  stream: "supply" | "return";
  /** the ducts on it, biggest first */
  diasMm: number[];
  ends: DuctEnd[];
}

type RunLike = { id?: string; type: string; floorId?: string; props: Record<string, unknown>; geometry: { kind: string; points?: Point[] } };

function ductMeets(runs: readonly RunLike[]): DuctJunction[] {
  const byEnd = new Map<string, DuctJunction>();
  const add = (floor: string, at: Point, stream: "supply" | "return", diaMm: number, path: Point[], runId: string | undefined, fromEnd: "start" | "end") => {
    const key = `${floor}/${stream}/${at.x.toFixed(3)}/${at.y.toFixed(3)}`;
    const j = byEnd.get(key) ?? { at, stream, diasMm: [], ends: [] };
    j.ends.push({ diaMm, path, runId, fromEnd });
    byEnd.set(key, j);
  };
  for (const r of runs) {
    const pts = r.geometry.points;
    if (r.type !== "duct-run" || !r.props.form || !pts || pts.length < 2) continue;
    const stream = r.props.stream === "return" ? "return" : "supply";
    const dia = Number(r.props.diaMm) || 250;
    const path = r.props.form === "flex" ? sampleSmoothed(pts, straightLegsOf(r.props)) : pts;
    if (!r.props.startAttach) add(r.floorId ?? "", pts[0], stream, dia, path, r.id, "start");
    if (!r.props.endAttach) add(r.floorId ?? "", pts[pts.length - 1], stream, dia, [...path].reverse(), r.id, "end");
  }
  return [...byEnd.values()].map((j) => {
    const ends = [...j.ends].sort((a, b) => b.diaMm - a.diaMm);
    return { ...j, ends, diasMm: ends.map((e) => e.diaMm) };
  });
}

/** two or more free ends at one spot: a fitting */
export const ductJunctions = (runs: readonly RunLike[]): DuctJunction[] => ductMeets(runs).filter((j) => j.ends.length >= 2);

/** a free end on its own: the circle another duct is dropped on */
export const ductFreeEnds = (runs: readonly RunLike[]): DuctJunction[] => ductMeets(runs).filter((j) => j.ends.length === 1);
