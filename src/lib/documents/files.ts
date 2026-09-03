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

/* `receipt` and `fuel_receipt` are deliberately TWO kinds, not one with a
   flag. A docket is adopted by exactly one owner — an expense claim or a
   vehicle log — and the kind is what stops the wrong one claiming it. Merged,
   a fuel docket could be attached to a reimbursement claim and the same
   $158.40 would land in the tax export twice, once as fuel and once as a
   staff expense. Two kinds makes that a type error instead of a discrepancy
   somebody finds in June. */
/* `medical_certificate` is its own kind for the same reason `receipt` and
   `fuel_receipt` are two: the kind is what stops the wrong owner claiming a
   file. It is also the most sensitive thing this bucket holds — health
   information about one named person — so it is worth being able to say, of
   any row, that it is one, without opening it. */
export type DocumentKind =
  | "notice_attachment"
  | "receipt"
  | "fuel_receipt"
  | "medical_certificate"
  | "licence"
  | "work_rights"
  | "org_logo"
  | "staff_photo"
  | "project_file"
  /* A cached copy of a file that lives in ServiceM8. Its own kind because it
     is the only one nobody here uploaded: it is re-fetchable, it is deleted
     when the grant is, and it must never be adoptable by a claim or a notice
     the way a receipt is. */
  | "job_file"
  /* The invoice or receipt behind a vehicle's purchase price. Its own kind for
     the standing reason: an expense claim must not be able to adopt the van's
     purchase paperwork and land a $45,000 vehicle in someone's
     reimbursements. Owned by the VEHICLE (documents.vehicle_id), not a log. */
  | "purchase_invoice"
  /* Renewal paperwork. Three kinds, not one "renewal" with a flag, for the
     standing reason — and because they land on different expiry dates. Each
     upload is a NEW document: the newest is current and the ones under it are
     the history, so nothing is ever overwritten.

     A green slip is its own kind rather than a second insurance policy. It is
     CTP — the cover the state makes you carry to be registered — and it runs
     to its own date on its own certificate, from an insurer who is not
     necessarily the comprehensive one. Filing it as `insurance_policy` would
     silently retire the comprehensive expiry the fleet actually warns on. */
  | "insurance_policy"
  | "rego_notice"
  | "green_slip"
  /* The photo on a vehicle's card. Its own kind so nothing else can adopt a
     picture of a van as a receipt, and so the card can find its photo by kind
     rather than by guessing which image among the paperwork is the vehicle. */
  | "vehicle_photo"
  /* The finance agreement behind a vehicle's repayments. Its own kind for the
     standing reason — a loan contract must not be adoptable as a receipt —
     and so the Financials screen can file it under the agreement it states. */
  | "finance_agreement"
  | "other";

export const DOCUMENT_KINDS: readonly DocumentKind[] = [
  "notice_attachment",
  "receipt",
  "fuel_receipt",
  "medical_certificate",
  "licence",
  "work_rights",
  "org_logo",
  "staff_photo",
  "project_file",
  "job_file",
  "purchase_invoice",
  "insurance_policy",
  "rego_notice",
  "green_slip",
  "vehicle_photo",
  "finance_agreement",
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
