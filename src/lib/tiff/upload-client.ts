"use client";

import { beginKbUpload, confirmKbUpload } from "@/app/actions/kb";
import { checkKbUpload } from "./files";

/* The browser half of putting a manual in the library.

   Three steps, and the bytes only ever touch the middle one: ask the server
   for a signed slot, PUT the PDF straight to the private `kb` bucket, tell the
   server it landed. The same shape as lib/documents/upload-client.ts, and for
   a stronger reason here — a 40 MB manual has no chance of crossing a server
   action body.

   THE CONTENT TYPE IS PINNED, not taken from the File. The bucket only accepts
   application/pdf, and a browser that reports an empty or vendor-specific type
   for a PDF would otherwise be refused by storage after the upload has already
   started. checkKbUpload has already insisted it IS a PDF by then. */

export type KbUploadMeta = {
  title: string;
  category: string;
  source?: string;
  edition?: string;
};

export type KbUploadOutcome =
  | { ok: true; documentId: string }
  | { ok: false; error: string };

export async function uploadKbFile(file: File, meta: KbUploadMeta): Promise<KbUploadOutcome> {
  // checked here so an obviously-wrong file is refused instantly rather than
  // after a round trip; beginKbUpload decides for real either way
  const local = checkKbUpload({ type: file.type, size: file.size });
  if (!local.ok) return { ok: false, error: local.error };

  const slot = await beginKbUpload({
    title: meta.title,
    category: meta.category,
    source: meta.source,
    edition: meta.edition,
    mime: file.type,
    sizeBytes: file.size,
  });
  if (!slot.ok) return { ok: false, error: slot.error };

  const { supabaseBrowser } = await import("@/lib/supabase-browser");
  const { error } = await supabaseBrowser()
    .storage.from(slot.bucket)
    .uploadToSignedUrl(slot.ref, slot.token, file, { contentType: "application/pdf" });
  /* An unconfirmed row is invisible in every read (`uploaded_at` stays null),
     so a failure here needs no cleanup — it simply never becomes a document
     anybody can see. */
  if (error) return { ok: false, error: "That upload didn't finish." };

  const done = await confirmKbUpload(slot.documentId);
  if (!done.ok) return { ok: false, error: done.error };

  return { ok: true, documentId: slot.documentId };
}
