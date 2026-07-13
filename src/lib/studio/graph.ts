/* Design Studio — connectivity graph v0 (Stage 4).
   Endpoint connectivity only: knows whether IDU / ODU / runs are actually
   joined — the split badge depends on it (design-studio-plan.md, Stage 4).
   Junction nodes and downstream aggregation arrive with graph v1 (Stage 7);
   this file deliberately models nothing but units, risers and runs.

   Object conventions (all plain DesignObjects — no schema bump):
   - unit:     type "unit",     point geometry, props { role: "idu"|"odu",
               model, widthMm, depthMm }
   - pipe run: type "pipe-run", polyline geometry, props { startAttach?,
               endAttach? } where an attach is { kind: "unit"|"riser", id }
               — recorded by the canvas when an endpoint snaps to an anchor.
   - riser:    type "riser",    point geometry, props { group: "A", heightM }
               — risers sharing a group (within one system) are the same
               vertical pipe; consecutive levels link with a vertical edge of
               the lower riser's heightM.

   Pure functions: (objects, floors) in → nodes/edges/paths out. No React. */

import type { DesignObject, Floor } from "./document";
import { polylineLength, unitsToMeters } from "./geometry";

/* Attach kinds: unit/riser are live today (graph v0); fitting/spigot/grille
   are the Stage-7 duct anchors (ducted spec §13) — accepted now so duct-run
   endpoints can record them, resolved to nodes by graph v1 (Step 4). */
export interface Attach {
  kind: "unit" | "riser" | "fitting" | "spigot" | "grille";
  id: string;
}

const ATTACH_KINDS: ReadonlySet<string> = new Set([
  "unit",
  "riser",
  "fitting",
  "spigot",
  "grille",
]);

export function attachOf(v: unknown): Attach | null {
  if (typeof v !== "object" || v === null) return null;
  const a = v as Record<string, unknown>;
  return typeof a.kind === "string" && ATTACH_KINDS.has(a.kind) && typeof a.id === "string"
    ? { kind: a.kind as Attach["kind"], id: a.id }
    : null;
}

export interface GraphEdge {
  /** object id of the pipe-run, or `riser-gap:<group>:<level>` for verticals */
  id: string;
  a: string; // node id (object id of a unit or riser)
  b: string;
  /** metres; null when the run's floor is uncalibrated */
  lengthM: number | null;
  /** vertical rise a→b in metres (0 for horizontal runs) */
  riseM: number;
}

export interface SystemGraph {
  /** node id → the object (units and risers) */
  nodes: Map<string, DesignObject>;
  edges: GraphEdge[];
  /** runs whose endpoints never attached to anything on either end */
  orphanRuns: string[];
}

/** Build the endpoint-connectivity graph for ONE system's objects. */
export function buildSystemGraph(
  objects: DesignObject[],
  floors: Floor[],
  systemId: string
): SystemGraph {
  const mine = objects.filter((o) => o.systemId === systemId);
  const floorById = new Map(floors.map((f) => [f.id, f]));

  const nodes = new Map<string, DesignObject>();
  for (const o of mine) {
    if (o.type === "unit" || o.type === "riser") nodes.set(o.id, o);
  }

  const edges: GraphEdge[] = [];
  const orphanRuns: string[] = [];

  // pipe runs → edges between attached endpoints
  for (const o of mine) {
    if (o.type !== "pipe-run" || o.geometry.kind !== "polyline") continue;
    const start = attachOf(o.props.startAttach);
    const end = attachOf(o.props.endAttach);
    const scale = floorById.get(o.floorId)?.scaleMmPerUnit ?? null;
    const lengthM =
      scale != null
        ? unitsToMeters(polylineLength(o.geometry.points), scale)
        : null;
    if (start && end && nodes.has(start.id) && nodes.has(end.id)) {
      edges.push({ id: o.id, a: start.id, b: end.id, lengthM, riseM: 0 });
    } else {
      orphanRuns.push(o.id);
    }
  }

  // risers sharing a group: vertical edges between consecutive floor levels
  const byGroup = new Map<string, DesignObject[]>();
  for (const o of mine) {
    if (o.type !== "riser") continue;
    const g = String(o.props.group ?? "A");
    const arr = byGroup.get(g) ?? [];
    arr.push(o);
    byGroup.set(g, arr);
  }
  for (const [group, risers] of byGroup) {
    const sorted = [...risers].sort(
      (x, y) =>
        (floorById.get(x.floorId)?.level ?? 0) -
        (floorById.get(y.floorId)?.level ?? 0)
    );
    for (let i = 0; i < sorted.length - 1; i++) {
      const lower = sorted[i];
      const upper = sorted[i + 1];
      const h = Number(lower.props.heightM ?? 3);
      edges.push({
        id: `riser-gap:${group}:${i}`,
        a: lower.id,
        b: upper.id,
        lengthM: h,
        riseM: h,
      });
    }
  }

  return { nodes, edges, orphanRuns };
}

export interface PathResult {
  /** node ids from source to target inclusive */
  nodeIds: string[];
  /** total pipe length in metres; null if any segment is uncalibrated */
  lengthM: number | null;
  /** |net vertical| in metres between the endpoints */
  liftM: number;
}

/** BFS shortest path (by hop count) between two nodes; null when unreachable. */
export function findPath(
  graph: SystemGraph,
  fromId: string,
  toId: string
): PathResult | null {
  if (!graph.nodes.has(fromId) || !graph.nodes.has(toId)) return null;
  const prev = new Map<string, { node: string; edge: GraphEdge }>();
  const seen = new Set([fromId]);
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === toId) break;
    for (const e of graph.edges) {
      const next = e.a === cur ? e.b : e.b === cur ? e.a : null;
      if (!next || seen.has(next)) continue;
      seen.add(next);
      prev.set(next, { node: cur, edge: e });
      queue.push(next);
    }
  }
  if (!seen.has(toId)) return null;

  const nodeIds = [toId];
  let lengthM: number | null = 0;
  let rise = 0;
  let cur = toId;
  while (cur !== fromId) {
    const p = prev.get(cur)!;
    if (lengthM != null)
      lengthM = p.edge.lengthM == null ? null : lengthM + p.edge.lengthM;
    // rise is stored a→b; walking b→a flips the sign
    rise += p.edge.a === p.node ? p.edge.riseM : -p.edge.riseM;
    cur = p.node;
    nodeIds.push(cur);
  }
  nodeIds.reverse();
  return { nodeIds, lengthM, liftM: Math.abs(rise) };
}

/** Total drawn pipe length for a system in metres (all runs + riser gaps);
    null when any run sits on an uncalibrated floor. Materials uses this. */
export function totalPipeLengthM(graph: SystemGraph): number | null {
  let total = 0;
  for (const e of graph.edges) {
    if (e.lengthM == null) return null;
    total += e.lengthM;
  }
  return total;
}
