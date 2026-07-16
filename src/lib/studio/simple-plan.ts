/* Design Studio — simple-view renderer.
   Derives a clean "real-estate style" plan from space polygons: near-coincident
   edges from separately drawn spaces are welded onto one shared wall line,
   every welded line is classified (shared between two spaces / external /
   unmarked boundary), and walls get real thickness from the floor's
   calibration. Everything here is deterministic geometry — walls are computed,
   never guessed. Two callers share the core:
     · buildSimplePlan(doc, floorId)         — traced room objects (fallback)
     · buildSimplePlanFromExtraction(...)    — AI-extracted spaces (simple-extract.ts)
   Pure data + pure functions: no React, no DOM (the canvas layer and the SVG
   emitter both consume the same model). */

import type {
  DesignDocument,
  DesignObject,
  ExtractFixtureKind,
  ExtractOpeningKind,
  Point,
} from "./document";
import {
  areaUnitsToM2,
  boundsOfPoints,
  dist,
  formatMeters,
  polygonArea,
  polygonCentroid,
  type Bounds,
} from "./geometry";

export type WallKind = "external" | "shared" | "boundary";

export interface SimplePlanWall {
  a: Point;
  b: Point;
  kind: WallKind;
  /** wall thickness in world units (from calibration) */
  thicknessU: number;
}

export interface SimplePlanRoomLabel {
  id: string;
  name: string;
  at: Point;
  areaM2: number | null;
  /** side lengths in metres for 4-vertex spaces (w × d), else null */
  sizeM: { w: number; h: number } | null;
}

export interface SimplePlanDim {
  a: Point;
  b: Point;
  label: string;
  side: "top" | "left";
}

/** A weld that actually corrected something: ≥2 spaces whose edges sat on
    slightly different lines, snapped onto one. `mm` is the spread fixed. */
export interface SimplePlanWeld {
  mm: number;
  roomIds: string[];
}

/** An opening cut into a derived wall (AI extraction path only). The gap span
    a→b lies on the wall centreline; `leaf` carries door-swing geometry when
    the drawing showed one. */
export interface SimplePlanOpening {
  kind: ExtractOpeningKind;
  a: Point;
  b: Point;
  /** the host wall's thickness (world units) */
  thicknessU: number;
  leaf: { hinge: Point; free: Point } | null;
}

/** A fixture symbol (AI extraction path only), world units. */
export interface SimplePlanFixture {
  kind: ExtractFixtureKind;
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotationDeg: number;
}

export interface SimplePlanModel {
  walls: SimplePlanWall[];
  rooms: SimplePlanRoomLabel[];
  dims: SimplePlanDim[];
  bounds: Bounds | null;
  scaleMmPerUnit: number | null;
  welds: SimplePlanWeld[];
  openings: SimplePlanOpening[];
  fixtures: SimplePlanFixture[];
  /** non-fatal problems found while building (stale sheets, dropped items) */
  issues: string[];
}

export const SIMPLE_PLAN = {
  /** rendered wall thicknesses (real mm, converted via calibration) */
  EXT_MM: 230,
  INT_MM: 110,
  /** traced edges within this of each other are the same wall */
  WELD_TOL_MM: 250,
  ANGLE_TOL_DEG: 2.5,
  /** drop wall slivers shorter than this */
  MIN_WALL_MM: 80,
  /** wall endpoints snap to a crossing wall line within this */
  CORNER_SNAP_MM: 320,
  /** uncalibrated floors fall back to the blank-canvas default */
  FALLBACK_MM_PER_UNIT: 10,
};

/* ── core input ── */

/** A space polygon handed to the core: `external[i]` marks edge i
    (points[i] → points[i+1]) as a marked-external wall face. */
export interface CoreSpace {
  id: string;
  name: string;
  points: Point[];
  external: boolean[];
}

/* ── internals ── */

interface TracedEdge {
  roomId: string;
  a: Point;
  b: Point;
  len: number;
  /** unit direction a→b */
  dir: Point;
  external: boolean;
}

interface WallLine {
  /** unit direction of the welded line */
  dir: Point;
  /** unit normal */
  normal: Point;
  /** signed offset: every point P on the line satisfies P·normal = offset */
  offset: number;
  edges: TracedEdge[];
}

const dot = (p: Point, q: Point): number => p.x * q.x + p.y * q.y;

function roomPolys(doc: DesignDocument, floorId: string) {
  return doc.objects.filter(
    (o): o is DesignObject & { geometry: { kind: "polygon"; points: Point[] } } =>
      o.type === "room" && o.floorId === floorId && o.geometry.kind === "polygon"
  );
}

function spaceEdges(spaces: CoreSpace[]): TracedEdge[] {
  const edges: TracedEdge[] = [];
  for (const s of spaces) {
    const pts = s.points;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const len = dist(a, b);
      if (len < 1e-6) continue;
      edges.push({
        roomId: s.id,
        a,
        b,
        len,
        dir: { x: (b.x - a.x) / len, y: (b.y - a.y) / len },
        external: Boolean(s.external[i]),
      });
    }
  }
  return edges;
}

/** Union edges that lie on (nearly) the same infinite line: near-parallel and
    both endpoints within the weld tolerance of the other's line. */
function weldLines(edges: TracedEdge[], tolU: number): WallLine[] {
  const cosTol = Math.cos((SIMPLE_PLAN.ANGLE_TOL_DEG * Math.PI) / 180);
  const parent = edges.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (i: number, j: number) => {
    parent[find(i)] = find(j);
  };

  for (let i = 0; i < edges.length; i++) {
    const ei = edges[i];
    const ni = { x: -ei.dir.y, y: ei.dir.x };
    const ci = dot(ei.a, ni);
    for (let j = i + 1; j < edges.length; j++) {
      const ej = edges[j];
      if (Math.abs(dot(ei.dir, ej.dir)) < cosTol) continue;
      if (Math.abs(dot(ej.a, ni) - ci) > tolU) continue;
      if (Math.abs(dot(ej.b, ni) - ci) > tolU) continue;
      union(i, j);
    }
  }

  const groups = new Map<number, TracedEdge[]>();
  edges.forEach((e, i) => {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(e);
    else groups.set(root, [e]);
  });

  const lines: WallLine[] = [];
  for (const group of groups.values()) {
    // the longest edge anchors the direction (traces of long walls are the
    // most reliable); the offset is the length-weighted mean of the group
    const ref = group.reduce((m, e) => (e.len > m.len ? e : m));
    const dir = ref.dir;
    const normal = { x: -dir.y, y: dir.x };
    let w = 0;
    let acc = 0;
    for (const e of group) {
      const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
      acc += dot(mid, normal) * e.len;
      w += e.len;
    }
    lines.push({ dir, normal, offset: acc / w, edges: group });
  }
  return lines;
}

/** Split one welded line into wall segments by how many spaces cover each
    stretch: ≥2 spaces → shared internal wall; 1 space → that space's boundary
    (external when the edge was marked external). */
function lineToWalls(
  line: WallLine,
  tolU: number,
  minLenU: number
): { u: number; v: number; kind: WallKind }[] {
  type Span = { t0: number; t1: number; external: boolean };
  const spans: Span[] = line.edges.map((e) => {
    const ta = dot(e.a, line.dir);
    const tb = dot(e.b, line.dir);
    return { t0: Math.min(ta, tb), t1: Math.max(ta, tb), external: e.external };
  });

  const cuts = [...new Set(spans.flatMap((s) => [s.t0, s.t1]))].sort((a, b) => a - b);
  const raw: { u: number; v: number; kind: WallKind }[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const u = cuts[i];
    const v = cuts[i + 1];
    if (v - u < 1e-6) continue;
    const active = spans.filter((s) => s.t0 <= u + 1e-6 && s.t1 >= v - 1e-6);
    if (active.length === 0) continue;
    const kind: WallKind =
      active.length >= 2 ? "shared" : active[0].external ? "external" : "boundary";
    raw.push({ u, v, kind });
  }

  // merge same-kind stretches, healing sub-tolerance trace gaps along the
  // line (40 mm of daylight at a sloppy corner is noise; a 1.25 m gap is a
  // real corridor opening and stays open)
  const merged: typeof raw = [];
  for (const seg of raw) {
    const prev = merged[merged.length - 1];
    if (prev && prev.kind === seg.kind && seg.u - prev.v < tolU + 1e-6) {
      prev.v = seg.v;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged.filter((s) => s.v - s.u >= minLenU);
}

const linePoint = (line: WallLine, t: number): Point => ({
  x: line.normal.x * line.offset + line.dir.x * t,
  y: line.normal.y * line.offset + line.dir.y * t,
});

/** Snap a wall endpoint onto the nearest crossing wall line, so corners from
    independently drawn spaces meet exactly. The point only slides along its
    own line (the intersection is on both), so the weld is never disturbed. */
function snapEndpoint(p: Point, own: WallLine, lines: WallLine[], snapU: number): Point {
  let best = p;
  let bestD = snapU;
  for (const other of lines) {
    if (other === own) continue;
    const det = own.normal.x * other.normal.y - own.normal.y * other.normal.x;
    if (Math.abs(det) < 0.15) continue; // near-parallel — no stable corner
    const x = (own.offset * other.normal.y - other.offset * own.normal.y) / det;
    const y = (own.normal.x * other.offset - other.normal.x * own.offset) / det;
    const d = dist(p, { x, y });
    if (d < bestD) {
      bestD = d;
      best = { x, y };
    }
  }
  return best;
}

/* ── model ── */

/** Core: spaces in, model out. Shared by the traced-rooms and AI-extraction
    paths; the callers own where the spaces came from. */
export function buildSimplePlanCore(
  spaces: CoreSpace[],
  scaleMmPerUnit: number | null,
  opts: { weldTolMm?: number } = {}
): SimplePlanModel {
  const scale = scaleMmPerUnit;
  const mmPerUnit = scale ?? SIMPLE_PLAN.FALLBACK_MM_PER_UNIT;
  const tolU = (opts.weldTolMm ?? SIMPLE_PLAN.WELD_TOL_MM) / mmPerUnit;
  const minLenU = SIMPLE_PLAN.MIN_WALL_MM / mmPerUnit;
  const snapU = SIMPLE_PLAN.CORNER_SNAP_MM / mmPerUnit;
  const extU = SIMPLE_PLAN.EXT_MM / mmPerUnit;
  const intU = SIMPLE_PLAN.INT_MM / mmPerUnit;

  const lines = weldLines(spaceEdges(spaces), tolU);

  const walls: SimplePlanWall[] = [];
  for (const line of lines) {
    for (const seg of lineToWalls(line, tolU, minLenU)) {
      const a = snapEndpoint(linePoint(line, seg.u), line, lines, snapU);
      const b = snapEndpoint(linePoint(line, seg.v), line, lines, snapU);
      if (dist(a, b) < minLenU) continue;
      walls.push({
        a,
        b,
        kind: seg.kind,
        thicknessU: seg.kind === "external" ? extU : intU,
      });
    }
  }

  const welds: SimplePlanWeld[] = [];
  for (const line of lines) {
    const roomIds = [...new Set(line.edges.map((e) => e.roomId))];
    if (roomIds.length < 2) continue;
    const offsets = line.edges.map((e) =>
      dot({ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 }, line.normal)
    );
    const mm = (Math.max(...offsets) - Math.min(...offsets)) * mmPerUnit;
    if (mm > 5) welds.push({ mm: Math.round(mm), roomIds });
  }

  const labels: SimplePlanRoomLabel[] = spaces.map((s) => {
    const pts = s.points;
    return {
      id: s.id,
      name: s.name,
      at: polygonCentroid(pts),
      areaM2: scale ? areaUnitsToM2(polygonArea(pts), scale) : null,
      sizeM:
        scale && pts.length === 4
          ? {
              w: (dist(pts[0], pts[1]) * scale) / 1000,
              h: (dist(pts[1], pts[2]) * scale) / 1000,
            }
          : null,
    };
  });

  const bounds = boundsOfPoints(spaces.flatMap((s) => s.points));
  const dims: SimplePlanDim[] = [];
  if (bounds && scale) {
    dims.push({
      a: { x: bounds.minX, y: bounds.minY },
      b: { x: bounds.maxX, y: bounds.minY },
      label: formatMeters(((bounds.maxX - bounds.minX) * scale) / 1000),
      side: "top",
    });
    dims.push({
      a: { x: bounds.minX, y: bounds.minY },
      b: { x: bounds.minX, y: bounds.maxY },
      label: formatMeters(((bounds.maxY - bounds.minY) * scale) / 1000),
      side: "left",
    });
  }

  return {
    walls,
    rooms: labels,
    dims,
    bounds,
    scaleMmPerUnit: scale,
    welds,
    openings: [],
    fixtures: [],
    issues: [],
  };
}

/** Traced-rooms wrapper (the pre-extraction fallback): spaces = the floor's
    room objects, with external flags from wall-marking. */
export function buildSimplePlan(
  doc: DesignDocument,
  floorId: string
): SimplePlanModel {
  const floor = doc.floors.find((f) => f.id === floorId);
  const rooms = floor ? roomPolys(doc, floorId) : [];
  const spaces: CoreSpace[] = rooms.map((r) => {
    const pts = r.geometry.points;
    const ext = new Set(
      Array.isArray(r.props.externalWalls)
        ? (r.props.externalWalls as unknown[]).filter((n) => typeof n === "number")
        : []
    );
    return {
      id: r.id,
      name: String(r.props.name ?? "Room"),
      points: pts,
      external: pts.map((_, i) => ext.has(i)),
    };
  });
  return buildSimplePlanCore(spaces, floor?.scaleMmPerUnit ?? null);
}

/* ── fixture symbols: primitive shapes in a local frame centred on (0,0),
      unrotated, spanning w×h. Renderers apply translate+rotate. ── */

export type FixturePrim =
  | { t: "rect"; x: number; y: number; w: number; h: number; rx?: number }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number }
  | { t: "ellipse"; cx: number; cy: number; rx: number; ry: number };

export function fixturePrimitives(f: {
  kind: ExtractFixtureKind;
  w: number;
  h: number;
}): FixturePrim[] {
  const { w, h } = f;
  const hw = w / 2;
  const hh = h / 2;
  const box: FixturePrim = { t: "rect", x: -hw, y: -hh, w, h };
  switch (f.kind) {
    case "bed": {
      const m = Math.min(w, h) * 0.08;
      return [
        box,
        { t: "rect", x: -hw + m, y: -hh + m, w: w - 2 * m, h: h * 0.18 },
        { t: "line", x1: -hw, y1: -hh + h * 0.32, x2: hw, y2: -hh + h * 0.32 },
      ];
    }
    case "robe":
      return [box, { t: "line", x1: -hw, y1: 0, x2: hw, y2: 0 }];
    case "wc":
      return [
        { t: "rect", x: -hw, y: -hh, w, h: h * 0.28 },
        { t: "ellipse", cx: 0, cy: hh * 0.35, rx: hw * 0.7, ry: hh * 0.55 },
      ];
    case "shower":
      return [
        box,
        { t: "rect", x: -hw * 0.8, y: -hh * 0.8, w: w * 0.8, h: h * 0.8 },
        {
          t: "ellipse",
          cx: 0,
          cy: 0,
          rx: Math.min(w, h) * 0.06,
          ry: Math.min(w, h) * 0.06,
        },
      ];
    case "bath":
      return [
        box,
        {
          t: "rect",
          x: -hw * 0.82,
          y: -hh * 0.7,
          w: w * 0.82,
          h: h * 0.7,
          rx: Math.min(w, h) * 0.2,
        },
      ];
    case "vanity":
    case "sink":
      return [box, { t: "ellipse", cx: 0, cy: 0, rx: hw * 0.5, ry: hh * 0.5 }];
    case "stairs": {
      const prims: FixturePrim[] = [box];
      const treads = Math.max(4, Math.min(14, Math.round((h / Math.max(w, 1)) * 6)));
      for (let i = 1; i < treads; i++) {
        const y = -hh + (h * i) / treads;
        prims.push({ t: "line", x1: -hw, y1: y, x2: hw, y2: y });
      }
      return prims;
    }
    case "sofa":
      return [
        box,
        { t: "line", x1: -hw, y1: -hh + h * 0.25, x2: hw, y2: -hh + h * 0.25 },
      ];
    case "car":
      return [{ t: "rect", x: -hw, y: -hh, w, h, rx: Math.min(w, h) * 0.18 }];
    default:
      return [box];
  }
}

/* ── standalone SVG emitter (export + the review-modal preview; the canvas
      layer renders the same model as React elements) ── */

const WALL_COLOUR: Record<WallKind, string> = {
  external: "#26241f",
  shared: "#4e4b45",
  boundary: "#8a867e",
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderSimplePlanSVG(
  model: SimplePlanModel,
  opts: { title?: string; widthPx?: number } = {}
): string {
  const W = opts.widthPx ?? 1000;
  const M = 84;
  const b = model.bounds;
  if (!b || model.walls.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="200" viewBox="0 0 ${W} 200"><text x="${
      W / 2
    }" y="100" text-anchor="middle" font-size="14" fill="#8a867e">No plan geometry yet</text></svg>`;
  }
  const k = (W - 2 * M) / Math.max(1, b.maxX - b.minX);
  const H = Math.ceil((b.maxY - b.minY) * k + 2 * M);
  const px = (p: Point) => ({
    x: M + (p.x - b.minX) * k,
    y: M + (p.y - b.minY) * k,
  });
  const f = (n: number) => n.toFixed(1);
  const font = `font-family="'Plus Jakarta Sans', system-ui, sans-serif"`;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
  );
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);

  for (const wall of model.walls) {
    const a = px(wall.a);
    const bp = px(wall.b);
    parts.push(
      `<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(bp.x)}" y2="${f(
        bp.y
      )}" stroke="${WALL_COLOUR[wall.kind]}" stroke-width="${f(
        Math.max(1.5, wall.thicknessU * k)
      )}" stroke-linecap="square"/>`
    );
  }

  /* openings: erase the wall across the gap, then the kind's glyph */
  for (const o of model.openings) {
    const a = px(o.a);
    const bp = px(o.b);
    const tk = Math.max(2, o.thicknessU * k);
    parts.push(
      `<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(bp.x)}" y2="${f(
        bp.y
      )}" stroke="#ffffff" stroke-width="${f(tk * 1.3)}" stroke-linecap="butt"/>`
    );
    const dx = bp.x - a.x;
    const dy = bp.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const n = { x: -dy / len, y: dx / len };
    if (o.kind === "window") {
      for (const s of [-0.28, 0.28]) {
        parts.push(
          `<line x1="${f(a.x + n.x * tk * s)}" y1="${f(a.y + n.y * tk * s)}" x2="${f(
            bp.x + n.x * tk * s
          )}" y2="${f(bp.y + n.y * tk * s)}" stroke="#5f5e5a" stroke-width="1.2"/>`
        );
      }
    } else if (o.kind === "slider") {
      const mid = { x: (a.x + bp.x) / 2, y: (a.y + bp.y) / 2 };
      const off = tk * 0.22;
      parts.push(
        `<line x1="${f(a.x + n.x * off)}" y1="${f(a.y + n.y * off)}" x2="${f(
          mid.x + n.x * off
        )}" y2="${f(mid.y + n.y * off)}" stroke="#4e4b45" stroke-width="2"/>`,
        `<line x1="${f(mid.x - n.x * off)}" y1="${f(mid.y - n.y * off)}" x2="${f(
          bp.x - n.x * off
        )}" y2="${f(bp.y - n.y * off)}" stroke="#4e4b45" stroke-width="2"/>`
      );
    } else if (o.kind === "garage-door") {
      parts.push(
        `<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(bp.x)}" y2="${f(
          bp.y
        )}" stroke="#8a867e" stroke-width="1.5" stroke-dasharray="6 4"/>`
      );
    } else if (o.leaf) {
      const hg = px(o.leaf.hinge);
      const fr = px(o.leaf.free);
      const far = dist(o.leaf.hinge, o.a) > dist(o.leaf.hinge, o.b) ? a : bp;
      const r = Math.hypot(fr.x - hg.x, fr.y - hg.y);
      const cross =
        (fr.x - hg.x) * (far.y - hg.y) - (fr.y - hg.y) * (far.x - hg.x);
      const sweep = cross > 0 ? 1 : 0;
      parts.push(
        `<line x1="${f(hg.x)}" y1="${f(hg.y)}" x2="${f(fr.x)}" y2="${f(
          fr.y
        )}" stroke="#4e4b45" stroke-width="1.4"/>`,
        `<path d="M${f(fr.x)},${f(fr.y)} A${f(r)},${f(r)} 0 0 ${sweep} ${f(
          far.x
        )},${f(far.y)}" fill="none" stroke="#8a867e" stroke-width="1"/>`
      );
    }
  }

  /* fixtures */
  for (const fx of model.fixtures) {
    const c = px({ x: fx.cx, y: fx.cy });
    parts.push(
      `<g transform="translate(${f(c.x)} ${f(c.y)}) rotate(${f(fx.rotationDeg)})">`
    );
    for (const p of fixturePrimitives({ kind: fx.kind, w: fx.w * k, h: fx.h * k })) {
      if (p.t === "rect") {
        parts.push(
          `<rect x="${f(p.x)}" y="${f(p.y)}" width="${f(p.w)}" height="${f(p.h)}"${
            p.rx ? ` rx="${f(p.rx)}"` : ""
          } fill="none" stroke="#8a867e" stroke-width="1"/>`
        );
      } else if (p.t === "line") {
        parts.push(
          `<line x1="${f(p.x1)}" y1="${f(p.y1)}" x2="${f(p.x2)}" y2="${f(
            p.y2
          )}" stroke="#8a867e" stroke-width="0.8"/>`
        );
      } else {
        parts.push(
          `<ellipse cx="${f(p.cx)}" cy="${f(p.cy)}" rx="${f(p.rx)}" ry="${f(
            p.ry
          )}" fill="none" stroke="#8a867e" stroke-width="1"/>`
        );
      }
    }
    parts.push(`</g>`);
  }

  /* labels: names only — the simple view carries no measurements (dims and
     areas stay in the model for other consumers, but are never drawn) */
  for (const room of model.rooms) {
    if (!room.name) continue;
    const c = px(room.at);
    parts.push(
      `<text x="${f(c.x)}" y="${f(c.y + 4)}" text-anchor="middle" font-size="15" font-weight="600" fill="#26241f" ${font}>${escapeXml(
        room.name
      )}</text>`
    );
  }

  if (opts.title) {
    parts.push(
      `<text x="${M}" y="${H - 20}" font-size="12" fill="#8a867e" ${font}>${escapeXml(
        opts.title
      )}</text>`
    );
  }
  parts.push("</svg>");
  return parts.join("\n");
}
