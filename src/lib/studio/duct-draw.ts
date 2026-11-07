/* DRAWING A DUCT (Isaac, 2026-11-01). Three things it never asks you for:

   Which stream. "It's only for the grills": a duct is whatever it touches, a
   grille first, then the duct it joins, then the face of the unit it comes off.
   Everything joined to it follows. Touching nothing yet, it is supply.

   Dots. A finger or a mouse can draw the line; the stroke is thinned to a few
   dots here, so it is a line like any other.

   A fitting put down first. A duct started or ended on another duct cuts that
   one there, and the two ends and the new duct make the fitting
   (duct-fitting.ts), which is still not stored: it is where the ends are. */

import type { DesignObject, Point } from "./document";
import { sampleSmoothed } from "./geometry";
import { legsOfCut, legsProp, straightLegsOf } from "./run-legs";

export type DuctStream = "supply" | "return";

type Run = DesignObject;

const isDrawnDuct = (o: DesignObject): boolean => o.type === "duct-run" && !!o.props.form && o.geometry.kind === "polyline";
const dotsOf = (o: DesignObject): Point[] => (o.geometry.kind === "polyline" ? o.geometry.points : []);
const streamOf = (o: DesignObject): DuctStream => (o.props.stream === "return" ? "return" : "supply");
const near = (a: Point, b: Point, tol = 1e-6) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;

/* ── the stroke ── */

/** a drawn stroke as its few dots: every dot further than `tol` off the line stays */
export function thinStroke(stroke: readonly Point[], tol: number): Point[] {
  if (stroke.length <= 2) return [...stroke];
  const a = stroke[0];
  const b = stroke[stroke.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const long = Math.hypot(dx, dy);
  let far = 0;
  let at = 0;
  for (let i = 1; i < stroke.length - 1; i++) {
    const p = stroke[i];
    const d = long > 0 ? Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / long : Math.hypot(p.x - a.x, p.y - a.y);
    if (d > far) {
      far = d;
      at = i;
    }
  }
  if (far <= tol) return [a, b];
  return [...thinStroke(stroke.slice(0, at + 1), tol).slice(0, -1), ...thinStroke(stroke.slice(at), tol)];
}

/* ── on a duct ── */

export interface OnDuct {
  runId: string;
  /** which of its legs, between dots */
  seg: number;
  at: Point;
  stream: DuctStream;
}

const SAMPLES_PER_LEG = 16;

/** the nearest point on a drawn duct, along the line as it is drawn. `reach` is
    how far off its middle counts, for that duct */
export function nearestOnDucts(runs: readonly DesignObject[], w: Point, reach: (run: DesignObject) => number): OnDuct | null {
  let best: OnDuct | null = null;
  let bestD = Infinity;
  for (const run of runs) {
    if (!isDrawnDuct(run)) continue;
    const dots = dotsOf(run);
    const flex = run.props.form === "flex";
    const line = flex ? sampleSmoothed(dots, straightLegsOf(run.props), SAMPLES_PER_LEG) : dots;
    const perLeg = flex ? SAMPLES_PER_LEG : 1;
    const limit = reach(run);
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((w.x - a.x) * dx + (w.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const at = { x: a.x + dx * t, y: a.y + dy * t };
      const d = Math.hypot(w.x - at.x, w.y - at.y);
      if (d <= limit && d < bestD) {
        bestD = d;
        best = { runId: run.id, seg: Math.floor((i - 1) / perLeg), at, stream: streamOf(run) };
      }
    }
  }
  return best;
}

/** cut the duct under `at` in two there. What was on each end stays on it; the
    two new ends meet at `at` */
export function cutDuctAt(objects: readonly DesignObject[], at: Point, newRunId: string): DesignObject[] {
  const on = nearestOnDucts(objects, at, () => 1);
  const run = on && objects.find((o) => o.id === on.runId);
  if (!on || !run || run.geometry.kind !== "polyline") return [...objects];
  const dots = run.geometry.points;
  const { first, second } = legsOfCut(straightLegsOf(run.props) ?? [], on.seg);
  const before = dots.slice(0, on.seg + 1);
  const after = dots.slice(on.seg + 1);
  const headDots = near(before[before.length - 1], at, 1e-3) ? before : [...before, at];
  const tailDots = near(after[0], at, 1e-3) ? after : [at, ...after];
  /* on the very end of the duct there is nothing to cut */
  if (headDots.length < 2 || tailDots.length < 2) return [...objects];
  const { straight: _old, startAttach: _start, endAttach: _end, ...rest } = run.props;
  const head: DesignObject = {
    ...run,
    geometry: { ...run.geometry, points: headDots },
    props: { ...rest, ...(run.props.startAttach ? { startAttach: run.props.startAttach } : {}), ...legsProp(first, headDots.length) },
  };
  const tail: DesignObject = {
    ...run,
    id: newRunId,
    geometry: { ...run.geometry, points: tailDots },
    props: { ...rest, ...(run.props.endAttach ? { endAttach: run.props.endAttach } : {}), ...legsProp(second, tailDots.length) },
  };
  return objects.flatMap((o) => (o.id === run.id ? [head, tail] : [o]));
}

/* ── the stream ── */

/** what one end of a new duct touches. `decides` is a grille */
export interface DuctTouch {
  stream: DuctStream | null;
  decides?: boolean;
}

/** which face of a unit a duct heading for `toward` comes off */
export function unitFaceToward(unit: { at: Point; rotation: number; flip: boolean }, toward: Point): DuctStream {
  const rad = (unit.rotation * Math.PI) / 180;
  const across = -(toward.x - unit.at.x) * Math.sin(rad) + (toward.y - unit.at.y) * Math.cos(rad);
  return across >= 0 !== unit.flip ? "supply" : "return";
}

/** a new duct's stream: a grille, then what it joins, then a unit's face */
export function chooseDuctStream(start: DuctTouch | null, end: DuctTouch | null, face: DuctStream | null): DuctStream {
  const touches = [end, start];
  return touches.find((t) => t?.decides && t.stream)?.stream ?? touches.reverse().find((t) => t?.stream)?.stream ?? face ?? "supply";
}

const endKey = (o: DesignObject, p: Point) => `${o.floorId}/${p.x.toFixed(3)}/${p.y.toFixed(3)}`;
const freeEnds = (o: DesignObject): string[] => {
  const dots = dotsOf(o);
  return [...(o.props.startAttach ? [] : [endKey(o, dots[0])]), ...(o.props.endAttach ? [] : [endKey(o, dots[dots.length - 1])])];
};
const heldByItsEnds = (o: DesignObject) =>
  [o.props.startAttach, o.props.endAttach].some((a) => {
    const kind = (a as { kind?: string } | undefined)?.kind;
    return kind === "grille" || kind === "unit";
  });

/** everything joined to this duct takes its stream, bar a duct a grille or a unit is holding */
export function spreadDuctStream(objects: readonly DesignObject[], runId: string): DesignObject[] {
  const from = objects.find((o) => o.id === runId);
  if (!from) return [...objects];
  const ducts = objects.filter(isDrawnDuct);
  const stream = streamOf(from);
  const reached = new Set([from.id]);
  const open = [...freeEnds(from)];
  const seen = new Set(open);
  while (open.length > 0) {
    const key = open.pop();
    for (const d of ducts) {
      if (reached.has(d.id)) continue;
      const ends = freeEnds(d);
      if (!ends.includes(key as string)) continue;
      reached.add(d.id);
      for (const e of ends) {
        if (!seen.has(e)) {
          seen.add(e);
          open.push(e);
        }
      }
    }
  }
  return objects.map((o) => (reached.has(o.id) && o.id !== runId && !heldByItsEnds(o) && streamOf(o) !== stream ? { ...o, props: { ...o.props, stream } } : o));
}

/** a grille changed stream: the ducts on it change with it, and all they join */
export function ductsFollowGrille(objects: readonly DesignObject[], grilleId: string, stream: DuctStream): DesignObject[] {
  const on = objects.filter(
    (o): o is Run =>
      isDrawnDuct(o) &&
      [o.props.startAttach, o.props.endAttach].some((a) => {
        const attach = a as { kind?: string; id?: string } | undefined;
        return attach?.kind === "grille" && attach.id === grilleId;
      })
  );
  return on.reduce<DesignObject[]>(
    (now, run) => spreadDuctStream(now.map((o) => (o.id === run.id ? { ...o, props: { ...o.props, stream } } : o)), run.id),
    [...objects]
  );
}
