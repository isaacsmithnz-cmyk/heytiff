/* A plan page is trimmed to its drawing before it becomes a sheet (job 3375,
   2026-10-07: a listing's lightbox screenshot, 3,680 wide with the plan a
   third of it — the page printed the dark bars, and every word sized to the
   sheet came out three times too big for the plan). */

import { trimBorders } from "../plan-trim";
import { placeSheets } from "../plans";

type RGB = [number, number, number];
const DARK: RGB = [35, 39, 45];
const PAPER: RGB = [255, 255, 255];
const INK: RGB = [20, 20, 20];

/** an RGBA raster painted by a function of (x, y) */
function raster(w: number, h: number, paint: (x: number, y: number) => RGB) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  return data;
}

/** a lightbox: dark bars either side of a white page, a drawing on the page */
const W = 600;
const H = 300;
const PAGE = { x0: 200, x1: 400 }; // the white page, full height
const PLAN = { x0: 230, x1: 370, y0: 40, y1: 260 }; // the drawing on it
const lightbox = (extra?: (x: number, y: number) => RGB | null) =>
  raster(W, H, (x, y) => {
    const e = extra?.(x, y);
    if (e) return e;
    if (x < PAGE.x0 || x >= PAGE.x1) return DARK;
    const onPlan = x >= PLAN.x0 && x < PLAN.x1 && y >= PLAN.y0 && y < PLAN.y1;
    // the drawing's outline only — a plan is mostly paper inside its walls
    const edge =
      onPlan && (x < PLAN.x0 + 3 || x >= PLAN.x1 - 3 || y < PLAN.y0 + 3 || y >= PLAN.y1 - 3);
    return edge ? INK : PAPER;
  });

describe("trimming a plan page to its drawing", () => {
  it("cuts a viewer's dark bars clean and keeps a sliver of the page's paper", () => {
    const t = trimBorders(lightbox(), W, H)!;
    // the gutter is 1% of the drawing's longer side: 220 → 2
    expect(t).toEqual({ x: PLAN.x0 - 2, y: PLAN.y0 - 2, w: PLAN.x1 - PLAN.x0 + 4, h: PLAN.y1 - PLAN.y0 + 4 });
  });

  /* the paper's sliver must never reach back into the chrome, or the print
     shows a hairline of dark bar down each side */
  it("never hands any of the dark bars back as gutter", () => {
    const flush = raster(W, H, (x, y) =>
      x < PAGE.x0 || x >= PAGE.x1 ? DARK : y < 20 || y >= H - 20 ? PAPER : x === PAGE.x0 || x === PAGE.x1 - 1 ? INK : PAPER
    );
    const t = trimBorders(flush, W, H)!;
    expect(t.x).toBeGreaterThanOrEqual(PAGE.x0);
    expect(t.x + t.w).toBeLessThanOrEqual(PAGE.x1);
  });

  it("is not stopped by a speck of compression noise in a margin", () => {
    const noisy = lightbox((x, y) => (x === 50 && y === 120 ? [200, 30, 30] : null));
    expect(trimBorders(noisy, W, H)).toEqual(trimBorders(lightbox(), W, H));
  });

  /* a margin is EMPTY: a line of real drawing near the edge ends it there, so
     nothing anybody drew is ever cropped away */
  it("stops at the first line of drawing", () => {
    // a wall's line in the bar, drawn in a colour you can see on it
    const ruled = lightbox((x, y) => (x === 100 && y > 10 && y < 290 ? [0, 160, 220] : null));
    const t = trimBorders(ruled, W, H)!;
    expect(t.x).toBeLessThanOrEqual(100);
  });

  it("leaves a page alone when there is nothing to cut", () => {
    const full = raster(W, H, (x, y) => ((x + y) % 7 === 0 ? INK : [180, 200, 220]));
    expect(trimBorders(full, W, H)).toBeNull();
  });

  it("leaves a blank page alone rather than cropping it to a speck", () => {
    expect(trimBorders(raster(W, H, () => PAPER), W, H)).toBeNull();
    const speck = raster(W, H, (x, y) => (x === 300 && y === 150 ? INK : PAPER));
    expect(trimBorders(speck, W, H)).toBeNull();
  });
});

describe("a trimmed page becomes a cropped sheet", () => {
  it("carries the trim onto the sheet as its crop", () => {
    const [s] = placeSheets([], [
      { label: "GF", ref: "r1", pageNumber: null, width: W, height: H, crop: { x: 10, y: 20, w: 300, h: 200 } },
    ]);
    expect(s.crop).toEqual({ x: 10, y: 20, w: 300, h: 200 });
  });

  it("leaves an untrimmed page uncropped", () => {
    const [s] = placeSheets([], [{ label: "GF", ref: "r1", pageNumber: null, width: W, height: H }]);
    expect(s.crop).toBeUndefined();
  });
});
