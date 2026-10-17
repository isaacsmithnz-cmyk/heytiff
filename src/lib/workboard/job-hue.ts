import type { Hue } from "@/components/parts/state";

/* A JOB'S COLOUR, SNAPPED TO THE EIGHT (docs/design.md, rule 18): its
   ServiceM8 category's colour, taken to the nearest of the palette's hues by
   its hue alone; a category with no hue (a grey, a white, a black, or none)
   is grey. Red follows the Unsuccessful status, never the category, so a
   red-ish category snaps to the hue beside red that it leans to. Pure. */

/** The palette's hues round the wheel, by where each one's band starts. */
const BANDS: readonly [number, Hue][] = [
  [0, "orange"],
  [40, "yellow"],
  [70, "green"],
  [170, "blue"],
  [255, "purple"],
  [290, "pink"],
];

export function jobHue(colour: string | null | undefined, unsuccessful = false): Hue {
  if (unsuccessful) return "red";
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((colour ?? "").trim());
  if (!m) return "grey";
  const hex = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  /* too little colour to have a hue: grey */
  if (chroma < 0.12) return "grey";
  let h = max === r ? ((g - b) / chroma) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
  h = (h * 60 + 360) % 360;
  /* red's own band leans to pink below 0 and to orange above it */
  if (h >= 345) return "pink";
  let hue: Hue = "orange";
  for (const [from, name] of BANDS) if (h >= from) hue = name;
  return hue;
}
