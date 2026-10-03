/* The library's own front door for uploads — what may go in, and where.

   Pure, and deliberately separate from lib/documents/files.ts even though the
   shape is the same. That module's bucket is capped at 10 MB and its type list
   is built around notice photos; a manufacturer's install manual is routinely
   30 MB of PDF. Two different answers to "is this allowed", so two modules
   rather than a kind that has to opt out of every rule.

   THE PATH CARRIES THE ORG, exactly as it does over there: every key begins
   `org/<org_id>/`, so a stray reference is rejected by looking at it instead of
   trusting the id that arrived with the request. */

import { fmtBytes } from "@/lib/documents/files";

export const KB_BUCKET = "kb";

/** 50 MB, for everybody who can upload. */
export const MAX_KB_BYTES = 50 * 1024 * 1024;

/* A LARGE DOCUMENT — a manufacturer's whole data book runs past 100 MB (the
   2024 M-S-P book is 131 MB, 1,015 pages). Owners may bring one in up to
   150 MB, twice a month for the org (Isaac, 2026-09-30: "a normal limit of
   50 megabytes and then up to 100 and something, once or twice a month").
   The bucket enforces the 150; the two a month is counted from the
   documents that actually landed (large.ts). */
export const MAX_KB_LARGE_BYTES = 150 * 1024 * 1024;
export const KB_LARGE_PER_MONTH = 2;

/** What this person may bring in over 50 MB: null when they can't at all
    (not an owner), else how many are left this month and when that resets
    (ISO yyyy-mm-01, the AU month after). */
export type KbLargeAllowance = { left: number; resetsOn: string } | null;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "1 November" from yyyy-mm-01 */
export function fmtResets(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m || 1) - 1]}`;
}

/* v1 reads PDF text layers. Nothing else is accepted — not because DOCX is
   hard, but because a half-supported format in the library is a document that
   silently never answers a question. */
export const KB_MIME = "application/pdf";

/* The categories are product structure: they colour the cards, filter the
   library and scope a search, and the DB carries the same CHECK. The UI's
   labels/colours for them live in components/tiff/kb.ts — this is the list the
   server validates against, so a route can't invent one.

   `field` is the fifth (2026-08-06) and the odd one out on purpose: nobody
   UPLOADS into it. Its documents are field notes — crew knowledge published
   from the note widget's review card — so `checkKbUpload` below still takes
   PDFs only, and the upload drawer never offers it. */
export type KbCategory = "install" | "faults" | "specs" | "sops" | "field";

export const KB_CATEGORIES: readonly KbCategory[] = ["install", "faults", "specs", "sops", "field"];

export function asKbCategory(value: unknown): KbCategory | null {
  return KB_CATEGORIES.includes(value as KbCategory) ? (value as KbCategory) : null;
}

export type KbUploadCheck = { ok: true } | { ok: false; error: string };

/** Decide whether a file may be stored, before any slot is handed out.
    `large` is what this person may bring in over 50 MB (null: nothing). */
export function checkKbUpload(file: { type: string; size: number }, large: KbLargeAllowance = null): KbUploadCheck {
  if (String(file.type).toLowerCase().split(";")[0].trim() !== KB_MIME)
    return { ok: false, error: "The library takes PDFs only." };
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, error: "That file is empty." };
  if (file.size > MAX_KB_LARGE_BYTES)
    return { ok: false, error: `That file is too big — ${fmtBytes(MAX_KB_LARGE_BYTES)} is the most the library takes.` };
  if (file.size > MAX_KB_BYTES) {
    if (!large)
      return {
        ok: false,
        error: `That file is too big — ${fmtBytes(MAX_KB_BYTES)} is the limit. An owner can add one up to ${fmtBytes(MAX_KB_LARGE_BYTES)}.`,
      };
    if (large.left <= 0)
      return {
        ok: false,
        error: `That's over ${fmtBytes(MAX_KB_BYTES)}, and this month's ${KB_LARGE_PER_MONTH} large uploads are used. More from ${fmtResets(large.resetsOn)}.`,
      };
  }
  return { ok: true };
}

/** Is this a large upload (one of the two a month)? */
export const isLargeKb = (size: number): boolean => size > MAX_KB_BYTES;

/* The object key. The document id is already unique, so the file's own name is
   never part of the path — it is a label, kept in the row, not an address. */
export function kbStorageRef(orgId: string, documentId: string): string {
  return `org/${orgId}/kb/${documentId}.pdf`;
}

/** True when a stored reference really belongs to this org. */
export function kbRefIsOrgs(ref: string, orgId: string): boolean {
  return ref.startsWith(`org/${orgId}/`);
}

/** A title safe to store and show — trimmed, capped, never empty. */
export function kbTitle(name: string): string {
  const clean = String(name ?? "").trim().replace(/[\r\n\t]/g, " ");
  if (!clean) return "Untitled";
  return clean.length > 160 ? `${clean.slice(0, 157)}…` : clean;
}
