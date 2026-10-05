import "server-only";
import { isSendableImage } from "@/lib/workboard/photo-reading";

/* A PHOTO, READY FOR CLAUDE'S IMAGE BLOCK — shared by the photo bank's
   reader (actions/photo-readings) and the rating-plate reader
   (workboard/plate-read-server). Server only: sharp is a native binary. */

/** The longest edge we send — the API's OWN ceiling, not a number we picked.
    Anything larger is downscaled server-side before the model sees it, so
    resizing to 1568 costs nothing in quality while cutting the bytes on the
    wire and the tokens billed (full-size measured 5,497 input tokens for one
    2016x1512 photo).

    1024 WAS TEMPTING AND IS THE WRONG CALL. It measured 1,624 tokens on the
    same photograph and still read the model number — but that was a rating
    plate FILLING the frame. Small text in a wide shot is precisely what a
    self-inflicted downscale destroys, and transcribing small text is now the
    whole point of this. Never shrink past what the reader needs to read. */
export const MAX_EDGE = 1568;

/** Get the bytes into something the image block will take.

    RE-ENCODING TO JPEG IS WHAT MAKES AVIF READABLE. Claude's image block
    accepts four types and AVIF is not one of them, but 399 of the account's
    photos are AVIF — before this they would have been recorded as unreadable.
    sharp decodes them and hands over a JPEG.

    THE FALLBACK IS THE ORIGINAL, NEVER A FAILED READING. sharp is a native
    binary and it arrived here as a transitive dependency of Next — it is a
    direct one now, but if it ever fails to load, the honest move is to send
    the bytes we have and pay a few tokens more, not to quietly mark every
    photograph in the workspace as unreadable. That failure would have looked
    exactly like "the reader doesn't work" with nothing in any log. */
export async function imageForClaude(
  bytes: Buffer,
  /** The row's stored mime — NOT derived from the name, which in this mirror
      is the extensionless string `Photo` for every photograph there is. */
  storedMime: string | null
): Promise<{ bytes: Buffer; mime: "image/jpeg" | "image/png" | "image/webp" | "image/gif" } | null> {
  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(bytes)
      .rotate() // honour EXIF orientation, or a portrait plate arrives sideways
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { bytes: out, mime: "image/jpeg" };
  } catch (e) {
    console.error("[images] could not re-encode, sending as-is:", e);
    /* Only the four the block actually accepts. An AVIF with no sharp to
       decode it has nowhere to go, and says so by being unreadable. */
    if (isSendableImage(storedMime)) return { bytes, mime: storedMime };
    return null;
  }
}
