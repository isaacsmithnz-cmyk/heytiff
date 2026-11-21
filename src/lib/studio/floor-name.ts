/* A ROOM'S NAME PRINTED ON ITS FLOOR in the 3D (view-3d's floorName): how
   large its picture is drawn and how large it lies on the floor.

   The words are drawn at NAME_PX in a band NAME_BAND_PX high, with room
   either side, and ringed in white NAME_RING_PX wide (Isaac's phone, 22
   November 2026: "Bed 1" read "Bed", "Bath" lost its "B", "Covered
   balcony" only "Co", a blue airflow ribbon across "BALCONY (side)"). The
   names already draw over everything, but grey letters with nothing round
   them go into a dark door or window frame, a table or a ribbon crossing
   them, and from a phone's distance their thin strokes let what's under
   them through. The white ring keeps every letter apart from whatever is
   under it; on the white floor it doesn't show.

   The band is as large as the room lets it, up to 450 mm: the words fit
   80% of the room's length and half its width, so they are never cut by
   its walls; the ring lies round them, outside that fit. */

export const NAME_PX = 96;
export const NAME_BAND_PX = 128;
/** room either side of the words, px, inside the fit */
const SIDE_PX = 12;
/** the white ring round each letter, px out from its edge */
export const NAME_RING_PX = 12;
/** the band's height, metres: no taller than this */
const MAX_BAND_M = 0.45;
/** smaller than this the name isn't printed */
const MIN_BAND_M = 0.12;

export type FloorNameSize = {
  /** the picture, px: the words, the room either side and the ring round it all */
  canvasW: number;
  canvasH: number;
  /** where the words' middle is drawn on it, px */
  midX: number;
  midY: number;
  /** the picture on the floor, metres */
  planeW: number;
  planeH: number;
  /** the words' band alone, metres: what fits the room */
  bandM: number;
  wordsM: number;
};

/** The size of a room's name on its floor, from its words' width at NAME_PX and the room's width and depth in metres; null when the room is too small to print it. */
export function floorNameSize(textPx: number, w: number, d: number): FloorNameSize | null {
  if (!(textPx > 0) || !(w > 0) || !(d > 0)) return null;
  const wordsPx = Math.ceil(textPx) + SIDE_PX * 2;
  const bandM = Math.min(MAX_BAND_M, (Math.max(w, d) * 0.8 * NAME_BAND_PX) / wordsPx, Math.min(w, d) * 0.5);
  if (bandM < MIN_BAND_M) return null;
  const canvasW = wordsPx + NAME_RING_PX * 2;
  const canvasH = NAME_BAND_PX + NAME_RING_PX * 2;
  const perPx = bandM / NAME_BAND_PX;
  return {
    canvasW,
    canvasH,
    midX: canvasW / 2,
    midY: canvasH / 2,
    planeW: canvasW * perPx,
    planeH: canvasH * perPx,
    bandM,
    wordsM: wordsPx * perPx,
  };
}
