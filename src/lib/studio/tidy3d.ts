import type { Floor3D, Opening3D, Space3D, XZ } from "./scene3d";

/* THE HOUSE MADE TIDY, IN 3D (Isaac, 9 November 2026: "look for issues of
   staircases going into walls, rooms going to nowhere, doors going to
   nowhere ... I need to make sure that it's pretty tidy"). Tiff reads each
   room as its own outline and each door as a line; the 3D walls every
   outline. Three things that leaves untidy, put right here:

   - A door or window read on the wall's outside face, or a hair off it,
     cut no wall and so was never drawn: it goes onto the wall it belongs
     to, and cuts the room's face on the far side of a thick wall too.
   - Two rooms drawn edge to edge with no wall between them on the plan
     (her outlines meet: the hall that runs into the dining) were walled
     apart: where they meet is open.
   - A room she found no way into (the kitchen open to the living through
     an arch, the walk-in robe off the bedroom, a bathroom whose door she
     missed) was a sealed box: it opens to the room it's most likely open
     to, or gets a door where it's a room that has one.

   Pure, in metres on the plan, as scene3d. */

const sub = (a: XZ, b: XZ): XZ => [a[0] - b[0], a[1] - b[1]];
const dot = (a: XZ, b: XZ) => a[0] * b[0] + a[1] * b[1];
const len = (a: XZ, b: XZ) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const lerp = (a: XZ, b: XZ, t: number): XZ => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;
const p3 = (p: XZ): XZ => [r3(p[0]), r3(p[1])];

function within(p: XZ, poly: XZ[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
const area = (pts: XZ[]) => Math.abs(pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0)) / 2;
const sides = (s: Space3D) => s.pts.map((p, i): [XZ, XZ] => [p, s.pts[(i + 1) % s.pts.length]]);

/** Spaces a person walks into: everything indoors that stands in walls. */
const INDOOR: ReadonlySet<Space3D["kind"]> = new Set(["room", "wet", "cupboard", "circulation", "stair", "garage", "other", "zone"]);
/** The living side of a house, which runs into itself through arches and open sides: the hall, the entry, the living, the dining, the kitchen. A bedroom, a study, a bathroom or a garage has a door. */
const SHUT = /bed|study|office|robe|\bwir\b|\bens|bath|\bwc\b|toilet|powder|pwdr|laundry|ldry|garage|store|media|theatre|gym|nursery|guest|cellar|plant|cupb|linen|\blin\b|pantry|scullery|butler|shower|\bshr\b/i;
const OPEN = /living|lounge|dining|kitchen|family|meals|rumpus|sitting|entry|hall|foyer|lobby|landing|passage|corridor|gallery|open plan|top of stair/i;
export const flows = (s: Space3D) => (s.kind === "circulation" || ((s.kind === "room" || s.kind === "other" || s.kind === "zone") && OPEN.test(s.name))) && !SHUT.test(s.name);
/** A store opened from outside keeps its walls when no door into it was read. */
const OUTSIDE_STORE = /\bbins?\b|meter|pump|plant|pool|\bhws\b|\bgas\b|bin store/i;

/** A side as a line: its direction, its normal, its length. */
function line(a: XZ, b: XZ) {
  const L = len(a, b) || 1;
  const u: XZ = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  return { a, b, L, u, n: [-u[1], u[0]] as XZ };
}
/** A point onto a side's line. */
function onto(p: XZ, a: XZ, b: XZ): XZ {
  const { u } = line(a, b);
  const t = dot(sub(p, a), u);
  return [a[0] + u[0] * t, a[1] + u[1] * t];
}

/** The side of a walled space an opening belongs to: parallel to it, both its ends near its line, and along it. */
function sideFor(o: { a: XZ; b: XZ }, s: Space3D, reach: number): { a: XZ; b: XZ; off: number } | null {
  let best: { a: XZ; b: XZ; off: number } | null = null;
  const ol = line(o.a, o.b);
  for (const [a, b] of sides(s)) {
    const l = line(a, b);
    if (l.L < 0.3 || Math.abs(dot(ol.u, l.n)) > 0.35) continue;
    const off = Math.max(Math.abs(dot(sub(o.a, a), l.n)), Math.abs(dot(sub(o.b, a), l.n)));
    if (off > reach) continue;
    const t0 = Math.max(0, Math.min(dot(sub(o.a, a), l.u), dot(sub(o.b, a), l.u)));
    const t1 = Math.min(l.L, Math.max(dot(sub(o.a, a), l.u), dot(sub(o.b, a), l.u)));
    if (t1 - t0 < 0.3) continue;
    if (!best || off < best.off) best = { a, b, off };
  }
  return best;
}

/** Each door and window onto its wall. One read a little off its wall (on the outside face of a thick wall, or a hair past it) moves onto it; across a thick wall, the room on the far side has its face cut too, by an echo that draws nothing in it. */
export function snapOpenings(spaces: Space3D[], openings: Opening3D[]): Opening3D[] {
  const walled = spaces.filter((s) => INDOOR.has(s.kind) || s.existing);
  const out: Opening3D[] = [];
  /* an outside wall: nothing indoors past it */
  const outward = (a: XZ, b: XZ, s: Space3D) => {
    const l = line(a, b);
    const m = lerp(a, b, 0.5);
    const n: XZ = within([m[0] + l.n[0] * 0.05, m[1] + l.n[1] * 0.05], s.pts) ? [-l.n[0], -l.n[1]] : l.n;
    return [0.3, 0.6].every((d) => !walled.some((x) => x !== s && x.kind !== "stair" && within([m[0] + n[0] * d, m[1] + n[1] * d], x.pts)));
  };
  for (const o of openings) {
    let hits = walled.flatMap((s) => sideFor(o, s, 0.5) ?? []).sort((p, q) => p.off - q.off);
    /* one in an outside wall, read further in (6 Bishops Ave's living windows, 0.6 m in): onto the outside wall it faces */
    if (!hits.length && o.external)
      hits = walled.flatMap((s) => {
        const h = sideFor(o, s, 0.9);
        return h && outward(h.a, h.b, s) ? [h] : [];
      });
    if (!hits.length) {
      out.push(o);
      continue;
    }
    const first = hits[0];
    const moved = first.off < 0.06 ? o : { ...o, a: p3(onto(o.a, first.a, first.b)), b: p3(onto(o.b, first.a, first.b)) };
    out.push(moved);
    for (const h of hits.slice(1)) {
      /* a face the moved one already cuts (within the wall builder's quarter metre) needs nothing more */
      const l = line(h.a, h.b);
      if (Math.max(Math.abs(dot(sub(moved.a, h.a), l.n)), Math.abs(dot(sub(moved.b, h.a), l.n))) < 0.2) continue;
      if (out.some((e) => e.echo && len(e.a, onto(moved.a, h.a, h.b)) < 0.05)) continue;
      out.push({ ...o, a: p3(onto(moved.a, h.a, h.b)), b: p3(onto(moved.b, h.a, h.b)), echo: true });
    }
  }
  return out;
}

/** Where one space runs along another: on a side of `x`, the stretch whose other side (within a wall's thickness) is `y`, and how far across. */
type Run = { x: Space3D; y: Space3D; a: XZ; b: XZ; gap: number; n: XZ };

function runsOf(x: Space3D, others: Space3D[]): Run[] {
  const out: Run[] = [];
  const STEP = 0.1;
  for (const [a, b] of sides(x)) {
    const l = line(a, b);
    if (l.L < 0.5) continue;
    /* the normal pointing out of x */
    const m = lerp(a, b, 0.5);
    const n: XZ = within([m[0] + l.n[0] * 0.05, m[1] + l.n[1] * 0.05], x.pts) ? [-l.n[0], -l.n[1]] : l.n;
    let cur: { y: Space3D; t0: number; t1: number; gap: number } | null = null;
    const close = () => {
      if (cur && cur.t1 - cur.t0 >= 0.5) out.push({ x, y: cur.y, a: p3(lerp(a, b, cur.t0 / l.L)), b: p3(lerp(a, b, cur.t1 / l.L)), gap: cur.gap, n });
      cur = null;
    };
    for (let t = STEP / 2; t < l.L; t += STEP) {
      const p = lerp(a, b, t / l.L);
      let found: { y: Space3D; gap: number } | null = null;
      for (const d of [0.03, 0.15, 0.3, 0.45]) {
        const q: XZ = [p[0] + n[0] * d, p[1] + n[1] * d];
        const y = others.find((s) => s !== x && within(q, s.pts));
        if (y) {
          found = { y, gap: d };
          break;
        }
      }
      if (found && cur && (cur as { y: Space3D }).y === found.y) {
        (cur as { t1: number }).t1 = t + STEP / 2;
        (cur as { gap: number }).gap = Math.max((cur as { gap: number }).gap, found.gap);
      } else {
        close();
        if (found) cur = { y: found.y, t0: t - STEP / 2, t1: t + STEP / 2, gap: found.gap };
      }
    }
    close();
  }
  return out;
}

/** A stretch of x's side and the same stretch on y's facing side, so both of their walls are cut. */
function bothFaces(r: Run, t0: number, t1: number): [XZ, XZ][] {
  const L = len(r.a, r.b);
  const a = p3(lerp(r.a, r.b, t0 / L));
  const b = p3(lerp(r.a, r.b, t1 / L));
  const segs: [XZ, XZ][] = [[a, b]];
  /* y's side that faces x here: parallel, the nearest across */
  let best: { s: [XZ, XZ]; d: number } | null = null;
  for (const [p, q] of sides(r.y)) {
    const l = line(p, q);
    if (l.L < 0.3 || Math.abs(dot(l.u, line(r.a, r.b).n)) > 0.2) continue;
    const d = dot(sub(p, a), r.n);
    if (d < -0.05 || d > 0.6) continue;
    const ta = dot(sub(a, p), l.u);
    const tb = dot(sub(b, p), l.u);
    if (Math.max(ta, tb) < 0 || Math.min(ta, tb) > l.L) continue;
    if (!best || d < best.d) best = { s: [p, q], d };
  }
  if (best && best.d > 0.15) segs.push([p3(onto(a, ...best.s)), p3(onto(b, ...best.s))]);
  return segs;
}

/** The spaces either side of a door or an opening: each side's first, out to a thick wall's width. */
function acrossOf(o: { a: XZ; b: XZ }, nodes: Space3D[]): Space3D[] {
  const l = line(o.a, o.b);
  const m = lerp(o.a, o.b, 0.5);
  const at = (d: number) => nodes.filter((s) => within([m[0] + l.n[0] * d, m[1] + l.n[1] * d], s.pts));
  const side = (k: number) => [0.2, 0.35, 0.5, 0.65].map((d) => at(d * k)).find((x) => x.length) ?? [];
  return [...side(1), ...side(-1)];
}

/** The floor across a wall's thickness where it's open or a door goes through it: between the two faces cut, so no slot shows. */
function bridge(f: Floor3D, faces: [XZ, XZ][]) {
  if (faces.length < 2) return;
  const [[a0, a1], [b0, b1]] = faces;
  if (len(a0, b0) < 0.03) return;
  (f.bridges ??= []).push([a0, a1, b1, b0]);
}

/** Spaces linked by the floor's doors and open ends: what can be walked to from what. */
function linksOf(f: Floor3D, nodes: Space3D[]) {
  const parent = new Map<Space3D, Space3D>(nodes.map((s) => [s, s]));
  const find = (s: Space3D): Space3D => {
    let r = s;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const join = (a: Space3D, b: Space3D) => parent.set(find(a), find(b));
  for (const o of [...f.openings.filter((x) => x.kind === "door"), ...(f.open ?? []).map(([a, b]) => ({ a, b }))]) {
    const hit = acrossOf(o, nodes);
    for (let i = 1; i < hit.length; i++) join(hit[0], hit[i]);
  }
  return { find, join };
}

/** What a space is to open into, best first: a robe to the room it serves, a bathroom to the hall, a room to the hall or the living. */
function rank(x: Space3D, y: Space3D): number {
  const order: Record<string, Space3D["kind"][]> = {
    cupboard: ["room", "circulation", "other", "zone"],
    wet: ["circulation", "room", "wet", "other", "zone", "garage"],
    garage: ["circulation", "room", "other", "zone"],
    room: ["circulation", "room", "other", "zone"],
    circulation: ["circulation", "room", "other", "zone"],
    other: ["circulation", "room", "other", "zone"],
    zone: ["zone", "circulation", "room", "other"],
  };
  /* a linen press may open off a bathroom; a store under the stairs doesn't */
  if (x.kind === "cupboard" && y.kind === "wet") return /\blin|linen/i.test(x.name) ? 7 : -1;
  const i = (order[x.kind] ?? []).indexOf(y.kind);
  return i < 0 ? -1 : 10 - i;
}

/** The walls a floor shouldn't have, gone, and a way into every room. Adds to the floor's open stretches and its openings; returns what it did, for the record. */
export function waysIn(f: Floor3D): string[] {
  const did: string[] = [];
  if (!f.read) return did;
  const nodes = f.spaces.filter((s) => INDOOR.has(s.kind) && s.pts.length >= 3);
  const open = (f.open ??= []);
  /* a stair's open end through the facing room's wall too, when it stands a wall's thickness off (48 Thorne St: its foot faced the dining's wall) */
  for (const [a, b] of [...open]) {
    const l = line(a, b);
    if (l.L < 0.3) continue;
    const m = lerp(a, b, 0.5);
    for (const k of [1, -1]) {
      const n: XZ = [l.n[0] * k, l.n[1] * k];
      for (const y of nodes) {
        if (y.kind === "stair" || within([m[0] - n[0] * 0.05, m[1] - n[1] * 0.05], y.pts)) continue;
        for (const [p, q] of sides(y)) {
          const e = line(p, q);
          if (e.L < 0.3 || Math.abs(dot(e.u, l.n)) > 0.2) continue;
          const d = dot(sub(p, a), n);
          if (d < 0.08 || d > 0.6) continue;
          const ta = dot(sub(onto(a, p, q), p), e.u);
          const tb = dot(sub(onto(b, p, q), p), e.u);
          if (Math.max(ta, tb) < 0.1 || Math.min(ta, tb) > e.L - 0.1) continue;
          const face: [XZ, XZ] = [p3(onto(a, p, q)), p3(onto(b, p, q))];
          if (open.some(([u, v]) => len(u, face[0]) < 0.05 && len(v, face[1]) < 0.05)) continue;
          open.push(face);
          bridge(f, [[a, b], face]);
        }
      }
    }
  }
  /* a door through a thick wall: its threshold */
  for (const e of f.openings) {
    if (!e.echo || e.kind !== "door") continue;
    const main = f.openings.find((o) => !o.echo && o.kind === "door" && len(lerp(o.a, o.b, 0.5), lerp(e.a, e.b, 0.5)) < 1 && Math.abs(dot(line(o.a, o.b).u, line(e.a, e.b).n)) < 0.1);
    if (main) bridge(f, [[main.a, main.b], [e.a, e.b]]);
  }
  const all = nodes.flatMap((x) => runsOf(x, nodes));

  /* edge to edge: where two outlines meet with no wall's thickness between them, the plan has no wall;
     unless a door joins them, which it would only do through a wall (27 Milroy Ave: the old hall drawn
     right up to the old bedroom it has a door into) */
  const doored = new Set<string>();
  for (const o of f.openings) {
    if (o.kind !== "door") continue;
    const hit = acrossOf(o, nodes);
    for (const p of hit) for (const q of hit) if (p !== q) doored.add(`${nodes.indexOf(p)}|${nodes.indexOf(q)}`);
  }
  const seen = new Set<string>();
  for (const r of all) {
    if (r.gap > 0.05 || !flows(r.x) || !flows(r.y) || r.x.existing !== r.y.existing) continue;
    if (doored.has(`${nodes.indexOf(r.x)}|${nodes.indexOf(r.y)}`)) continue;
    const key = [r.x.name, r.y.name].sort().join("|");
    const L = len(r.a, r.b);
    if (L < 0.6) continue;
    const faces = bothFaces(r, 0, L);
    open.push(...faces);
    bridge(f, faces);
    if (!seen.has(key)) {
      did.push(`"${r.x.name}" runs into "${r.y.name}"`);
      seen.add(key);
    }
  }

  /* a way into every room: whatever stands apart from the rest opens to its likeliest neighbour */
  for (let pass = 0; pass < nodes.length; pass++) {
    const { find } = linksOf(f, nodes);
    const groups = new Map<Space3D, Space3D[]>();
    for (const s of nodes) groups.set(find(s), [...(groups.get(find(s)) ?? []), s]);
    if (groups.size < 2) break;
    const size = (g: Space3D[]) => g.reduce((t, s) => t + area(s.pts), 0);
    const main = [...groups.values()].sort((p, q) => size(q) - size(p))[0];
    let made = false;
    for (const g of [...groups.values()].sort((p, q) => size(p) - size(q))) {
      if (g === main) continue;
      /* a store opened from outside, and a stair (its flight decides its ends), wait to be reached */
      /* a group reaches out through its hall or a room, not through a robe or a bathroom wall, unless that's all it is */
      const walk = g.filter((s) => s.kind === "circulation" || s.kind === "room" || s.kind === "other" || s.kind === "zone");
      const from = (walk.length ? walk : g).filter((s) => s.kind !== "stair" && !(s.kind === "cupboard" && OUTSIDE_STORE.test(s.name)));
      const best = all
        .filter((r) => from.includes(r.x) && !g.includes(r.y) && r.y.kind !== "stair" && len(r.a, r.b) >= 0.7)
        .map((r) => ({ r, score: rank(r.x, r.y) * 100 + (main.includes(r.y) ? 50 : 0) + Math.min(len(r.a, r.b), 4) }))
        .filter((c) => c.score >= 0)
        .sort((p, q) => q.score - p.score)[0];
      if (!best) continue;
      const { r } = best;
      const L = len(r.a, r.b);
      const shallow = r.x.kind === "cupboard" && Math.min(...sides(r.x).map(([a, b]) => len(a, b))) <= 0.9;
      if (r.x.kind !== "cupboard" && !(flows(r.x) && flows(r.y))) {
        /* a bedroom, a study, a bathroom, a garage: a door, as wide as a door, in the middle of where they meet */
        const w = Math.min(0.82, L - 0.2);
        const [d0, d1] = [(L - w) / 2, (L + w) / 2];
        const faces = bothFaces(r, d0, d1);
        const door = (a: XZ, b: XZ, echo: boolean): Opening3D => ({ kind: "door", a, b, external: false, sill: 0, head: Math.min(2.1, f.ceiling), ...(echo ? { echo: true } : {}) });
        f.openings.push(door(...faces[0], false), ...faces.slice(1).map((s) => door(...s, true)));
        bridge(f, faces);
        did.push(`a door from "${r.x.name}" to "${r.y.name}"`);
      } else if (r.x.kind === "cupboard" && !shallow) {
        /* a walk-in robe: an opening a door wide */
        const w = Math.min(0.85, L - 0.2);
        const faces = bothFaces(r, (L - w) / 2, (L + w) / 2);
        open.push(...faces);
        bridge(f, faces);
        did.push(`"${r.x.name}" opens to "${r.y.name}"`);
      } else {
        /* a robe's front, or an arch: open the length they share, its ends kept */
        const keep = Math.min(0.1, L / 10);
        const faces = bothFaces(r, keep, L - keep);
        open.push(...faces);
        bridge(f, faces);
        did.push(`"${r.x.name}" opens to "${r.y.name}"`);
      }
      made = true;
      break;
    }
    if (!made) break;
  }
  return did;
}

/** A wall's stretches outside the given shapes: a room's wall stops where it would cross a flight of stairs. */
export function clipOut(a: XZ, b: XZ, holes: XZ[][]): [XZ, XZ][] {
  if (!holes.length) return [[a, b]];
  const L = len(a, b);
  if (L < 1e-6) return [];
  const ts = [0, 1];
  for (const h of holes)
    h.forEach((p, i) => {
      const q = h[(i + 1) % h.length];
      const r = sub(b, a);
      const s = sub(q, p);
      const den = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(den) < 1e-9) return;
      const w = sub(p, a);
      const t = (w[0] * s[1] - w[1] * s[0]) / den;
      const u = (w[0] * r[1] - w[1] * r[0]) / den;
      if (t > 1e-6 && t < 1 - 1e-6 && u >= -1e-9 && u <= 1 + 1e-9) ts.push(t);
    });
  ts.sort((x, y) => x - y);
  const out: [XZ, XZ][] = [];
  for (let i = 0; i < ts.length - 1; i++) {
    if ((ts[i + 1] - ts[i]) * L < 0.02) continue;
    const m = lerp(a, b, (ts[i] + ts[i + 1]) / 2);
    /* in a hole, and not on its edge (a wall along a stair's side stays) */
    const inHole = holes.some((h) => within(m, h) && h.every((p, k) => distTo(m, p, h[(k + 1) % h.length]) > 0.08));
    if (inHole) continue;
    const s0 = lerp(a, b, ts[i]);
    const s1 = lerp(a, b, ts[i + 1]);
    const last = out[out.length - 1];
    if (last && len(last[1], s0) < 1e-6) last[1] = s1;
    else out.push([s0, s1]);
  }
  return out;
}

function distTo(p: XZ, a: XZ, b: XZ) {
  const e = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), e) / (dot(e, e) || 1)));
  return Math.hypot(p[0] - a[0] - e[0] * t, p[1] - a[1] - e[1] * t);
}
