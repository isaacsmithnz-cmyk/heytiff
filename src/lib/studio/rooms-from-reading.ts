/* ROOMS FROM TIFF'S READING (20 October; the boards flow-rooms and
   flow-adjust at https://claude.ai/artifact/ST5TfR7UjifF9S81ZnTkFo). What the
   Rooms page offers once a floor has its scale: every space she read on it,
   placed on the floor, the ones an air conditioner usually serves ticked
   (Isaac, 20 October: "ticked"), each with its glass and where it faces.
   Nothing becomes a room until the person presses Done; then each kept one
   is a Studio room like one drawn by hand, its load the Studio's own.

   Pure. A sheet's points are its own pixels; on the floor they sit at the
   sheet's place, which is what a room drawn on that sheet uses too. */

import { newId, type DesignObject, type Floor, type Point } from "./document";
import { isAxisAlignedRect, polygonArea } from "./geometry";
import type { GlazingLevel, Orientation } from "./loads";
import type { ReadOpening, ReadSpace, SheetReading } from "./reading";

export type Suggestion = {
  key: string;
  name: string;
  kind: ReadSpace["kind"];
  /** on the floor, world units */
  points: Point[];
  keep: boolean;
  /** what the plan says that the reading doesn't account for, in words */
  notes: string[];
  /** the windows read as this room's, for its glass and its facing */
  windows: ReadOpening[];
};

/* The spaces an air conditioner usually serves come ticked; wet rooms,
   cupboards, halls, stairs and outside come unticked. */
const SERVED = /\b(bed|bedroom|master|guest|nursery|living|lounge|family|dining|meals|kitchen|study|office|rumpus|media|theatre|games|retreat|sitting|gym|studio|activity|playroom)\b/i;

export const servedByDefault = (s: Pick<ReadSpace, "kind" | "name">) => s.kind === "room" && SERVED.test(s.name);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Every space she read on a floor, placed on it, outside spaces and voids left out. */
export function suggestionsFor(floor: Pick<Floor, "plans">, sheets: SheetReading[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const r of sheets) {
    const sheet = floor.plans.find((p) => p.id === r.sheetId);
    if (!sheet) continue;
    const at = (p: Point) => ({ x: sheet.x + p.x, y: sheet.y + p.y });
    for (const s of r.spaces) {
      if (s.outline.length < 3 || ["void", "notch", "outdoor", "stair"].includes(s.kind) || s.existing) continue;
      const notes = r.flags.filter((f) => f.kind === "label_inside" && f.room === s.name).map((f) => `"${f.text}" is written inside ${s.name}: a space of its own?`);
      out.push({
        key: newId("sg"),
        name: s.name,
        kind: s.kind,
        points: s.outline.map(at),
        keep: servedByDefault(s),
        notes,
        windows: r.openings.filter((o) => o.kind === "window" && norm(o.room) === norm(s.name)),
      });
    }
  }
  return out;
}

/* A window's glass is its width by this height when the plan gives only
   the width (the floor read does; the elevations will give the real one). */
const WINDOW_HEIGHT_M = 1.2;

/** The glass read for a room, in m². */
export const glassM2 = (s: Pick<Suggestion, "windows">) => s.windows.reduce((t, w) => t + (w.widthMm / 1000) * WINDOW_HEIGHT_M, 0);

/** The glazing level from glass over floor area, by the fixed cut-offs
    (Isaac left it to the most reliable answer, 20 October): under 15% low,
    15 to 30% moderate, over 30% high. Undefined when there's no floor area
    to judge by. */
export function glazingFor(areaM2: number, glass: number): GlazingLevel | undefined {
  if (!(areaM2 > 0)) return undefined;
  const r = glass / areaM2;
  return r < 0.15 ? "low" : r <= 0.3 ? "moderate" : "high";
}

const FACES = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** The way the room faces: the external wall with the most glass. */
export function orientationFor(s: Pick<Suggestion, "windows">): Orientation | undefined {
  const by = new Map<string, number>();
  for (const w of s.windows) {
    const f = w.facing.toUpperCase().trim();
    if (w.external && (FACES as readonly string[]).includes(f)) by.set(f, (by.get(f) ?? 0) + w.widthMm);
  }
  let best: string | undefined;
  for (const [f, mm] of by) if (!best || mm > by.get(best)!) best = f;
  return best as Orientation | undefined;
}

/* ── Join with: a room and its robe as one zone ── */

/** Two outlines as one, across the wall between them: the shared walls'
    gap (up to `wall` units) is closed and the outline traced round both.
    Rooms that don't touch, or have a slanted wall, come back as the hull
    round both, which still contains them. */
export function joinOutlines(a: Point[], b: Point[], wall: number): Point[] {
  const all = [...a, ...b];
  const slanted = (poly: Point[]) => poly.some((p, i) => {
    const q = poly[(i + 1) % poly.length];
    return Math.abs(p.x - q.x) > 1 && Math.abs(p.y - q.y) > 1;
  });
  if (slanted(a) || slanted(b)) return hull(all);
  /* one value per wall line: coordinates within a wall's width are the same line */
  const snap = (vals: number[]) => {
    const sorted = [...new Set(vals)].sort((x, y) => x - y);
    const groups: number[][] = [];
    for (const v of sorted) {
      const g = groups[groups.length - 1];
      if (g && v - g[g.length - 1] <= wall) g.push(v);
      else groups.push([v]);
    }
    const to = new Map<number, number>();
    for (const g of groups) for (const v of g) to.set(v, g.reduce((s, x) => s + x, 0) / g.length);
    return to;
  };
  const sx = snap(all.map((p) => p.x));
  const sy = snap(all.map((p) => p.y));
  const fit = (poly: Point[]) => poly.map((p) => ({ x: sx.get(p.x)!, y: sy.get(p.y)! }));
  const pa = fit(a);
  const pb = fit(b);
  const xs = [...new Set([...sx.values()])].sort((x, y) => x - y);
  const ys = [...new Set([...sy.values()])].sort((x, y) => x - y);
  const filled = (i: number, j: number) => {
    const c = { x: (xs[i] + xs[i + 1]) / 2, y: (ys[j] + ys[j + 1]) / 2 };
    return within(c, pa) || within(c, pb);
  };
  /* the outline: every cell edge with a filled cell on one side only, chained */
  const edges = new Map<string, Point>();
  const key = (p: Point) => `${p.x},${p.y}`;
  const add = (from: Point, to: Point) => edges.set(key(from), to);
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      if (!filled(i, j)) continue;
      const [x0, x1, y0, y1] = [xs[i], xs[i + 1], ys[j], ys[j + 1]];
      if (j === 0 || !filled(i, j - 1)) add({ x: x0, y: y0 }, { x: x1, y: y0 });
      if (i === xs.length - 2 || !filled(i + 1, j)) add({ x: x1, y: y0 }, { x: x1, y: y1 });
      if (j === ys.length - 2 || !filled(i, j + 1)) add({ x: x1, y: y1 }, { x: x0, y: y1 });
      if (i === 0 || !filled(i - 1, j)) add({ x: x0, y: y1 }, { x: x0, y: y0 });
    }
  }
  if (edges.size === 0) return hull(all);
  const start = edges.keys().next().value!;
  const ring: Point[] = [];
  let at = start;
  for (let n = 0; n <= edges.size; n++) {
    const [x, y] = at.split(",").map(Number);
    ring.push({ x, y });
    const next = edges.get(at);
    if (!next) return hull(all);
    at = key(next);
    if (at === start) break;
  }
  /* two rooms that don't meet trace two rings: the first ring isn't all of it */
  if (ring.length < edges.size) return hull(all);
  return dropStraight(ring);
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

function dropStraight(ring: Point[]): Point[] {
  return ring.filter((p, i) => {
    const a = ring[(i - 1 + ring.length) % ring.length];
    const b = ring[(i + 1) % ring.length];
    return !((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y));
  });
}

function hull(points: Point[]): Point[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Point[] = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** One kept suggestion as a Studio room: named as she read it (or as it was
    renamed), its load inputs from what she read, numbered like the rest.
    `roomAbove`: another floor sits over this one, so no roof takes heat. */
export function roomFrom(s: Suggestion, floorId: string, mmPerUnit: number, roomAbove: boolean): DesignObject {
  const areaM2 = (polygonArea(s.points) * mmPerUnit * mmPerUnit) / 1e6;
  const glazing = glazingFor(areaM2, glassM2(s));
  const orientation = orientationFor(s);
  const external = s.windows.some((w) => w.external);
  return {
    id: newId("obj"),
    type: "room",
    systemId: null,
    floorId,
    geometry: { kind: "polygon", points: s.points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) },
    plane: "room",
    props: {
      name: s.name,
      externalWalls: [],
      hasExternalWalls: external,
      ...(glazing ? { glazing } : {}),
      ...(orientation ? { orientation } : {}),
      ...(roomAbove ? { roomAbove: true } : {}),
      ...(isAxisAlignedRect(s.points, 1) ? { shape: "rect" } : {}),
      fromReading: true,
    },
  };
}
