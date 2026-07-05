/* Design Studio — plans pipeline (client side).
   PDFs are rasterised in the browser with pdf.js (npm dep, workers bundled);
   each selected page uploads to Supabase Storage via a signed URL and the
   design document stores only the ref + natural size. The pure helpers
   (labelling, floor mapping) are unit-tested; the raster path is browser-only. */

import { newId, type Floor, type PlanSheet } from "./document";

/** A rasterised candidate floor plan (one PDF page or one uploaded image). */
export interface PageImage {
  pageNumber: number | null; // null when it came from a plain image file
  label: string;
  blob: Blob;
  ext: "png" | "jpeg";
  thumbUrl: string; // object URL for the picker grid
  width: number;
  height: number;
}

/* ── Pure: keyword floor labelling ──
   Real drawing sets mention many sheet names on every page (title blocks,
   sheet indexes), so first-match regexes mislabel constantly. Instead every
   pattern hit scores (occurrences capped so an index page can't run away),
   and the highest-scoring label wins. Specific floor names outweigh generic
   sheet types like "elevations". */

const ORDINALS = [
  "first|1st",
  "second|2nd",
  "third|3rd",
  "fourth|4th",
  "fifth|5th",
  "sixth|6th",
  "seventh|7th",
  "eighth|8th",
  "ninth|9th",
  "tenth|10th",
];

type LabelPattern = {
  re: RegExp;
  label: (m: RegExpExecArray) => string;
  weight: number;
};

const LABEL_PATTERNS: LabelPattern[] = [
  { re: /lower\s+ground(?:\s+(?:floor|level))?/g, label: () => "Lower ground", weight: 4 },
  { re: /\bbasement\b/g, label: () => "Basement", weight: 4 },
  { re: /\bground\s+(?:floor|level)\b/g, label: () => "Ground floor", weight: 4 },
  ...ORDINALS.map((ord, i) => ({
    re: new RegExp(`\\b(?:${ord})\\s+(?:floor|level|storey)\\b`, "g"),
    label: () => `Level ${i + 1}`,
    weight: 4,
  })),
  { re: /\blevel\s+(\d{1,2})\b/g, label: (m) => `Level ${parseInt(m[1], 10)}`, weight: 4 },
  { re: /\bl(\d{1,2})\s+(?:floor\s+)?plan\b/g, label: (m) => `Level ${parseInt(m[1], 10)}`, weight: 3 },
  { re: /\bmezzanine\b/g, label: () => "Mezzanine", weight: 3 },
  { re: /\bupper\s+(?:floor|level)\b/g, label: () => "Upper floor", weight: 3 },
  { re: /\blower\s+(?:floor|level)\b/g, label: () => "Lower floor", weight: 3 },
  { re: /\battic\b|\bloft\b/g, label: () => "Attic", weight: 3 },
  { re: /\bgarage\s+plan\b/g, label: () => "Garage", weight: 3 },
  { re: /\broof\s+(?:plan|layout)\b/g, label: () => "Roof", weight: 4 },
  { re: /\bsite\s+plan\b/g, label: () => "Site plan", weight: 4 },
  { re: /\bfloor\s+plan\b/g, label: () => "Floor plan", weight: 1 },
  { re: /\belevations?\b/g, label: () => "Elevations", weight: 2 },
  { re: /\bsections?\b/g, label: () => "Sections", weight: 2 },
  { re: /\belectrical\s+(?:plan|layout)\b/g, label: () => "Electrical", weight: 2 },
];

export function guessFloorLabel(text: string, pageNumber: number): string {
  const t = text.toLowerCase().replace(/\s+/g, " ");
  const scores = new Map<string, { score: number; order: number }>();
  LABEL_PATTERNS.forEach((p, order) => {
    p.re.lastIndex = 0;
    const counts = new Map<string, number>();
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(t)) !== null) {
      const label = p.label(m);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    for (const [label, count] of counts) {
      const score = Math.min(count, 3) * p.weight;
      const prev = scores.get(label);
      if (!prev) scores.set(label, { score, order });
      else prev.score += score;
    }
  });
  let best: { label: string; score: number; order: number } | null = null;
  for (const [label, { score, order }] of scores) {
    if (!best || score > best.score || (score === best.score && order < best.order)) {
      best = { label, score, order };
    }
  }
  return best ? best.label : `Page ${pageNumber}`;
}

/* ── Pure: uploaded pages → sheets on floors ──
   A floor is one world space that can hold several plan sheets (a big level
   split across east/west drawings). Allocation is by floor NAME: pages given
   the same name land on the same floor; a name matching an existing floor
   adds sheets to it; anything else becomes a new floor. */

export interface UploadedSheet {
  label: string;
  ref: string;
  pageNumber: number | null;
  width: number;
  height: number;
}

const SHEET_GAP = 60; // world units between auto-placed sheets

/** Place new sheets to the right of whatever the floor already holds; the
    user drags them into true alignment with the arrange tool afterwards. */
export function placeSheets(
  existing: PlanSheet[],
  sheets: UploadedSheet[]
): PlanSheet[] {
  let cursor = existing.reduce((m, s) => Math.max(m, s.x + s.width), 0);
  return sheets.map((s) => {
    const x = cursor === 0 ? 0 : cursor + SHEET_GAP;
    cursor = x + s.width;
    return {
      id: newId("sht"),
      imageRef: s.ref,
      pageNumber: s.pageNumber,
      name: s.label,
      width: s.width,
      height: s.height,
      x,
      y: 0,
    };
  });
}

/** Apply the picker's allocations: entries in order, grouped by trimmed
    case-insensitive floor name. Returns the design's full new floors array. */
export function applyPageAllocations(
  entries: { floorName: string; sheet: UploadedSheet }[],
  floors: Floor[]
): Floor[] {
  const result = floors.map((f) => ({ ...f, plans: [...f.plans] }));
  const byName = new Map<string, Floor>();
  for (const f of result) byName.set(f.name.trim().toLowerCase(), f);
  let nextLevel = result.reduce((m, f) => Math.max(m, f.level), -1) + 1;

  for (const { floorName, sheet } of entries) {
    const name = floorName.trim() || sheet.label;
    const key = name.toLowerCase();
    const existing = byName.get(key);
    if (existing) {
      existing.plans = [...existing.plans, ...placeSheets(existing.plans, [sheet])];
    } else {
      const floor: Floor = {
        id: newId("flr"),
        name,
        level: nextLevel++,
        scaleMmPerUnit: null, // plans must be calibrated before sizes are real
        northDeg: null,
        plans: placeSheets([], [sheet]),
      };
      result.push(floor);
      byName.set(key, floor);
    }
  }
  return result;
}

/* ── Browser-only: rasterisation ── */

const MAX_RENDER_WIDTH = 2400;

export async function pdfToPages(
  file: File,
  onProgress?: (done: number, total: number) => void
): Promise<PageImage[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: PageImage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(Math.max(MAX_RENDER_WIDTH / base.width, 1), 3);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("render failed"))), "image/png")
    );
    const text = (await page.getTextContent()).items
      .map((it) => ("str" in it ? it.str : ""))
      .join(" ");
    pages.push({
      pageNumber: n,
      label: guessFloorLabel(text, n),
      blob,
      ext: "png",
      thumbUrl: URL.createObjectURL(blob),
      width: canvas.width,
      height: canvas.height,
    });
    onProgress?.(n, doc.numPages);
  }
  return pages;
}

export async function imageToPage(file: File): Promise<PageImage> {
  const bmp = await createImageBitmap(file);
  const ext = file.type === "image/jpeg" ? "jpeg" : "png";
  return {
    pageNumber: null,
    label: file.name.replace(/\.[a-z0-9]+$/i, "") || "Floor plan",
    blob: file,
    ext,
    thumbUrl: URL.createObjectURL(file),
    width: bmp.width,
    height: bmp.height,
  };
}

/* ── Storage seam (injectable for tests, like DesignStore) ── */

export interface PlanImages {
  upload(page: PageImage): Promise<string>; // → ref stored in the document
  url(ref: string): Promise<string>;
  remove(ref: string): Promise<void>;
}

export class RemotePlanImages implements PlanImages {
  private urls = new Map<string, { url: string; expires: number }>();

  async upload(page: PageImage): Promise<string> {
    const [{ createPlanUpload }, { supabaseBrowser }] = await Promise.all([
      import("@/app/actions/studio-plans"),
      import("@/lib/supabase-browser"),
    ]);
    const { ref, token } = await createPlanUpload(page.ext);
    const { error } = await supabaseBrowser()
      .storage.from("studio-plans")
      .uploadToSignedUrl(ref, token, page.blob, {
        contentType: `image/${page.ext}`,
      });
    if (error) throw new Error(error.message);
    return ref;
  }

  async url(ref: string): Promise<string> {
    const hit = this.urls.get(ref);
    if (hit && hit.expires > Date.now()) return hit.url;
    const { planImageUrl } = await import("@/app/actions/studio-plans");
    const url = await planImageUrl(ref);
    this.urls.set(ref, { url, expires: Date.now() + 50 * 60 * 1000 });
    return url;
  }

  async remove(ref: string): Promise<void> {
    const { deletePlanImage } = await import("@/app/actions/studio-plans");
    await deletePlanImage(ref);
    this.urls.delete(ref);
  }
}
