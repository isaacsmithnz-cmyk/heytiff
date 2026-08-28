/* What a ServiceM8 attachment IS, and whether we may hold a copy of it —
   pure, client-safe, and decided by the file's OWN extension rather than
   anything we hope is true about it.

   WHY EXTENSION AND NOT `photo_width`. The mirror carries photo_width and
   photo_height and they look like an "is this an image?" test. They are not
   one, in two separate ways, both counted against the live account rather
   than assumed (24,999 rows, 2026-08-14):

     - `photo_width` is NEVER NULL. Not one row. ServiceM8 sends 0 as its
       sentinel, so 4,213 rows — every one of the 4,134 PDFs among them —
       carry a real zero. Any test of the form `photo_width is not null`
       matches the ENTIRE TABLE and quietly decides nothing.
     - `photo_width > 0` does discriminate, but it means HAS PIXELS, which
       is images AND video: 506 of 523 .mp4 rows clear it. Grouping on it
       drops half a thousand unplayable videos into the photo grid.

   So there is no dimensions test that means "photo". `file_type` is what
   the file actually is; it arrives lowercase with the leading dot ('.jpg'),
   which is ServiceM8's own documented shape. (Both halves of this were
   found the same day by two sessions checking each other's assumptions
   against prod — the sentinel half by the one that owns the probe.)

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

/** How many of a job's files one read carries, and what the sheet says when
    it binds. It lives in THIS module, not beside the query that enforces it,
    because the sheet is a client component and the query module imports
    supabaseAdmin — a value import from there would drag the server client
    into the browser bundle. Types are erased and may cross; constants may
    not. */
export const JOB_MEDIA_CAP = 120;

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

/* ── where a file came from, in ServiceM8's own words ── */

/** `attachment_source` is ServiceM8's tag for a file's origin. Three values
    earn a chip because each changes what the file MEANS to a reader:

      INVOICE / QUOTE   the paperwork rather than the work
      InboxMessage      it arrived by EMAIL and was filed against the job —
                        somebody sent this in, it wasn't produced on site.
                        1,150 of them in the live account, 283 of those PDFs
                        on jobs, which is what makes it worth a chip at all.

    Everything else is left unlabelled. The live account also carries
    WORK_ORDER, PHOTO_MARKUP, INVOICE_SIGNOFF, IMAGINE, DOCUMENT and
    SERVICE_QUESTION_CHOICE — each a one-line addition here if it ever earns
    one, and none of them guessed at in the meantime.

    CASE IS NOT CONSISTENT ON THE WIRE. Photos alone arrive as `Photo`,
    `PHOTO`, `PHOTO_LIBRARY` and `PHOTO_LIBRARY_ON_CHECKOUT`; `InboxMessage`
    is the only camel-cased source. Compare upper-cased, always. */
export function originLabel(source: string | null | undefined): string | null {
  const s = typeof source === "string" ? source.trim().toUpperCase() : "";
  if (s === "INVOICE") return "Invoice";
  if (s === "QUOTE") return "Quote";
  if (s === "INBOXMESSAGE") return "Emailed in";
  return null;
}

/* ── one job's media, grouped the way the sheet shows it ── */

export type JobMediaItem = {
  /** The ServiceM8 attachment uuid — the dedupe key for a cached copy. */
  remoteId: string;
  name: string;
  fileType: string | null;
  kind: JobMediaKind;
  /** "Invoice" | "Quote" | "Emailed in" | null — see originLabel. */
  origin: string | null;
  /** Naive local stamp from ServiceM8, or null. */
  takenAt: string | null;
  /** A signed URL when the bytes are cached here, null while they aren't. */
  url: string | null;
  /** The job NUMBER of the progress claim this file was filed against, when
      it wasn't filed against the job itself ("2380A"). ServiceM8 clones a job
      to bill it in stages, and a photo taken on site lands on whichever clone
      happened to be open — 622 of them live. The photo is about the work, so
      it rises to the job; this says where it came from, which is also how
      anyone would ever notice one filed against the wrong invoice. */
  fromClaim: string | null;
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
