/* THE FILLED SHAPES OF A VECTOR PDF PAGE, out of pdf.js's operator list. A
   wall on an architect's plan is a filled shape: on 3570 (an A1 CDC set) a
   grey box masked by a clip whose outline IS the wall, on Frogmore a plain
   filled outline. Each fill comes back with its colour and its outlines in
   the page's own points (y down, the page's top-left the origin), so what is
   read off them is the architect's geometry, not a picture of it (Isaac, 22
   November 2026: "I need the plans accurate to design it").

   Pure: it takes the operator list's two arrays and pdf.js's OPS numbers,
   so it is tried without pdf.js (which jest can't load). */

export type Ring = [number, number][];
export type Fill = { colour: string; rings: Ring[] };

/** The OPS numbers this reads, as pdf.js names them. */
export type FillOps = {
  save: number;
  restore: number;
  transform: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  setFillRGBColor: number;
  setFillGray: number;
  eoClip: number;
  clip: number;
  constructPath: number;
  endPath: number;
  fill: number;
  eoFill: number;
  fillStroke: number;
  eoFillStroke: number;
};

type M = [number, number, number, number, number, number];
const mul = (m: M, n: readonly number[]): M => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/* pdf.js's path data: 0 moveTo x y, 1 lineTo x y, 2 curveTo x1 y1 x2 y2 x y,
   3 quadraticCurveTo x1 y1 x y, 4 closePath. A curve keeps its end point:
   a curved wall comes out as its chord, near enough at a wall's length. */
function ringsOf(data: ArrayLike<number>, m: M): Ring[] {
  const out: Ring[] = [];
  let r: Ring | null = null;
  const P = (x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  let k = 0;
  while (k < data.length) {
    const t = data[k++];
    if (t === 0) {
      r = [P(data[k], data[k + 1])];
      out.push(r);
      k += 2;
    } else if (t === 1) {
      r?.push(P(data[k], data[k + 1]));
      k += 2;
    } else if (t === 2) {
      r?.push(P(data[k + 4], data[k + 5]));
      k += 6;
    } else if (t === 3) {
      r?.push(P(data[k + 2], data[k + 3]));
      k += 4;
    } else if (t !== 4) break;
  }
  return out.filter((x) => x.length >= 3);
}

export function boxOf(rings: readonly Ring[]): [number, number, number, number] {
  let a: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings) for (const [x, y] of r) a = [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)];
  return a;
}

/* A fill masked by an even-odd clip is the clip's shape only when the fill
   is the clip's own box (3570's walls); a page-wide clip leaves every fill
   as it is drawn. */
function masked(clip: Ring[] | null, rings: Ring[]): Ring[] {
  if (!clip) return rings;
  const a = boxOf(clip);
  const b = boxOf(rings);
  return Math.max(...a.map((v, i) => Math.abs(v - b[i]))) < 0.5 ? clip : rings;
}

const grey = (v: number) => {
  const h = Math.round(Math.max(0, Math.min(1, v)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${h}${h}${h}`;
};

/** Every filled shape on the page, in page points with y down. `base` is the
    page's viewport transform at scale 1. */
export function fillsOf(fnArray: ArrayLike<number>, argsArray: ArrayLike<unknown>, O: FillOps, base: readonly number[]): Fill[] {
  let m = [...base] as M;
  let colour = "#000000";
  let clip: Ring[] | null = null;
  let want: "eo" | "nz" | null = null;
  const stack: [M, string, Ring[] | null][] = [];
  const out: Fill[] = [];
  const FILLS = new Set([O.fill, O.eoFill, O.fillStroke, O.eoFillStroke]);
  for (let i = 0; i < fnArray.length; i++) {
    const f = fnArray[i];
    const a = argsArray[i] as unknown[] | null;
    if (f === O.save) stack.push([m, colour, clip]);
    else if (f === O.restore) [m, colour, clip] = stack.pop() ?? [m, colour, clip];
    else if (f === O.transform && a) m = mul(m, a as number[]);
    else if (f === O.paintFormXObjectBegin && a) {
      stack.push([m, colour, clip]);
      if (a[0]) m = mul(m, Array.from(a[0] as ArrayLike<number>));
    } else if (f === O.paintFormXObjectEnd) [m, colour, clip] = stack.pop() ?? [m, colour, clip];
    else if (f === O.setFillRGBColor && a) colour = typeof a[0] === "string" ? (a[0] as string).toLowerCase() : colour;
    else if (f === O.setFillGray && a) colour = grey(Number(a[0]));
    else if (f === O.eoClip) want = "eo";
    else if (f === O.clip) want = "nz";
    else if (f === O.constructPath && a) {
      const op = a[0] as number;
      const data = (a[1] as ArrayLike<number>[] | undefined)?.[0];
      if (!data) continue;
      if (want && op === O.endPath) {
        if (want === "eo") clip = ringsOf(data, m);
        want = null;
        continue;
      }
      if (!FILLS.has(op)) continue;
      const rings = masked(clip, ringsOf(data, m));
      if (rings.length) out.push({ colour, rings });
    }
  }
  return out;
}
