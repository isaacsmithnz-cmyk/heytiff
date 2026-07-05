/* Design Studio — geometry & viewport math. Pure functions, no React, no DOM.
   World space = floor-plan image pixels ("units"); each floor's
   scaleMmPerUnit converts units to real millimetres (ADR-001). Derived
   values (areas, lengths) are always computed from geometry + scale, never
   stored. Ported/adapted from the audited DUCTR helpers (HARVEST §5, grade A). */

import type { Point } from "./document";

export type { Point };

export interface Viewport {
  /** world coordinate at the screen origin (top-left) */
  x: number;
  y: number;
  /** screen px per world unit */
  zoom: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/* ── Scalars ── */

export const dist = (a: Point, b: Point): number =>
  Math.hypot(b.x - a.x, b.y - a.y);

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/* ── Polygons & polylines ── */

/** Shoelace formula, absolute area in world units². */
export function polygonArea(points: Point[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Area-weighted centroid (falls back to vertex mean for degenerate rings). */
export function polygonCentroid(points: Point[]): Point {
  if (points.length < 3) {
    const n = Math.max(1, points.length);
    return {
      x: points.reduce((s, p) => s + p.x, 0) / n,
      y: points.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  let a = 0,
    cx = 0,
    cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (a === 0) return polygonCentroid(points.slice(0, 2));
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function polylineLength(points: Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += dist(points[i - 1], points[i]);
  return len;
}

/** Ray-casting point-in-polygon. */
export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Distance from point to segment ab. */
export function distToSegment(p: Point, a: Point, b: Point): number {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (l2 === 0) return dist(p, a);
  const t = clamp(
    ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2,
    0,
    1
  );
  return dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}

export function boundsOfPoints(points: Point[]): Bounds | null {
  if (points.length === 0) return null;
  const b: Bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  for (const p of points) {
    b.minX = Math.min(b.minX, p.x);
    b.minY = Math.min(b.minY, p.y);
    b.maxX = Math.max(b.maxX, p.x);
    b.maxY = Math.max(b.maxY, p.y);
  }
  return b;
}

/* ── Snapping ── */

export function snapToGrid(p: Point, step: number): Point {
  return {
    x: Math.round(p.x / step) * step,
    y: Math.round(p.y / step) * step,
  };
}

/** Snap to horizontal/vertical from the previous vertex (pipe/duct routing). */
export function orthoSnap(prev: Point, p: Point): Point {
  return Math.abs(p.x - prev.x) >= Math.abs(p.y - prev.y)
    ? { x: p.x, y: prev.y }
    : { x: prev.x, y: p.y };
}

/** Index of the vertex within maxDist of p, or -1. */
export function nearestVertexIndex(
  p: Point,
  points: Point[],
  maxDist: number
): number {
  let best = -1;
  let bestD = maxDist;
  points.forEach((v, i) => {
    const d = dist(p, v);
    if (d <= bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

/* ── Rectangle-aware vertex editing ── */

/** True for a 4-vertex axis-aligned rectangle (either winding). */
export function isAxisAlignedRect(points: Point[], eps = 1e-6): boolean {
  if (points.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = points[i];
    const b = points[(i + 1) % 4];
    const sameX = Math.abs(a.x - b.x) <= eps;
    const sameY = Math.abs(a.y - b.y) <= eps;
    if (sameX === sameY) return false; // must share exactly one axis per edge
  }
  return polygonArea(points) > eps;
}

/** The axis-aligned bounding rectangle of a set of points, as polygon corners
    (TL → TR → BR → BL). Used to snap a free-edited room back to rectangular. */
export function boundingRect(points: Point[]): Point[] {
  const b = boundsOfPoints(points);
  if (!b) return [];
  return [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ];
}

/** Move corner `index` of an axis-aligned rectangle to `p`, dragging the two
    adjacent corners along their shared axes so the shape stays rectangular.
    The opposite corner is the fixed anchor. */
export function rectDragVertex(points: Point[], index: number, p: Point): Point[] {
  const next = points.map((pt) => ({ ...pt }));
  const prev = (index + 3) % 4;
  const nxt = (index + 1) % 4;
  next[index] = { ...p };
  for (const j of [prev, nxt]) {
    if (Math.abs(points[j].x - points[index].x) <= 1e-6) next[j].x = p.x;
    else next[j].y = p.y;
  }
  return next;
}

/* ── Viewport ── */

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 12;

export function worldToScreen(p: Point, vp: Viewport): Point {
  return { x: (p.x - vp.x) * vp.zoom, y: (p.y - vp.y) * vp.zoom };
}

export function screenToWorld(p: Point, vp: Viewport): Point {
  return { x: p.x / vp.zoom + vp.x, y: p.y / vp.zoom + vp.y };
}

/** Zoom by factor keeping the world point under `screen` stationary. */
export function zoomAt(vp: Viewport, screen: Point, factor: number): Viewport {
  const zoom = clamp(vp.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  if (zoom === vp.zoom) return vp;
  const world = screenToWorld(screen, vp);
  return {
    zoom,
    x: world.x - screen.x / zoom,
    y: world.y - screen.y / zoom,
  };
}

/** Viewport that fits bounds inside width×height with padding (screen px). */
export function fitBounds(
  bounds: Bounds,
  width: number,
  height: number,
  padding = 40
): Viewport {
  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const zoom = clamp(
    Math.min((width - padding * 2) / bw, (height - padding * 2) / bh),
    MIN_ZOOM,
    MAX_ZOOM
  );
  return {
    zoom,
    x: bounds.minX - (width / zoom - bw) / 2,
    y: bounds.minY - (height / zoom - bh) / 2,
  };
}

/* ── Real-world conversion (everything traces back to calibration) ── */

/** Two calibration points + the real distance between them → mm per unit. */
export function mmPerUnitFromCalibration(
  a: Point,
  b: Point,
  realMeters: number
): number | null {
  const d = dist(a, b);
  if (d < 1e-6 || realMeters <= 0) return null;
  return (realMeters * 1000) / d;
}

export const unitsToMeters = (units: number, mmPerUnit: number): number =>
  (units * mmPerUnit) / 1000;

export const areaUnitsToM2 = (areaUnits2: number, mmPerUnit: number): number =>
  (areaUnits2 * mmPerUnit * mmPerUnit) / 1e6;

export function formatMeters(m: number): string {
  return m >= 100 ? `${m.toFixed(0)} m` : `${m.toFixed(2)} m`;
}

export function formatArea(m2: number): string {
  return `${m2 >= 100 ? m2.toFixed(0) : m2.toFixed(1)} m²`;
}
