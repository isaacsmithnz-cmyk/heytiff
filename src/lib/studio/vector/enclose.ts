import type { Ring } from "./fills";

/* THE SPACES THE WALLS ENCLOSE. The walls are laid on a grid of pixels (a few
   to a point, finer than any wall), the gaps a door or a window leaves in a
   wall are closed, and each run of floor the walls then close off is one
   space, outlined on the walls' faces. A gap is closed only where both its
   ends are the thin ends of one wall line: a doorway in a wall, not the open
   side of a room or the space between two walls that run the same way. The
   widest closed is about six and a half metres (3570's ground floor: its
   dining room's glazed wall, its family room's sliders); an opening wider
   than that leaves two spaces as one. Pure. */

export type Space = {
  id: number;
  /** pixels it holds */
  n: number;
  box: [number, number, number, number];
  /** its outline on the walls' faces, in the grid's pixels, clockwise */
  outline: [number, number][];
  /** it reaches the grid's edge: outside the building */
  open: boolean;
};

export type Enclosed = { width: number; height: number; label: Int32Array; wall: Uint8Array; spaces: Space[] };

/** Fill even-odd shapes onto a grid `k` pixels a point. */
export function rasterise(shapes: readonly Ring[][], width: number, height: number, k: number): Uint8Array {
  const W = Math.ceil(width * k);
  const H = Math.ceil(height * k);
  const out = new Uint8Array(W * H);
  const xs: number[] = [];
  for (const rings of shapes) {
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const r of rings)
      for (const [, y] of r) {
        y0 = Math.min(y0, y * k);
        y1 = Math.max(y1, y * k);
      }
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(H - 1, Math.ceil(y1)); y++) {
      const yc = y + 0.5;
      xs.length = 0;
      for (const r of rings)
        for (let i = 0; i < r.length; i++) {
          const ax = r[i][0] * k;
          const ay = r[i][1] * k;
          const bx = r[(i + 1) % r.length][0] * k;
          const by = r[(i + 1) % r.length][1] * k;
          if (ay > yc !== by > yc) xs.push(ax + ((yc - ay) * (bx - ax)) / (by - ay));
        }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const from = Math.max(0, Math.ceil(xs[i] - 0.5));
        const to = Math.min(W - 1, Math.floor(xs[i + 1] - 0.5));
        for (let x = from; x <= to; x++) out[y * W + x] = 1;
      }
    }
  }
  return out;
}

/** Close the gaps doors and windows leave: a run of floor between two wall
    pixels in a row (or a column) at most `widest` long, where the wall at each
    end is at most `thin` thick across the run and the two ends are one wall's
    band (they overlap by most of their thickness). */
export function bridged(wall: Uint8Array, W: number, H: number, widest: number, thin: number, tee = 0): Uint8Array {
  const out = new Uint8Array(wall);
  const along = (n: number, len: number, at: (i: number, j: number) => number, across: (i: number, j: number) => [number, number]) => {
    for (let i = 0; i < n; i++) {
      let last = -1;
      for (let j = 0; j < len; j++) {
        if (!wall[at(i, j)]) continue;
        const gap = j - last - 1;
        if (last >= 0 && gap >= 2 && gap <= widest) {
          const [a0, a1] = across(i, last);
          const [b0, b1] = across(i, j);
          const overlap = Math.min(a1, b1) - Math.max(a0, b0);
          /* two wall ends facing each other, one wall's band: a door or a window.
             A wall end facing a wall that runs across it is left open: on a
             real plan that is more often a yard or a porch than a window hard
             against an inside wall (Pariatur, 3570, 22 November 2026) */
          const aThin = a1 - a0 <= thin;
          const bThin = b1 - b0 <= thin;
          const shut =
            (aThin && bThin && overlap >= 0.6 * Math.min(a1 - a0, b1 - b0)) ||
            /* asked for (`tee`), inside one space only: a wall end facing a wall across it, a robe's or an ensuite's opening */
            (gap <= tee && ((aThin && !bThin && overlap >= 0.9 * (a1 - a0)) || (bThin && !aThin && overlap >= 0.9 * (b1 - b0))));
          if (shut) for (let g = last + 1; g < j; g++) out[at(i, g)] = 1;
        }
        last = j;
      }
    }
  };
  /* the wall's extent across a run, at one of its pixels: up and down for a row, left and right for a column */
  const vert = (x: number, y: number): [number, number] => {
    let a = y;
    let b = y;
    while (a > 0 && wall[(a - 1) * W + x]) a--;
    while (b < H - 1 && wall[(b + 1) * W + x]) b++;
    return [a, b + 1];
  };
  const horiz = (x: number, y: number): [number, number] => {
    let a = x;
    let b = x;
    while (a > 0 && wall[y * W + a - 1]) a--;
    while (b < W - 1 && wall[y * W + b + 1]) b++;
    return [a, b + 1];
  };
  along(H, W, (y, x) => y * W + x, (y, x) => vert(x, y));
  along(W, H, (x, y) => y * W + x, (x, y) => horiz(x, y));
  return out;
}

/** The outline of space `id`: its pixels' outer edge, followed clockwise from its top-left. */
function outlineOf(label: Int32Array, W: number, id: number, box: [number, number, number, number]): [number, number][] {
  const [x0, y0, x1, y1] = box;
  const key = (x: number, y: number) => y * (W + 1) + x;
  const next = new Map<number, number[]>();
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const k = key(ax, ay);
    const l = next.get(k);
    if (l) l.push(key(bx, by));
    else next.set(k, [key(bx, by)]);
  };
  const at = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && label[y * W + x] === id;
  let start = -1;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) {
        add(x, y, x + 1, y);
        if (start < 0) start = key(x, y);
      }
      if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!at(x - 1, y)) add(x, y + 1, x, y);
    }
  if (start < 0) return [];
  const ring: [number, number][] = [];
  let cur = start;
  let dir = 0; // the way the last edge ran: 0 right, 1 down, 2 left, 3 up
  for (let guard = 0; guard < 4 * (x1 - x0 + 2) * (y1 - y0 + 2); guard++) {
    const x = cur % (W + 1);
    const y = Math.floor(cur / (W + 1));
    ring.push([x, y]);
    const outs = next.get(cur);
    if (!outs?.length) break;
    /* where two edges leave one corner, turn the way a clockwise walk keeps the space on its right */
    let pick = 0;
    if (outs.length > 1) {
      const turn = (k: number) => {
        const nx = k % (W + 1);
        const ny = Math.floor(k / (W + 1));
        const d = nx > x ? 0 : ny > y ? 1 : nx < x ? 2 : 3;
        return (d - dir + 4) % 4;
      };
      pick = outs.map((k, i) => [turn(k) === 1 ? 0 : turn(k) === 0 ? 1 : 2, i]).sort((a, b) => a[0] - b[0])[0][1];
    }
    const nxt = outs.splice(pick, 1)[0];
    const nx = nxt % (W + 1);
    const ny = Math.floor(nxt / (W + 1));
    dir = nx > x ? 0 : ny > y ? 1 : nx < x ? 2 : 3;
    cur = nxt;
    if (cur === start) break;
  }
  return simplify(ring);
}

/** Corners only: points on a straight run dropped, then a staircase (a slanted
    or curved wall on the grid) drawn as its line, within a pixel and a half. */
export function simplify(ring: [number, number][], eps = 1.5): [number, number][] {
  const n = ring.length;
  if (n < 4) return ring;
  const turns = ring.filter((p, i) => {
    const a = ring[(i - 1 + n) % n];
    const b = ring[(i + 1) % n];
    return (b[0] - p[0]) * (p[1] - a[1]) - (b[1] - p[1]) * (p[0] - a[0]) !== 0;
  });
  const dp = (pts: [number, number][]): [number, number][] => {
    if (pts.length < 3) return pts;
    const [a, b] = [pts[0], pts[pts.length - 1]];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let far = 0;
    let at = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / L;
      if (d > far) {
        far = d;
        at = i;
      }
    }
    if (far <= eps) return [a, b];
    return [...dp(pts.slice(0, at + 1)).slice(0, -1), ...dp(pts.slice(at))];
  };
  if (turns.length < 4) return turns;
  /* split at the corner farthest from the first, so the closed ring is two open runs */
  let far = 0;
  let at = 0;
  for (let i = 1; i < turns.length; i++) {
    const d = Math.hypot(turns[i][0] - turns[0][0], turns[i][1] - turns[0][1]);
    if (d > far) {
        far = d;
        at = i;
      }
  }
  const one = dp(turns.slice(0, at + 1));
  const two = dp([...turns.slice(at), turns[0]]);
  return [...one.slice(0, -1), ...two.slice(0, -1)];
}

/** The spaces between the walls on a grid `W`×`H`. */
export function enclose(wall: Uint8Array, W: number, H: number, widest: number, thin: number): Enclosed {
  const solid = bridged(wall, W, H, widest, thin);
  const label = new Int32Array(W * H).fill(-1);
  const queue = new Int32Array(W * H);
  const spaces: Space[] = [];
  for (let s = 0; s < W * H; s++) {
    if (solid[s] || label[s] >= 0) continue;
    const id = spaces.length;
    let head = 0;
    let tail = 0;
    let n = 0;
    let open = false;
    let [x0, y0, x1, y1] = [W, H, 0, 0];
    queue[tail++] = s;
    label[s] = id;
    while (head < tail) {
      const i = queue[head++];
      n++;
      const x = i % W;
      const y = (i / W) | 0;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) open = true;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && !solid[i - 1] && label[i - 1] < 0) {
        label[i - 1] = id;
        queue[tail++] = i - 1;
      }
      if (x < W - 1 && !solid[i + 1] && label[i + 1] < 0) {
        label[i + 1] = id;
        queue[tail++] = i + 1;
      }
      if (y > 0 && !solid[i - W] && label[i - W] < 0) {
        label[i - W] = id;
        queue[tail++] = i - W;
      }
      if (y < H - 1 && !solid[i + W] && label[i + W] < 0) {
        label[i + W] = id;
        queue[tail++] = i + W;
      }
    }
    spaces.push({ id, n, box: [x0, y0, x1, y1], outline: [], open });
  }
  return { width: W, height: H, label, wall: solid, spaces };
}

/** A space's outline, worked out when it is wanted (most spaces on a sheet are dropped first). */
export const outlined = (e: Enclosed, s: Space): [number, number][] => outlineOf(e.label, e.width, s.id, s.box);

/** One space that holds two rooms' names, parted where a wall end faces a
    wall across it (a bedroom open to its robe, a bathroom to its WC): its
    walls' gaps closed again with that allowed, up to `tee` across. Each part
    that holds a name comes back with its outline; null when the names still
    share one part. `wall` is the grid's walls before any gap was closed. */
export function parted(
  e: Enclosed,
  wall: Uint8Array,
  s: Space,
  at: readonly { x: number; y: number }[],
  widest: number,
  thin: number,
  tee: number,
): { n: number; box: [number, number, number, number]; outline: [number, number][]; holds: number[] }[] | null {
  const W = e.width;
  const pad = Math.ceil(thin * 2);
  const x0 = Math.max(0, s.box[0] - pad);
  const y0 = Math.max(0, s.box[1] - pad);
  const x1 = Math.min(W - 1, s.box[2] + pad);
  const y1 = Math.min(e.height - 1, s.box[3] + pad);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const local = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) local[y * w + x] = wall[(y + y0) * W + x + x0];
  const shut = bridged(local, w, h, widest, thin, tee);
  const label = new Int32Array(w * h).fill(-1);
  const mine = (i: number) => !shut[i] && e.label[(Math.floor(i / w) + y0) * W + (i % w) + x0] === s.id;
  const parts: { n: number; box: [number, number, number, number]; holds: number[] }[] = [];
  const queue = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (label[start] >= 0 || !mine(start)) continue;
    const id = parts.length;
    let head = 0;
    let tail = 0;
    let n = 0;
    let [bx0, by0, bx1, by1] = [w, h, 0, 0];
    queue[tail++] = start;
    label[start] = id;
    while (head < tail) {
      const i = queue[head++];
      n++;
      const x = i % w;
      const y = (i / w) | 0;
      bx0 = Math.min(bx0, x);
      bx1 = Math.max(bx1, x);
      by0 = Math.min(by0, y);
      by1 = Math.max(by1, y);
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1])
        if (j >= 0 && label[j] < 0 && mine(j)) {
          label[j] = id;
          queue[tail++] = j;
        }
    }
    parts.push({ n, box: [bx0, by0, bx1, by1], holds: [] });
  }
  at.forEach((p, k) => {
    const x = Math.round(p.x) - x0;
    const y = Math.round(p.y) - y0;
    /* a name on a closed gap: the nearest floor a few pixels round it */
    for (let r = 0; r <= 8; r += 2)
      for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const id = label[yy * w + xx];
        if (id >= 0) {
          if (!parts[id].holds.includes(k)) parts[id].holds.push(k);
          return;
        }
      }
  });
  const named = parts.filter((p) => p.holds.length);
  if (named.length < 2) return null;
  return named.map((p) => {
    const id = parts.indexOf(p);
    return {
      n: p.n,
      box: [p.box[0] + x0, p.box[1] + y0, p.box[2] + x0, p.box[3] + y0],
      outline: outlineOf(label, w, id, p.box).map(([x, y]) => [x + x0, y + y0]),
      holds: p.holds,
    };
  });
}

/** A gap closed in a wall: a door's or a window's place. Its two jambs' middles and the wall's thickness there, in the grid's pixels. */
export type Gap = { a: [number, number]; b: [number, number]; t: number };

/** The gaps `bridged` closed: each run of closed pixels, with a wall at both
    its ends along x (a gap in a wall running across) or along y (one running
    up and down). `wall` is the grid before, `shut` after. */
export function gapsOf(wall: Uint8Array, shut: Uint8Array, W: number, H: number): Gap[] {
  const seen = new Uint8Array(W * H);
  const out: Gap[] = [];
  const queue = new Int32Array(W * H);
  const is = (i: number) => shut[i] === 1 && wall[i] === 0;
  for (let s = 0; s < W * H; s++) {
    if (seen[s] || !is(s)) continue;
    let head = 0;
    let tail = 0;
    let [x0, y0, x1, y1] = [W, H, 0, 0];
    queue[tail++] = s;
    seen[s] = 1;
    while (head < tail) {
      const i = queue[head++];
      const x = i % W;
      const y = (i / W) | 0;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1])
        if (j >= 0 && !seen[j] && is(j)) {
          seen[j] = 1;
          queue[tail++] = j;
        }
    }
    const cx = (x0 + x1 + 1) / 2;
    const cy = (y0 + y1 + 1) / 2;
    const at = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && wall[y * W + x] === 1;
    const across = at(x0 - 1, Math.floor(cy)) && at(x1 + 1, Math.floor(cy));
    const down = at(Math.floor(cx), y0 - 1) && at(Math.floor(cx), y1 + 1);
    if (across && (!down || x1 - x0 >= y1 - y0)) out.push({ a: [x0, cy], b: [x1 + 1, cy], t: y1 - y0 + 1 });
    else if (down) out.push({ a: [cx, y0], b: [cx, y1 + 1], t: x1 - x0 + 1 });
  }
  return out;
}
