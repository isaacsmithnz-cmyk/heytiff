import type { Line } from "./fills";
import { enclose, outlined, rasterise } from "./enclose";

/* THE ROOF OFF THE ROOF PLAN'S OWN LINES (Isaac, 22 November 2026, of a roof
   read as nine boxes drawn by eye: "why is it guessed?"). A roof plan draws
   every face of the roof as a shape closed by its eaves, ridges, hips and
   valleys, and prints in each face its pitch with an arrow down its fall
   (3570's A104: 60 pitches, 40°, 20°, 15° and 5°; a curved verandah). So
   each face is the run of paper those lines close round a printed pitch,
   and it falls the way its arrow points. Nothing is guessed: a pitch with no
   arrow of its own, or in a shape that doesn't close, or sharing its shape
   with a different pitch, is left out, said why; and a page where most
   pitches don't read gives nothing, the roof left to the read by picture.
   Pure, in the page's own points (y down). */

/** A word on the page, centred where it sits, in page points. */
export type RoofWord = { text: string; at: { x: number; y: number } };

export type RoofFace = {
  /** the face's outline on its lines, page points: its corners on the line ends they stand by */
  outline: [number, number][];
  pitchDeg: number;
  /** which way it falls on the page: a unit vector, downhill */
  fall: [number, number];
  /** where its pitch is printed, page points */
  at: [number, number];
};

/** The faces read, and each printed pitch left out with why. */
export type RoofLines = { faces: RoofFace[]; left: { at: [number, number]; why: string }[] } | { none: string };

/** Grid pixels to a page point: a line's two sides 0.5 pt apart are told apart. */
export const ROOF_K = 2;
/** Fewer faces than this and the page is not read as a roof plan. */
const FEWEST = 3;
/** The share of a page's printed pitches that must read as faces for any of them to be used (3570's A104: 45 of 60; another set's, its arrows drawn grey: 3 of 13). */
const MOST = 0.6;
/** How far from its pitch an arrow's middle may be, points (3570: 6 to 9 pt from the word's centre). */
const ARROW_REACH = 24;
/** An arrow's strokes are shorter than this, points (3570's shafts: 14 pt). */
const ARROW_LONGEST = 40;

const PITCH = /^(?:(?:roof\s+)?(?:fall|pitch|pitched)(?:\s+at)?\s+)?(\d{1,2}(?:\.\d+)?)\s*(?:°|deg(?:rees?)?)(?:\s+(?:fall|pitch))?$/i;

/** A printed roof pitch ("40.0°", "5°", "FALL 8°", "PITCH 22.5 DEG") in degrees; null for any other word. */
export function pitchOf(text: string): number | null {
  const m = PITCH.exec(text.trim());
  if (!m) return null;
  const deg = Number(m[1]);
  return deg > 0 && deg < 75 ? deg : null;
}

const lightness = (c: string) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  if (!m) return 1;
  return (parseInt(m[1], 16) + parseInt(m[2], 16) + parseInt(m[3], 16)) / (3 * 255);
};

const near = (p: [number, number], q: [number, number], d: number) => Math.abs(p[0] - q[0]) <= d && Math.abs(p[1] - q[1]) <= d;

/** An arrow drawn on the page: where three or more short dark strokes meet
    (a shaft and its head's two sides), the way it points (from the strokes'
    far ends to that tip) and its middle (half way down its longest stroke). */
export type Arrow = { tip: [number, number]; dir: [number, number]; mid: [number, number]; strokes: Line[] };

/** The arrow whose tip is `tip`, out of the strokes that end there: one
    shaft and two head strokes each under half its length, leaning back off
    it 10° to 45° on either side, mirrored. Anything else that meets at a
    point (a hip at an eave corner, a curve's pieces at a line) is no arrow. */
function arrowOf(tip: [number, number], meet: readonly Line[]): Arrow | null {
  if (meet.length !== 3) return null;
  const back = meet.map((l) => {
    const far = near(l.a, tip, 0.05) ? l.b : l.a;
    const len = Math.hypot(far[0] - tip[0], far[1] - tip[1]);
    return { l, len, u: [(far[0] - tip[0]) / len, (far[1] - tip[1]) / len] as [number, number] };
  });
  back.sort((p, q) => q.len - p.len);
  const [shaft, h1, h2] = back;
  if (h1.len > shaft.len / 2 || h2.len > shaft.len / 2) return null;
  const lean = (h: (typeof back)[number]) => (Math.acos(Math.max(-1, Math.min(1, h.u[0] * shaft.u[0] + h.u[1] * shaft.u[1]))) * 180) / Math.PI;
  const side = (h: (typeof back)[number]) => Math.sign(shaft.u[0] * h.u[1] - shaft.u[1] * h.u[0]);
  const [a1, a2] = [lean(h1), lean(h2)];
  if (a1 < 10 || a1 > 45 || a2 < 10 || a2 > 45 || Math.abs(a1 - a2) > 8 || side(h1) === side(h2)) return null;
  return {
    tip,
    dir: [-shaft.u[0], -shaft.u[1]],
    mid: [tip[0] + (shaft.u[0] * shaft.len) / 2, tip[1] + (shaft.u[1] * shaft.len) / 2],
    strokes: meet.slice(),
  };
}

/** Every arrow among the short dark strokes. */
export function arrowsOf(dark: readonly Line[]): Arrow[] {
  const short = dark.filter((l) => {
    const len = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]);
    return len > 0.5 && len < ARROW_LONGEST;
  });
  /* the strokes by where they end, on a coarse grid, so a page of 40,000 lines is met in one pass */
  const at = new Map<string, Line[]>();
  const key = (p: readonly [number, number]) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
  for (const l of short) for (const e of [l.a, l.b]) at.set(key(e), [...(at.get(key(e)) ?? []), l]);
  const out: Arrow[] = [];
  for (const list of at.values()) {
    if (list.length < 3) continue;
    /* the tip as drawn, not as gridded: a tip off by half a point turns a 14 pt shaft by two degrees */
    const end = list.flatMap((l) => [l.a, l.b]).find((e) => list.filter((l) => near(l.a, e, 0.05) || near(l.b, e, 0.05)).length >= 3);
    if (!end || out.some((a) => near(a.tip, end, 0.5))) continue;
    const arrow = arrowOf([end[0], end[1]], list.filter((l) => near(l.a, end, 0.05) || near(l.b, end, 0.05)));
    if (arrow) out.push(arrow);
  }
  return out;
}

/** Each pitch's arrow: the arrow nearest it, when it is within reach and the
    pitch is the nearest pitch to that arrow too. A pair of pitches printed
    back to back (a gable's two sides) each keep their own; an arrow two
    pitches could claim alike is nobody's. */
export function arrowsFor(pitches: readonly { at: [number, number] }[], arrows: readonly Arrow[]): (Arrow | null)[] {
  const d = (p: readonly [number, number], q: readonly [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  return pitches.map((p) => {
    let best: Arrow | null = null;
    for (const a of arrows) if (d(a.mid, p.at) <= ARROW_REACH && (!best || d(a.mid, p.at) < d(best.mid, p.at))) best = a;
    if (!best) return null;
    const mine = d(best.mid, p.at);
    const theirs = Math.min(...pitches.filter((q) => q !== p).map((q) => d(best.mid, q.at)));
    return theirs > mine * 1.2 ? best : null;
  });
}

/** How far a traced corner stands from the line end it belongs to, points: the trace runs a line's half width and a grid pixel inside it. */
const SNAP = 2;

/** Each corner onto the nearest line end within SNAP, the run of corners that
    land on one end made one. A corner with no end by it (a curve traced
    between its pieces' ends) stays as traced. */
function onTheLines(outline: readonly [number, number][], ends: ReadonlyMap<string, [number, number][]>): [number, number][] {
  const out: [number, number][] = [];
  for (const p of outline) {
    let best: [number, number] | null = null;
    let d = SNAP;
    const gx = Math.round(p[0] / SNAP);
    const gy = Math.round(p[1] / SNAP);
    for (let x = gx - 1; x <= gx + 1; x++)
      for (let y = gy - 1; y <= gy + 1; y++)
        for (const e of ends.get(`${x},${y}`) ?? []) {
          const h = Math.hypot(e[0] - p[0], e[1] - p[1]);
          if (h < d) {
            d = h;
            best = e;
          }
        }
    const q: [number, number] = best ? [best[0], best[1]] : [p[0], p[1]];
    const last = out[out.length - 1];
    if (!last || Math.hypot(last[0] - q[0], last[1] - q[1]) > 1e-6) out.push(q);
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 1e-6) out.pop();
  return out;
}

/** An arrow is drawn square to the eave it falls to, as near as a hand sets
    it: within 8° of square to one of the face's edges, the fall is that
    edge's square. Otherwise (a curved face) the arrow stands as drawn. */
function squared(outline: readonly [number, number][], dir: [number, number]): [number, number] {
  let best: [number, number] = dir;
  let bestDot = Math.cos((8 * Math.PI) / 180);
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 4) continue;
    for (const sq of [[(b[1] - a[1]) / len, -(b[0] - a[0]) / len], [-(b[1] - a[1]) / len, (b[0] - a[0]) / len]] as [number, number][]) {
      const dot = sq[0] * dir[0] + sq[1] * dir[1];
      if (dot > bestDot) {
        bestDot = dot;
        best = sq;
      }
    }
  }
  return best;
}

/** The roof plan's faces: the shapes its darkest thin lines close round each printed pitch. */
export function roofLines(input: { lines: readonly Line[]; words: readonly RoofWord[]; width: number; height: number }): RoofLines {
  const pitches = input.words.map((w) => ({ deg: pitchOf(w.text), at: [w.at.x, w.at.y] as [number, number] })).filter((p): p is { deg: number; at: [number, number] } => p.deg != null);
  if (pitches.length < FEWEST) return { none: "It prints too few roof pitches to be a roof plan" };
  const dark = input.lines.filter((l) => lightness(l.colour) <= 0.2);
  if (!dark.length) return { none: "It has no dark lines to read a roof from" };
  /* the outlines are the dark lines that aren't arrows: an arrow's head would close a small shape of its own */
  const found = arrowsOf(dark);
  const inArrow = new Set(found.flatMap((a) => a.strokes));
  const outlines = dark.filter((l) => !inArrow.has(l));

  const K = ROOF_K;
  const W = Math.ceil(input.width * K);
  const H = Math.ceil(input.height * K);
  /* each line laid as a strip a pixel and a half wide, run on past its ends a little, so lines that meet on paper meet on the grid */
  const strips = outlines.map((l) => {
    const len = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]) || 1;
    const ux = (l.b[0] - l.a[0]) / len;
    const uy = (l.b[1] - l.a[1]) / len;
    const h = 0.75 / K;
    const e = 0.5 / K;
    const [ax, ay] = [l.a[0] - ux * e, l.a[1] - uy * e];
    const [bx, by] = [l.b[0] + ux * e, l.b[1] + uy * e];
    return [
      [
        [ax - uy * h, ay + ux * h],
        [bx - uy * h, by + ux * h],
        [bx + uy * h, by - ux * h],
        [ax + uy * h, ay - ux * h],
      ] as [number, number][],
    ];
  });
  const grid = enclose(rasterise(strips, input.width, input.height, K), W, H, 0, 0);

  /* each pitch to the shape it is printed in: its arrow's tail first (the word may straddle a line), then the word itself */
  const byShape = new Map<number, { deg: number; at: [number, number]; dir: [number, number] }[]>();
  const left: { at: [number, number]; why: string }[] = [];
  const arrows = arrowsFor(pitches, found);
  pitches.forEach((p, i) => {
    const arrow = arrows[i];
    if (!arrow) return void left.push({ at: p.at, why: "no arrow of its own beside it" });
    const shapeAt = ([x, y]: [number, number]) => grid.label[Math.floor(y * K) * W + Math.floor(x * K)] ?? -1;
    /* the arrow's middle names the shape; the word, unless it sits on a line, must be in the same one */
    const id = shapeAt(arrow.mid);
    const word = shapeAt(p.at);
    if (id < 0) return void left.push({ at: p.at, why: "its arrow is drawn on a line" });
    if (word >= 0 && word !== id) return void left.push({ at: p.at, why: "its arrow is in another shape" });
    byShape.set(id, [...(byShape.get(id) ?? []), { deg: p.deg, at: p.at, dir: arrow.dir }]);
  });

  /* the outlines' corners as drawn: a face is traced inside its lines, so each corner is put back on the line end it stands by */
  const ends = new Map<string, [number, number][]>();
  for (const l of outlines)
    for (const e of [l.a, l.b]) {
      const k = `${Math.round(e[0] / SNAP)},${Math.round(e[1] / SNAP)}`;
      ends.set(k, [...(ends.get(k) ?? []), e]);
    }
  const faces: RoofFace[] = [];
  for (const [id, said] of byShape) {
    const shape = grid.spaces[id];
    /* the paper round the drawing, or a shape that runs off the page, is no face */
    if (!shape || shape.open) {
      for (const s of said) left.push({ at: s.at, why: "its lines don't close round it" });
      continue;
    }
    /* one face may print its pitch twice, the same pitch falling the same way; two
       that differ in one shape mean a line is missing between two faces, and
       which part is which isn't known */
    if (said.some((s) => s.deg !== said[0].deg || s.dir[0] * said[0].dir[0] + s.dir[1] * said[0].dir[1] < Math.cos(Math.PI / 18))) {
      for (const s of said) left.push({ at: s.at, why: "another pitch is printed in the same shape" });
      continue;
    }
    const outline = onTheLines(
      outlined(grid, shape).map(([x, y]) => [x / K, y / K] as [number, number]),
      ends,
    );
    if (outline.length < 3) continue;
    faces.push({ outline, pitchDeg: said[0].deg, fall: squared(outline, said[0].dir), at: said[0].at });
  }
  /* a page whose pitches mostly don't read as faces isn't drawn the way this reads: none of it is trusted */
  const read = pitches.length - left.length;
  if (faces.length < FEWEST || read < MOST * pitches.length)
    return { none: `Only ${read} of its ${pitches.length} printed pitches closed a face with an arrow` };
  return { faces, left };
}

/** How far each corner of a face stands above its eave, in its outline's
    units. Its eave is its edges whose outside faces down its fall. A face
    whose eave edges all run one way is a plane: its corners rise up the fall
    from its longest eave line, and a piece of eave stepped further out sits
    that much lower, as it does on one plane. A face whose eave turns (a
    curved verandah) rises square off the nearest piece of it. A face with no
    such edge rises up its fall from its lowest corner. */
export function riseOf(outline: readonly [number, number][], fall: [number, number], pitchDeg: number): number[] {
  const t = Math.tan((pitchDeg * Math.PI) / 180);
  const n = outline.length;
  /* the outline's turn (y down): an edge's outside is to its left or right as drawn */
  const area = outline.reduce((s, p, i) => s + p[0] * outline[(i + 1) % n][1] - outline[(i + 1) % n][0] * p[1], 0);
  const turn = area > 0 ? 1 : -1;
  const eaves: [[number, number], [number, number]][] = [];
  for (let i = 0; i < n; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!len) continue;
    const out: [number, number] = [(turn * (b[1] - a[1])) / len, (-turn * (b[0] - a[0])) / len];
    if (out[0] * fall[0] + out[1] * fall[1] >= Math.cos(Math.PI / 6)) eaves.push([a, b]);
  }
  const down = (p: readonly [number, number]) => p[0] * fall[0] + p[1] * fall[1];
  const length = ([a, b]: [[number, number], [number, number]]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!eaves.length) {
    const low = Math.max(...outline.map(down));
    return outline.map((p) => (low - down(p)) * t);
  }
  const longest = eaves.reduce((m, e) => (length(e) > length(m) ? e : m));
  const parallel = eaves.every(([a, b]) => {
    const [a0, b0] = longest;
    const cross = (b[0] - a[0]) * (b0[1] - a0[1]) - (b[1] - a[1]) * (b0[0] - a0[0]);
    return Math.abs(cross) <= Math.sin(Math.PI / 90) * length([a, b]) * length(longest);
  });
  if (parallel) {
    /* its eaves' lines, each as long as it runs, decide the plane's foot: the line carrying most of the eave */
    const by = new Map<number, number>();
    for (const e of eaves) {
      const at = Math.round((down(e[0]) + down(e[1])) / 2);
      by.set(at, (by.get(at) ?? 0) + length(e));
    }
    const foot = [...by].reduce((m, x) => (x[1] > m[1] ? x : m))[0];
    return outline.map((p) => (foot - down(p)) * t);
  }
  const toSeg = (p: readonly [number, number], [a, b]: [[number, number], [number, number]]) => {
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy || 1)));
    return Math.hypot(p[0] - a[0] - u * vx, p[1] - a[1] - u * vy);
  };
  return outline.map((p) => Math.min(...eaves.map((e) => toSeg(p, e))) * t);
}
