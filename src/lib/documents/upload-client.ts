"use client";

import { beginUpload, confirmUpload } from "@/app/actions/documents";
import { checkUpload, type DocumentKind } from "./files";

/* The browser half of an upload.

   Three steps, and the bytes only ever touch the middle one: ask the server for
   a signed slot, PUT the file straight to storage, tell the server it landed.
   Nothing large crosses a server action, so there is no body-size ceiling to
   run into and no 10 MB photo buffered in the Node process.

   The same flow the floor-plan storage uses; this is the shared version. */

export type UploadedFile = {
  documentId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** An object URL for previewing an image before the page reloads. */
  previewUrl: string | null;
};

export type UploadOutcome =
  | { ok: true; file: UploadedFile }
  | { ok: false; error: string };

export async function uploadFile(file: File, kind: DocumentKind): Promise<UploadOutcome> {
  // check here too, so an obviously-wrong file is refused instantly rather
  // than after a round trip — the server decides for real either way
  const local = checkUpload({ name: file.name, type: file.type, size: file.size });
  if (!local.ok) return { ok: false, error: local.error };

  const slot = await beginUpload({
    kind,
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  });
  if (!slot.ok) return { ok: false, error: slot.error };

  const { supabaseBrowser } = await import("@/lib/supabase-browser");
  const { error } = await supabaseBrowser()
    .storage.from(slot.bucket)
    .uploadToSignedUrl(slot.ref, slot.token, file, { contentType: file.type });
  // an unconfirmed row is invisible everywhere, so a failure here needs no
  // cleanup — it simply never becomes a file anybody can see
  if (error) return { ok: false, error: "That upload didn't finish." };

  const done = await confirmUpload(slot.documentId);
  if (!done.ok) return { ok: false, error: done.error };

  return {
    ok: true,
    file: {
      documentId: slot.documentId,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    },
  };
}
