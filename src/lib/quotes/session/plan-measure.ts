/* ROOMS MEASURED OFF A PLAN PHOTO (measure_plan). A plan with no room
   sizes printed still has its scale: one printed dimension, or its scale
   bar. She reads that figure and marks where its two ends are on the
   picture, then marks each room's corners. The arithmetic is done here,
   never in her head: the dimension's length in pixels gives the
   millimetres a pixel, and each room's outline its m². On 3465 (re-run 10
   November 2026) she looked at the plan photo whole and said "There are no
   room sizes on the plan or in the photo", so no room load was run; the
   plan has its overall dimensions printed. Pure. */

type Err = { error: string };
/** A point as fractions of the whole picture, from its top left. */
export type PlanPoint = { x: number; y: number };
type Area = { left: number; top: number; width: number; height: number };

export type MeasureAsk = {
  known: { mm: number; what: string; from: PlanPoint; to: PlanPoint };
  rooms: { name: string; corners: PlanPoint[] }[];
};

const MAX_ROOMS = 30;
const MAX_CORNERS = 12;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const frac = (v: unknown) => {
  const n = num(v);
  return n != null && n >= 0 && n <= 1 ? n : null;
};

/** The part of the picture the points were marked on, as look_at took it; none, the whole. */
function areaFrom(raw: unknown): Area | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const [left, top, width, height] = [frac(r.left), frac(r.top), frac(r.width), frac(r.height)];
  if (left == null || top == null || width == null || height == null || width <= 0 || height <= 0) return null;
  return { left, top, width: Math.min(width, 1 - left), height: Math.min(height, 1 - top) };
}

/** A marked point, made a fraction of the whole picture. */
function pointOf(raw: unknown, area: Area | null): PlanPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const [x, y] = [frac(r.x), frac(r.y)];
  if (x == null || y == null) return null;
  return area ? { x: area.left + x * area.width, y: area.top + y * area.height } : { x, y };
}

export function measureAskOf(raw: unknown): MeasureAsk | Err {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const k = (r.known && typeof r.known === "object" ? r.known : {}) as Record<string, unknown>;
  const mm = num(k.mm);
  if (mm == null || mm <= 0) return { error: "Give the printed dimension you measure by in mm (known.mm)." };
  const kArea = areaFrom(k.area);
  const from = pointOf(k.from, kArea);
  const to = pointOf(k.to, kArea);
  if (!from || !to) return { error: "Mark the dimension's two ends (known.from, known.to) as fractions of the picture, or of the area you looked at." };
  const rooms: MeasureAsk["rooms"] = [];
  const list = Array.isArray(r.rooms) ? r.rooms.slice(0, MAX_ROOMS) : [];
  for (const raw of list) {
    const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim().slice(0, 60) : "";
    const area = areaFrom(o.area);
    const corners = (Array.isArray(o.corners) ? o.corners.slice(0, MAX_CORNERS) : []).map((c) => pointOf(c, area));
    if (!name) return { error: "Name every room." };
    if (corners.length < 3 || corners.some((c) => !c)) return { error: `Mark at least three corners of ${name}, each as x and y fractions.` };
    rooms.push({ name, corners: corners as PlanPoint[] });
  }
  if (rooms.length === 0) return { error: "Mark the rooms to measure, each by its corners." };
  const what = typeof k.what === "string" && k.what.trim() ? k.what.trim().slice(0, 80) : `the ${mm} mm dimension`;
  return { known: { mm, what, from, to }, rooms };
}

export type Measured = {
  scale: string;
  rooms: { name: string; area_m2: number; about: string; check?: string }[];
  said: string;
};

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Each room's m² off the picture's own scale, on a picture `size` px whole. */
export function measurePlan(size: { w: number; h: number }, ask: MeasureAsk): Measured | Err {
  const px = (p: PlanPoint) => ({ x: p.x * size.w, y: p.y * size.h });
  const a = px(ask.known.from);
  const b = px(ask.known.to);
  const span = Math.hypot(b.x - a.x, b.y - a.y);
  /* a short span makes every room's error large: a tenth of the picture at least */
  if (span < Math.max(size.w, size.h) * 0.1)
    return { error: "The dimension's ends are too close together to measure by. Mark the ends of a long printed dimension, an overall one or the scale bar." };
  const mmPerPx = ask.known.mm / span;
  const rooms = ask.rooms.map((room) => {
    const pts = room.corners.map(px);
    let twice = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      twice += p.x * q.y - q.x * p.y;
    }
    const m2 = (Math.abs(twice) / 2) * mmPerPx * mmPerPx * 1e-6;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const wide = ((Math.max(...xs) - Math.min(...xs)) * mmPerPx) / 1000;
    const deep = ((Math.max(...ys) - Math.min(...ys)) * mmPerPx) / 1000;
    const area_m2 = r1(m2);
    const check = area_m2 < 2 ? `${area_m2} m² is small for a room: check its corners` : area_m2 > 150 ? `${area_m2} m² is big for one room: check its corners and the dimension` : undefined;
    return { name: room.name, area_m2, about: `about ${r1(wide)} × ${r1(deep)} m`, ...(check ? { check } : {}) };
  });
  return {
    scale: `1 px = ${Math.round(mmPerPx * 10) / 10} mm on the full-size picture, off ${ask.known.what} (${Math.round(span)} px)`,
    rooms,
    said: `Measured off the plan against ${ask.known.what}, as assumed: say so, and ask to confirm the sizes the load rests on.`,
  };
}
