/* Joints on the plan (docs/studio-vrf.md, step 3): where a refrigerant run
   branches. A joint is a point object of its system; runs attach to it the
   way they attach to a unit or a riser. Two ways make one (Isaac,
   2026-09-28): the Joint tool drops one, and a run's end landing on another
   run makes one there. Either way a joint ON a run cuts it in two at that
   point, each half keeping its far end's attach, so the graph sees a node
   with three runs meeting — a branch. A joint with three or more runs out of
   it is a header when the tree is sized (vrf-tree.ts).

   Pure functions over the document. No React. */

import { pruneObjects } from "./attach";
import { newId, type DesignDocument, type DesignObject, type Point } from "./document";
import { attachOf } from "./graph";

type Polyline = DesignObject & { geometry: { kind: "polyline"; points: Point[] } };

/** the nearest point on one segment to w */
function onSegment(w: Point, a: Point, b: Point): { at: Point; d: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((w.x - a.x) * dx + (w.y - a.y) * dy) / len2));
  const at = { x: a.x + t * dx, y: a.y + t * dy };
  return { at, d: Math.hypot(w.x - at.x, w.y - at.y) };
}

/** the nearest point on any of these refrigerant runs within `tol`: which
    run, which segment (its first vertex), and where */
export function nearestOnRuns(
  runs: readonly Polyline[],
  w: Point,
  tol: number
): { runId: string; seg: number; at: Point } | null {
  let best: { runId: string; seg: number; at: Point } | null = null;
  let bestD = tol;
  for (const r of runs) {
    if (r.type !== "pipe-run") continue;
    const pts = r.geometry.points;
    for (let j = 0; j < pts.length - 1; j++) {
      const hit = onSegment(w, pts[j], pts[j + 1]);
      if (hit.d <= bestD) {
        bestD = hit.d;
        best = { runId: r.id, seg: j, at: hit.at };
      }
    }
  }
  return best;
}

/** a new joint of this system, on this floor */
export function jointObject(systemId: string, floorId: string, at: Point, id: string = newId("obj")): DesignObject {
  return {
    id,
    type: "joint",
    systemId,
    floorId,
    geometry: { kind: "point", at },
    plane: "room",
    props: {},
  };
}

/** a new branch box of this system, on this floor (PUMY): the heads' runs end
    on it; which box it is (3 or 5 ports) follows from how many do
    (vrf-tree.ts) */
export function branchBoxObject(systemId: string, floorId: string, at: Point): DesignObject {
  return { id: newId("obj"), type: "branch-box", systemId, floorId, geometry: { kind: "point", at }, plane: "room", props: {} };
}

/** put a joint on a run at `at` (on segment `seg`): the run becomes two, the
    first ending on the joint, the second starting from it, each keeping its
    far end's attach and the run's other props. A point at a run's own end
    makes no cut: the joint is just attached there. `jointId` lets a caller
    that must name the joint before the write (the canvas's run draft) choose
    it. */
export function jointOnRun(
  doc: DesignDocument,
  runId: string,
  seg: number,
  at: Point,
  jointId: string = newId("obj")
): { doc: DesignDocument; jointId: string } | null {
  const run = doc.objects.find((o) => o.id === runId);
  if (!run || run.type !== "pipe-run" || !run.systemId) return null;
  const cut = nodeOnRun(doc, runId, seg, at, jointObject(run.systemId, run.floorId, at, jointId));
  return cut ? { doc: cut, jointId } : null;
}

/** a riser dropped on a run (Isaac, 2026-09-30: "the riser isn't even
    snapping to the pipes"): it goes in the run at that point the way a joint
    does — the run in two, each half on the riser — so the pipe on this floor
    reaches it and the vertical carries on from there */
export function riserOnRun(doc: DesignDocument, runId: string, seg: number, riser: DesignObject): DesignDocument | null {
  if (riser.geometry.kind !== "point") return null;
  return nodeOnRun(doc, runId, seg, riser.geometry.at, riser);
}

/* put a point node (a joint, or a riser) on a run at `at`: the cut, shared */
function nodeOnRun(doc: DesignDocument, runId: string, seg: number, at: Point, joint: DesignObject): DesignDocument | null {
  const run = doc.objects.find((o) => o.id === runId);
  if (!run || run.type !== "pipe-run" || run.geometry.kind !== "polyline" || !run.systemId) return null;
  const pts = run.geometry.points;
  if (seg < 0 || seg >= pts.length - 1) return null;
  const same = (p: Point) => Math.hypot(p.x - at.x, p.y - at.y) < 1e-6;
  /* a piece remembers which of its ends a cut made (cutStart / cutEnd), so
     a later cut along the same run keeps the earlier one's mark */
  const { startAttach, endAttach, cutStart, cutEnd, ...rest } = run.props;
  const start = attachOf(startAttach);
  const end = attachOf(endAttach);
  const toJoint = { kind: joint.type === "riser" ? ("riser" as const) : ("joint" as const), id: joint.id };

  /* at an end: attach that end to the joint, no cut (an end already joined
     to something else keeps it — a joint does not steal a unit's pipe) */
  if (same(pts[0]) || same(pts[pts.length - 1])) {
    const atStart = same(pts[0]);
    if ((atStart && start) || (!atStart && end)) return null;
    const props = { ...run.props, [atStart ? "startAttach" : "endAttach"]: toJoint };
    return { ...doc, objects: [...doc.objects.map((o) => (o.id === runId ? { ...o, props } : o)), joint] };
  }

  const first: DesignObject = {
    ...run,
    geometry: { kind: "polyline", points: [...pts.slice(0, seg + 1), at] },
    props: { ...rest, ...(start ? { startAttach: start } : {}), endAttach: toJoint, ...(cutStart ? { cutStart } : {}), cutEnd: joint.id },
  };
  const second: DesignObject = {
    ...run,
    id: newId("obj"),
    geometry: { kind: "polyline", points: [at, ...pts.slice(seg + 1)] },
    props: { ...rest, startAttach: toJoint, ...(end ? { endAttach: end } : {}), cutStart: joint.id, ...(cutEnd ? { cutEnd } : {}) },
  };
  const objects = doc.objects.flatMap((o) => (o.id === runId ? [first, second] : [o]));
  return { ...doc, objects: [...objects, joint] };
}

/** delete a joint, or a riser dropped in a run (riserOnRun). One that cut a
    run (jointOnRun marks which end of each half the cut made)
    with one branch on it puts the run back together: the halves become one
    run again, keeping its two far ends, and the branch run goes with the
    joint (Isaac, 2026-09-29). Any other joint just goes, and the runs on it
    are left with loose ends to redraw. */
export function deleteJoint(doc: DesignDocument, jointId: string): DesignDocument {
  const onIt = doc.objects.filter(
    (o) =>
      o.type === "pipe-run" &&
      (attachOf(o.props.startAttach)?.id === jointId || attachOf(o.props.endAttach)?.id === jointId)
  );
  const first = onIt.find((o) => o.props.cutEnd === jointId && attachOf(o.props.endAttach)?.id === jointId);
  const second = onIt.find((o) => o.props.cutStart === jointId && attachOf(o.props.startAttach)?.id === jointId);
  const branches = onIt.filter((o) => o !== first && o !== second);
  if (first && second && branches.length <= 1 && first.geometry.kind === "polyline" && second.geometry.kind === "polyline") {
    const { cutEnd: _a, endAttach: _b, ...firstProps } = first.props;
    void _a;
    void _b;
    const end = attachOf(second.props.endAttach);
    const secondCutEnd = second.props.cutEnd;
    const whole: DesignObject = {
      ...first,
      geometry: { kind: "polyline", points: [...first.geometry.points, ...second.geometry.points.slice(1)] },
      props: { ...firstProps, ...(end ? { endAttach: end } : {}), ...(secondCutEnd ? { cutEnd: secondCutEnd } : {}) },
    };
    const gone = new Set([jointId, second.id, ...branches.map((b) => b.id)]);
    return {
      ...doc,
      objects: doc.objects.flatMap((o) => (o.id === first.id ? [whole] : gone.has(o.id) ? [] : [o])),
    };
  }
  /* no cut to undo: the joint goes and its runs keep loose ends */
  return {
    ...doc,
    objects: doc.objects
      .filter((o) => o.id !== jointId)
      .map((o) => {
        if (o.type !== "pipe-run") return o;
        const props = { ...o.props };
        if (attachOf(props.startAttach)?.id === jointId) delete props.startAttach;
        if (attachOf(props.endAttach)?.id === jointId) delete props.endAttach;
        if (props.cutStart === jointId) delete props.cutStart;
        if (props.cutEnd === jointId) delete props.cutEnd;
        return props === o.props ? o : { ...o, props };
      }),
  };
}

/** what the schematic deletes (vrf-schematic.tsx): a section's drawn runs, a
    joint (its cut run put back together, as the plan's Delete does), a
    branch box (its pipes left loose, so they show red to be finished or
    erased), or one loose run. Nothing else is touched. */
export type SchematicTarget =
  | { kind: "runs"; ids: string[] }
  | { kind: "joint"; id: string }
  | { kind: "box"; id: string }
  | { kind: "riser"; id: string };

export function deleteFromSchematic(doc: DesignDocument, target: SchematicTarget): DesignDocument {
  if (target.kind === "joint" || target.kind === "riser") return deleteJoint(doc, target.id);
  const gone = new Set(target.kind === "runs" ? target.ids : [target.id]);
  if (!doc.objects.some((o) => gone.has(o.id))) return doc;
  return { ...doc, objects: pruneObjects(doc.objects, (o) => !gone.has(o.id)) };
}

/* SLIDING A JOINT OR RISER ALONG ITS PIPE (Isaac, 2026-09-30: "if I wanted to
   move that riser back about a meter, it should slide along the pipes. If I
   start dragging it directly off the line then the pipes can follow"). A node
   IN a run (the two halves a cut made, or the straightest pair of runs on it)
   moves along their combined line: the half behind it shortens, the half
   ahead lengthens, and a corner passed over moves from one half to the other.
   Anything else on the node (a branch) follows its end, as on any move. Off
   the line by more than `tol`, there is no slide: the caller drags it free. */

type Half = { run: DesignObject; pts: Point[]; rev: boolean };

/** the node's through line: the run coming in to it and the run going on,
    each oriented so the path reads in → node → on */
function throughLine(objects: readonly DesignObject[], nodeId: string): { in: Half; on: Half } | null {
  const ends = objects
    .filter((o): o is Polyline => o.type === "pipe-run" && o.geometry.kind === "polyline" && o.geometry.points.length >= 2)
    .flatMap((o) => {
      const out: { run: Polyline; atEnd: boolean }[] = [];
      if (attachOf(o.props.endAttach)?.id === nodeId) out.push({ run: o, atEnd: true });
      if (attachOf(o.props.startAttach)?.id === nodeId) out.push({ run: o, atEnd: false });
      return out;
    });
  if (ends.length < 2) return null;
  const toNode = (e: { run: Polyline; atEnd: boolean }): Half => {
    const p = e.run.geometry.points;
    return { run: e.run, pts: e.atEnd ? [...p] : [...p].reverse(), rev: !e.atEnd };
  };
  /* the halves a cut made, when it marked them */
  const cutIn = ends.find((e) => e.atEnd && e.run.props.cutEnd === nodeId);
  const cutOn = ends.find((e) => !e.atEnd && e.run.props.cutStart === nodeId);
  let pair: [(typeof ends)[number], (typeof ends)[number]] | null = cutIn && cutOn && cutIn.run !== cutOn.run ? [cutIn, cutOn] : null;
  /* else the straightest two: the pair whose last legs into the node are
     most nearly opposite */
  if (!pair) {
    let best = -Infinity;
    for (let i = 0; i < ends.length; i++)
      for (let j = i + 1; j < ends.length; j++) {
        if (ends[i].run === ends[j].run) continue;
        const a = toNode(ends[i]).pts;
        const b = toNode(ends[j]).pts;
        const da = { x: a[a.length - 1].x - a[a.length - 2].x, y: a[a.length - 1].y - a[a.length - 2].y };
        const db = { x: b[b.length - 1].x - b[b.length - 2].x, y: b[b.length - 1].y - b[b.length - 2].y };
        const la = Math.hypot(da.x, da.y) || 1;
        const lb = Math.hypot(db.x, db.y) || 1;
        const opposite = -(da.x * db.x + da.y * db.y) / (la * lb);
        if (opposite > best) {
          best = opposite;
          pair = [ends[i], ends[j]];
        }
      }
  }
  if (!pair) return null;
  const a = toNode(pair[0]);
  const b = toNode(pair[1]);
  /* `on` reads node → far end */
  return { in: a, on: { ...b, pts: [...b.pts].reverse() } };
}

/** slide a joint or riser to the nearest point on its through line to `w`:
    the objects with the node, its two halves and its branches moved, and
    where it went; null when it is not in a line, or `w` is more than `tol`
    off it */
export function slideOnRun(
  objects: readonly DesignObject[],
  nodeId: string,
  w: Point,
  tol: number
): { at: Point; objects: DesignObject[] } | null {
  const node = objects.find((o) => o.id === nodeId);
  if (!node || node.geometry.kind !== "point" || (node.type !== "joint" && node.type !== "riser")) return null;
  const line = throughLine(objects, nodeId);
  if (!line) return null;
  /* the whole line, in → node → on. The node's own point is no corner when
     the line runs straight through it, so it goes: the node leaves no kink
     where it used to be. At a real corner it stays. */
  const before = line.in.pts[line.in.pts.length - 2];
  const here = line.in.pts[line.in.pts.length - 1];
  const after = line.on.pts[1];
  const cross = (here.x - before.x) * (after.y - here.y) - (here.y - before.y) * (after.x - here.x);
  const straight = Math.abs(cross) < 1e-6 * Math.max(1, Math.hypot(after.x - before.x, after.y - before.y) ** 2);
  const path = [...line.in.pts.slice(0, straight ? -1 : undefined), ...line.on.pts.slice(1)];
  let best: { seg: number; at: Point; d: number } | null = null;
  for (let j = 0; j < path.length - 1; j++) {
    const hit = onSegment(w, path[j], path[j + 1]);
    if (!best || hit.d < best.d) best = { seg: j, at: hit.at, d: hit.d };
  }
  if (!best || best.d > tol) return null;
  /* never onto the line's far ends (a unit or the next joint is there): it
     stops short of them, still on the line */
  const gap = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
  const stopShort = (end: Point, from: Point): Point => {
    const len = gap(end, from);
    const m = Math.min(tol / 2, len / 2);
    return len === 0 ? end : { x: end.x + ((from.x - end.x) * m) / len, y: end.y + ((from.y - end.y) * m) / len };
  };
  let at = best.at;
  if (gap(at, path[0]) < tol / 2) at = stopShort(path[0], path[1]);
  if (gap(at, path[path.length - 1]) < tol / 2) at = stopShort(path[path.length - 1], path[path.length - 2]);
  if (best.seg === 0 && gap(at, path[0]) < 1e-9) return null;
  const clean = (pts: Point[]) => pts.filter((p, i) => i === 0 || gap(p, pts[i - 1]) > 1e-6);
  const inPts = clean([...path.slice(0, best.seg + 1), at]);
  const onPts = clean([at, ...path.slice(best.seg + 1)]);
  const orient = (h: Half, pts: Point[], endsAtNode: boolean) => {
    /* back to the run's own direction */
    const nodeLast = endsAtNode ? pts : [...pts].reverse();
    return h.rev ? [...nodeLast].reverse() : nodeLast;
  };
  const inGeom = orient(line.in, inPts, true);
  const onGeom = orient(line.on, onPts, false);
  const moved = objects.map((o) => {
    if (o.id === nodeId && o.geometry.kind === "point") return { ...o, geometry: { ...o.geometry, at } };
    if (o.id === line.in.run.id) return { ...o, geometry: { kind: "polyline" as const, points: inGeom } };
    if (o.id === line.on.run.id) return { ...o, geometry: { kind: "polyline" as const, points: onGeom } };
    return o;
  });
  return { at, objects: moved };
}
