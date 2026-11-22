import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { PAGE_LONG_PX, PHOTOGRAPHED, pagesToPdf } from "../pages-pdf";

/* A paper manual photographed on the phone (23 November 2026): one page a
   photo, in the order taken, the photo's own shape, shrunk. */
const photo = (width: number, height: number, r: number) =>
  sharp({ create: { width, height, channels: 3, background: { r, g: 200, b: 200 } } }).jpeg().toBuffer().then((b) => new Uint8Array(b));

describe("photographed pages as one PDF", () => {
  it("makes a page of each photo, in order, each the photo's shape", async () => {
    const bytes = await pagesToPdf([await photo(300, 400, 10), await photo(400, 300, 20), await photo(3000, 4000, 30)], "Old manual");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(3);
    const [a, b, c] = pdf.getPages().map((p) => p.getSize());
    expect(a!.width).toBe(595);
    expect(a!.height).toBeCloseTo((595 * 4) / 3, 3);
    expect(b!.height).toBeCloseTo((595 * 3) / 4, 3);
    expect(c!.height).toBeCloseTo((595 * 4) / 3, 0);
    expect(pdf.getTitle()).toBe("Old manual");
    expect(pdf.getSubject()).toBe(PHOTOGRAPHED);
  });

  it("shrinks a camera photo to the page's long side", async () => {
    const big = await pagesToPdf([await photo(3000, 4000, 30)], "x");
    const small = await pagesToPdf([await photo(PAGE_LONG_PX * 0.75, PAGE_LONG_PX, 30)], "x");
    expect(Math.abs(big.byteLength - small.byteLength)).toBeLessThan(small.byteLength * 0.2);
  });
});
