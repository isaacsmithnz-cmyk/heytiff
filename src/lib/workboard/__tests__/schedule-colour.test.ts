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
   plus the awkward ones — a yellow, where white can only sit once the fill has
   travelled a long way down. */
const CATEGORY_COLOURS = [
  "#CBB8F2", // lilac
  "#B9CCF5", // powder blue
  "#B7E6C8", // mint
  "#F5D9B8", // sand
  "#F2EFB8", // pale yellow — needs the biggest walk before white clears
  "#F5B8C4", // pink
  "#B8EFF2", // ice
  "#7A5AF8", // an already-strong colour, not a wash
  "#00A389",
  "#C8D4C8", // a deliberately muted sage — faint, but still a chosen hue
];

/* Colours with no hue to rescue. These do NOT get the category treatment:
   flooring the saturation of something already grey fabricates a hue, which
   is how #D9D9DE came out blue-violet and how black and white both came out
   red. They take the neutral pair instead. */
const ACHROMATIC = ["#D9D9DE", "#000000", "#FFFFFF", "#808080", "#1a1a1a"];

describe("scheduleBlockPaint", () => {
  it.each(CATEGORY_COLOURS)("gives %s a label that clears 4.5:1", (hex) => {
    const { fill, ink } = scheduleBlockPaint(hex);
    expect(contrastRatio(channels(fill), channels(ink))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(CATEGORY_COLOURS)("keeps %s legible once it closes", (hex) => {
    const { pale } = scheduleBlockPaint(hex);
    expect(contrastRatio(channels(pale), [10, 11, 16])).toBeGreaterThanOrEqual(4.5);
  });

  it("closes every category to the SAME neutral, carrying no hue", () => {
    /* `pale` used to be the category at 92% lightness. Against a 94% wash that
       is the same colour twice, and finished work stopped being tellable from
       live work at a glance — the tick was doing all of it. Colour on this
       rail means work still to do. */
    const pales = new Set(CATEGORY_COLOURS.map((hex) => scheduleBlockPaint(hex).pale));
    expect(pales.size).toBe(1);
    const [r, g, b] = channels([...pales][0]);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(8); // a grey, not a tint
  });

  it.each(CATEGORY_COLOURS)("keeps %s's number chip legible too", (hex) => {
    // the chip paints its own ground UNDER the same ink — a tint made from
    // the text colour walks it toward its own words, which is how the first
    // cut of this measured 3.2:1 on every ink-labelled block
    const { chip, ink } = scheduleBlockPaint(hex);
    expect(contrastRatio(channels(chip), channels(ink))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(CATEGORY_COLOURS)("gives %s an INK label, whatever the hue", (hex) => {
    // the rail's text colour is a rule, not a property of the category. A row
    // of blocks that disagree about it reads as an accident.
    expect(scheduleBlockPaint(hex).ink).toBe("rgb(10, 11, 16)");
  });

  it.each(CATEGORY_COLOURS)("gives %s a cap that clears 3:1 on its own wash", (hex) => {
    /* THE PROMISE THIS MODULE NOW MAKES. The cap is the only thing naming a
       category by colour, so it is held to WCAG's floor for a graphic — and
       it is held there by WALKING, because a fixed lightness is not a fixed
       contrast: pinned at L=0.42 a purple cap measured 6.12:1 and a
       yellow-green one 2.22:1 against the very same wash. */
    const { fill, bar } = scheduleBlockPaint(hex);
    expect(contrastRatio(channels(bar), channels(fill))).toBeGreaterThanOrEqual(3);
  });

  it.each(CATEGORY_COLOURS)("cannot paint %s as an alarm, whatever ServiceM8 sent", (hex) => {
    /* THE BUG THIS TREATMENT EXISTS TO MAKE IMPOSSIBLE. A pale pink category
       arrived as rgb(235, 0, 0) — more saturated than --wb2-dan itself — so a
       Service Call outshouted the ring for a job that had actually failed.
       The ground is a wash by construction now: it cannot get near a state
       colour, because it cannot get far from white. */
    const [r, g, b] = channels(scheduleBlockPaint(hex).fill);
    expect(Math.min(r, g, b)).toBeGreaterThanOrEqual(224);
    expect(contrastRatio([r, g, b], [255, 255, 255])).toBeLessThan(1.4);
  });

  it("walks a cap DOWN when the hue is too light to measure where it starts", () => {
    /* yellow-green is far lighter than purple at the same HSL lightness, so it
       has to travel; purple clears on the first step and stays put. */
    const yellow = channels(scheduleBlockPaint("#F2EFB8").bar);
    const lilac = channels(scheduleBlockPaint("#CBB8F2").bar);
    const lightness = (c: [number, number, number]) =>
      (Math.max(...c) + Math.min(...c)) / 2;
    expect(lightness(yellow)).toBeLessThan(lightness(lilac));
    // and both still measure, which is the whole point of the walk
    for (const hex of ["#F2EFB8", "#CBB8F2"]) {
      const { fill, bar } = scheduleBlockPaint(hex);
      expect(contrastRatio(channels(bar), channels(fill))).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(ACHROMATIC)("takes the neutral pair for %s rather than inventing a hue", (hex) => {
    expect(scheduleBlockPaint(hex)).toBe(NO_CATEGORY_PAINT);
  });

  it("no longer turns black and white into the danger colour", () => {
    // both compute 0°, and 0° at the saturation floor is red — they used to
    // render identically to each other AND to a job that didn't go ahead
    for (const hex of ["#000000", "#FFFFFF"]) {
      const [r, g, b] = channels(scheduleBlockPaint(hex).fill);
      expect(r - Math.max(g, b)).toBeLessThan(20); // nothing like a red
    }
  });

  it("keeps a muted pick's hue rather than rounding it to grey", () => {
    // the line errs toward keeping a colour: losing one somebody chose is the
    // worse mistake of the two
    expect(scheduleBlockPaint("#C8D4C8")).not.toBe(NO_CATEGORY_PAINT);
    const [r, g, b] = channels(scheduleBlockPaint("#C8D4C8").fill);
    expect(g).toBeGreaterThan(Math.max(r, b)); // still green
  });

  it.each(CATEGORY_COLOURS)("moves %s's chip away from its label, never toward it", (hex) => {
    const { chip, fill } = scheduleBlockPaint(hex);
    const lum = ([r, g, b]: [number, number, number]) => r + g + b;
    // the label is white, so the chip's ground can only go darker
    expect(lum(channels(chip))).toBeLessThan(lum(channels(fill)));
  });

  it("rebuilds the hue on the cap rather than passing the wash through", () => {
    // the cap must be a real colour, not the grey `barOf` used to produce by
    // multiplying each channel — that is what flattened lilac into slate
    const [r, g, b] = channels(scheduleBlockPaint("#CBB8F2").bar);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeGreaterThan(60);
  });

  it("tells two washes apart that the old bar treatment flattened", () => {
    // lilac and powder blue both became slate under `× 0.55 per channel`
    const lilac = channels(scheduleBlockPaint("#CBB8F2").bar);
    const blue = channels(scheduleBlockPaint("#B9CCF5").bar);
    const apart = Math.max(...lilac.map((v, i) => Math.abs(v - blue[i])));
    expect(apart).toBeGreaterThan(40);
  });

  it("reads three-, six- and eight-digit hex the same way", () => {
    // sm8CategoryColour admits all three; alpha is dropped, never composited
    expect(scheduleBlockPaint("#abc")).toEqual(scheduleBlockPaint("#aabbcc"));
    expect(scheduleBlockPaint("#aabbccdd")).toEqual(scheduleBlockPaint("#aabbcc"));
  });

  it("falls back to grey for no category or an unreadable colour", () => {
    expect(scheduleBlockPaint("#12345")).toBe(NO_CATEGORY_PAINT);
    expect(scheduleBlockPaint(null)).toBe(NO_CATEGORY_PAINT);
    expect(scheduleBlockPaint(undefined)).toBe(NO_CATEGORY_PAINT);
    expect(scheduleBlockPaint("#12345")).toBe(NO_CATEGORY_PAINT);
    expect(scheduleBlockPaint("nope")).toBe(NO_CATEGORY_PAINT);
    expect(scheduleBlockPaint("")).toBe(NO_CATEGORY_PAINT);
  });

  it("ships a grey pair that clears 4.5:1 as well", () => {
    const { fill, ink, chip, pale, bar } = NO_CATEGORY_PAINT;
    expect(contrastRatio(channels(bar), channels(fill))).toBeGreaterThanOrEqual(3);
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
