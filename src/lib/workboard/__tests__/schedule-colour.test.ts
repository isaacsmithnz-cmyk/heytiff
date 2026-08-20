/* The Schedule block's paint. The whole point of this module is a promise —
   "every label on this rail clears 4.5:1" — and a promise that isn't measured
   is a comment. These tests are the measurement. */

import {
  contrastRatio,
  scheduleBlockPaint,
  NO_CATEGORY_PAINT,
} from "../schedule-colour";

/** "rgb(12, 34, 56)" → channels, so a test can measure what shipped. */
function channels(cssColour: string): [number, number, number] {
  const m = cssColour.match(/\d+/g);
  if (!m || m.length < 3) throw new Error(`not an rgb() colour: ${cssColour}`);
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}

/* A spread of what ServiceM8 actually hands out: washes around 85% lightness,
   plus the awkward ones — a yellow (where white never works), a near-grey
   (almost no chroma to floor up), and black and white themselves. */
const CATEGORY_COLOURS = [
  "#CBB8F2", // lilac
  "#B9CCF5", // powder blue
  "#B7E6C8", // mint
  "#F5D9B8", // sand
  "#F2EFB8", // pale yellow — the hue white can never sit on
  "#F5B8C4", // pink
  "#B8EFF2", // ice
  "#D9D9DE", // near-grey
  "#000000",
  "#FFFFFF",
  "#7A5AF8", // an already-strong colour, not a wash
  "#00A389",
];

describe("scheduleBlockPaint", () => {
  it.each(CATEGORY_COLOURS)("gives %s a label that clears 4.5:1", (hex) => {
    const { fill, ink } = scheduleBlockPaint(hex);
    expect(contrastRatio(channels(fill), channels(ink))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(CATEGORY_COLOURS)("keeps %s legible once it closes", (hex) => {
    const { pale } = scheduleBlockPaint(hex);
    // a closed block always takes ink, and should be MORE readable, not less
    const onInk = contrastRatio(channels(pale), [10, 11, 16]);
    expect(onInk).toBeGreaterThanOrEqual(4.5);
    expect(onInk).toBeGreaterThan(
      contrastRatio(channels(scheduleBlockPaint(hex).fill), [10, 11, 16]) - 0.01
    );
  });

  it.each(CATEGORY_COLOURS)("keeps %s's number chip legible too", (hex) => {
    // the chip paints its own ground UNDER the same ink — a tint made from
    // the text colour walks it toward its own words, which is how the first
    // cut of this measured 3.2:1 on every ink-labelled block
    const { chip, ink } = scheduleBlockPaint(hex);
    expect(contrastRatio(channels(chip), channels(ink))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(CATEGORY_COLOURS)("gives %s a WHITE label, whatever the hue", (hex) => {
    // the rail's text colour is a rule, not a property of the category. A row
    // of blocks that disagree about it reads as an accident.
    expect(scheduleBlockPaint(hex).ink).toBe("rgb(255, 255, 255)");
  });

  it.each(CATEGORY_COLOURS)("moves %s's chip away from its label, never toward it", (hex) => {
    const { chip, fill } = scheduleBlockPaint(hex);
    const lum = ([r, g, b]: [number, number, number]) => r + g + b;
    // the label is white, so the chip's ground can only go darker
    expect(lum(channels(chip))).toBeLessThan(lum(channels(fill)));
  });

  it("darkens a hue too bright for white until white works", () => {
    // a pale yellow at a true mid is far brighter than white can sit on, so
    // the FILL moves rather than the label — it lands an olive, not a lemon
    const { fill } = scheduleBlockPaint("#F2EFB8");
    expect(contrastRatio(channels(fill), [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
    // and it really did have to travel: well below the 0.55 start
    const [r, g, b] = channels(fill);
    expect(Math.max(r, g, b)).toBeLessThan(160);
  });

  it("leaves a hue that already carries white where it is", () => {
    // lilac clears on the first step, so it keeps its full-strength mid
    expect(scheduleBlockPaint("#CBB8F2").fill).toBe("rgb(113, 61, 219)");
  });

  it("rebuilds the hue rather than passing the wash through", () => {
    // the fill must NOT still be ServiceM8's near-white pick
    const [r, g, b] = channels(scheduleBlockPaint("#CBB8F2").fill);
    expect(Math.max(r, g, b)).toBeLessThan(230);
    // and it must be a real colour, not the grey `barOf` used to produce
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeGreaterThan(60);
  });

  it("tells two washes apart that the old bar treatment flattened", () => {
    // lilac and powder blue both became slate under `× 0.55 per channel`
    const lilac = channels(scheduleBlockPaint("#CBB8F2").fill);
    const blue = channels(scheduleBlockPaint("#B9CCF5").fill);
    const apart = Math.max(...lilac.map((v, i) => Math.abs(v - blue[i])));
    expect(apart).toBeGreaterThan(40);
  });

  it("reads three-, six- and eight-digit hex the same way", () => {
    // sm8CategoryColour admits all three; alpha is dropped, never composited
    expect(scheduleBlockPaint("#abc")).toEqual(scheduleBlockPaint("#aabbcc"));
    expect(scheduleBlockPaint("#aabbccdd")).toEqual(scheduleBlockPaint("#aabbcc"));
  });

  it("falls back to grey for no category or an unreadable colour", () => {
    expect(scheduleBlockPaint(null)).toBe(NO_CATEGORY_PAINT);
    expect(scheduleBlockPaint(undefined)).toBe(NO_CATEGORY_PAINT);
    expect(scheduleBlockPaint("#12345")).toBe(NO_CATEGORY_PAINT);
    expect(scheduleBlockPaint("nope")).toBe(NO_CATEGORY_PAINT);
    expect(scheduleBlockPaint("")).toBe(NO_CATEGORY_PAINT);
  });

  it("ships a grey pair that clears 4.5:1 as well", () => {
    const { fill, ink, chip, pale } = NO_CATEGORY_PAINT;
    expect(contrastRatio(channels(fill), channels(ink))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(channels(chip), channels(ink))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(channels(pale), [10, 11, 16])).toBeGreaterThanOrEqual(4.5);
  });

  it("never returns a colour the browser will refuse", () => {
    for (const hex of CATEGORY_COLOURS) {
      for (const value of Object.values(scheduleBlockPaint(hex))) {
        expect(value).toMatch(/^rgb\(\d{1,3}, \d{1,3}, \d{1,3}\)$/);
        for (const n of channels(value)) {
          expect(n).toBeGreaterThanOrEqual(0);
          expect(n).toBeLessThanOrEqual(255);
        }
      }
    }
  });
});

describe("contrastRatio", () => {
  it("is 21 for black on white, and 1 for a colour on itself", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([120, 30, 200], [120, 30, 200])).toBeCloseTo(1, 5);
  });

  it("does not care which way round the two colours are given", () => {
    expect(contrastRatio([12, 200, 90], [240, 240, 10])).toBeCloseTo(
      contrastRatio([240, 240, 10], [12, 200, 90]),
      10
    );
  });
});
