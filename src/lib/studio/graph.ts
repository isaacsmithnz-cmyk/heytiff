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
   - riser:    type "riser",    point geometry, props { group: "A",
               manualM? }
               — risers sharing a group (within one system) are the same
               vertical pipe; consecutive levels link with a vertical edge as
               tall as the floors between them, or the lower riser's manualM
               when set by hand (a floor console's pipe starts at the floor
               and may rise to the ceiling of the floor above: 6 m, not 3 —
               Isaac, 2026-09-30). The legacy heightM every riser was written
               with (always 3) is ignored.

   HEIGHTS (Isaac, 2026-09-30, for the book's lift limits): a floor stands
   on the one below it, each floor as tall as its `heightM` (3 m unset); a
   unit, box or riser sits `props.mountM` above its own floor (0 unset). An
   edge's rise is the height between its two ends. A run's length stays the
   one drawn on the plan; a riser's is its height.

   Pure functions: (objects, floors) in → nodes/edges/paths out. No React. */

import type { DesignDocument, DesignObject, Floor } from "./document";
import { polylineLength, smoothedLength, unitsToMeters } from "./geometry";

/* Attach kinds: unit/riser are live today (graph v0); fitting/spigot/grille
   are the Stage-7 duct anchors (ducted spec §13) — accepted now so duct-run
   endpoints can record them, resolved to nodes by graph v1 (Step 4). */
export interface Attach {
  kind: "unit" | "riser" | "joint" | "branch-box" | "fitting" | "spigot" | "grille";
  id: string;
}

const ATTACH_KINDS: ReadonlySet<string> = new Set([
  "unit",
  "riser",
  "joint",
  "branch-box",
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
  /** vertical rise a→b in metres (0 when both ends are at one height) */
  riseM: number;
  /** elbows the edge itself puts in the pipe: a riser turns at each end a
      run leaves it (a run's own corners are counted from its drawing) */
  bends?: number;
}

export interface SystemGraph {
  /** node id → the object (units, risers and joints) */
  nodes: Map<string, DesignObject>;
  edges: GraphEdge[];
  /** runs whose endpoints never attached to anything on either end */
  orphanRuns: string[];
}

/** a floor's storey height, metres (unset = 3) */
export const DEFAULT_FLOOR_HEIGHT_M = 3;
export const floorHeightM = (f: Floor): number =>
  typeof f.heightM === "number" && f.heightM > 0 ? f.heightM : DEFAULT_FLOOR_HEIGHT_M;

/** each floor's height above the lowest floor, metres: floors stack in level
    order, each on the one below; floors sharing a level share it (the
    taller one sets how high the next level starts) */
export function floorBasesM(floors: readonly Floor[]): Map<string, number> {
  const levels = [...new Set(floors.map((f) => f.level))].sort((a, b) => a - b);
  const baseOfLevel = new Map<number, number>();
  let at = 0;
  for (const l of levels) {
    baseOfLevel.set(l, at);
    at += Math.max(...floors.filter((f) => f.level === l).map(floorHeightM));
  }
  return new Map(floors.map((f) => [f.id, baseOfLevel.get(f.level) ?? 0]));
}

/** a placed object's height above its own floor, metres (props.mountM) */
export const mountOf = (o: DesignObject): number => {
  const v = Number(o.props.mountM);
  return Number.isFinite(v) ? v : 0;
};

/** set a floor's storey height (null or not above 0 clears it to the default) */
export function setFloorHeight(doc: DesignDocument, floorId: string, m: number | null): DesignDocument {
  return {
    ...doc,
    floors: doc.floors.map((f) => {
      if (f.id !== floorId) return f;
      const { heightM: _old, ...rest } = f;
      void _old;
      return m != null && Number.isFinite(m) && m > 0 ? { ...rest, heightM: m } : rest;
    }),
  };
}

/** a riser's height set by hand (the pipe up from it), or null */
export const manualRiserM = (o: DesignObject): number | null => {
  const v = Number(o.props.manualM);
  return Number.isFinite(v) && v > 0 ? v : null;
};

/** the vertical a picked riser is part of: the one going up from it, else
    the one coming up to it. `lowerId` is the riser that carries its height
    set by hand; `planM` is what the floor heights make it. */
export interface RiserGap {
  lowerId: string;
  fromFloorId: string;
  toFloorId: string;
  planM: number;
  manualM: number | null;
}

export function riserGapOf(objects: DesignObject[], floors: Floor[], riserId: string): RiserGap | null {
  const r = objects.find((o) => o.id === riserId && o.type === "riser");
  if (!r) return null;
  const group = String(r.props.group ?? "A");
  const level = new Map(floors.map((f) => [f.id, f.level]));
  const sorted = objects
    .filter((o) => o.type === "riser" && o.systemId === r.systemId && String(o.props.group ?? "A") === group)
    .sort((x, y) => (level.get(x.floorId) ?? 0) - (level.get(y.floorId) ?? 0));
  const i = sorted.findIndex((o) => o.id === riserId);
  const [lower, upper] = i < sorted.length - 1 ? [sorted[i], sorted[i + 1]] : i > 0 ? [sorted[i - 1], sorted[i]] : [null, null];
  if (!lower || !upper) return null;
  const base = floorBasesM(floors);
  const at = (o: DesignObject) => (base.get(o.floorId) ?? 0) + mountOf(o);
  return {
    lowerId: lower.id,
    fromFloorId: lower.floorId,
    toFloorId: upper.floorId,
    planM: Math.abs(at(upper) - at(lower)),
    manualM: manualRiserM(lower),
  };
}

/** set a riser's height by hand (on the riser it rises from); null goes back
    to the floor heights */
export function setRiserHeight(doc: DesignDocument, lowerId: string, m: number | null): DesignDocument {
  return {
    ...doc,
    objects: doc.objects.map((o) => {
      if (o.id !== lowerId) return o;
      const { manualM: _old, ...props } = o.props;
      void _old;
      return { ...o, props: m != null && Number.isFinite(m) && m > 0 ? { ...props, manualM: m } : props };
    }),
  };
}

/** set a placed object's height above its floor (null clears it to 0) */
export function setMount(doc: DesignDocument, id: string, m: number | null): DesignDocument {
  return {
    ...doc,
    objects: doc.objects.map((o) => {
      if (o.id !== id) return o;
      const { mountM: _old, ...props } = o.props;
      void _old;
      return { ...o, props: m == null || m === 0 ? props : { ...props, mountM: m } };
    }),
  };
}

/** Build the endpoint-connectivity graph for ONE system's objects. */
export function buildSystemGraph(
  objects: DesignObject[],
  floors: Floor[],
  systemId: string
): SystemGraph {
  const mine = objects.filter((o) => o.systemId === systemId);
  const floorById = new Map(floors.map((f) => [f.id, f]));

  const base = floorBasesM(floors);
  const elevationOf = (o: DesignObject) => (base.get(o.floorId) ?? 0) + mountOf(o);

  const nodes = new Map<string, DesignObject>();
  for (const o of mine) {
    // a joint is where runs branch (joints.ts): a node like a riser
    if (o.type === "unit" || o.type === "riser" || o.type === "joint" || o.type === "branch-box") nodes.set(o.id, o);
  }

  const edges: GraphEdge[] = [];
  const orphanRuns: string[] = [];

  // pipe runs → edges between attached endpoints
  for (const o of mine) {
    if (o.type !== "pipe-run" || o.geometry.kind !== "polyline") continue;
    const start = attachOf(o.props.startAttach);
    const end = attachOf(o.props.endAttach);
    const scale = floorById.get(o.floorId)?.scaleMmPerUnit ?? null;
    // a soft-drawn run is the smoothed curve through its dots — the takeoff
    // must measure the pipe that gets installed, not the chords between dots
    const drawnUnits =
      o.props.form === "soft"
        ? smoothedLength(o.geometry.points)
        : polylineLength(o.geometry.points);
    const lengthM = scale != null ? unitsToMeters(drawnUnits, scale) : null;
    if (start && end && nodes.has(start.id) && nodes.has(end.id)) {
      const riseM = elevationOf(nodes.get(end.id)!) - elevationOf(nodes.get(start.id)!);
      edges.push({ id: o.id, a: start.id, b: end.id, lengthM, riseM });
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
    const runOn = (id: string) =>
      mine.some(
        (r) =>
          r.type === "pipe-run" &&
          (attachOf(r.props.startAttach)?.id === id || attachOf(r.props.endAttach)?.id === id)
      );
    for (let i = 0; i < sorted.length - 1; i++) {
      const lower = sorted[i];
      const upper = sorted[i + 1];
      const h = elevationOf(upper) - elevationOf(lower);
      const manual = manualRiserM(lower);
      edges.push({
        id: `riser-gap:${group}:${i}`,
        a: lower.id,
        b: upper.id,
        lengthM: manual ?? Math.abs(h),
        riseM: h,
        bends: (runOn(lower.id) ? 1 : 0) + (runOn(upper.id) ? 1 : 0),
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
