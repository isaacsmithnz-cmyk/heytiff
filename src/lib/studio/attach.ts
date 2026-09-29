/* Design Studio — attached-run geometry maintenance.
   A run's endpoint attach (props.startAttach/endAttach, see graph.ts) is the
   truth of connectivity; its polyline endpoint is a coordinate snapshot taken
   at draw time. These helpers keep the two reconciled: an attached endpoint
   sits at its referenced object's current point. Used by the canvas move
   commit, the mid-drag preview, and open-time repair (migrations.ts).

   Pure functions, identity-preserving throughout: unchanged inputs come back
   by reference so React memos and no-op mutates stay cheap. */

import type { DesignObject, DesignSystem, Point } from "./document";
import { attachOf, type Attach } from "./graph";
import { isPlenumOf } from "./ducted";

/** Run types whose attached endpoints track their referenced object.
    pipe-run, drain-run and cable-run are live today; duct-run inherits the
    behaviour when it ships. */
export const ATTACHED_RUN_TYPES: ReadonlySet<string> = new Set([
  "pipe-run",
  "drain-run",
  "cable-run",
  "duct-run",
]);

const EPS = 1e-6;
const near = (a: number, b: number) => Math.abs(a - b) < EPS;
const samePt = (a: Point, b: Point) => near(a.x, b.x) && near(a.y, b.y);

/** Current anchor point of an attach target. Units and risers anchor at their
    centre; fitting/spigot/grille resolve with graph v1 — null until then, and
    null for a missing or non-point target (leave the run alone). */
export function anchorPointOf(
  byId: ReadonlyMap<string, DesignObject>,
  a: Attach
): Point | null {
  if (a.kind !== "unit" && a.kind !== "riser") return null;
  const o = byId.get(a.id);
  return o && o.geometry.kind === "point" ? o.geometry.at : null;
}

function dedupe(pts: Point[]): Point[] {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (!samePt(pts[i], out[out.length - 1])) out.push(pts[i]);
  }
  // a fully collapsed run keeps two coincident points rather than degenerating
  if (out.length < 2) out.push(pts[pts.length - 1]);
  return out;
}

/** Move one endpoint of a polyline to `target`. For runs of ≥3 points the
    final segment keeps its axis-alignment: the penultimate vertex shifts on
    the axis that segment doesn't care about, so both neighbouring segments
    stay orthogonal. 2-point runs stretch plainly — the far end is either
    attached elsewhere or user-placed, never ours to move. A corner that
    collapses onto the endpoint drops its bend. */
export function moveEndpointTo(
  points: Point[],
  end: "start" | "end",
  target: Point
): Point[] {
  // a run with no endpoint to move (corrupted document) is left as-is
  if (!Array.isArray(points) || points.length === 0) return points;
  const rev = end === "start";
  const pts = rev ? [...points].reverse() : [...points];
  const n = pts.length;
  const old = pts[n - 1];
  if (samePt(old, target)) return points;
  pts[n - 1] = target;
  if (n >= 3) {
    const pen = pts[n - 2];
    if (near(pen.x, old.x)) pts[n - 2] = { x: target.x, y: pen.y };
    else if (near(pen.y, old.y)) pts[n - 2] = { x: pen.x, y: target.y };
    // diagonal final segment (legacy data): plain stretch
  }
  return dedupe(rev ? pts.reverse() : pts);
}

/** Snap every attached run endpoint onto its referenced object's current
    position. `movedIds` limits work to runs touching those objects (the move
    commit); null reconciles everything (open-time repair). Dangling attaches
    (target gone) are left untouched — graph.ts already reports those as
    orphan runs, and reconciliation must not destroy data. */
export function reconcileAttachedRuns(
  objects: DesignObject[],
  movedIds: ReadonlySet<string> | null = null
): DesignObject[] {
  const byId = new Map(objects.map((o) => [o.id, o]));
  let changed = false;
  const next = objects.map((o) => {
    if (!ATTACHED_RUN_TYPES.has(o.type) || o.geometry?.kind !== "polyline") return o;
    let pts = o.geometry.points;
    for (const [key, end] of [
      ["startAttach", "start"],
      ["endAttach", "end"],
    ] as const) {
      const a = attachOf(o.props?.[key]);
      if (!a || (movedIds && !movedIds.has(a.id))) continue;
      const target = anchorPointOf(byId, a);
      if (target) pts = moveEndpointTo(pts, end, target);
    }
    if (pts === o.geometry.points) return o;
    changed = true;
    return { ...o, geometry: { kind: "polyline" as const, points: pts } };
  });
  return changed ? next : objects;
}

/* ── room moves: a room's units travel with it ──
   Membership is the props.roomId stamp (written on unit drop/move by the
   canvas): wall-mounted and roomLock-pinned units follow their room; ODUs
   and risers are never stamped, so they stay put and their runs stretch. */

/** ids of units stamped to this room — the set that travels with a room
    move. Captured at drag start so the preview and the commit agree. */
export function roomMemberIds(
  objects: DesignObject[],
  roomId: string
): Set<string> {
  const ids = new Set<string>();
  for (const o of objects) {
    if (o.type === "unit" && o.geometry.kind === "point" && o.props.roomId === roomId)
      ids.add(o.id);
  }
  return ids;
}

/** Translate a room's polygon and its member units by `delta`, then
    reconcile attached runs — one pure step so the canvas commit stays a
    single mutate (one undo restores room, units and pipes together). */
export function translateRoomWithContents(
  objects: DesignObject[],
  roomId: string,
  memberIds: ReadonlySet<string>,
  delta: Point
): DesignObject[] {
  if (near(delta.x, 0) && near(delta.y, 0)) return objects;
  const shift = (p: Point): Point => ({ x: p.x + delta.x, y: p.y + delta.y });
  const moved = objects.map((o) => {
    if (o.id === roomId && o.geometry.kind === "polygon")
      return {
        ...o,
        geometry: { kind: "polygon" as const, points: o.geometry.points.map(shift) },
      };
    if (memberIds.has(o.id) && o.geometry.kind === "point")
      return { ...o, geometry: { ...o.geometry, at: shift(o.geometry.at) } };
    return o;
  });
  return reconcileAttachedRuns(moved, memberIds);
}

/** Deleting a room takes what belongs to it: the units stamped to it and
    those units' plenums, mirroring the way a room move carries them. Runs
    that reached those units keep their geometry but lose the attach ref, so
    they read as open ends instead of claiming a connection to something
    that no longer exists. */
export function deleteRoomWithContents(
  objects: DesignObject[],
  roomId: string
): DesignObject[] {
  const memberIds = roomMemberIds(objects, roomId);
  const kept = objects.filter(
    (o) =>
      o.id !== roomId &&
      !memberIds.has(o.id) &&
      ![...memberIds].some((id) => isPlenumOf(o, id))
  );
  return stripAttachesTo(kept, memberIds);
}

/** Drop deleted rooms from every system's adopted-room list, so dead ids
    can't linger in `settings.roomIds`. */
export function releaseRoomsFromSystems(
  systems: DesignSystem[],
  roomIds: ReadonlySet<string>
): DesignSystem[] {
  if (roomIds.size === 0) return systems;
  let changed = false;
  const next = systems.map((s) => {
    const cur = Array.isArray(s.settings.roomIds) ? (s.settings.roomIds as string[]) : [];
    if (!cur.some((id) => roomIds.has(id))) return s;
    changed = true;
    return {
      ...s,
      settings: { ...s.settings, roomIds: cur.filter((id) => !roomIds.has(id)) },
    };
  });
  return changed ? next : systems;
}

/** Filter objects, then drop attach refs to everything that went — so a bulk
    delete (a whole system, a floor) can't leave a surviving run claiming a
    connection to a unit that no longer exists. */
export function pruneObjects(
  objects: DesignObject[],
  keep: (o: DesignObject) => boolean
): DesignObject[] {
  const kept = objects.filter(keep);
  if (kept.length === objects.length) return objects;
  const keptIds = new Set(kept.map((o) => o.id));
  const gone = new Set<string>();
  for (const o of objects) if (!keptIds.has(o.id)) gone.add(o.id);
  return stripAttachesTo(kept, gone);
}

/** ids of the rooms among `objects` that `keep` would remove — the set to
    release from systems alongside a bulk prune. */
export function removedRoomIds(
  objects: DesignObject[],
  keep: (o: DesignObject) => boolean
): Set<string> {
  const ids = new Set<string>();
  for (const o of objects) if (o.type === "room" && !keep(o)) ids.add(o.id);
  return ids;
}

/** Drop attach refs that point at any of `deletedIds`. Geometry is untouched:
    the run stays drawn where it was, now a genuinely open end — so the graph
    and the cockpit's connected-ends counters read the truth. */
export function stripAttachesTo(
  objects: DesignObject[],
  deletedIds: ReadonlySet<string>
): DesignObject[] {
  let changed = false;
  const next = objects.map((o) => {
    if (!ATTACHED_RUN_TYPES.has(o.type)) return o;
    const s = attachOf(o.props?.startAttach);
    const e = attachOf(o.props?.endAttach);
    const dropS = s !== null && deletedIds.has(s.id);
    const dropE = e !== null && deletedIds.has(e.id);
    if (!dropS && !dropE) return o;
    changed = true;
    const props = { ...o.props };
    if (dropS) delete props.startAttach;
    if (dropE) delete props.endAttach;
    return { ...o, props };
  });
  return changed ? next : objects;
}
