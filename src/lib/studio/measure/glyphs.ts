/* NUMBERS DRAWN AS LINES, NOT TYPE. The wall lines' numbers on the picture
   the model reads were SVG <text>, which sharp draws with the server's fonts,
   and a Vercel function has none: the numbers came out as empty boxes and the
   model was asked to name rooms by lines it couldn't read (the engine's
   review, 21 November 2026). So the few characters the picture needs, the
   digits and x and y, are drawn here as strokes, the same on every server.

   Each glyph is a path in a box 6 wide and 10 high, y down, sitting on its
   baseline at 10 (y drops below it). Plain shapes, chosen to read apart. */
const GLYPH: Record<string, string> = {
  "0": "M1.5,0 L4.5,0 L6,1.5 L6,8.5 L4.5,10 L1.5,10 L0,8.5 L0,1.5 Z M1,8.5 L5,1.5",
  "1": "M1,2 L3.5,0 L3.5,10 M1,10 L6,10",
  "2": "M0,1.5 L1.5,0 L4.5,0 L6,1.5 L6,4 L0,10 L6,10",
  "3": "M0,0 L6,0 L2.5,4.2 L4.5,4.2 L6,5.7 L6,8.5 L4.5,10 L1.5,10 L0,8.5",
  "4": "M4.5,10 L4.5,0 L0,7 L6,7",
  "5": "M6,0 L0.5,0 L0,4.6 L4.5,4.2 L6,5.7 L6,8.5 L4.5,10 L1.5,10 L0,8.5",
  "6": "M5.5,0 L2.5,0 L0,3 L0,8.5 L1.5,10 L4.5,10 L6,8.5 L6,6 L4.5,4.5 L1.5,4.5 L0,6",
  "7": "M0,0 L6,0 L2,10",
  "8": "M1.5,0 L4.5,0 L5.6,1.1 L5.6,3.5 L4.5,4.7 L1.5,4.7 L0.4,3.5 L0.4,1.1 Z M1.5,4.7 L0,6.1 L0,8.7 L1.3,10 L4.7,10 L6,8.7 L6,6.1 L4.5,4.7",
  "9": "M6,4 L4.5,5.5 L1.5,5.5 L0,4 L0,1.5 L1.5,0 L4.5,0 L6,1.5 L6,7 L3.5,10 L0.5,10",
  x: "M0,3.5 L6,10 M6,3.5 L0,10",
  y: "M0,3.5 L3,10 M6,3.5 L1.5,13",
};
const ADVANCE = 8;

/** The characters strokeText can draw. */
export const DRAWN = Object.keys(GLYPH);

/** `text` drawn centred on x with its baseline at y, `size` the height of a
    capital, in `colour` on a white halo so it reads over the drawing. A
    character with no glyph is left out. The text is kept on the group as
    data-text, for tests and for a person reading the SVG. */
export function strokeText(text: string, x: number, y: number, size: number, colour: string): string {
  const u = size / 10;
  const chars = [...text].filter((c) => GLYPH[c]);
  if (!chars.length) return "";
  const width = (chars.length * ADVANCE - (ADVANCE - 6)) * u;
  const left = x - width / 2;
  const d = chars
    .map((c, i) => `<path transform="translate(${(left + i * ADVANCE * u).toFixed(1)},${(y - 10 * u).toFixed(1)}) scale(${u.toFixed(3)})" d="${GLYPH[c]}"/>`)
    .join("");
  const line = (stroke: string, w: number) =>
    `<g fill="none" stroke="${stroke}" stroke-width="${(w / u).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round">${d}</g>`;
  return `<g data-text="${chars.join("")}">${line("#fff", size * 0.42)}${line(colour, size * 0.16)}</g>`;
}
