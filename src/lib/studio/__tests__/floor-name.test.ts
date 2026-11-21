/* A room's name on its floor in the 3D: the words fit the room, never cut
   by its walls, and the white ring round them has room on the picture. */

import { NAME_BAND_PX, NAME_RING_PX, floorNameSize } from "../floor-name";

it("is as large as the room lets it, up to a 450 mm band", () => {
  const big = floorNameSize(200, 6, 5)!;
  expect(big.bandM).toBeCloseTo(0.45);
  /* a long name in a narrow room: the words take 80% of its length */
  const long = floorNameSize(900, 3.2, 1.6)!;
  expect(long.wordsM).toBeCloseTo(3.2 * 0.8);
  /* a shallow room: the band is half its width */
  expect(floorNameSize(150, 6, 0.5)!.bandM).toBeCloseTo(0.25);
});

it("never runs past the room, ring and all, in a room that fits it", () => {
  for (const [px, w, d] of [
    [220, 3.2, 3.6],
    [210, 2, 2.4],
    [700, 5.2, 2],
    [1100, 4, 1.2],
  ]) {
    const s = floorNameSize(px, w, d)!;
    expect(s.wordsM).toBeLessThanOrEqual(Math.max(w, d) * 0.8 + 1e-9);
    expect(s.bandM).toBeLessThanOrEqual(Math.min(w, d) * 0.5 + 1e-9);
    /* the picture holds the whole of the words and their ring */
    expect(s.canvasW).toBeGreaterThanOrEqual(Math.ceil(px) + NAME_RING_PX * 2);
    expect(s.canvasH).toBe(NAME_BAND_PX + NAME_RING_PX * 2);
    expect(s.midX).toBe(s.canvasW / 2);
    /* the picture on the floor is the canvas at the band's scale, so the words aren't squashed */
    expect(s.planeW / s.planeH).toBeCloseTo(s.canvasW / s.canvasH);
  }
});

it("isn't printed where it would be too small to read", () => {
  expect(floorNameSize(300, 0.2, 0.2)).toBeNull();
  expect(floorNameSize(0, 4, 4)).toBeNull();
  expect(floorNameSize(200, 0, 4)).toBeNull();
});
