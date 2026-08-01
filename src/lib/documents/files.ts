/* The documents track — what may be stored, and where it goes.

   Pure, and deliberately NOT about notices. Photos on a noticeboard post are
   the first caller, but expense receipts, licence scans, work-rights evidence
   and the org logo are the same problem: bytes in a bucket, and a row saying
   whose they are and what they're for. The rules about size, type and path live
   here once, so there is one answer rather than one per feature.

   THE PATH CARRIES THE ORG. Every object key begins `org/<org_id>/`, which
   means a stray reference can be rejected by looking at it — the same check the
   floor-plan storage already makes — instead of trusting whatever id came in
   with the request. */

export type DocumentKind =
  | "notice_attachment"
  | "receipt"
  | "licence"
  | "work_rights"
  | "org_logo"
  | "staff_photo"
  | "project_file"
  | "other";

export const DOCUMENT_KINDS: readonly DocumentKind[] = [
  "notice_attachment",
  "receipt",
  "licence",
  "work_rights",
  "org_logo",
  "staff_photo",
  "project_file",
  "other",
];

export function asDocumentKind(value: unknown): DocumentKind | null {
  return DOCUMENT_KINDS.includes(value as DocumentKind) ? (value as DocumentKind) : null;
}

/* What the bucket will take. Photos of a job and a PDF of an invoice cover
   everything asked for so far; anything else is a "no" with a reason rather
   than a silent failure halfway through an upload. The bucket carries the same
   list, so a client that skips this check still can't get past storage. */
export const ALLOWED_TYPES: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

/** 10 MB. A phone photo is 2–5; a scanned multi-page PDF is the outlier this
    is sized for. The bucket enforces the same number. */
export const MAX_BYTES = 10 * 1024 * 1024;

/** How many files may hang off a single notice. */
export const MAX_NOTICE_FILES = 6;

export type UploadCheck =
  | { ok: true; ext: string }
  | { ok: false; error: string };

/** Decide whether a file may be stored, before any slot is handed out. */
export function checkUpload(file: { name: string; type: string; size: number }): UploadCheck {
  const ext = ALLOWED_TYPES[file.type.toLowerCase()];
  if (!ext) return { ok: false, error: "That file type isn't allowed — photos and PDFs only." };
  if (file.size <= 0) return { ok: false, error: "That file is empty." };
  if (file.size > MAX_BYTES)
    return { ok: false, error: `That file is too big — ${fmtBytes(MAX_BYTES)} is the limit.` };
  if (!file.name.trim()) return { ok: false, error: "That file has no name." };
  return { ok: true, ext };
}

export function isImage(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith("image/");
}

/* The object key. The id is already unique, so the name is never part of the
   path — a file called "../../secrets" can't become one, and two people
   uploading "photo.jpg" don't collide. The original name is kept in the row,
   which is where it belongs: it's a label, not an address. */
export function storageRef(orgId: string, kind: DocumentKind, documentId: string, ext: string): string {
  return `org/${orgId}/${kind}/${documentId}.${ext}`;
}

/** True when a stored reference really belongs to this org. */
export function refIsOrgs(ref: string, orgId: string): boolean {
  return ref.startsWith(`org/${orgId}/`);
}

/** A file name safe to show — trimmed, capped, and never empty. */
export function displayName(name: string): string {
  const clean = name.trim().replace(/[\r\n\t]/g, " ");
  if (!clean) return "Untitled";
  return clean.length > 80 ? `${clean.slice(0, 77)}…` : clean;
}

/** "2.4 MB" — sizes as people read them. */
export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
