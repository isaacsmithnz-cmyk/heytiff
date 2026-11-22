/**
 * @jest-environment node
 */
jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import { PDFDocument, StandardFonts } from "pdf-lib";
import { fitted } from "../reading-server";

/* A SET IS CUT TO WHAT FITS BESIDE ITS IMAGES, by what is sent: base64, four
   characters for every three bytes. A made-up set of numbered sheets, each a
   different width so the pages kept can be told apart. */

async function set(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const pg = doc.addPage([600 + i, 400]);
    for (let l = 0; l < 30; l++) pg.drawText(`Sheet A${100 + i}, line ${l}: ${"general notes ".repeat(5)}`, { x: 10, y: 380 - l * 12, size: 8, font });
  }
  return Buffer.from(await doc.save());
}
const sent = (b: Buffer) => b.toString("base64").length;
const widths = async (b: Buffer) => (await PDFDocument.load(b)).getPages().map((p) => p.getWidth() - 600);
const inOrder = (total: number) => Array.from({ length: total }, (_, i) => i);

describe("a drawing set, as it can be sent", () => {
  it("goes whole when it fits", async () => {
    const pdf = await set(8);
    expect(await fitted(pdf, sent(pdf), inOrder, 4, "too large")).toBe(pdf);
  });

  it("is cut when its base64 is over the room, though its bytes are under it, keeping the pages its order puts first", async () => {
    const pdf = await set(8);
    const room = pdf.byteLength + 10;
    const out = await fitted(pdf, room, inOrder, 4, "too large");
    expect(sent(out)).toBeLessThanOrEqual(room);
    const kept = await widths(out);
    expect(kept.length).toBeGreaterThanOrEqual(4);
    expect(kept.length).toBeLessThan(8);
    expect(kept).toEqual(inOrder(kept.length));
    /* the order decides what goes, and the pages keep the set's own order */
    const last = await widths(await fitted(pdf, room, (t) => inOrder(t).reverse(), 4, "too large"));
    expect(last).toEqual(inOrder(8).slice(8 - last.length));
  });

  it("says it is too large when even its fewest pages don't fit", async () => {
    const pdf = await set(8);
    await expect(fitted(pdf, 1000, inOrder, 4, "The drawing set is too large to read the roof from")).rejects.toThrow("too large to read the roof");
    await expect(fitted(pdf, -5, inOrder, 1, "too large")).rejects.toThrow("too large");
  });
});
