/* Turning a camera roll photo into something a vision model can actually read.

   THE BUG THIS EXISTS FOR. Every scan path in the app used to do the same
   thing: FileReader -> base64 -> straight to Claude. That sends the file's
   ORIGINAL PIXELS, and a phone almost never stores those upright. A camera
   writes the sensor's landscape frame to disk and records how far to turn it
   in an EXIF `Orientation` tag; the gallery, the browser and the <img> in the
   scan preview all honour that tag, so the photo looks right everywhere a
   human sees it. The vision API decodes pixels and ignores the tag — so the
   one reader that mattered was the one getting the form sideways. Found on a
   real QBE green slip shot on a Galaxy (4000x2252, Orientation=6): legible to
   a person on the phone, rotated a quarter turn by the time Tiff saw it.

   THE FIX IS TO BAKE THE ROTATION IN. `createImageBitmap` with
   `imageOrientation: "from-image"` applies the tag, and drawing the result to
   a canvas re-encodes it with the rotation in the pixels and no tag left to
   ignore. The upright copy is what goes to Tiff; the ORIGINAL file is what
   still goes to storage, because the paper we keep for the ATO should be the
   file the camera produced, not our re-encode of it.

   IT ALSO SHRINKS THE PAYLOAD, which is a side effect rather than the point:
   a 12MP phone photo is a few megabytes of base64 for a document whose text
   is legible at a fraction of the size. MAX_EDGE is set well above the
   resolution dense small print needs — the failure mode of downscaling too far
   is a misread figure, and a wrong premium is worse than a slow upload.

   IT NEVER THROWS AND NEVER BLOCKS A SCAN. Every failure — no
   `createImageBitmap`, no 2D context, a codec that won't decode, jsdom under
   test — falls back to the raw bytes, which is exactly what the callers did
   before this file existed. A rotated read is a worse read; no read at all is
   a broken feature. */

/** Base64 payload plus the media type it is actually encoded as. The two
    travel together because re-encoding CHANGES the type: a PNG that came back
    through the canvas is a JPEG, and telling the API otherwise is a 400. */
export type UprightImage = { data: string; mediaType: string };

/* What is worth re-drawing. These are the still formats that carry EXIF and
   that every browser canvas can decode. GIF is deliberately absent: it has no
   orientation tag to apply, and flattening one to a JPEG would throw away the
   animation for no gain. Anything else — a PDF renewal notice, a HEIC, an
   unknown type — passes through untouched. */
const REDRAWABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Longest edge of the image handed to the model, in pixels. */
const MAX_EDGE = 2400;

/** JPEG quality for the re-encode. High: this is small print on paper. */
const QUALITY = 0.92;

/** A file as base64 for the vision API — upright where that can be arranged,
    and byte-for-byte otherwise. Never rejects. */
export async function fileToUprightBase64(file: File): Promise<UprightImage> {
  if (REDRAWABLE.has(file.type)) {
    try {
      const redrawn = await redraw(file);
      if (redrawn) return redrawn;
    } catch {
      /* fall through to the raw bytes — see the header comment */
    }
  }
  return { data: await rawBase64(file), mediaType: file.type };
}

/** The original bytes, base64, no re-encode. The fallback, and the whole story
    for PDFs. */
export function rawBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Decode with the EXIF rotation applied, redraw at a sane size, re-encode.
    Null means "this environment can't", not "this file is bad". */
async function redraw(file: File): Promise<UprightImage | null> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;

  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    if (!bitmap.width || !bitmap.height) return null;
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    /* Paper is white. A JPEG has no alpha channel, so a transparent PNG drawn
       straight onto a fresh canvas comes out with black where the page was. */
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);

    const url = canvas.toDataURL("image/jpeg", QUALITY);
    /* A canvas that couldn't encode returns "data:," — and some environments
       hand back a PNG regardless of what was asked. Trust the prefix, not the
       request, because the media type is what the API validates against. */
    if (!url.startsWith("data:image/jpeg;base64,")) return null;
    const data = url.slice(url.indexOf(",") + 1);
    return data ? { data, mediaType: "image/jpeg" } : null;
  } finally {
    bitmap.close?.();
  }
}
