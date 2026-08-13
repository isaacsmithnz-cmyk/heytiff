/* What a ServiceM8 attachment IS, and whether we may hold a copy of it —
   pure, client-safe, and decided by the file's OWN extension rather than
   anything we hope is true about it.

   WHY EXTENSION AND NOT `photo_width`. The mirror carries photo_width and
   photo_height, and they are tempting: non-null looks like "this is an
   image". Checked against the live account rather than assumed, and the
   answer is worse than useless — VIDEOS carry dimensions (513 of 530 .mp4
   rows have them), so `photo_width is not null` would drop half a thousand
   unplayable video files into the photo grid. PDFs, for the record, carry
   none at all. The extension is what the file actually is; `file_type`
   arrives lowercase with the leading dot ('.jpg'), which is ServiceM8's own
   documented shape.

   THE FOUR KINDS, and why videos are their own:

     photo     an image we can show, and whose bytes we may cache
     document  a PDF or office file — listed by name, cached only if we can
     video     NEVER cached. The live account holds 535 of them; a job's
               worth of mp4 is measured in hundreds of megabytes against a
               bucket sized in gigabytes, and no screen here plays video.
               It is named and left in ServiceM8, which is an honest handoff
               rather than a copy nobody asked for.
     other     anything unrecognised — named, never fetched.

   THE COUNTS COME FROM THE LIVE ACCOUNT (2026-08-14, attachments whose
   related_object is a job), because a classifier written against imagined
   data is a classifier tested against imagined data: 17,369 .jpg ·
   3,758 .pdf · 675 .png · 528 .mp4 · 7 .mov, then a tail of .txt .htm .xlsx
   .docx .pptx .gif .avif in single figures. The tail is the reason `other`
   exists and the reason nothing here throws. */

export type JobMediaKind = "photo" | "document" | "video" | "other";

/** Extensions we will both SHOW and cache bytes for. */
const PHOTO_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

/* .heic and .avif are images that Chrome will not render in an <img>, so
   they are documents here: named and downloadable, never a broken tile in a
   grid. The live account has 5 .avif and no .heic, but an iPhone left on its
   default settings produces .heic all day, so this is a case that will
   arrive rather than one being invented. */
const UNRENDERABLE_IMAGE_EXTS = new Set([".heic", ".heif", ".avif"]);

const DOCUMENT_EXTS = new Set([
  ".pdf",
  ".txt",
  ".htm",
  ".html",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".csv",
  ...UNRENDERABLE_IMAGE_EXTS,
]);

const VIDEO_EXTS = new Set([".mp4", ".mov", ".m4v", ".avi", ".webm", ".mkv"]);

/** Normalise ServiceM8's file_type to a lowercase dotted extension. Their own
    docs say it is stored that way; this tolerates a missing dot and stray
    case rather than trusting it, because one odd row must not become an
    unclassifiable job. */
export function normaliseFileType(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const dotted = s.startsWith(".") ? s : `.${s}`;
  return /^\.[a-z0-9]{1,8}$/.test(dotted) ? dotted : null;
}

export function jobMediaKind(fileType: string | null | undefined): JobMediaKind {
  const ext = normaliseFileType(fileType);
  if (!ext) return "other";
  if (PHOTO_EXTS.has(ext)) return "photo";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (DOCUMENT_EXTS.has(ext)) return "document";
  return "other";
}

/** May we hold a copy of this file's bytes? Photos and PDFs only — the two
    kinds a job screen actually renders. Everything else is named and left
    where it is, which costs no storage and tells no lies. */
export function isCacheableMedia(fileType: string | null | undefined): boolean {
  const kind = jobMediaKind(fileType);
  if (kind === "photo") return true;
  return normaliseFileType(fileType) === ".pdf";
}

/* ── what a file is FOR, from ServiceM8's own tag ── */

/** `attachment_source` is ServiceM8's word for where a file came from. Two
    values are worth naming on screen because they are the paperwork rather
    than the work: the quote that was sent and the invoice that followed.
    Anything else is left unlabelled — an invented label is worse than none. */
export function paperworkLabel(source: string | null | undefined): string | null {
  const s = typeof source === "string" ? source.trim().toUpperCase() : "";
  if (s === "INVOICE") return "Invoice";
  if (s === "QUOTE") return "Quote";
  return null;
}

/* ── one job's media, grouped the way the sheet shows it ── */

export type JobMediaItem = {
  /** The ServiceM8 attachment uuid — the dedupe key for a cached copy. */
  remoteId: string;
  name: string;
  fileType: string | null;
  kind: JobMediaKind;
  /** "Invoice" | "Quote" | null. */
  paperwork: string | null;
  /** Naive local stamp from ServiceM8, or null. */
  takenAt: string | null;
  /** A signed URL when the bytes are cached here, null while they aren't. */
  url: string | null;
};

export type JobMediaGroups = {
  photos: JobMediaItem[];
  documents: JobMediaItem[];
  /** Videos and unrecognised files — named, never fetched. */
  elsewhere: JobMediaItem[];
};

/** Split one job's attachments into the three things the sheet renders.
    Order is preserved inside each group, so whatever the loader sorted by
    (newest first) survives. */
export function groupJobMedia(items: readonly JobMediaItem[]): JobMediaGroups {
  const groups: JobMediaGroups = { photos: [], documents: [], elsewhere: [] };
  for (const item of items) {
    if (item.kind === "photo") groups.photos.push(item);
    else if (item.kind === "document") groups.documents.push(item);
    else groups.elsewhere.push(item);
  }
  return groups;
}

/** The one line a media section leads with. Says what's there, and stays
    honest when a job has only the paperwork or only the pictures. */
export function mediaCountLine(groups: JobMediaGroups): string {
  const parts: string[] = [];
  const n = (count: number, one: string, many: string) =>
    `${count} ${count === 1 ? one : many}`;
  if (groups.photos.length) parts.push(n(groups.photos.length, "photo", "photos"));
  if (groups.documents.length) parts.push(n(groups.documents.length, "document", "documents"));
  if (groups.elsewhere.length) parts.push(`${groups.elsewhere.length} left in ServiceM8`);
  if (parts.length === 0) return "Nothing attached in ServiceM8";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
