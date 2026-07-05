/* Design Studio — plans pipeline (client side).
   PDFs are rasterised in the browser with pdf.js (npm dep, workers bundled);
   each selected page uploads to Supabase Storage via a signed URL and the
   design document stores only the ref + natural size. The pure helpers
   (labelling, floor mapping) are unit-tested; the raster path is browser-only. */

import { newId, type Floor } from "./document";

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

/* ── Pure: keyword floor labelling (Enhance tier, cheap to do now) ── */

export function guessFloorLabel(text: string, pageNumber: number): string {
  const t = text.toLowerCase();
  if (/\b(basement|lower ground)\b/.test(t)) return "Basement";
  if (/\bground\s+(floor|level)\b/.test(t)) return "Ground floor";
  if (/\b(first|1st)\s+floor\b/.test(t) || /\blevel\s*0?1\b/.test(t)) return "Level 1";
  if (/\b(second|2nd)\s+floor\b/.test(t) || /\blevel\s*0?2\b/.test(t)) return "Level 2";
  if (/\b(third|3rd)\s+floor\b/.test(t) || /\blevel\s*0?3\b/.test(t)) return "Level 3";
  const lvl = t.match(/\blevel\s*(\d{1,2})\b/);
  if (lvl) return `Level ${parseInt(lvl[1], 10)}`;
  if (/\broof\s+plan\b/.test(t)) return "Roof";
  if (/\bsite\s+plan\b/.test(t)) return "Site plan";
  return `Page ${pageNumber}`;
}

/* ── Pure: selected pages → new floors ── */

export function floorsFromPages(
  pages: {
    label: string;
    ref: string;
    pageNumber: number | null;
    width: number;
    height: number;
  }[],
  existing: Floor[]
): Floor[] {
  const maxLevel = existing.reduce((m, f) => Math.max(m, f.level), -1);
  return pages.map((p, i) => ({
    id: newId("flr"),
    name: p.label,
    level: maxLevel + 1 + i,
    scaleMmPerUnit: null, // plans must be calibrated before sizes are real
    northDeg: null,
    plan: {
      imageRef: p.ref,
      pageNumber: p.pageNumber,
      width: p.width,
      height: p.height,
    },
  }));
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
