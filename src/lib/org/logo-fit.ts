/* FITTING A LOGO TO WHAT IT WILL BE PRINTED ON — the measuring half.

   A business uploads whatever its designer exported, and every surface the app
   draws it on makes a different assumption about it. Three things went wrong,
   all of them properties of the FILE rather than of any one surface:

   - EMPTY MARGIN. Most exported logos carry transparent padding, sometimes a
     fifth of the width on every side. The surfaces size the box, so the margin
     is paid for out of the mark: a wordmark that fills the Quote's column came
     out about 70px wide on the handover band and 40px on the share-link bar.
   - A WHITE BOX. A JPEG has no transparency, so the logo arrives on a white
     rectangle that is invisible on paper and a slab on anything else.
   - LIGHT INK. A white wordmark is the right logo for a dark website header,
     and on a white document it is not there — the blank corner on the Quote.

   The first two are fixed by CUTTING the file once, at upload (logo-prepare.ts
   does the canvas work). The third cannot be fixed by cutting: the logo is
   right, the ground is wrong. So it is MEASURED once, here, and stored as a
   tone; each surface then knows what ground it is and puts a plate behind the
   logo only when the logo's ink would not survive the ground (brand.ts::plateFor).

   Pure, over a plain pixel buffer, so it is testable without a canvas and the
   browser half stays a thin shell. Nothing here touches the DOM. */

/** What the ink of the mark is, as a ground has to treat it. `mixed` is a mark
    with both (a coloured badge with white letters, a mid-tone): it survives a
    light ground and gets a plate on a dark one, as every logo did before. */
export const LOGO_TONES = ["light", "dark", "mixed"] as const;
export type LogoTone = (typeof LOGO_TONES)[number];

export function isLogoTone(v: unknown): v is LogoTone {
  return typeof v === "string" && (LOGO_TONES as readonly string[]).includes(v);
}

export type Pixels = {
  /** RGBA, row-major — what a canvas's getImageData returns */
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

export type LogoFit = {
  /** the smallest rectangle holding the mark, in source pixels */
  box: { x: number; y: number; w: number; h: number };
  tone: LogoTone;
  /** 1 where the pixel is a white box to be made transparent; null when the
      file has no white box (it is transparent already, or the box is a colour
      the designer chose) */
  clear: Uint8Array | null;
  /** nothing to do: no margin to cut and no box to clear. The caller uploads
      the original bytes rather than re-encoding a file that was already right. */
  unchanged: boolean;
};

/** below this a pixel is not there */
const ALPHA_GONE = 16;
/** at or above this a pixel counts as part of the mark's own body, for tone —
    the anti-aliased fringe would otherwise drag every logo towards its ground */
const ALPHA_BODY = 128;
/** a channel at or above this is white for the purpose of a white box. JPEG
    ringing leaves a "white" ground at 235-255, not 255. */
const WHITE_MIN = 235;

/** the mean luminance (0-1) at or above which the ink would vanish on paper */
const LIGHT_AT = 0.78;
/** and at or below which it would vanish on a dark ground */
const DARK_AT = 0.5;

const lum = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** Measure a logo: where the mark is, what its ink is, and which pixels are a
    white box around it. Null when there is no mark at all (blank, or white on
    white) — the caller then keeps the file exactly as it came. */
export function fitLogo(px: Pixels): LogoFit | null {
  const { data, width: w, height: h } = px;
  if (w < 1 || h < 1 || data.length < w * h * 4) return null;
  const n = w * h;

  const alpha = (i: number) => data[i * 4 + 3];
  const white = (i: number) =>
    alpha(i) >= 200 && data[i * 4] >= WHITE_MIN && data[i * 4 + 1] >= WHITE_MIN && data[i * 4 + 2] >= WHITE_MIN;
  const gone = (i: number) => alpha(i) < ALPHA_GONE;

  /* A WHITE BOX IS A FACT ABOUT THE CORNERS. A logo whose four corners are all
     opaque white is sitting on a white rectangle; one with transparent corners
     is not, and one with a coloured corner is on a box somebody designed —
     navy with white lettering is the logo, and clearing the navy would print
     white lettering on the page. So only white is treated as "not part of it". */
  const corners = [0, w - 1, (h - 1) * w, n - 1];
  const whiteBox = corners.every(white);

  let clear: Uint8Array | null = null;
  if (whiteBox) {
    /* Flood from the border, so only the white CONNECTED to the outside goes.
       The white counters inside a letter, or a white word on a dark badge, are
       the mark's own and stay. 4-connected, over a typed-array stack: a logo is
       at most a couple of megapixels, and a recursive fill would overflow. */
    clear = new Uint8Array(n);
    const stack = new Int32Array(n);
    let top = 0;
    const seed = (i: number) => {
      if (!clear![i] && (white(i) || gone(i))) {
        clear![i] = 1;
        stack[top++] = i;
      }
    };
    for (let x = 0; x < w; x++) {
      seed(x);
      seed((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      seed(y * w);
      seed(y * w + (w - 1));
    }
    while (top > 0) {
      const i = stack[--top];
      const x = i % w;
      if (x > 0) seed(i - 1);
      if (x < w - 1) seed(i + 1);
      if (i >= w) seed(i - w);
      if (i < n - w) seed(i + w);
    }
  }

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let weight = 0;
  let sum = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (gone(i) || (clear && clear[i])) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const a = alpha(i);
      if (a >= ALPHA_BODY) {
        weight += a;
        sum += lum(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) * a;
      }
    }
  }
  if (maxX < 0 || weight === 0) return null;

  const mean = sum / weight;
  const tone: LogoTone = mean >= LIGHT_AT ? "light" : mean <= DARK_AT ? "dark" : "mixed";
  const box = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  // within a pixel or two of the edge on every side is "no margin" — a re-encode
  // to shave one row would only cost the file its original bytes
  const unchanged = !clear && box.x <= 1 && box.y <= 1 && box.w >= w - 2 && box.h >= h - 2;
  return { box, tone, clear, unchanged };
}
