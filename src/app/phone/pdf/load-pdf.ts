import type { PDFDocumentProxy } from "pdfjs-dist";

/* Opening a stored manual a piece at a time. Storage answers a byte range
   and says the file's length to a page on another host, but keeps the
   headers pdf.js reads to find that out to itself, so pdf.js left alone
   would fetch all 14 MB before page 1. Asked for the length once, it reads
   only the pieces of the file the pages on screen need: the first page
   shows in a second or two on a phone's signal. */

type Pdfjs = typeof import("pdfjs-dist");
let lib: Promise<Pdfjs> | null = null;

/** pdf.js, loaded once, with its worker beside it: the legacy build, which an older phone's web view reads too. */
function pdfjs(): Promise<Pdfjs> {
  lib ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
    return m as Pdfjs;
  });
  return lib;
}

/** The manual behind a signed storage link, read in 256 KB pieces as its pages are drawn. */
export async function openSigned(url: string, onLost: () => void): Promise<PDFDocumentProxy> {
  const m = await pdfjs();
  const head = await fetch(url, { method: "HEAD" });
  const length = Number(head.headers.get("content-length"));
  if (!head.ok || !(length > 0)) throw new Error("The manual couldn't be read.");
  const range = new m.PDFDataRangeTransport(length, null);
  range.requestDataRange = (begin: number, end: number) => {
    void fetch(url, { headers: { Range: `bytes=${begin}-${end - 1}` } })
      .then(async (r) => {
        if (r.status !== 206 && r.status !== 200) throw new Error(String(r.status));
        /* a store that sends the whole file for a range has sent it from the start */
        range.onDataRange(r.status === 200 ? 0 : begin, new Uint8Array(await r.arrayBuffer()));
      })
      .catch(onLost);
  };
  return m.getDocument({ range, rangeChunkSize: 262_144, disableAutoFetch: true, disableStream: true }).promise;
}
