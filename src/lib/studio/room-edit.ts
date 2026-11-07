/* ROOMS ON THE PLAN, EDITED WHERE THEY ARE (the next flow, boards 3 and 4 of
   the Studio rework mocks, https://claude.ai/artifact/Dohqw25XUuCwkHYcxLeWTU).
   A picked room shows its corners: drag one, pull a new one out of a wall's
   middle, Delete the picked one. Two rooms picked together join as one.
   What Tiff read and nobody has kept yet stays on the floor as "found", one
   press from a room, and a kept one takes its outside walls from the windows
   and doors she read on them, so the wall marks, the facing and the load all
   start from the plan.

   Pure. Points are world units on the floor, as everywhere in the Studio. */

import { releaseZones } from "./builder";
import type { DesignDocument, DesignObject, Point } from "./document";
import { distToSegment, isAxisAlignedRect } from "./geometry";
import type { DataPack } from "./packs/schema";
import type { ReadOpening } from "./reading";
import { joinOutlines, roomFrom, suggestionsFor, type Suggestion } from "./rooms-from-reading";

/** A new corner on the wall from corner `edge` to the next, at `at`. */
export function insertCorner(points: Point[], edge: number, at: Point): Point[] {
  const out = [...points];
  out.splice(edge + 1, 0, at);
  return out;
}

/** The outline without corner `index`; null when that would leave under three. */
export function removeCorner(points: Point[], index: number): Point[] | null {
  if (points.length <= 3) return null;
  return points.filter((_, i) => i !== index);
}

/** The outside walls once a corner goes on wall `edge`: that wall is two
    now, both outside if it was, and every wall after it moves up one. */
export function wallsAfterInsert(walls: number[], edge: number): number[] {
  const out = walls.flatMap((w) => (w < edge ? [w] : w === edge ? [w, w + 1] : [w + 1]));
  return [...new Set(out)].sort((a, b) => a - b);
}

/** The outside walls once corner `index` of `n` comes off: the walls either
    side of it are one, outside if either was, and every wall after moves
    down one. */
export function wallsAfterRemove(walls: number[], index: number, n: number): number[] {
  const merged = index === 0 ? n - 2 : index - 1;
  const out = walls.map((w) => (w === index || w === (index - 1 + n) % n ? merged : w > index ? w - 1 : w));
  return [...new Set(out)].sort((a, b) => a - b);
}

/** A changed outline's props: still a rectangle, or a shape of its own now. */
export function shapeAfterEdit(points: Point[]): "rect" | "poly" {
  return points.length === 4 && isAxisAlignedRect(points, 1) ? "rect" : "poly";
}

/** The outline's walls an outside opening sits on: the wall nearest each
    opening's middle, within `reach` world units. */
export function wallsWithOpenings(points: Point[], openings: Pick<ReadOpening, "a" | "b" | "external">[], reach: number): number[] {
  const walls = new Set<number>();
  for (const o of openings) {
    if (!o.external) continue;
    const mid = { x: (o.a.x + o.b.x) / 2, y: (o.a.y + o.b.y) / 2 };
    let best = -1;
    let bestD = reach;
    for (let i = 0; i < points.length; i++) {
      const d = distToSegment(mid, points[i], points[(i + 1) % points.length]);
      if (d <= bestD) {
        best = i;
        bestD = d;
      }
    }
    if (best >= 0) walls.add(best);
  }
  return [...walls].sort((a, b) => a - b);
}

/* An opening up to this far off the outline's line is on that wall: a
   reading traces the inside face, and a window sits in the wall's middle. */
const WALL_REACH_MM = 400;

/** Tiff's rooms on a floor that aren't on the plan: each one's key is its
    sheet and place in her read, so it stays the same from render to render
    and a kept room remembers which one it came from. */
export function foundOn(doc: DesignDocument, floorId: string): Suggestion[] {
  const floor = doc.floors.find((f) => f.id === floorId);
  const sheets = doc.reading?.floors[floorId];
  if (!floor || !sheets?.length) return [];
  /* a joined room holds the keys of every read room it took in */
  const kept = new Set(
    doc.objects
      .filter((o) => o.type === "room" && o.floorId === floorId)
      .flatMap((o) => [o.props.readKey, ...(Array.isArray(o.props.joinedKeys) ? o.props.joinedKeys : [])])
      .filter((k): k is string => typeof k === "string"),
  );
  /* a room kept before rooms remembered their key: matched by name */
  const named = new Set(
    doc.objects
      .filter((o) => o.type === "room" && o.floorId === floorId && o.props.fromReading === true && o.props.readKey == null)
      .map((o) => norm(String(o.props.name ?? ""))),
  );
  return suggestionsFor(floor, sheets).filter((s) => !kept.has(s.key) && !named.has(norm(s.name)));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Found rooms on the plan, as Studio rooms: their outside walls marked
    from the openings she read on them. `ids`: the id a found room takes,
    when the caller wants to pick it straight after. */
export function keepFound(doc: DesignDocument, floorId: string, keys: string[], ids: Record<string, string> = {}): DesignDocument {
  const floor = doc.floors.find((f) => f.id === floorId);
  const mm = floor?.scaleMmPerUnit;
  if (!floor || !mm) return doc;
  const want = new Set(keys);
  const sheets = doc.reading?.floors[floorId] ?? [];
  const roomAbove = doc.floors.some((f) => f.level > floor.level);
  const added: DesignObject[] = [];
  for (const s of foundOn(doc, floorId)) {
    if (!want.has(s.key)) continue;
    const room = roomFrom(s, floorId, mm, roomAbove);
    const sheet = sheets.find((r) => s.key.startsWith(`${r.sheetId}:`));
    const plan = floor.plans.find((p) => p.id === sheet?.sheetId);
    const at = (p: Point) => (plan ? { x: plan.x + p.x, y: plan.y + p.y } : p);
    const openings = (s.openings ?? []).map((o) => ({ ...o, a: at(o.a), b: at(o.b) }));
    const walls = room.geometry.kind === "polygon" ? wallsWithOpenings(room.geometry.points, openings, WALL_REACH_MM / mm) : [];
    const height = readHeightOf(doc, floorId, s.name);
    added.push({
      ...room,
      id: ids[s.key] ?? room.id,
      props: {
        ...room.props,
        readKey: s.key,
        externalWalls: walls,
        hasExternalWalls: walls.length > 0 || room.props.hasExternalWalls === true,
        ...(height ? { ceilingHeightM: height.m, heightFrom: height.from } : {}),
      },
    });
  }
  return added.length ? { ...doc, objects: [...doc.objects, ...added] } : doc;
}

/** The ceiling height the set gives a room, in metres, and where it says
    so: a raked ceiling read for the room by name, its middle height; else
    its floor's ceiling off the sections. */
export function readHeightOf(doc: DesignDocument, floorId: string, name: string): { m: number; from: string } | null {
  const roof = doc.reading?.roof;
  if (!roof) return null;
  /* where it says so, in a few words: her source is often a paragraph of
     working, the drawing it's off comes first */
  const short = (src: string) => {
    const head = src.split(/[:;(]/)[0].trim();
    return head.length > 40 ? `${head.slice(0, 40).replace(/\s+\S*$/, "")}…` : head;
  };
  const rake = roof.raked.find((r) => r.floorId === floorId && norm(r.room) === norm(name));
  if (rake) return { m: Math.round((rake.lowMm + rake.highMm) / 2) / 1000, from: `raked, ${rake.lowMm / 1000} to ${rake.highMm / 1000} m` };
  const level = roof.levels.find((l) => l.floorId === floorId);
  return level ? { m: level.ceilingMm / 1000, from: short(level.source) || "the sections" } : null;
}

/** Whether two outlines meet: a corner of one on, in, or within `gap` of
    the other. Rooms either side of a wall are `gap` apart, a wall's width. */
export function touches(a: Point[], b: Point[], gap: number): boolean {
  const near = (p: Point, poly: Point[]) =>
    within(p, poly) || poly.some((q, i) => distToSegment(p, q, poly[(i + 1) % poly.length]) <= gap);
  return a.some((p) => near(p, b)) || b.some((p) => near(p, a));
}

function within(p: Point, poly: Point[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** The rooms picked to join, if they can be: each one meets one before it,
    within a wall's width (300 mm), so the join never draws over a hall. */
export function canJoin(doc: DesignDocument, ids: string[]): boolean {
  const rooms = ids.map((id) => doc.objects.find((o) => o.id === id && o.type === "room"));
  if (rooms.length < 2 || rooms.some((r) => !r || r.geometry.kind !== "polygon" || r.floorId !== rooms[0]!.floorId)) return false;
  const floor = doc.floors.find((f) => f.id === rooms[0]!.floorId);
  const gap = floor?.scaleMmPerUnit ? 300 / floor.scaleMmPerUnit : 0;
  const pts = rooms.map((r) => (r!.geometry.kind === "polygon" ? r!.geometry.points : []));
  return pts.slice(1).every((p, i) => pts.slice(0, i + 1).some((q) => touches(p, q, gap)));
}

/** Rooms picked together as one, under the first one's name: the outline
    traced round them across the walls between, what sat in the others now
    in it, and the others off any system that claimed them. */
export function joinRooms(doc: DesignDocument, pack: DataPack | null, ids: string[]): DesignDocument {
  if (!canJoin(doc, ids)) return doc;
  const rooms = ids.map((id) => doc.objects.find((o) => o.id === id && o.type === "room")).filter((o): o is DesignObject => !!o);
  const [first, ...rest] = rooms;
  const floor = doc.floors.find((f) => f.id === first.floorId);
  if (!floor || rest.some((r) => r.floorId !== first.floorId)) return doc;
  const wall = floor.scaleMmPerUnit ? 300 / floor.scaleMmPerUnit : 0;
  const ptsOf = (o: DesignObject) => (o.geometry.kind === "polygon" ? o.geometry.points : []);
  const points = rest.reduce((acc, r) => joinOutlines(acc, ptsOf(r), wall), ptsOf(first));
  const gone = new Set(rest.map((r) => r.id));
  const released = releaseZones(doc, pack, gone);
  const walls = new Set<number>();
  /* the joined outline's outside walls: every wall of it that lay on an
     outside wall of one of the rooms */
  for (const r of rooms) {
    const pts = ptsOf(r);
    const marked = Array.isArray(r.props.externalWalls) ? (r.props.externalWalls as number[]) : [];
    for (const i of marked) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (!a || !b) continue;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const on = wallsWithOpenings(points, [{ a: mid, b: mid, external: true }], wall || 1);
      for (const w of on) walls.add(w);
    }
  }
  return {
    ...released,
    objects: released.objects
      .filter((o) => !gone.has(o.id))
      .map((o) => {
        if (o.id === first.id)
          return {
            ...o,
            geometry: { kind: "polygon" as const, points },
            props: {
              ...o.props,
              shape: shapeAfterEdit(points),
              joinedKeys: rest.flatMap((r) => [r.props.readKey, ...(Array.isArray(r.props.joinedKeys) ? r.props.joinedKeys : [])]).concat(Array.isArray(o.props.joinedKeys) ? o.props.joinedKeys : []).filter((k) => typeof k === "string"),
              externalWalls: [...walls].sort((a, b) => a - b),
              hasExternalWalls: walls.size > 0 || rooms.some((r) => r.props.hasExternalWalls === true),
            },
          };
        if (typeof o.props.roomId === "string" && gone.has(o.props.roomId)) return { ...o, props: { ...o.props, roomId: first.id } };
        return o;
      }),
  };
}
