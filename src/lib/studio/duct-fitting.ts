/* A FITTING IS THE SHAPE ITS DUCTS MAKE (Isaac, 2026-11-01: "ours will be
   universal… We would not be locked to specific sizes, but a 14 10/10/10 would
   be y shape with extra leg"). A hub the size of the way in, and a leg to each
   duct at a set angle, straight, tapering from the way in down to that duct:
   any count, any size. The biggest duct is the way in. The name comes from the layout, in
   inches biggest first. */

import type { Point } from "./document";
import type { DuctEnd, DuctJunction } from "./run-legs";

export type FittingKind = "Joiner" | "Reducer" | "Y" | "BTO" | "Double BTO";

/* a leg this close to dead ahead of the way in carries straight on */
const AHEAD_DEG = 30;
/* how far a leg reaches, of the way in's width: the way in itself, and the rest */
const WAY_IN_REACH = 1;
const LEG_REACH = 1.3;
/* a leg never takes more than this share of a short duct */
const MOST_OF_DUCT = 0.6;

const len = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

/* the way a duct leaves the fitting */
function leaves(e: DuctEnd): Point {
  const from = e.path[0];
  const next = e.path.find((p) => len(from, p) > 1e-6) ?? from;
  const d = len(from, next) || 1;
  return { x: (next.x - from.x) / d, y: (next.y - from.y) / d };
}

export function fittingKind(ends: readonly DuctEnd[]): FittingKind {
  const [wayIn, ...outs] = ends;
  if (outs.length <= 1) return outs[0]?.diaMm === wayIn.diaMm ? "Joiner" : "Reducer";
  const back = leaves(wayIn);
  const cos = Math.cos((AHEAD_DEG * Math.PI) / 180);
  const ahead = outs.find((o) => {
    const d = leaves(o);
    return -(d.x * back.x + d.y * back.y) >= cos;
  });
  /* it runs on past its branches only when it is bigger than all of them */
  if (!ahead || outs.some((o) => o !== ahead && o.diaMm >= ahead.diaMm)) return "Y";
  return outs.length === 3 ? "Double BTO" : "BTO";
}

/** "Y 16-14-12": its kind, then its sizes in inches (25 mm to the inch, as the trade rounds) */
export const fittingName = (j: Pick<DuctJunction, "ends">): string =>
  `${fittingKind(j.ends)} ${j.ends.map((e) => Math.round(e.diaMm / 25)).join("-")}`;

/* where a duct is, this far along it, and which way it is heading there */
function onPath(path: readonly Point[], reach: number): { at: Point; heading: Point } {
  let left = reach;
  for (let i = 1; i < path.length; i++) {
    const leg = len(path[i - 1], path[i]);
    if (leg > 0 && leg >= left) {
      const t = left / leg;
      const heading = { x: (path[i].x - path[i - 1].x) / leg, y: (path[i].y - path[i - 1].y) / leg };
      return { at: { x: path[i - 1].x + (path[i].x - path[i - 1].x) * t, y: path[i - 1].y + (path[i].y - path[i - 1].y) * t }, heading };
    }
    left -= leg;
  }
  const n = path.length;
  const d = len(path[Math.max(n - 2, 0)], path[n - 1]) || 1;
  return { at: path[n - 1], heading: { x: (path[n - 1].x - path[Math.max(n - 2, 0)].x) / d, y: (path[n - 1].y - path[Math.max(n - 2, 0)].y) / d } };
}

export interface FittingLeg {
  /** the leg, straight, from the hub out */
  outline: Point[];
  /** the line square across its end, where the duct goes on */
  mouth: [Point, Point];
  /** which way it points */
  heading: Point;
  reach: number;
}

export interface FittingShape {
  hubRadius: number;
  legs: FittingLeg[];
}

/* the end share of a tapered leg that is the duct's size all the way: the spigot */
const SPIGOT = 0.35;
/* how far along a duct to look to see which way it is going, of the way in's width */
const LOOK = 2;
/* how far past the spigot a duct takes to come back to its own line, of its width */
const COMES_BACK = 3.5;
const COME_BACK_SLICES = 12;

const unit = (p: Point): Point => {
  const d = Math.hypot(p.x, p.y) || 1;
  return { x: p.x / d, y: p.y / d };
};
const turned = (p: Point, deg: number): Point => {
  const r = (deg * Math.PI) / 180;
  return { x: p.x * Math.cos(r) - p.y * Math.sin(r), y: p.x * Math.sin(r) + p.y * Math.cos(r) };
};
const runOf = (path: readonly Point[]) => path.reduce((sum, p, i) => (i ? sum + len(path[i - 1], p) : 0), 0);
/* the side of the axis a heading is on, turning the short way */
const offAxis = (axis: Point, d: Point) => (Math.atan2(axis.x * d.y - axis.y * d.x, axis.x * d.x + axis.y * d.y) * 180) / Math.PI;

/* THE SHAPE IS FIXED (Isaac, 2026-11-01: "The BTO should be a fixed shape with
   the duct connecting onto it"). A trunk dead straight with its branch square
   off it, a Y's legs at set angles, whatever the ducts do past the spigots. The
   ducts decide only which way it faces and which leg is whose. */
function legHeadings(ends: readonly DuctEnd[], wayIn: number): Point[] {
  const heading = (e: DuctEnd) => {
    const from = e.path[0];
    const to = onPath(e.path, Math.min(wayIn * LOOK, runOf(e.path))).at;
    return unit({ x: to.x - from.x, y: to.y - from.y });
  };
  const [first, ...outs] = ends.map(heading);
  const out = unit(outs.reduce((sum, d) => ({ x: sum.x + d.x, y: sum.y + d.y }), { x: 0, y: 0 }));
  let axis = unit({ x: out.x - first.x, y: out.y - first.y });
  if (outs.length > 1) {
    const deg = (Math.atan2(axis.y, axis.x) * 180) / Math.PI;
    /* a branching fitting always sits square or on a 45 */
    const near = (Math.round(deg / 45) * 45 * Math.PI) / 180;
    axis = { x: Math.cos(near), y: Math.sin(near) };
  }
  const back = { x: -axis.x, y: -axis.y };
  if (outs.length === 1) return [back, axis];

  const kind = fittingKind(ends);
  const degs = new Array<number>(outs.length);
  const order = outs.map((d, i) => ({ i, off: offAxis(axis, d) })).sort((a, b) => a.off - b.off);
  if (kind === "BTO" || kind === "Double BTO") {
    const ahead = order.reduce((a, b) => (Math.abs(b.off) < Math.abs(a.off) ? b : a));
    degs[ahead.i] = 0;
    const branches = order.filter((o) => o !== ahead);
    const oneSide = branches.every((o) => Math.sign(o.off) === Math.sign(branches[0].off));
    branches.forEach((o, k) => {
      const side = Math.sign(o.off) || 1;
      degs[o.i] = side * (oneSide && branches.length === 2 && k === (side > 0 ? 0 : 1) ? 45 : 90);
    });
  } else {
    /* a Y's two legs a square apart; each extra leg a set step in the fan */
    const step = outs.length === 2 ? 90 : outs.length === 3 ? 50 : 40;
    order.forEach((o, k) => {
      degs[o.i] = (k - (order.length - 1) / 2) * step;
    });
  }
  return [back, ...degs.map((deg) => turned(axis, deg))];
}

/** the shape: straight legs at set angles, each ending square for its duct to go on */
export function fittingShape(j: Pick<DuctJunction, "at" | "ends">, widthOf: (diaMm: number) => number): FittingShape {
  const wayIn = widthOf(j.ends[0].diaMm);
  const kind = fittingKind(j.ends);
  const headings = legHeadings(j.ends, wayIn);
  const trunk = kind === "BTO" || kind === "Double BTO";
  const legs = j.ends.map((e, i): FittingLeg => {
    const heading = headings[i];
    const reach = Math.min(wayIn * (i === 0 ? WAY_IN_REACH : LEG_REACH), runOf(e.path) * MOST_OF_DUCT);
    const w = widthOf(e.diaMm) / 2;
    /* a BTO's branch is a plain tube off the trunk; everything else tapers from the way in */
    const branch = trunk && i > 0 && Math.abs(heading.x * headings[0].x + heading.y * headings[0].y) < 0.99;
    const base = branch ? w : wayIn / 2;
    const n = { x: -heading.y, y: heading.x };
    const side = (s: number, half: number): Point => ({ x: j.at.x + heading.x * s + n.x * half, y: j.at.y + heading.y * s + n.y * half });
    const shoulder = reach * (1 - SPIGOT);
    return {
      outline: [side(0, base), side(shoulder, w), side(reach, w), side(reach, -w), side(shoulder, -w), side(0, -base)],
      mouth: [side(reach, w), side(reach, -w)],
      heading,
      reach,
    };
  });
  return { hubRadius: wayIn / 2, legs };
}

/* a duct from a fitting's spigot back onto its own line: off the end dead straight,
   then curving to meet where it was drawn */
function offTheSpigot(path: readonly Point[], leg: FittingLeg, width: number, share: number): Point[] {
  const mouth = { x: (leg.mouth[0].x + leg.mouth[1].x) / 2, y: (leg.mouth[0].y + leg.mouth[1].y) / 2 };
  const run = runOf(path);
  const back = Math.min(Math.max(leg.reach + COMES_BACK * width, leg.reach), run * share);
  const { at: meet, heading } = onPath(path, back);
  const pull = len(mouth, meet) / 3;
  const c1 = { x: mouth.x + leg.heading.x * pull, y: mouth.y + leg.heading.y * pull };
  const c2 = { x: meet.x - heading.x * pull, y: meet.y - heading.y * pull };
  const bend = Array.from({ length: COME_BACK_SLICES }, (_, k) => {
    const t = (k + 1) / COME_BACK_SLICES;
    const u = 1 - t;
    return {
      x: u * u * u * mouth.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * meet.x,
      y: u * u * u * mouth.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * meet.y,
    };
  });
  let along = 0;
  const rest: Point[] = [];
  for (let i = 1; i < path.length; i++) {
    along += len(path[i - 1], path[i]);
    if (along > back + 1e-6) rest.push(path[i]);
  }
  /* it starts a little inside the spigot, under the fitting, so no gap can show */
  const inside = { x: mouth.x - leg.heading.x * width * 0.2, y: mouth.y - leg.heading.y * width * 0.2 };
  return [inside, mouth, ...bend, ...rest];
}

/** each duct on a fitting, as drawn: from the spigots rather than through the hub.
    What is stored, measured and priced stays the line the duct was drawn on */
export function ductLinesOn(junctions: readonly DuctJunction[], widthOf: (diaMm: number) => number): Map<string, Point[]> {
  const on = new Map<string, { path: Point[]; width: number; start?: FittingLeg; end?: FittingLeg }>();
  for (const j of junctions) {
    const { legs } = fittingShape(j, widthOf);
    j.ends.forEach((e, i) => {
      if (!e.runId) return;
      const path = e.fromEnd === "end" ? [...e.path].reverse() : e.path;
      const held = on.get(e.runId) ?? { path, width: widthOf(e.diaMm) };
      held[e.fromEnd === "end" ? "end" : "start"] = legs[i];
      on.set(e.runId, held);
    });
  }
  const lines = new Map<string, Point[]>();
  for (const [id, { path, width, start, end }] of on) {
    const share = start && end ? 0.5 : 0.95;
    const fromStart = start ? offTheSpigot(path, start, width, share) : path;
    lines.set(id, end ? offTheSpigot([...fromStart].reverse(), end, width, share).reverse() : fromStart);
  }
  return lines;
}

/** a drawn line as a path, for the ribs of a flex duct */
export const linePathD = (points: readonly Point[]): string => points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");

/** its words on the plan: laid out with the ducts' words, kept off the ducts */
export const fittingKey = (j: Pick<DuctJunction, "at" | "stream">): string => `fitting/${j.stream}/${j.at.x}/${j.at.y}`;

export function fittingLabelIn(j: DuctJunction, mmPerUnit: number | null | undefined) {
  const width = j.diasMm[0] / (mmPerUnit ?? 10);
  return {
    id: fittingKey(j),
    points: [j.at, { x: j.at.x + width, y: j.at.y }],
    text: fittingName(j),
    size: 8,
    half: width / 2,
  };
}
