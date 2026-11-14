/* A PHOTO'S SQUARE, small (Isaac, 13 November 2026: swiping job 2043's photos,
   then the job card itself, lagged; every square on the phone was the photo's
   full original, 89 of them, about 89 MB, all fetched the moment the card
   opened). The squares are drawn from a small copy Supabase makes of the
   stored photo (an 8.9 MB one came back 3.5 KB); the full photo is only
   fetched when one is opened.

   Pure: where a signed link's file is, and the size asked for. */

/** The square's size in pixels: a 112-point square on a 3x screen, and the grid's. */
export const THUMB = { width: 360, height: 360, resize: "cover" as const, quality: 60 };

/** The stored file a signed link points at, in its bucket: ".../storage/v1/object/sign/<bucket>/<path>?token=…" → path. Null for anything else. */
export function signedPath(url: string | null | undefined, bucket: string): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const head = `/storage/v1/object/sign/${bucket}/`;
  if (!u.pathname.startsWith(head)) return null;
  const path = u.pathname.slice(head.length);
  if (!path) return null;
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}
