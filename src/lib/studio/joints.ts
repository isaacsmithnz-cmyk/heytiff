/* Joints on the plan (docs/studio-vrf.md, step 3): where a refrigerant run
   branches. A joint is a point object of its system; runs attach to it the
   way they attach to a unit or a riser. Two ways make one (Isaac,
   2026-09-28): the Joint tool drops one, and a run's end landing on another
   run makes one there. Either way a joint ON a run cuts it in two at that
   point, each half keeping its far end's attach, so the graph sees a node
   with three runs meeting — a branch. A joint with three or more runs out of
   it is a header when the tree is sized (vrf-tree.ts).

   Pure functions over the document. No React. */

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
  if (!run || run.type !== "pipe-run" || run.geometry.kind !== "polyline" || !run.systemId) return null;
  const pts = run.geometry.points;
  if (seg < 0 || seg >= pts.length - 1) return null;
  const joint = jointObject(run.systemId, run.floorId, at, jointId);
  const same = (p: Point) => Math.hypot(p.x - at.x, p.y - at.y) < 1e-6;
  const { startAttach, endAttach, ...rest } = run.props;
  const start = attachOf(startAttach);
  const end = attachOf(endAttach);
  const toJoint = { kind: "joint" as const, id: joint.id };

  /* at an end: attach that end to the joint, no cut (an end already joined
     to something else keeps it — a joint does not steal a unit's pipe) */
  if (same(pts[0]) || same(pts[pts.length - 1])) {
    const atStart = same(pts[0]);
    if ((atStart && start) || (!atStart && end)) return null;
    const props = { ...run.props, [atStart ? "startAttach" : "endAttach"]: toJoint };
    return {
      doc: { ...doc, objects: [...doc.objects.map((o) => (o.id === runId ? { ...o, props } : o)), joint] },
      jointId: joint.id,
    };
  }

  const first: DesignObject = {
    ...run,
    geometry: { kind: "polyline", points: [...pts.slice(0, seg + 1), at] },
    props: { ...rest, ...(start ? { startAttach: start } : {}), endAttach: toJoint },
  };
  const second: DesignObject = {
    ...run,
    id: newId("obj"),
    geometry: { kind: "polyline", points: [at, ...pts.slice(seg + 1)] },
    props: { ...rest, startAttach: toJoint, ...(end ? { endAttach: end } : {}) },
  };
  const objects = doc.objects.flatMap((o) => (o.id === runId ? [first, second] : [o]));
  return { doc: { ...doc, objects: [...objects, joint] }, jointId: joint.id };
}
