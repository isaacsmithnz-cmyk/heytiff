import "server-only";
import { createRequire } from "node:module";
import path from "node:path";
import { fullScale, PREVIEW_WIDTH, wordsOf } from "@/lib/studio/plans";
import { trimBorders, type TrimRect } from "@/lib/studio/plan-trim";
import type { DrawnPreview } from "@/app/print/plan-pages/plan-pages";

/* A JOB'S PLAN SET DRAWN IN NODE, with no browser. pdf.js draws each page
   onto @napi-rs/canvas (pdf.js's own Node canvas, installed with it), the
   very drawing the Studio's New design makes in a browser: the same
   preview width, the same full scale, the words placed the same way.

   Why not the headless browser: on Vercel its Chrome couldn't take in a
   big set by any road (3570, 19–20 November 2026: Luke's 27 A1 sheets,
   11 MB, failed fetched, handed over whole, then mid-body), and nothing
   about it could be run anywhere but there. This runs the same here as on
   the server, on the real file. The browser stays the way in for a photo,
   and the fallback if this can't draw. */

type Napi = typeof import("@napi-rs/canvas");
type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

const PDFJS_DIR = path.join(process.cwd(), "node_modules", "pdfjs-dist");

let loaded: Promise<{ napi: Napi; pdfjs: PdfJs }> | null = null;

/** The canvas and pdf.js, once. The canvas's own DOMMatrix, Path2D and
    ImageData go on the global first: lib/tiff/extract puts do-nothing
    stand-ins there for reading words, which can't draw. */
function load(): Promise<{ napi: Napi; pdfjs: PdfJs }> {
  loaded ??= (async () => {
    const req = createRequire(path.join(process.cwd(), "package.json"));
    const napi = req("@napi-rs/canvas") as Napi;
    Object.assign(globalThis, { DOMMatrix: napi.DOMMatrix, Path2D: napi.Path2D, ImageData: napi.ImageData });
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as PdfJs;
    return { napi, pdfjs };
  })();
  loaded.catch(() => {
    loaded = null;
  });
  return loaded;
}

async function open(bytes: Uint8Array) {
  const { napi, pdfjs } = await load();
  const task = pdfjs.getDocument({
    /* a copy: pdf.js takes the buffer it's given */
    data: new Uint8Array(bytes),
    standardFontDataUrl: `${PDFJS_DIR}/standard_fonts/`,
    cMapUrl: `${PDFJS_DIR}/cmaps/`,
    cMapPacked: true,
    wasmUrl: `${PDFJS_DIR}/wasm/`,
    verbosity: 0,
  });
  const doc = await task.promise;
  return { napi, doc, close: () => void task.destroy() };
}

type Doc = Awaited<ReturnType<typeof open>>["doc"];
type Page = Awaited<ReturnType<Doc["getPage"]>>;

async function drawn(napi: Napi, page: Page, scale: number) {
  const viewport = page.getViewport({ scale });
  const canvas = napi.createCanvas(Math.round(viewport.width), Math.round(viewport.height));
  const ctx = canvas.getContext("2d");
  /* print draws straight through, as printing does: nothing here waits on a frame */
  await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport, intent: "print" }).promise;
  return { canvas, ctx, viewport };
}

/** Every page drawn small with its full drawing's size and its words placed
    on it, as print/plan-pages's first visit hands back. */
export async function previewsInNode(bytes: Uint8Array, onProgress?: (done: number, total: number) => void): Promise<DrawnPreview[]> {
  const { napi, doc, close } = await open(bytes);
  try {
    const out: DrawnPreview[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const { canvas } = await drawn(napi, page, PREVIEW_WIDTH / base.width);
      const full = page.getViewport({ scale: fullScale(base.width) });
      const words = await wordsOf(page, full);
      out.push({
        n,
        width: Math.round(full.width),
        height: Math.round(full.height),
        ...(words.length ? { words } : {}),
        jpeg: `data:image/jpeg;base64,${canvas.toBuffer("image/jpeg", 85).toString("base64")}`,
      });
      page.cleanup();
      onProgress?.(n, doc.numPages);
    }
    return out;
  } finally {
    close();
  }
}

export type FullInNode = { n: number; png: Buffer; width: number; height: number; trim?: TrimRect; words?: { text: string; at: { x: number; y: number } }[] };

/** The pages named drawn in full, each a PNG with its margins found and its
    words placed, as print/plan-pages's second visit draws them. */
export async function fullInNode(bytes: Uint8Array, numbers: readonly number[], onProgress?: (done: number, total: number) => void): Promise<FullInNode[]> {
  const { napi, doc, close } = await open(bytes);
  try {
    const out: FullInNode[] = [];
    for (const n of numbers) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const { canvas, ctx, viewport } = await drawn(napi, page, fullScale(base.width));
      let trim: TrimRect | null = null;
      try {
        trim = trimBorders(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
      } catch {
        trim = null;
      }
      const words = await wordsOf(page, viewport);
      out.push({ n, png: canvas.toBuffer("image/png"), width: canvas.width, height: canvas.height, ...(trim ? { trim } : {}), ...(words.length ? { words } : {}) });
      page.cleanup();
      onProgress?.(out.length, numbers.length);
    }
    return out;
  } finally {
    close();
  }
}
