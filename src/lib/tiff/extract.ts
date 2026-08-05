/* PDF text, page by page, on the server.

   THE IMPORT IS THE WHOLE FILE. `pdfjs-dist/legacy/build/pdf.mjs` is native
   ESM with no `exports` map, so the bare subpath resolves in plain Node — and
   `serverExternalPackages: ["pdfjs-dist"]` (next.config.ts) keeps it that way
   at runtime instead of letting the bundler rewrite it. The legacy build is
   the one that runs without a DOM: no canvas, no worker, no `document`.

   IT CANNOT BE PROVEN IN-PROCESS BY JEST. `.mjs` is hard ESM to jest and no
   transform carve-out reaches it (tried, reverted), so the proof that this
   import works lives in __tests__/extract.test.ts, which runs the same
   specifier in a CHILD Node process against a fixture PDF. That is why this
   module stays thin: everything worth unit-testing is the pure logic below it.

   A PAGE WITH NO TEXT LAYER IS A SCANNED IMAGE, not an empty page.
   `getTextContent()` returns nothing for both, so the count is kept and
   surfaced honestly ("12 pages unreadable — scanned images") rather than
   indexed as blank. Claude-vision OCR for those pages is a listed follow-up. */

/** Below this many characters a page is treated as scanned rather than read.
    A page with a header, a page number and nothing else lands around 20; real
    prose clears it on the first sentence. */
export const MIN_TEXT_CHARS = 40;

/** How many pages one ingest request reads. Sized so a batch finishes well
    inside the route's 300s ceiling on a slow 50 MB manual. */
export const PAGE_BATCH = 20;

export type PdfDoc = {
  numPages: number;
  /** 1-based, like every page number a person says out loud. */
  pageText(n: number): Promise<string>;
  destroy(): Promise<void>;
};

/* pdfjs will not LOAD without DOMMatrix, and the serverless runtime has none.

   The legacy build ends with `const SCALE_MATRIX = new DOMMatrix()` at module
   scope, so the reference is evaluated the moment the module is imported —
   this is an import-time crash, not a rendering one. pdfjs's own answer is to
   borrow the class from `@napi-rs/canvas`, which is an OPTIONAL dependency of
   pdfjs-dist: npm installs it on a developer's machine, and Vercel does not
   trace it into the function. That is the whole difference between "opens in
   one line locally" and "That PDF couldn't be opened" in production — and it
   is why the fixture test passed while the feature was broken. That test now
   runs against these globals too.

   THE STUB IS HONEST BECAUSE NOTHING IS DRAWN. Every real use of DOMMatrix in
   that build sits behind the canvas rendering path — `getTextContent` reads
   the text layer and never touches one. So the class only has to EXIST, and
   pretending otherwise (shipping a 40 MB native canvas to a function that
   reads text) would cost more than it buys. Methods return `this` so that if
   anything ever does reach for one, it degrades instead of throwing.

   Assigned before the dynamic import, and only when absent: pdfjs checks
   `globalThis.DOMMatrix` first and skips the canvas lookup entirely, so a
   machine that HAS the real thing keeps using it. */
function ensurePdfGlobals() {
  const g = globalThis as unknown as Record<string, unknown>;

  if (!g.DOMMatrix) {
    class DOMMatrixStub {
      a = 1;
      b = 0;
      c = 0;
      d = 1;
      e = 0;
      f = 0;
      constructor(init?: number[] | string) {
        if (Array.isArray(init) && init.length >= 6) {
          [this.a, this.b, this.c, this.d, this.e, this.f] = init as number[];
        }
      }
      translate() { return this; }
      scale() { return this; }
      invertSelf() { return this; }
      multiplySelf() { return this; }
      preMultiplySelf() { return this; }
      transformPoint(p: unknown) { return p; }
    }
    g.DOMMatrix = DOMMatrixStub;
  }

  if (!g.Path2D) {
    class Path2DStub {
      addPath() {}
      moveTo() {}
      lineTo() {}
      closePath() {}
    }
    g.Path2D = Path2DStub;
  }
}

export async function openPdf(bytes: Uint8Array): Promise<PdfDoc> {
  ensurePdfGlobals();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  /* Both options are about the absent DOM: nothing is being drawn, so fonts
     are never installed, and pdfjs's warnings would otherwise fill the function
     logs with font complaints for every page of every manual.

     There is deliberately no `isEvalSupported: false` here even though it is
     the obvious thing to want on a customer-uploaded file. pdfjs 6 REMOVED the
     option along with the eval-based font compiler it guarded — the string
     appears nowhere in the shipped build — so passing it is a no-op the types
     correctly reject. Nothing here evaluates anything from the PDF. */
  const task = pdfjs.getDocument({
    data: bytes,
    disableFontFace: true,
    verbosity: 0,
  });
  const doc = await task.promise;

  return {
    numPages: doc.numPages,
    async pageText(n: number) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      return content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/[ \t]+/g, " ")
        .trim();
    },
    /* destroy() lives on the LOADING TASK, not on the document proxy the
       promise resolves to — calling it on the doc is a TypeError at runtime,
       and leaking it holds the parsed file in memory for the rest of the
       invocation. */
    destroy: () => task.destroy(),
  };
}

/** True when a page's text layer gave us nothing worth indexing. */
export function isScannedPage(text: string): boolean {
  return text.trim().length < MIN_TEXT_CHARS;
}

export type PageWindow = { from: number; to: number; count: number };

/* Which pages this request reads: from the bookmark, at most `batch`, never
   past the end, and never more than the org's remaining allowance. Pure, so
   the arithmetic that decides how much of a manual gets billed is testable
   without a PDF. Returns count 0 when there is nothing left to do. */
export function pageWindow(
  nextPage: number,
  numPages: number,
  batch: number = PAGE_BATCH,
  allowance: number = Infinity
): PageWindow {
  const from = Math.max(1, Math.trunc(nextPage));
  const last = Math.trunc(numPages);
  if (!Number.isFinite(last) || from > last) return { from, to: from - 1, count: 0 };

  const room = Math.max(0, Math.min(batch, allowance));
  const to = Math.min(last, from + room - 1);
  return { from, to, count: Math.max(0, to - from + 1) };
}
