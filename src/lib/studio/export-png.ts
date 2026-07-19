/* Design Studio — SVG → PNG export helpers (browser-only; no React).

   The one hard rule: plan rasters must be INLINED as data URLs before the
   figure is serialized. An SVG loaded as an <img> is sandboxed — external
   hrefs (our signed storage URLs) are simply never fetched, so the raster
   would silently vanish; and data URLs keep the canvas untainted so
   toBlob() stays legal. Supabase storage serves permissive CORS, so the
   inlining fetch itself is fine. */

import type { DesignDocument, Floor } from "./document";
import { floorDisplayName } from "./plans";

/** signed/plain URLs → data URLs, keyed the same. A ref that fails to fetch
    is DROPPED (the figure draws without that sheet — same as print). */
export async function inlineImageUrls(
  urls: Record<string, string>
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    Object.entries(urls).map(async ([ref, url]) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const blob = await res.blob();
        out[ref] = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(new Error(`read failed: ${ref}`));
          r.readAsDataURL(blob);
        });
      } catch {
        /* dropped — never blocks the export */
      }
    })
  );
  return out;
}

const VIEWBOX_RE = /viewBox="([-\d.]+)[ ,]+([-\d.]+)[ ,]+([-\d.]+)[ ,]+([-\d.]+)"/;

/** serialized PlanFigure markup → PNG blob at targetWidthPx (aspect from the
    viewBox; white paper behind — a transparent plan reads as a black box in
    most viewers). */
export async function svgToPngBlob(
  markup: string,
  targetWidthPx: number
): Promise<Blob> {
  const vb = VIEWBOX_RE.exec(markup);
  if (!vb) throw new Error("figure markup has no viewBox");
  const vbW = parseFloat(vb[3]);
  const vbH = parseFloat(vb[4]);
  const W = Math.round(targetWidthPx);
  const H = Math.max(1, Math.round((targetWidthPx * vbH) / vbW));
  /* explicit pixel size on the root so the <img> has an intrinsic size */
  const sized = markup.replace(/<svg /, `<svg width="${W}" height="${H}" `);
  const url = URL.createObjectURL(
    new Blob([sized], { type: "image/svg+xml" })
  );
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
        "image/png"
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** "harbour-view-ground-floor.png" — the design-file slug rules + the floor */
export function pngFileName(doc: DesignDocument, floor: Floor): string {
  const slugify = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  const name = slugify(doc.meta.name) || "design";
  const fl = slugify(floorDisplayName(floor)) || "floor";
  return `${name}-${fl}.png`;
}
