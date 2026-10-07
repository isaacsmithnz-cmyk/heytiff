/* The empty margins round a plan raster, found so they can be cropped off.

   A plan arrives however it was got, and a lot of them are SCREENSHOTS — of a
   listing's floor-plan lightbox, of a PDF viewer — so the drawing sits in the
   middle of a slab of viewer chrome. Job 3375's was 3,680 wide with the plan
   only about a third of it, dark bars either side (2026-10-07). Everything
   that frames itself on the sheet then frames the bars: the printed page
   showed a small plan in a wide dark band, and every word sized to the sheet
   came out three times too big for the drawing it was on.

   So a fresh page is trimmed to its content before it becomes a sheet: rows
   and columns from each edge that are all one colour go, as a CROP, so the
   raster itself is never touched and the user's Crop tool can still put any
   of it back. Pure — pixels in, a rectangle out — so it can be tested without
   a canvas. */

export interface TrimRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** how far a pixel may sit from the margin's colour and still be margin —
    JPEG ringing round a hard edge runs to about this */
const TOL = 28;
/** the share of a line allowed to miss — a stray speck of compression noise
    must not stop the trim, a line of real drawing must */
const STRAY = 0.004;
/** a trim smaller than this share of a side is noise, not a margin */
const MIN_CUT = 0.01;
/** what must be left — less, and it was a blank or near-blank image */
const MIN_KEEP = 0.15;
/** the paper kept round a drawing when the margin was paper (light) — a plan's
    own border line should not sit flush against the clip */
const GUTTER = 0.01;

type Px = (x: number, y: number) => number; // index of the pixel's R

/** Every line from an edge that is all `ref`'s colour, counted inward. */
function margin(
  at: Px,
  data: Uint8ClampedArray,
  lines: number,
  span: [number, number],
  coord: (line: number, along: number) => [number, number],
  ref: [number, number, number]
): number {
  const [from, to] = span;
  const len = to - from;
  if (len <= 0) return 0;
  // a sample every other pixel on a long line is plenty to see a drawing in
  const step = len > 1200 ? 2 : 1;
  const allowed = Math.floor((len / step) * STRAY);
  let n = 0;
  for (; n < lines; n++) {
    let miss = 0;
    for (let a = from; a < to; a += step) {
      const [x, y] = coord(n, a);
      const i = at(x, y);
      if (
        Math.abs(data[i] - ref[0]) > TOL ||
        Math.abs(data[i + 1] - ref[1]) > TOL ||
        Math.abs(data[i + 2] - ref[2]) > TOL
      ) {
        if (++miss > allowed) return n;
      }
    }
  }
  return n;
}

const luma = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** The rectangle inside a raster's one-colour margins, or null when there is
    nothing worth cutting (or the cut would leave next to nothing).

    `data` is RGBA, row-major, `w × h` — what `getImageData` hands back.

    Two passes, because there are two kinds of margin. CHROME first — dark or
    coloured, a viewer's bars — cut clean; then PAPER — light — inside what
    the chrome left, which keeps a sliver of itself so a plan's own border
    line doesn't sit flush against the clip. A lightbox has both: dark bars
    the full height, and the white page between them, whose own margins only
    show once the bars are gone. Each pass takes the sides, then the top and
    bottom over what the sides left, then the sides once more. */
export function trimBorders(data: Uint8ClampedArray, w: number, h: number): TrimRect | null {
  if (w < 8 || h < 8 || data.length < w * h * 4) return null;
  const at: Px = (x, y) => (y * w + x) * 4;
  const colour = (x: number, y: number): [number, number, number] => {
    const i = at(x, y);
    return [data[i], data[i + 1], data[i + 2]];
  };
  const isPaper = (c: [number, number, number]) => luma(c) > 200;

  const r = { x0: 0, x1: w, y0: 0, y1: h }; // x1/y1 exclusive

  /** cut every margin of one kind (paper or not) off `r` */
  const pass = (paper: boolean) => {
    const sides = () => {
      const midY = Math.floor((r.y0 + r.y1) / 2);
      const left = colour(r.x0, midY);
      if (isPaper(left) === paper)
        r.x0 += margin(at, data, r.x1 - r.x0, [r.y0, r.y1], (n, a) => [r.x0 + n, a], left);
      const right = colour(r.x1 - 1, midY);
      if (isPaper(right) === paper)
        r.x1 -= margin(at, data, r.x1 - r.x0, [r.y0, r.y1], (n, a) => [r.x1 - 1 - n, a], right);
    };
    const ends = () => {
      const midX = Math.floor((r.x0 + r.x1) / 2);
      const top = colour(midX, r.y0);
      if (isPaper(top) === paper)
        r.y0 += margin(at, data, r.y1 - r.y0, [r.x0, r.x1], (n, a) => [a, r.y0 + n], top);
      const bottom = colour(midX, r.y1 - 1);
      if (isPaper(bottom) === paper)
        r.y1 -= margin(at, data, r.y1 - r.y0, [r.x0, r.x1], (n, a) => [a, r.y1 - 1 - n], bottom);
    };
    sides();
    ends();
    sides();
  };

  pass(false);
  const chrome = { ...r };
  pass(true);

  const kw = r.x1 - r.x0;
  const kh = r.y1 - r.y0;
  if (kw < w * MIN_KEEP || kh < h * MIN_KEEP) return null;
  if (w - kw < w * MIN_CUT && h - kh < h * MIN_CUT) return null;

  // the paper's sliver, never reaching back into the chrome
  const g = Math.round(Math.max(kw, kh) * GUTTER);
  const x0 = Math.max(chrome.x0, r.x0 - g);
  const y0 = Math.max(chrome.y0, r.y0 - g);
  const x1 = Math.min(chrome.x1, r.x1 + g);
  const y1 = Math.min(chrome.y1, r.y1 + g);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
