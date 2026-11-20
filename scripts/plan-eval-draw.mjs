#!/usr/bin/env node
/* Draws pages of a plan set for the kept test (src/lib/studio/measure/__tests__/eval-set.test.ts),
   with pdf.js on its Node canvas as the server draws them (lib/jobs/plan-draw-node.ts), at 2 pixels
   per PDF point, each with its words placed. A set is a customer's drawing: it lives outside the repo.

     node scripts/plan-eval-draw.mjs ~/Developer/heytiff-plan-eval/3570 9 10 11 12 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [dir, ...pages] = process.argv.slice(2);
if (!dir || !pages.length) {
  console.error("usage: plan-eval-draw.mjs <folder with set.pdf> <page> [page ...]");
  process.exit(1);
}
const req = createRequire(path.join(process.cwd(), "package.json"));
const napi = req("@napi-rs/canvas");
Object.assign(globalThis, { DOMMatrix: napi.DOMMatrix, Path2D: napi.Path2D, ImageData: napi.ImageData });
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const PDFJS = path.join(process.cwd(), "node_modules", "pdfjs-dist");
const doc = await pdfjs.getDocument({
  data: new Uint8Array(readFileSync(path.join(dir, "set.pdf"))),
  standardFontDataUrl: `${PDFJS}/standard_fonts/`,
  cMapUrl: `${PDFJS}/cmaps/`,
  cMapPacked: true,
  wasmUrl: `${PDFJS}/wasm/`,
  verbosity: 0,
}).promise;
mkdirSync(path.join(dir, "pages"), { recursive: true });
for (const n of pages.map(Number)) {
  const page = await doc.getPage(n);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = napi.createCanvas(Math.round(viewport.width), Math.round(viewport.height));
  await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport, intent: "print" }).promise;
  const words = [];
  for (const it of (await page.getTextContent()).items) {
    const text = (it.str ?? "").trim();
    if (!text || !it.transform) continue;
    const [x, y] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
    const w = (it.width ?? 0) * viewport.scale;
    const h = (it.height ?? Math.abs(it.transform[3])) * viewport.scale;
    words.push({ text, at: { x: Math.round(x + w / 2), y: Math.round(y - h / 2) }, w: Math.round(w), h: Math.round(h) });
  }
  writeFileSync(path.join(dir, "pages", `p${n}.png`), canvas.toBuffer("image/png"));
  writeFileSync(path.join(dir, "pages", `p${n}.words.json`), JSON.stringify(words));
  console.log(`page ${n}: ${canvas.width}×${canvas.height}, ${words.length} words`);
}
