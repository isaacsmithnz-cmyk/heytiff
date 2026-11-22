import { inside, type ReadPoint, type ReadRoofFace, type ReadRoofPart, type ReadSpace } from "../reading";
import { riseOf, type RoofFace } from "./roof";

/* THE ROOF PLAN'S FACES SET OVER THE FLOORS. An architect's sheets share one
   page origin: on 3570 the ground floor's and level 1's walls fall exactly
   under A104's eaves, page point for page point. So a face is moved onto a
   floor's sheet by that sheet's own pixels to the point, and that is only
   trusted when it plainly holds: most of the rooms read on the floors stand
   under the faces. Each face then goes on the highest floor with a space
   under it (a hip over level 1 is carried by level 1's walls, a verandah
   over the ground floor's), its eave the height the read took off the
   sections for the roof part it sits in, else that floor's ceiling, and its
   overhang measured off the file's own walls. A face with no floor under it
   is left out. Pure. */

/** A floor as the read left it, its sheet's pixels to a page point. */
export type FloorUnder = {
  floorId: string;
  sheetId: string;
  level: number;
  pxPerPt: number;
  spaces: readonly ReadSpace[];
  /** the file's walls, sheet pixels, each a filled shape even-odd */
  walls?: readonly ReadPoint[][][];
  /** its ceiling as the read took it off the sections, mm; null if not read */
  ceilingMm: number | null;
  /** its sheet's scale, mm a pixel, as the Studio takes it; null if unknown */
  mmPerPx: number | null;
};

/** The share of the floors' rooms that must stand under the faces for the roof plan to be taken as drawn over them. */
const UNDER = 0.5;
/** An overhang longer than this, mm, is a verandah or a carport, not an eave's: no wall is looked for past it. */
const LONGEST_EAVE = 1500;

const centre = (ring: readonly ReadPoint[]): ReadPoint => {
  /* the area-weighted middle; a thin L's corner can fall outside it, so a point inside is taken when it does */
  let a = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const c = p.x * q.y - q.x * p.y;
    a += c;
    x += (p.x + q.x) * c;
    y += (p.y + q.y) * c;
  }
  if (!a) return ring[0];
  const m = { x: x / (3 * a), y: y / (3 * a) };
  if (inside(m, ring as ReadPoint[])) return m;
  /* else the middle of the longest run across the ring at its middle height */
  const xs: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    if (p.y > m.y !== q.y > m.y) xs.push(p.x + ((m.y - p.y) * (q.x - p.x)) / (q.y - p.y));
  }
  xs.sort((u, v) => u - v);
  let best = { x: m.x, y: m.y };
  let wide = -1;
  for (let i = 0; i + 1 < xs.length; i += 2)
    if (xs[i + 1] - xs[i] > wide) {
      wide = xs[i + 1] - xs[i];
      best = { x: (xs[i] + xs[i + 1]) / 2, y: m.y };
    }
  return best;
};

/** A point under a face: inside it, or on the line round it (a room's middle can fall on a ridge). */
const ON_LINE_PT = 1.5;
function under1(ring: readonly ReadPoint[], p: ReadPoint): boolean {
  if (inside(p, ring as ReadPoint[])) return true;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const u = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy || 1)));
    if (Math.hypot(p.x - a.x - u * vx, p.y - a.y - u * vy) <= ON_LINE_PT) return true;
  }
  return false;
}

const INDOOR = new Set<ReadSpace["kind"]>(["room", "wet", "circulation", "garage", "cupboard"]);

/** How far a face's eave stands out past the wall under it, sheet pixels:
    from points along its eave, straight in up its fall, to the first wall.
    Null where no wall is met within an eave's reach (a verandah on posts). */
function overhangOf(outline: readonly ReadPoint[], fall: ReadPoint, walls: readonly ReadPoint[][][], reach: number): number | null {
  const boxes = walls.map((w) => {
    const pts = w.flat();
    return [Math.min(...pts.map((p) => p.x)), Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.y))];
  });
  const inWall = (p: ReadPoint) => walls.some((w, i) => p.x >= boxes[i][0] && p.x <= boxes[i][2] && p.y >= boxes[i][1] && p.y <= boxes[i][3] && w.filter((r) => inside(p, r as ReadPoint[])).length % 2 === 1);
  const down = (p: ReadPoint) => p.x * fall.x + p.y * fall.y;
  const low = Math.max(...outline.map(down));
  const found: number[] = [];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    /* an eave edge: square to the fall, at the face's low side */
    if (Math.abs(down(a) - low) > 2 || Math.abs(down(b) - low) > 2) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 8) continue;
    for (let s = 1; s < 4; s++) {
      const t = s / 4;
      const from = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      for (let d = 0; d <= reach; d += 1) {
        if (inWall({ x: from.x - fall.x * d, y: from.y - fall.y * d })) {
          found.push(d);
          break;
        }
      }
    }
  }
  if (found.length < 2) return null;
  found.sort((p, q) => p - q);
  return found[Math.floor(found.length / 2)];
}

/** How far apart two faces' edges may lie and still be one hip, valley or
    ridge, mm: each face's outline runs inside its line, a line's width and a
    little apart. */
const SAME_EDGE_MM = 120;
/** How far two faces may disagree in height along the edge they share, mm. */
const SAME_HEIGHT_MM = 200;

/* FACES THAT MEET MEET AT ONE HEIGHT. Two faces of one roof (one floor, one
   eave) that share a hip, a valley or a ridge are the same height all along
   it. A face that disagrees with more of its neighbours than it agrees with
   was read wrong (3570: a pitch printed twice in a shape missing the line
   that splits it, 2.2 m above the faces it meets), and is left out. */
function meeting(faces: ReadRoofFace[], floors: readonly FloorUnder[]): ReadRoofFace[] {
  const mmOf = new Map(floors.map((f) => [f.floorId, f.mmPerPx]));
  type Edge = { a: ReadPoint; b: ReadPoint; ha: number; hb: number };
  const edgesOf = (f: ReadRoofFace): Edge[] => {
    const k = mmOf.get(f.floorId);
    if (!k) return [];
    const t = Math.tan((f.pitchDeg * Math.PI) / 180);
    const rise = riseOf(f.outline.map((p) => [p.x, p.y] as [number, number]), [f.fall.x, f.fall.y], f.pitchDeg);
    const h = rise.map((r) => r * k - f.overhangMm * t);
    return f.outline.map((a, i) => ({ a, b: f.outline[(i + 1) % f.outline.length], ha: h[i], hb: h[(i + 1) % h.length] }));
  };
  let live = faces.map((f) => ({ f, edges: edgesOf(f) }));
  for (let round = 0; round < 3; round++) {
    const score = live.map(() => ({ yes: 0, no: 0 }));
    live.forEach((A, i) => {
      const k = mmOf.get(A.f.floorId);
      if (!k) return;
      const tol = SAME_EDGE_MM / k;
      for (const e of A.edges) {
        const len = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
        if (len < 4 * tol) continue;
        const ux = (e.b.x - e.a.x) / len;
        const uy = (e.b.y - e.a.y) / len;
        const m = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
        const hm = (e.ha + e.hb) / 2;
        live.forEach((B, j) => {
          if (j === i || B.f.floorId !== A.f.floorId || B.f.sheetId !== A.f.sheetId || B.f.eaveMm !== A.f.eaveMm) return;
          for (const g of B.edges) {
            const gl = Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y);
            if (gl < 4 * tol) continue;
            /* the same line: parallel, and A's middle on it */
            if (Math.abs(((g.b.x - g.a.x) / gl) * uy - ((g.b.y - g.a.y) / gl) * ux) > 0.03) continue;
            const s = ((m.x - g.a.x) * (g.b.x - g.a.x) + (m.y - g.a.y) * (g.b.y - g.a.y)) / (gl * gl);
            if (s < 0 || s > 1) continue;
            const off = Math.hypot(g.a.x + (g.b.x - g.a.x) * s - m.x, g.a.y + (g.b.y - g.a.y) * s - m.y);
            if (off > tol) continue;
            const hg = g.ha + (g.hb - g.ha) * s;
            if (Math.abs(hg - hm) <= SAME_HEIGHT_MM) score[i].yes++;
            else score[i].no++;
            return;
          }
        });
      }
    });
    const next = live.filter((_, i) => !(score[i].no > score[i].yes));
    if (next.length === live.length) break;
    live = next;
  }
  return live.map((x) => x.f);
}

/** The faces of one roof plan page on the floors, or why they weren't put there. */
export function placeFaces(
  faces: readonly RoofFace[],
  page: number,
  floors: readonly FloorUnder[],
  parts: readonly ReadRoofPart[],
): { faces: ReadRoofFace[]; left: number } | { none: string } {
  if (!faces.length || !floors.length) return { none: "There were no faces or no floors" };
  const onPage = (f: RoofFace) => f.outline.map(([x, y]) => ({ x, y }));
  const rings = faces.map(onPage);
  /* the gate: the rooms read on the floors stand under the faces, page point for page point */
  const rooms = floors.flatMap((fl) => fl.spaces.filter((s) => INDOOR.has(s.kind) && s.outline.length >= 3).map((s) => ({ fl, at: centre(s.outline) })));
  if (!rooms.length) return { none: "No rooms were read on the floors to set the roof over" };
  const under = rooms.filter(({ fl, at }) => rings.some((r) => under1(r, { x: at.x / fl.pxPerPt, y: at.y / fl.pxPerPt }))).length;
  if (under < UNDER * rooms.length) return { none: `Only ${under} of the ${rooms.length} rooms read stand under the roof plan's faces` };

  const high = [...floors].sort((a, b) => b.level - a.level);
  const out: (ReadRoofFace & { over: number | null })[] = [];
  let left = 0;
  faces.forEach((face, i) => {
    const mid = centre(rings[i]);
    /* the highest floor with a space under the face's middle carries it */
    const fl = high.find((f) => f.spaces.some((s) => s.outline.length >= 3 && inside({ x: mid.x * f.pxPerPt, y: mid.y * f.pxPerPt }, s.outline)));
    if (!fl) return void left++;
    const outline = rings[i].map((p) => ({ x: Math.round(p.x * fl.pxPerPt * 10) / 10, y: Math.round(p.y * fl.pxPerPt * 10) / 10 }));
    const at = { x: mid.x * fl.pxPerPt, y: mid.y * fl.pxPerPt };
    const part = parts.find((p) => p.floorId === fl.floorId && p.sheetId === fl.sheetId && p.outline.length >= 3 && inside(at, p.outline));
    const eaveMm = part?.eaveMm ?? fl.ceilingMm;
    if (eaveMm == null || !(eaveMm > 0)) return void left++;
    const fall = { x: face.fall[0], y: face.fall[1] };
    const over = fl.mmPerPx && fl.walls?.length ? overhangOf(outline, fall, fl.walls, LONGEST_EAVE / fl.mmPerPx) : null;
    out.push({ floorId: fl.floorId, sheetId: fl.sheetId, outline, pitchDeg: face.pitchDeg, fall, eaveMm, overhangMm: 0, existing: part?.existing ?? false, page, over });
  });
  /* ONE OVERHANG FOR ONE ROOF. A face's own measure meets an inside wall or
     no wall at all as often as the one under its eave (3570's level 1: 0 to
     590 mm), and faces that sit at different heights don't meet at their
     hips. The faces one floor carries at one pitch and eave are one roof,
     and take the middle of their measures; none measured, they sit at the
     wall line. */
  const groups = new Map<string, number[]>();
  const key = (f: ReadRoofFace) => `${f.floorId}|${f.pitchDeg}|${f.eaveMm}`;
  for (const f of out) if (f.over != null) groups.set(key(f), [...(groups.get(key(f)) ?? []), f.over]);
  const placed: ReadRoofFace[] = out.map(({ over: _over, ...f }) => {
    const got = (groups.get(key(f)) ?? []).sort((a, b) => a - b);
    const mmPerPx = floors.find((fl) => fl.floorId === f.floorId)?.mmPerPx ?? null;
    return { ...f, overhangMm: got.length && mmPerPx ? Math.round(got[Math.floor(got.length / 2)] * mmPerPx) : 0 };
  });
  const kept = meeting(placed, floors);
  left += placed.length - kept.length;
  if (!kept.length) return { none: "None of its faces stood over a floor" };
  return { faces: kept, left };
}
