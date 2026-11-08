/* THE STANDARD FINISHES (Isaac, 8 November 2026: "the finishes should be
   read from the plans if possible, and maybe just compile a list of
   standard finishes so we're not going too crazy. Just put down the
   closest match to what our standard finishes are. Tiled roof, metal roof,
   timber finishes, concrete finishes, tile finishes. Yeah, whatever other
   basic ones there are.")

   A short list, and whatever a drawing says lands on the closest of it:
   Colorbond, Custom Orb and Kliplok are a metal roof; hybrid and
   engineered boards are timber; porcelain and pavers are tile. Where the
   drawing says nothing, nothing is claimed and the 3D keeps its defaults.

   Read from what Tiff already has, so nothing is paid twice: the roof's
   covering from her read of the roof, and the plan's own words, kept from
   the PDF at upload, inside each room. Pure. */

export type RoofFinish = "tiled" | "metal" | "flat";
export type SurfaceFinish = "timber" | "tile" | "carpet" | "concrete";

export const ROOF_FINISHES: { id: RoofFinish; label: string }[] = [
  { id: "tiled", label: "Tiled roof" },
  { id: "metal", label: "Metal roof" },
  { id: "flat", label: "Flat roof" },
];
export const SURFACE_FINISHES: { id: SurfaceFinish; label: string }[] = [
  { id: "timber", label: "Timber" },
  { id: "tile", label: "Tile" },
  { id: "carpet", label: "Carpet" },
  { id: "concrete", label: "Concrete" },
];

/** what a drawing writes, for each finish */
const ROOF_WORDS: [RoofFinish, RegExp][] = [
  ["tiled", /\btil(e|es|ed)\b|terracotta|\bslate\b|shingle/i],
  ["metal", /colorbond|custom ?orb|corrugated|kli?p-? ?lo(c)?k|trimdek|spandek|standing seam|zincalume|\bmetal\b|roof ?sheet|sheeting|\bsteel\b/i],
  /* a concrete slab or canopy is a flat roof; "concrete roof tiles" are tiles */
  ["flat", /membrane|torch-?on|waterproof|concrete (roof|slab|canopy)(?!\s*til)|flat roof/i],
];
const SURFACE_WORDS: [SurfaceFinish, RegExp][] = [
  ["carpet", /carpet|\bcpt\b/i],
  ["tile", /\btil(e|es|ed|ing)\b|porcelain|ceramic|terrazzo|\bstone\b|marble|pavers?|paving/i],
  ["concrete", /concrete|\bconc\b|polished|screed|\bslab\b/i],
  ["timber", /timber|\bt\/?b\b|floorboards?|hardwood|\boak\b|spotted gum|blackbutt|engineered|hybrid|laminate|vinyl plank|\blvt\b|bamboo|decking/i],
];
/* words about the frame, not the floor: "TIMBER POSTS AND BEAMS", "BRICK WALLING" */
const NOT_A_FLOOR = /\b(post|beam|stud|frame|framing|lintel|batten|joist|bearer|rafter|truss|wall|walling|ceiling|roof|gutter|fascia|cladding|fence|balustrade|handrail|window|door)s?\b/i;

/** the finish named first in some words, of a list */
function firstOf<T>(text: string, table: [T, RegExp][]): T | null {
  let best: T | null = null;
  let at = Infinity;
  for (const [id, re] of table) {
    const m = re.exec(text);
    if (m && m.index < at) {
      at = m.index;
      best = id;
    }
  }
  return best;
}

/** The closest standard roof to what's written: "Colorbond Kliplock at 3°" is a metal roof. */
export const roofFinishOf = (text: string): RoofFinish | null => firstOf(text, ROOF_WORDS);

/** The closest standard floor, stair or deck finish to what's written: "HYBRID" is timber, "TILED TO OWNER'S CHOICE" is tile. */
export const surfaceFinishOf = (text: string): SurfaceFinish | null => (NOT_A_FLOOR.test(text) && !/stair/i.test(text) ? null : firstOf(text, SURFACE_WORDS));

/**
 * A roof part's covering: what her note on that part says, else what her
 * read of the whole roof says about the existing roof (for a part kept) or
 * the new one, else nothing. "Existing main hip roof: tiles, retained … New
 * rear roof RF-01: Colorbond Kliplock" gives the kept hip tiles and the
 * new roof metal.
 */
export function roofFinishFor(part: { source: string; existing: boolean }, material: string): RoofFinish | null {
  const own = roofFinishOf(part.source ?? "");
  if (own) return own;
  const clauses = (material ?? "").split(/(?<=[.;])\s+/);
  const kept = (c: string) => /existing|retained|kept/i.test(c);
  for (const c of clauses.filter((c) => (part.existing ? kept(c) : !kept(c)))) {
    const f = roofFinishOf(c);
    if (f) return f;
  }
  return null;
}

/** A plan's word and where it sits, in the sheet's pixels. */
export type Word = { text: string; at: { x: number; y: number } };

/**
 * A room's finish from the plan's own words inside it: the first that names
 * a floor finish. A note about stairs ("NEW TIMBER STAIRS") is the stairs'.
 */
export function finishInside(words: Word[], outline: { x: number; y: number }[], inside: (p: { x: number; y: number }, poly: { x: number; y: number }[]) => boolean): SurfaceFinish | null {
  for (const w of words) {
    if (/stair/i.test(w.text) || !inside(w.at, outline)) continue;
    const f = surfaceFinishOf(w.text);
    if (f) return f;
  }
  return null;
}

/** The stairs' finish from any note on the sheet that names them: "NEW TIMBER STAIRS TO PART 11.2". */
export function stairFinishOf(words: Word[]): SurfaceFinish | null {
  for (const w of words) if (/stair/i.test(w.text)) {
    const f = firstOf(w.text, SURFACE_WORDS);
    if (f) return f;
  }
  return null;
}
