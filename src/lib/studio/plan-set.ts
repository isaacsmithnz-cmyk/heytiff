/* ONE SET OF DRAWINGS, ONE SCALE AND ONE NORTH (Isaac, 29 October 2026:
   7 Ipsum asked for its scale and its north twice, once a floor, though
   both floors are pages of the same A1 set at the same size).

   An architect's PDF prints its scale in the title block, "1:50 @ A1", and
   the page's own words carry it, so the scale is worked out from the paper
   and the raster without Tiff and without a click: A1 is 841 mm across, the
   page rasterised 2,400 pixels across, so a pixel is 0.3504 mm of paper and
   17.52 mm of building at 1:50. Pages of one set (the same upload, the same
   raster size) then share that scale and the north set on any of them.

   Pure: the Studio's set-up panel and its mutate wrapper call these. */

import type { DesignDocument, Floor, Point } from "./document";
import { scaleFromWritten } from "./reading";

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

/* the scales a plan is drawn at; a gradient (1:100 fall) is the same
   figure, so one followed by a word of falls is never a scale */
const RATIOS = new Set([10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 500]);
const RATIO_RE = /^1\s*:\s*(\d{1,4})(?:\s*(?:@|at)\s*(A[0-4]))?$/i;
/* the paper a scale is for, when written after it in words of its own: "@ A1", "at", "A1" */
const FOR_RE = /^(?:(?:@|at)\s*)?(A[0-4])$/i;
const FALL_RE = /^(fall|falls|grade|gradient|min|minimum|max|to|slope)\b/i;
/** paper sizes in PDF points, long side first */
const PAPER_PT = Object.fromEntries(Object.entries(PAPER_MM).map(([k, [l, s]]) => [k, [(l / 25.4) * 72, (s / 25.4) * 72]])) as Record<Paper, [number, number]>;

/** Building millimetres per PDF point, from the scale a sheet prints without
    its paper ("1 : 100", with the paper in another box or not at all), when
    the page itself is a paper size: a vector set printed to A1 is 2384 by
    1684 points, so one point is 0.353 mm of paper. Most title blocks print
    it this way (the engine's review, 21 November 2026: five of six real
    sets had no "1:100 @ A1" for printedScaleOf, so their walls were measured
    with no scale). The ratio near the word SCALE wins; else the one written
    most. Null: no ratio, or a page that isn't a paper (a scan or a photo). */
export function mmPerPointOf(words: readonly Word[] | null | undefined, page: { width: number; height: number }): { mmPerPt: number; text: string } | null {
  if (!words?.length) return null;
  const long = Math.max(page.width, page.height);
  const short = Math.min(page.width, page.height);
  const paper = (Object.keys(PAPER_PT) as Paper[]).find((k) => Math.abs(long / PAPER_PT[k][0] - 1) < 0.03 && Math.abs(short / PAPER_PT[k][1] - 1) < 0.03);
  if (!paper) return null;
  const seen: { ratio: number; scale: boolean; for: Paper | null }[] = [];
  for (let i = 0; i < words.length; i++) {
    /* "1:100", or "1" ":" "100", or "1 :" "100" split across tokens */
    for (const k of [1, 2, 3]) {
      const text = words.slice(i, i + k).map((w) => w.text.trim()).join(" ");
      const m = RATIO_RE.exec(text);
      if (!m) continue;
      const ratio = Number(m[1]);
      const next = words[i + k]?.text.trim() ?? "";
      /* the paper it is for: in the same word, or the next one or two ("@" "A1") */
      const after = FOR_RE.exec(next) ?? FOR_RE.exec(`${next} ${words[i + k + 1]?.text.trim() ?? ""}`.trim());
      const named = (m[2] ?? after?.[1])?.toUpperCase() as Paper | undefined;
      if (RATIOS.has(ratio) && !FALL_RE.test(next))
        seen.push({ ratio, scale: words.slice(Math.max(0, i - 3), i).some((w) => /^scale\b/i.test(w.text.trim())), for: named && named in PAPER_PT ? named : null });
      break;
    }
  }
  if (!seen.length) return null;
  const count = new Map<number, number>();
  for (const s of seen) count.set(s.ratio, (count.get(s.ratio) ?? 0) + 1);
  const ratio = seen.find((s) => s.scale)?.ratio ?? [...count].sort((a, b) => b[1] - a[1])[0][0];
  /* a scale for another paper is a copy printed bigger or smaller: an A1 set
     at 1:50 printed on A3 is drawn at half that size, so a point is twice the
     building (the outside review, 21 November 2026: "a ratio printed before a
     fit-to-page copy can be internally consistent yet physically wrong") */
  const named = seen.find((s) => s.ratio === ratio && s.for)?.for ?? null;
  const fit = named && named !== paper ? PAPER_PT[named][0] / PAPER_PT[paper][0] : 1;
  return { mmPerPt: (25.4 / 72) * ratio * fit, text: `1:${ratio}${named && named !== paper ? ` @ ${named}` : ""} on ${paper}` };
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
  const at = pageOf(doc, s.imageRef);
  return at != null ? (imp.words[at] ?? null) : null;
}

/** A sheet's page, by its render index at import, off its image */
function pageOf(doc: DesignDocument, imageRef: string): number | null {
  const at = Object.entries(doc.planImport?.placed ?? {}).find(([, ref]) => ref === imageRef)?.[0];
  return at != null ? Number(at) : null;
}

/** A scale to offer: the one the title block prints, or else the one Tiff
    measured off the lengths printed on the page (`from` says which, "the
    5000 mm printed on it"; `sure` when two or more agree). */
export type ScaleProposal =
  | { kind: "printed"; scale: PrintedScale; mmPerUnit: number }
  | { kind: "measured"; from: string; sure: boolean; mmPerUnit: number };

/** The scale to offer a floor, off its page: the printed one first, since
    it is the drawing's own word; Tiff's measured one where it prints none
    or its raster isn't the paper's shape (3517's plan, 13 November 2026);
    else the one the sizes written in its rooms give. */
export function proposedScale(doc: DesignDocument, floorId: string): ScaleProposal | null {
  const f = doc.floors.find((x) => x.id === floorId);
  const s = f && firstSheet(f);
  if (!s) return null;
  const scale = printedScaleOf(wordsOfFloor(doc, floorId));
  const printed = scale ? mmPerPxFor(scale, s) : null;
  if (scale && printed) return { kind: "printed", scale, mmPerUnit: printed };
  const m = pageOf(doc, s.imageRef);
  const read = m != null ? doc.planImport?.measured?.[m] : undefined;
  if (read && read.mmPerPx > 0) return { kind: "measured", from: read.from, sure: read.sure, mmPerUnit: read.mmPerPx };
  /* no printed scale and no dimension lines, as a sales floor plan: the
     sizes written in its rooms, as the job's own Plans scale it (pageScale,
     lib/jobs/plans.ts; 3516's plan, 17 November 2026: "why his plans arent
     scaled?") */
  const spaces = (doc.reading?.floors[floorId] ?? []).filter((r) => r.sheetId === s.id).flatMap((r) => r.spaces);
  const written = scaleFromWritten(spaces);
  return written ? { kind: "measured", from: `the sizes written in ${written.rooms} of its rooms`, sure: true, mmPerUnit: written.mmPerPx } : null;
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

/** The scales somebody has just measured in a design made from a job's
    plan, each as its page of the plan (1-based) and its scale in that
    page's pixels, to keep on the job's plan: the plan is the one set, so
    the next design, the heat load and a quote size the rooms by it too. A
    scale that is the one the page already offers (printed, or Tiff's) is
    the plan's own and is left out, and so is a floor whose sheet isn't a
    page of that plan. */
export function measuredForJob(prev: DesignDocument, next: DesignDocument): { planId: string; page: number; mmPerPx: number }[] {
  const planId = next.planImport?.jobPlanId;
  if (!planId || prev.id !== next.id) return [];
  const out: { planId: string; page: number; mmPerPx: number }[] = [];
  for (const f of next.floors) {
    const was = prev.floors.find((p) => p.id === f.id);
    const mm = f.scaleMmPerUnit;
    if (!was || mm == null || !(mm > 0) || mm === was.scaleMmPerUnit) continue;
    const offered = proposedScale(next, f.id);
    if (offered && Math.abs(offered.mmPerUnit - mm) < 1e-6) continue;
    const s = firstSheet(f);
    const at = s ? pageOf(next, s.imageRef) : null;
    if (at == null) continue;
    out.push({ planId, page: at + 1, mmPerPx: mm });
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
