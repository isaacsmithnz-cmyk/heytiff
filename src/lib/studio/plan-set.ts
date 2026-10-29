/* ONE SET OF DRAWINGS, ONE SCALE AND ONE NORTH (Isaac, 29 October 2026:
   7 Cutler asked for its scale and its north twice, once a floor, though
   both floors are pages of the same A1 set at the same size).

   An architect's PDF prints its scale in the title block, "1:50 @ A1", and
   the page's own words carry it, so the scale is worked out from the paper
   and the raster without Tiff and without a click: A1 is 841 mm across, the
   page rasterised 2,400 pixels across, so a pixel is 0.3504 mm of paper and
   17.52 mm of building at 1:50. Pages of one set (the same upload, the same
   raster size) then share that scale and the north set on any of them.

   Pure: the Studio's set-up panel and its mutate wrapper call these. */

import type { DesignDocument, Floor, Point } from "./document";

/** ISO A paper, long side by short side, mm */
export const PAPER_MM = {
  A0: [1189, 841],
  A1: [841, 594],
  A2: [594, 420],
  A3: [420, 297],
  A4: [297, 210],
} as const;
export type Paper = keyof typeof PAPER_MM;

export interface PrintedScale {
  /** the scale's denominator: 50 for 1:50 */
  ratio: number;
  paper: Paper;
  /** as printed, for showing where it came from */
  text: string;
}

type Word = { text: string };

const SCALE_RE = /\b1\s*:\s*(\d{1,4})\s*(?:@|at)\s*(A[0-4])\b/i;

/** The scale a sheet's title block prints, from the page's own words:
    "1:50 @ A1", "1:100 at A3", "SCALE 1 : 50 @A1". A note's "1:100 TO RWO"
    carries no paper and never matches. Words split across tokens are read
    four at a time; a match beside the word SCALE wins over one elsewhere. */
export function printedScaleOf(words: readonly Word[] | null | undefined): PrintedScale | null {
  if (!words?.length) return null;
  const found: { at: number; m: RegExpMatchArray }[] = [];
  for (let i = 0; i < words.length; i++) {
    const text = words.slice(i, i + 4).map((w) => w.text).join(" ");
    const m = text.match(SCALE_RE);
    if (m && words[i].text.match(/1\s*:/)) found.push({ at: i, m });
  }
  if (!found.length) return null;
  const nearScale = found.find(({ at }) => words.slice(Math.max(0, at - 4), at).some((w) => /^scale\b/i.test(w.text.trim())));
  const { m } = nearScale ?? found[0];
  const ratio = Number(m[1]);
  const paper = m[2].toUpperCase() as Paper;
  if (!(ratio > 0) || !(paper in PAPER_MM)) return null;
  return { ratio, paper, text: m[0].replace(/\s+/g, " ").trim() };
}

/** Building millimetres per raster pixel, for a whole page rasterised at
    `width` × `height`, or null when the raster is not that paper's shape
    (a scan or a photo: its page size isn't the paper, so the printed scale
    can't be trusted and a measured one must be used). */
export function mmPerPxFor(scale: PrintedScale, sheet: { width: number; height: number }): number | null {
  const [long, short] = PAPER_MM[scale.paper];
  const rl = Math.max(sheet.width, sheet.height);
  const rs = Math.min(sheet.width, sheet.height);
  if (!(rl > 0 && rs > 0)) return null;
  if (Math.abs(rl / rs - long / short) / (long / short) > 0.03) return null;
  return (long / rl) * scale.ratio;
}

const SHEET_NO_RE = /^[A-Z]{1,3}[-.]?\d{2,4}[A-Z]?$/;
const TITLE_RE = /\b(floor|plan|level|ground|basement|roof|mezzanine|attic)\b/i;

const sentence = (s: string) => {
  const t = s.trim().replace(/\s+/g, " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** A sheet's title and number from its title block, "GROUND FLOOR" beside
    "CD103": a floor-like title immediately before or after a sheet number. */
export function sheetTitleOf(words: readonly Word[] | null | undefined): { title: string; number: string } | null {
  if (!words?.length) return null;
  for (let i = 0; i < words.length; i++) {
    const t = words[i].text.trim();
    if (!SHEET_NO_RE.test(t)) continue;
    for (const j of [i - 1, i + 1]) {
      const w = words[j]?.text.trim();
      if (w && TITLE_RE.test(w) && w.length <= 40 && w === w.toUpperCase()) return { title: sentence(w), number: t };
    }
  }
  return null;
}

/** The first sheet of a floor: what its scale and north are measured on */
const firstSheet = (f: Floor) => f.plans[0] ?? null;

/** The words printed on a floor's first page, kept at import by the page's
    render index (`planImport.placed` maps that index to the sheet's image). */
export function wordsOfFloor(doc: DesignDocument, floorId: string): Word[] | null {
  const f = doc.floors.find((x) => x.id === floorId);
  const s = f && firstSheet(f);
  const imp = doc.planImport;
  if (!s || !imp?.words) return null;
  const at = Object.entries(imp.placed).find(([, ref]) => ref === s.imageRef)?.[0];
  return at != null ? (imp.words[Number(at)] ?? null) : null;
}

/** The set's printed scale and what it makes a pixel, off the floor's page. */
export function proposedScale(doc: DesignDocument, floorId: string): { scale: PrintedScale; mmPerUnit: number } | null {
  const f = doc.floors.find((x) => x.id === floorId);
  const s = f && firstSheet(f);
  const scale = printedScaleOf(wordsOfFloor(doc, floorId));
  if (!s || !scale) return null;
  const mmPerUnit = mmPerPxFor(scale, s);
  return mmPerUnit ? { scale, mmPerUnit } : null;
}

/** Floors drawn from the same set as `floorId`: each one's first sheet is a
    PDF page rasterised at the same size. Includes the floor itself. */
export function setOf(doc: DesignDocument, floorId: string): string[] {
  const me = doc.floors.find((f) => f.id === floorId);
  const s = me && firstSheet(me);
  if (!s || s.pageNumber == null) return me ? [me.id] : [];
  return doc.floors
    .filter((f) => {
      const o = firstSheet(f);
      return o != null && o.pageNumber != null && o.width === s.width && o.height === s.height;
    })
    .map((f) => f.id);
}

/** The set's scale on every floor of the set. */
export function applyScaleToSet(doc: DesignDocument, floorId: string, mmPerUnit: number): DesignDocument {
  const ids = new Set(setOf(doc, floorId));
  return { ...doc, floors: doc.floors.map((f) => (ids.has(f.id) ? { ...f, scaleMmPerUnit: mmPerUnit } : f)) };
}

/** Where the north arrow sits when north is simply up the page: inside the
    sheet's top right corner. */
export function northSpotOf(f: Floor): Point {
  const s = firstSheet(f);
  if (!s) return { x: 80, y: 80 };
  const c = s.crop ?? { x: 0, y: 0, w: s.width, h: s.height };
  const inset = Math.min(c.w, c.h) * 0.06;
  return { x: s.x + c.x + c.w - inset, y: s.y + c.y + inset };
}

/** The set's north on every floor of the set: the bearing everywhere, and
    an arrow on each floor that has none, at the same spot on its sheet. */
export function applyNorthToSet(doc: DesignDocument, floorId: string, deg: number, at?: Point): DesignDocument {
  const ids = new Set(setOf(doc, floorId));
  return {
    ...doc,
    floors: doc.floors.map((f) =>
      ids.has(f.id) ? { ...f, northDeg: deg, northPos: f.id === floorId && at ? at : (f.northPos ?? at ?? northSpotOf(f)) } : f,
    ),
  };
}

/** After any change: a floor whose scale or north was just set hands it to
    the rest of its set, so the second floor never asks again. Floors not in
    a set (a photo, a blank floor) are left as they are. */
export function shareAcrossSet(prev: DesignDocument, next: DesignDocument): DesignDocument {
  let out = next;
  for (const f of next.floors) {
    const was = prev.floors.find((p) => p.id === f.id);
    if (!was) continue;
    if (f.scaleMmPerUnit != null && f.scaleMmPerUnit !== was.scaleMmPerUnit) out = applyScaleToSet(out, f.id, f.scaleMmPerUnit);
    if (f.northDeg != null && f.northDeg !== was.northDeg) out = applyNorthToSet(out, f.id, f.northDeg, f.northPos ?? undefined);
  }
  return out;
}

/** What a set still needs before rooms can be measured and faced. */
export function setupNeeds(doc: DesignDocument): { scale: string[]; north: string[] } {
  return {
    scale: doc.floors.filter((f) => f.plans.length > 0 && f.scaleMmPerUnit == null).map((f) => f.id),
    north: doc.floors.filter((f) => f.plans.length > 0 && f.northDeg == null).map((f) => f.id),
  };
}
