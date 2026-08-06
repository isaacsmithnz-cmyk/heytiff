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

/** 50 MB. The bucket enforces the same number. */
export const MAX_KB_BYTES = 50 * 1024 * 1024;

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

/** Decide whether a file may be stored, before any slot is handed out. */
export function checkKbUpload(file: { type: string; size: number }): KbUploadCheck {
  if (String(file.type).toLowerCase().split(";")[0].trim() !== KB_MIME)
    return { ok: false, error: "The library takes PDFs only." };
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, error: "That file is empty." };
  if (file.size > MAX_KB_BYTES)
    return { ok: false, error: `That file is too big — ${fmtBytes(MAX_KB_BYTES)} is the limit.` };
  return { ok: true };
}

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
