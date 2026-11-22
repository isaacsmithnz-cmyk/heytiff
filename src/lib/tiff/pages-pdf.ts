import "server-only";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

/* A PAPER MANUAL, PHOTOGRAPHED PAGE BY PAGE ON THE PHONE, AS ONE PDF (Isaac,
   23 November 2026: "if you have a paper manual in front of you ... snap each
   page the same way in the jobs, then you review the photos afterwards ...
   then it gets put through the reader and processed the same way"; "Photos
   for now" to keeping them as taken, no cropping or straightening).

   One page a photo, in the order they were taken, each turned the way the
   phone held it and shrunk to what a page needs: 2000 px on its long side is
   small print still readable to the vision read, and twenty of them come to a
   few MB where the camera's own would be fifty. A page is the photo's shape,
   595 points wide (an A4 page's width), so nothing is cropped or stretched. */

/** The long side a page is kept at, in pixels. */
export const PAGE_LONG_PX = 2000;
/** A page's width in points: an A4 page's. */
const PAGE_WIDTH_PT = 595;

/** Stamped on the PDF, so the file says where it came from. */
export const PHOTOGRAPHED = "Pages photographed on the phone";

export async function pagesToPdf(photos: readonly Uint8Array[], title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setSubject(PHOTOGRAPHED);
  doc.setProducer("HeyTiff");
  doc.setCreator("HeyTiff");
  for (const photo of photos) {
    const jpg = await sharp(photo)
      .rotate()
      .resize({ width: PAGE_LONG_PX, height: PAGE_LONG_PX, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer();
    /* its own bytes, not sharp's Buffer: pdf-lib checks what it is given */
    const image = await doc.embedJpg(Uint8Array.from(jpg));
    const height = (PAGE_WIDTH_PT * image.height) / image.width;
    const page = doc.addPage([PAGE_WIDTH_PT, height]);
    page.drawImage(image, { x: 0, y: 0, width: PAGE_WIDTH_PT, height });
  }
  return doc.save();
}
