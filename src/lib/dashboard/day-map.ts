/* HOME'S MAP, the geometry (pure). The map is Google's static picture of a
   view, a centre and a zoom, fetched through our own route so the key stays
   on the server (app/api/home/day-map); the pins are the page's own, drawn
   over it where this file says they fall. Web Mercator, 256-pixel world at
   zoom 0, as Google draws it.

   A view opens fitted to the day's jobs, less any job far from the rest
   (Isaac, 17 November 2026: "If they're far away, like if they're out of
   the picture, where would they show up?"): Megalong Valley doesn't pull a
   Sydney day out to the mountains. It waits on the map's edge facing it,
   with how far it is, and Show all fits everything. */

export type LatLng = { lat: number; lng: number };
export type MapView = { lat: number; lng: number; zoom: number };

export const MIN_ZOOM = 3;
export const MAX_ZOOM = 16;
/** A job further than this from the middle of the day's jobs is far. */
export const FAR_KM = 30;

const TILE = 256;

/** The point's place on the world at zoom 0, in pixels. */
export function world(p: LatLng): { x: number; y: number } {
  const s = Math.sin((Math.max(-85, Math.min(85, p.lat)) * Math.PI) / 180);
  return { x: ((p.lng + 180) / 360) * TILE, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE };
}

/** Back from the world at zoom 0 to a latitude and longitude. */
export function unworld(x: number, y: number): LatLng {
  const lng = (x / TILE) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / TILE;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

/** Where a point falls on a w × h map of the view, in pixels from its top left. */
export function pixelOf(view: MapView, p: LatLng, w: number, h: number): { x: number; y: number } {
  const k = 2 ** view.zoom;
  const c = world(view), q = world(p);
  return { x: (q.x - c.x) * k + w / 2, y: (q.y - c.y) * k + h / 2 };
}

/** The view after dragging the map by (dx, dy) pixels. */
export function panned(view: MapView, dx: number, dy: number): MapView {
  const k = 2 ** view.zoom;
  const c = world(view);
  const at = unworld(c.x - dx / k, c.y - dy / k);
  return { lat: round(at.lat), lng: round(at.lng), zoom: view.zoom };
}

export function zoomed(view: MapView, by: number): MapView {
  return { ...view, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom + by)) };
}

/** + on the map: in toward the jobs. The middle of the jobs on the map
    comes to the map's middle as it closes in, or, where none is on it, the
    middle of them all (Isaac's walk, 17 November 2026: after Show all
    fitted Megalong Valley in, the map's own middle was past Penrith, and
    two presses of + left him in the mountains with no job in sight). −
    goes out about the map's middle, which loses nothing. */
export function zoomedToward(view: MapView, by: number, points: readonly LatLng[], w: number, h: number): MapView {
  const next = zoomed(view, by);
  if (by <= 0 || next.zoom === view.zoom || points.length === 0) return next;
  const on = points.filter((p) => {
    const q = pixelOf(view, p, w, h);
    return q.x >= 0 && q.x <= w && q.y >= 0 && q.y <= h;
  });
  const mid = middleOf(on.length > 0 ? on : points)!;
  return { lat: round(mid.lat), lng: round(mid.lng), zoom: next.zoom };
}

const round = (n: number) => Math.round(n * 1e5) / 1e5;

/** Kilometres between two points, as the crow flies. */
export function kmBetween(a: LatLng, b: LatLng): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** The middle of the day's jobs: the median of each, so one far job doesn't
    move it. */
export function middleOf(points: readonly LatLng[]): LatLng | null {
  if (points.length === 0) return null;
  return { lat: median(points.map((p) => p.lat)), lng: median(points.map((p) => p.lng)) };
}

/** Which of the points are far from the rest: more than FAR_KM from their
    middle, while some are near it. A day of only far jobs has none far. */
export function farOnes(points: readonly LatLng[]): boolean[] {
  const mid = middleOf(points);
  if (!mid) return [];
  const far = points.map((p) => kmBetween(p, mid) > FAR_KM);
  return far.every(Boolean) ? far.map(() => false) : far;
}

/** Room kept round the jobs when a view is fitted: more above, where a
    pin's number stands over its point. */
export const PAD = { top: 36, bottom: 8, side: 32 };

/** The view that shows every point on a w × h map with PAD to spare, as
    close in as that allows. No points: Sydney. */
export function fitView(points: readonly LatLng[], w: number, h: number, pad = PAD): MapView {
  if (points.length === 0) return { lat: -33.87, lng: 151.21, zoom: 11 };
  const ws = points.map(world);
  const minX = Math.min(...ws.map((p) => p.x)), maxX = Math.max(...ws.map((p) => p.x));
  const minY = Math.min(...ws.map((p) => p.y)), maxY = Math.max(...ws.map((p) => p.y));
  let zoom = MAX_ZOOM;
  /* one point, or many in one street: close in, but not to the doorstep */
  if (points.length === 1 || (maxX - minX < 1e-9 && maxY - minY < 1e-9)) zoom = 13;
  else
    while (zoom > MIN_ZOOM && ((maxX - minX) * 2 ** zoom > w - 2 * pad.side || (maxY - minY) * 2 ** zoom > h - pad.top - pad.bottom)) zoom--;
  /* the middle of the jobs sits in the middle of the room left for them */
  const c = unworld((minX + maxX) / 2, (minY + maxY) / 2 - (pad.top - pad.bottom) / 2 / 2 ** zoom);
  return { lat: round(c.lat), lng: round(c.lng), zoom };
}

/** Points closer than `within` pixels on the map drawn as one count. Each
    group keeps the first point's place. */
export function grouped<T>(items: readonly T[], place: (t: T) => { x: number; y: number }, within: number): { x: number; y: number; items: T[] }[] {
  const out: { x: number; y: number; items: T[] }[] = [];
  for (const it of items) {
    const p = place(it);
    const g = out.find((o) => Math.hypot(o.x - p.x, o.y - p.y) < within);
    if (g) g.items.push(it);
    else out.push({ x: p.x, y: p.y, items: [it] });
  }
  return out;
}

export type Edge = "left" | "right" | "top" | "bottom";

/** A point off the map: the edge facing it, and how far along that edge
    (0 to 1) the line from the map's middle to it crosses. */
export function edgeOf(p: { x: number; y: number }, w: number, h: number): { edge: Edge; along: number } {
  const dx = p.x - w / 2, dy = p.y - h / 2;
  const sx = dx === 0 ? Infinity : w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : h / 2 / Math.abs(dy);
  if (sx <= sy) return { edge: dx < 0 ? "left" : "right", along: Math.max(0, Math.min(1, (h / 2 + dy * sx) / h)) };
  return { edge: dy < 0 ? "top" : "bottom", along: Math.max(0, Math.min(1, (w / 2 + dx * sy) / w)) };
}
