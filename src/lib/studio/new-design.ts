/* NEW DESIGN, from the plans to the floors (v2, 19 October; the boards
   https://claude.ai/artifact/JJX25x6p7UB4Fd4fHSrkMr). Pure: what the New
   design dialog decides before the canvas opens.

   A FLOOR-TO-BE is a page, or a box cut from one ("Crop it out"): three
   levels drawn on one sheet become three floors, each keeping only its box.
   Pieces of one page share its raster, so they share its pixels; the scale
   is still measured per floor on the canvas, exactly as today ("current
   calibration works well"). Two floors-to-be on the same level are one
   floor holding both plans, as an east and a west half are. */

import { newId, type Floor, type PlanImport, type PlanImportSource } from "./document";
import { defaultFloorName, placeSheets, type PageImage, type UploadedSheet } from "./plans";
import type { TrimRect } from "./plan-trim";

/** A floor-to-be: which page, the box cut from it (none: the whole page,
    trimmed to its drawing), the level it sits at and the name typed, if one
    was ("" follows the level: Ground floor, Level 1). */
export type FloorDraft = {
  key: string;
  page: number;
  box?: TrimRect;
  level: number;
  name: string;
};

/** A PDF of more than this many pages opens the page picker with nothing
    ticked; this many or fewer come in ticked. */
export const PICK_OVER = 3;

/** The levels the chooser offers, top to bottom of a building. */
export const LEVELS = [5, 4, 3, 2, 1, 0, -1, -2];

/** The first floors-to-be for the pages chosen: in page order, from the
    ground up. */
export function draftsFor(pages: number[]): FloorDraft[] {
  return pages.map((page, i) => ({ key: newId("fd"), page, level: i, name: "" }));
}

/** What a floor-to-be is called on the canvas. */
export const draftName = (d: FloorDraft) => d.name.trim() || defaultFloorName(d.level);

/** Put a page's boxes in place of the page: each box a floor-to-be, the
    first keeping the page's level and the rest going up from it. With no
    boxes the page goes back to being whole. */
export function cropInto(drafts: FloorDraft[], page: number, boxes: { box: TrimRect; level: number }[]): FloorDraft[] {
  const at = drafts.findIndex((d) => d.page === page);
  const rest = drafts.filter((d) => d.page !== page);
  const level = at >= 0 ? drafts[at].level : 0;
  const made: FloorDraft[] = boxes.length
    ? boxes.map((b) => ({ key: newId("fd"), page, box: b.box, level: b.level, name: "" }))
    : [{ key: newId("fd"), page, level, name: "" }];
  const where = at < 0 ? rest.length : drafts.slice(0, at).filter((d) => d.page !== page).length;
  return [...rest.slice(0, where), ...made, ...rest.slice(where)];
}

/** The boxes already cut from a page, with their levels. */
export const boxesOf = (drafts: FloorDraft[], page: number) =>
  drafts.filter((d) => d.page === page && d.box).map((d) => ({ box: d.box!, level: d.level }));

/** The next level up from those already used: where the next box lands. */
export function nextLevel(used: number[]): number {
  return used.length ? Math.max(...used) + 1 : 0;
}

/** A box drawn on a page, in the page's own pixels, from two corners in any
    order, kept inside the page. Null when it's too small to be a plan. */
export function boxFrom(a: { x: number; y: number }, b: { x: number; y: number }, w: number, h: number): TrimRect | null {
  const x0 = Math.max(0, Math.min(a.x, b.x));
  const y0 = Math.max(0, Math.min(a.y, b.y));
  const x1 = Math.min(w, Math.max(a.x, b.x));
  const y1 = Math.min(h, Math.max(a.y, b.y));
  if (x1 - x0 < w * 0.03 || y1 - y0 < h * 0.03) return null;
  return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
}

/** The floors the design opens with: the floors-to-be grouped by level,
    bottom up, each holding the plans placed on it. `refs` is each used
    page's stored image. A floor's name is the first one typed on its level,
    else its level's. Scale and north are unset, as every new floor is. */
export function floorsFrom(drafts: FloorDraft[], pages: PageImage[], refs: Record<number, string>): Floor[] {
  const levels = [...new Set(drafts.map((d) => d.level))].sort((a, b) => a - b);
  return levels.map((level) => {
    const on = drafts.filter((d) => d.level === level);
    const sheets: UploadedSheet[] = on.map((d) => {
      const p = pages[d.page];
      const crop = d.box ?? p.trim;
      return {
        label: p.label,
        ref: refs[d.page],
        pageNumber: p.pageNumber,
        width: p.width,
        height: p.height,
        ...(crop ? { crop: { ...crop } } : {}),
      };
    });
    const named = on.find((d) => d.name.trim());
    return {
      id: newId("flr"),
      name: named ? named.name.trim() : defaultFloorName(level),
      level,
      scaleMmPerUnit: null,
      northDeg: null,
      northPos: null,
      plans: placeSheets([], sheets),
    };
  });
}

/** What the design remembers of the upload, so Edit plans can open it again. */
export function importFrom(sources: PlanImportSource[], drafts: FloorDraft[], refs: Record<number, string>): PlanImport {
  const chosen = [...new Set(drafts.map((d) => d.page))].sort((a, b) => a - b);
  const placed: Record<number, string> = {};
  for (const i of chosen) placed[i] = refs[i];
  return { sources, placed, chosen, names: {} };
}

/** The used pages' words, for the reading's label check. */
export function wordsFrom(pages: PageImage[], drafts: FloorDraft[]): Record<number, NonNullable<PageImage["words"]>> {
  const out: Record<number, NonNullable<PageImage["words"]>> = {};
  for (const d of drafts) {
    const w = pages[d.page].words;
    if (w?.length) out[d.page] = w;
  }
  return out;
}

/** "Pages 4 and 5", "Page 7", "Pages 2, 3 and 9": what the picker has ticked. */
export function pagesWord(idxs: number[]): string {
  const n = [...idxs].sort((a, b) => a - b).map((i) => String(i + 1));
  if (n.length === 0) return "No pages chosen";
  if (n.length === 1) return `Page ${n[0]}`;
  return `Pages ${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}
