/* FITTING A LOGO TO WHAT IT WILL BE PRINTED ON — the browser half.

   `fitLogo` (logo-fit.ts) says where the mark is and what its ink is; this reads
   the picked file into a canvas, asks it, cuts the empty margin and any white
   box away, and hands back the file to upload and the tone to store.

   FAIL SOFT, AND THAT IS NOT A SHORTCUT. Anything that goes wrong here — a
   browser without createImageBitmap, a file the decoder refuses, a canvas the
   page may not read — returns the ORIGINAL file and no tone, which is exactly
   what the app did before logos were measured. An upload must never be lost to
   a nicety, and a logo with no tone is drawn the way every logo always was.

   Downscaled to a ceiling because a logo is never drawn above ~300px wide, so
   the 3780px artwork a designer exports is eleven times the pixels any surface
   can use, and the page's own limit on a file is 10MB. */

import { fitLogo } from "./logo-fit";
import type { LogoTone } from "./logo-fit";

/** the longest side the stored logo keeps */
export const LOGO_MAX_SIDE = 1600;

export type PreparedLogo = {
  file: File;
  /** null when the file could not be measured */
  tone: LogoTone | null;
};

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

export async function prepareLogo(file: File): Promise<PreparedLogo> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, LOGO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { file, tone: null };
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const image = ctx.getImageData(0, 0, w, h);
    const fit = fitLogo({ data: image.data, width: w, height: h });
    if (!fit) return { file, tone: null };

    // already tight, already transparent, and not too big: the original bytes
    // are the right file, so it is not re-encoded
    if (fit.unchanged && scale === 1) return { file, tone: fit.tone };

    if (fit.clear) {
      for (let i = 0; i < fit.clear.length; i++) if (fit.clear[i]) image.data[i * 4 + 3] = 0;
    }
    const out = document.createElement("canvas");
    out.width = fit.box.w;
    out.height = fit.box.h;
    const outCtx = out.getContext("2d");
    if (!outCtx) return { file, tone: fit.tone };
    // the dirty rectangle IS the crop: only the box is drawn, offset back to the origin
    outCtx.putImageData(image, -fit.box.x, -fit.box.y, fit.box.x, fit.box.y, fit.box.w, fit.box.h);

    const blob = await toBlob(out);
    if (!blob) return { file, tone: fit.tone };
    return { file: new File([blob], "logo.png", { type: "image/png" }), tone: fit.tone };
  } catch {
    return { file, tone: null };
  }
}
