import { inside, type ReadPoint, type ReadRoofFace, type ReadRoofPart, type ReadSpace } from "../reading";
import { riseOf, type RoofFace } from "./roof";

/* THE ROOF PLAN'S FACES SET OVER THE FLOORS. An architect's sheets share one
   page origin: on 3570 the ground floor's and level 1's walls fall exactly
   under A104's eaves, page point for page point. So a face is moved onto a
   floor's sheet by that sheet's own pixels to the point, and that is only
   trusted when it plainly holds: most of the rooms read on the floors stand
   under the faces, and a floor's roofs' eaves stand out past its walls
   alike on opposite sides, both ways across it. Each face then goes on the
   highest floor under most of it (a hip over level 1 is carried by level
   1's walls, a verandah over the ground floor's), its eave the height the
   read took off the sections for the roof part it sits in, else that
   floor's ceiling, and its overhang measured off the file's own walls. A
   face with no floor under it, or standing half on one, or on a roof whose
   overhang can't be measured, is left out. Pure. */

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
/** How many points each way a face is tried at for the floor under it. */
const ACROSS = 10;
/** The share of a face's points over the floors that one floor must stand under to carry it. */
const CARRIES = 0.5;
/** A floor under more of a face than this and not most of it has the face half on it: which floor carries it isn't known. */
const HALF_ON = 0.15;
/** How far a roof's eaves on opposite sides may measure apart, mm, for the roof plan to be taken as drawn over the floor: one set off by more than half this stands its eaves that much further out on one side and in on the other. */
const OPPOSITE_MM = 150;
/** Two pairs of opposite eaves check the floor both ways across when their falls are within 30° of square to each other: cos 60°. */
const CROSSING = 0.5;

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

/** How far a point is from the line round a ring. */
function offRing(ring: readonly ReadPoint[], p: ReadPoint): number {
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const u = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy || 1)));
    d = Math.min(d, Math.hypot(p.x - a.x - u * vx, p.y - a.y - u * vy));
  }
  return d;
}

/** A point under a face: inside it, or on the line round it (a room's middle can fall on a ridge). */
const ON_LINE_PT = 1.5;
const under1 = (ring: readonly ReadPoint[], p: ReadPoint) => inside(p, ring as ReadPoint[]) || offRing(ring, p) <= ON_LINE_PT;

const INDOOR = new Set<ReadSpace["kind"]>(["room", "wet", "circulation", "garage", "cupboard"]);

/** Whether a point is in a floor's walls: each wall's box taken once for
    the floor, by a plain loop (a long curved wall has more points than can
    be spread into Math.min), then its outlines even-odd. */
function wallsAt(walls: readonly ReadPoint[][][]): (p: ReadPoint) => boolean {
  const boxes = walls.map((w) => {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const ring of w)
      for (const p of ring) {
        if (p.x < b[0]) b[0] = p.x;
        if (p.y < b[1]) b[1] = p.y;
        if (p.x > b[2]) b[2] = p.x;
        if (p.y > b[3]) b[3] = p.y;
      }
    return b;
  });
  return (p) => walls.some((w, i) => p.x >= boxes[i][0] && p.x <= boxes[i][2] && p.y >= boxes[i][1] && p.y <= boxes[i][3] && w.filter((r) => inside(p, r as ReadPoint[])).length % 2 === 1);
}

/** Points spread over a face: the middles of a grid's cells that fall in it, else its middle. */
function spread(ring: readonly ReadPoint[]): ReadPoint[] {
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  const [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const out: ReadPoint[] = [];
  for (let i = 0; i < ACROSS; i++)
    for (let j = 0; j < ACROSS; j++) {
      const p = { x: x0 + ((i + 0.5) * (x1 - x0)) / ACROSS, y: y0 + ((j + 0.5) * (y1 - y0)) / ACROSS };
      if (inside(p, ring as ReadPoint[])) out.push(p);
    }
  return out.length ? out : [centre(ring)];
}

/** How far a face's eave stands out past the wall under it, sheet pixels:
    from points along its eave, straight in up its fall, to the first wall.
    Null where no wall is met within an eave's reach (a verandah on posts). */
function overhangOf(outline: readonly ReadPoint[], fall: ReadPoint, inWall: (p: ReadPoint) => boolean, reach: number): number | null {
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
  const walled = new Map(high.map((f) => [f, f.walls?.length ? wallsAt(f.walls) : () => false]));
  /* a floor stands under a point where one of its spaces or its walls is (a notch is a cut out of it) */
  const standsUnder = (f: FloorUnder, p: ReadPoint) => {
    const q = { x: p.x * f.pxPerPt, y: p.y * f.pxPerPt };
    return f.spaces.some((s) => s.kind !== "notch" && s.outline.length >= 3 && inside(q, s.outline)) || walled.get(f)!(q);
  };
  const out: (Omit<ReadRoofFace, "overhangMm"> & { measured: number | null; mmPerPx: number | null })[] = [];
  let left = 0;
  faces.forEach((face, i) => {
    /* THE FLOOR UNDER MOST OF IT carries it, not the one under its middle
       alone: a face's middle can fall in the wall between two rooms. A
       floor under only part of it (a face read across two roofs, a sheet
       set a little off) leaves which floor carries it unknown, so it is
       left out rather than dropped a storey. Its points over no floor (its
       eave's overhang) count for none. */
    const hit = spread(rings[i]).map((p) => high.map((f) => standsUnder(f, p)));
    const any = hit.filter((h) => h.some(Boolean)).length;
    let fl: FloorUnder | undefined;
    for (let j = 0; j < high.length && any; j++) {
      const share = hit.filter((h) => h[j]).length / any;
      /* from the top: the first floor under most of it carries it; one under some of it and not most, none does */
      if (share >= CARRIES) fl = high[j];
      if (share > HALF_ON) break;
    }
    if (!fl) return void left++;
    const mid = centre(rings[i]);
    const outline = rings[i].map((p) => ({ x: Math.round(p.x * fl.pxPerPt * 10) / 10, y: Math.round(p.y * fl.pxPerPt * 10) / 10 }));
    const at = { x: mid.x * fl.pxPerPt, y: mid.y * fl.pxPerPt };
    const part = parts.find((p) => p.floorId === fl.floorId && p.sheetId === fl.sheetId && p.outline.length >= 3 && inside(at, p.outline));
    const eaveMm = part?.eaveMm ?? fl.ceilingMm;
    if (eaveMm == null || !(eaveMm > 0)) return void left++;
    const fall = { x: face.fall[0], y: face.fall[1] };
    const measured = fl.mmPerPx && fl.walls?.length ? overhangOf(outline, fall, walled.get(fl)!, LONGEST_EAVE / fl.mmPerPx) : null;
    out.push({ floorId: fl.floorId, sheetId: fl.sheetId, outline, pitchDeg: face.pitchDeg, fall, eaveMm, existing: part?.existing ?? false, page, measured, mmPerPx: fl.mmPerPx });
  });
  /* ONE OVERHANG FOR ONE ROOF. A face's own measure meets an inside wall or
     no wall at all as often as the one under its eave (3570's level 1: 0 to
     590 mm), and faces that sit at different heights don't meet at their
     hips. The faces one floor carries at one pitch and eave are one roof,
     and take the middle of their measures. */
  const key = (f: Pick<ReadRoofFace, "floorId" | "pitchDeg" | "eaveMm">) => `${f.floorId}|${f.pitchDeg}|${f.eaveMm}`;
  const roofs = new Map<string, typeof out>();
  for (const f of out) roofs.set(key(f), [...(roofs.get(key(f)) ?? []), f]);
  const middle = (v: readonly number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
  /* ITS EAVES STAND OUT ALIKE ON OPPOSITE SIDES. A roof plan set a metre off
     the floor under it still has most of the floor's rooms under it, but
     its eaves stand a metre further out on one side and a metre in on the
     other, or past an eave's reach and measure nothing. One pair checks it
     one way only: a roof plan set a metre along a gable's ridge, or a hip's
     whose short ends didn't measure, still has its long eaves alike. So a
     floor carries faces only when its roofs have opposite eaves measured
     alike both ways across it, two pairs falling near square to each
     other, and every pair measured on it is alike. */
  const sure = new Map<string, { alike: ReadPoint[]; apart: number }>();
  for (const roof of roofs.values()) {
    const sides: { fall: ReadPoint; got: number[] }[] = [];
    for (const f of roof) {
      if (f.measured == null) continue;
      const side = sides.find((s) => s.fall.x * f.fall.x + s.fall.y * f.fall.y > 0.95);
      if (side) side.got.push(f.measured);
      else sides.push({ fall: f.fall, got: [f.measured] });
    }
    const t = sure.get(roof[0].floorId) ?? { alike: [], apart: 0 };
    for (let a = 0; a < sides.length; a++)
      for (let b = a + 1; b < sides.length; b++) {
        if (sides[a].fall.x * sides[b].fall.x + sides[a].fall.y * sides[b].fall.y > -0.95) continue;
        if (Math.abs(middle(sides[a].got) - middle(sides[b].got)) * roof[0].mmPerPx! <= OPPOSITE_MM) t.alike.push(sides[a].fall);
        else t.apart++;
      }
    sure.set(roof[0].floorId, t);
  }
  const trusted = (floorId: string) => {
    const t = sure.get(floorId);
    return !!t && t.apart === 0 && t.alike.some((u, i) => t.alike.some((v, j) => j > i && Math.abs(u.x * v.x + u.y * v.y) <= CROSSING));
  };
  /* a roof whose overhang wasn't measured is left out, not set at the wall line: its eave's height would be guessed */
  const placed: ReadRoofFace[] = [];
  for (const { measured: _m, mmPerPx, ...f } of out) {
    const got = roofs.get(key(f))!.flatMap((g) => (g.measured == null ? [] : [g.measured]));
    if (!trusted(f.floorId) || !got.length || !mmPerPx) left++;
    else placed.push({ ...f, overhangMm: Math.round(middle(got) * mmPerPx) });
  }
  const kept = meeting(placed, floors);
  left += placed.length - kept.length;
  if (!kept.length) {
    if (!out.length) return { none: "None of its faces stood over a floor" };
    if (out.every((f) => f.measured == null)) return { none: "No overhang could be measured off the file's walls under it" };
    if (![...sure.keys()].some(trusted)) return { none: "Its eaves didn't measure alike on opposite sides both ways across any floor, so it isn't known to be drawn over them" };
    return { none: "None of its faces had its roof's overhang measured and met its neighbours at one height" };
  }
  return { faces: kept, left };
}

/** Whether every face another roof plan page placed is one of these read
    again: on the same floor at the same pitch, each corner of either within
    an edge's width of the other's outline. A face of its own (an existing
    roof's, where these are the proposed one's) makes it another roof. */
export function readAgain(other: readonly ReadRoofFace[], faces: readonly ReadRoofFace[], floors: readonly FloorUnder[]): boolean {
  const mmOf = new Map(floors.map((f) => [f.floorId, f.mmPerPx]));
  return other.every((g) => {
    const k = mmOf.get(g.floorId);
    if (!k) return false;
    const tol = SAME_EDGE_MM / k;
    return faces.some((f) => f.floorId === g.floorId && f.pitchDeg === g.pitchDeg && g.outline.every((p) => offRing(f.outline, p) <= tol) && f.outline.every((p) => offRing(g.outline, p) <= tol));
  });
}
