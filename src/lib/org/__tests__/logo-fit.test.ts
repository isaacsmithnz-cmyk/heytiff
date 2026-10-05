import { fitLogo, isLogoTone, type Pixels } from "../logo-fit";

/* Synthetic logos, drawn as plain pixel buffers: a canvas is not needed to say
   what the measuring does, which is the point of keeping it pure. */

type RGBA = [number, number, number, number];
const CLEAR: RGBA = [0, 0, 0, 0];
const WHITE: RGBA = [255, 255, 255, 255];
const NAVY: RGBA = [26, 43, 76, 255];
const BLACK: RGBA = [0, 0, 0, 255];
const ORANGE: RGBA = [237, 125, 49, 255];

function draw(w: number, h: number, ground: RGBA, rects: { x: number; y: number; w: number; h: number; c: RGBA }[]): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(ground, i * 4);
  for (const r of rects) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) data.set(r.c, (y * w + x) * 4);
    }
  }
  return { data, width: w, height: h };
}

describe("the margin", () => {
  it("finds the mark inside the transparent padding an exported logo carries", () => {
    const fit = fitLogo(draw(100, 40, CLEAR, [{ x: 20, y: 10, w: 60, h: 20, c: NAVY }]))!;
    expect(fit.box).toEqual({ x: 20, y: 10, w: 60, h: 20 });
    expect(fit.unchanged).toBe(false);
  });

  it("leaves a logo that has no margin alone, so its bytes are not re-encoded", () => {
    const fit = fitLogo(draw(100, 40, CLEAR, [{ x: 0, y: 0, w: 100, h: 40, c: NAVY }]))!;
    expect(fit.box).toEqual({ x: 0, y: 0, w: 100, h: 40 });
    expect(fit.unchanged).toBe(true);
  });

  it("ignores the faint fringe of an anti-aliased edge", () => {
    const px = draw(50, 20, CLEAR, [{ x: 10, y: 5, w: 30, h: 10, c: NAVY }]);
    px.data.set([26, 43, 76, 8], (2 * 50 + 3) * 4); // alpha 8: not there
    expect(fitLogo(px)!.box).toEqual({ x: 10, y: 5, w: 30, h: 10 });
  });

  it("finds nothing in an empty file", () => {
    expect(fitLogo(draw(10, 10, CLEAR, []))).toBeNull();
    expect(fitLogo({ data: new Uint8ClampedArray(0), width: 0, height: 0 })).toBeNull();
  });
});

/* A JPEG has no alpha, so the logo arrives on a white rectangle. */
describe("a white box", () => {
  const boxed = () => draw(100, 40, WHITE, [{ x: 20, y: 10, w: 60, h: 20, c: NAVY }]);

  it("is cleared, and the mark is found inside it", () => {
    const fit = fitLogo(boxed())!;
    expect(fit.clear).not.toBeNull();
    expect(fit.box).toEqual({ x: 20, y: 10, w: 60, h: 20 });
    expect(fit.clear![0]).toBe(1); // the corner goes
    expect(fit.clear![(15 * 100) + 50]).toBe(0); // the mark stays
  });

  it("clears only the white connected to the outside — a white word on the mark is the mark's", () => {
    const px = draw(100, 40, WHITE, [
      { x: 20, y: 10, w: 60, h: 20, c: NAVY },
      { x: 40, y: 15, w: 20, h: 10, c: WHITE },
    ]);
    const fit = fitLogo(px)!;
    expect(fit.clear![(20 * 100) + 50]).toBe(0);
    expect(fit.clear![(5 * 100) + 5]).toBe(1);
  });

  it("tolerates the near-white a JPEG leaves, not just 255", () => {
    const px = draw(100, 40, [243, 244, 242, 255], [{ x: 20, y: 10, w: 60, h: 20, c: NAVY }]);
    expect(fitLogo(px)!.box).toEqual({ x: 20, y: 10, w: 60, h: 20 });
  });

  /* Navy with white lettering IS the logo. Clearing the navy would print white
     lettering on the page, so only a WHITE box is ever treated as not part of it. */
  it("keeps a box the designer coloured", () => {
    const fit = fitLogo(draw(100, 40, NAVY, [{ x: 30, y: 12, w: 40, h: 16, c: WHITE }]))!;
    expect(fit.clear).toBeNull();
    expect(fit.box).toEqual({ x: 0, y: 0, w: 100, h: 40 });
  });

  it("finds nothing when white is drawn on white", () => {
    expect(fitLogo(draw(40, 20, WHITE, []))).toBeNull();
  });
});

describe("the tone of the ink", () => {
  const mark = (c: RGBA) => fitLogo(draw(60, 20, CLEAR, [{ x: 10, y: 5, w: 40, h: 10, c }]))!.tone;

  it("is light for a white wordmark, which is what vanishes on paper", () => {
    expect(mark(WHITE)).toBe("light");
  });

  it("is dark for navy and for black", () => {
    expect(mark(NAVY)).toBe("dark");
    expect(mark(BLACK)).toBe("dark");
  });

  it("is mixed for a mid-tone, which survives paper and gets a plate on a dark bar", () => {
    expect(mark(ORANGE)).toBe("mixed");
  });

  it("is light for a pale colour, which is no better on white than white is", () => {
    expect(mark([255, 230, 120, 255])).toBe("light");
  });

  it("weighs a navy badge with white lettering as dark: the badge is most of the ink", () => {
    const px = draw(100, 40, CLEAR, [
      { x: 20, y: 5, w: 60, h: 30, c: NAVY },
      { x: 40, y: 15, w: 20, h: 10, c: WHITE },
    ]);
    expect(fitLogo(px)!.tone).toBe("dark");
  });
});

describe("isLogoTone", () => {
  it("accepts the three and refuses anything else", () => {
    for (const t of ["light", "dark", "mixed"]) expect(isLogoTone(t)).toBe(true);
    for (const t of ["", "white", "LIGHT", null, undefined, 7]) expect(isLogoTone(t)).toBe(false);
  });
});
