import "server-only";
import { randomUUID } from "node:crypto";
import { beginKbUpload, confirmKbUpload } from "@/app/actions/kb";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { supabaseAdmin } from "@/lib/supabase-server";
import { KB_BUCKET, kbTitle } from "@/lib/tiff/files";
import { pagesToPdf } from "@/lib/tiff/pages-pdf";
import { actAsPhoneUser, type MobileCtx } from "./auth";
import type { InLibrary } from "./library-from-file";

/* A PAPER MANUAL INTO THE LIBRARY, PAGE BY PAGE FROM THE PHONE'S CAMERA
   (Isaac, 23 November 2026; the mock https://claude.ai/artifact/TPGgvCEgtKdwVqRBCgRZBN).

   Two steps, as a job's photos go. BEGIN gives a signed slot for each page's
   photo, in a folder of their own under the org in `documents` (the kb bucket
   takes PDFs only), and the phone puts each photo in its slot. ADD takes them
   in page order, makes one PDF of them (lib/tiff/pages-pdf), and puts it in
   the Library through the web's own beginKbUpload and confirmKbUpload, as the
   phone's person, so it is the same document a PDF added on the web would be.
   The photos are then thrown away: the PDF is the manual. */

type Answer<T> = { ok: true; value: T } | { ok: false; error: string; status: number };

/** The most pages one manual takes from the camera. */
export const PAGES_MOST = 60;
/** What the camera gives, and what a page can be made from. */
const PAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_ADDED = "Those pages couldn't go in the Library. Try again.";
/** How long the Library says a photographed manual is still being read, if
    nothing says it's done sooner: the read clears it (lib/tiff/after-ready),
    and one that died lets it say Ready again on its own. */
const READING_FOR_MS = 15 * 60_000;

export const pagePath = (orgId: string, batch: string, n: number) => `org/${orgId}/kb-pages/${batch}/${n}`;

export type PageSlots = { batch: string; uploadUrls: string[] };

export async function beginPages(ctx: MobileCtx, types: readonly string[]): Promise<Answer<PageSlots>> {
  if (types.length === 0) return { ok: false, error: "There are no pages to add.", status: 400 };
  if (types.length > PAGES_MOST) return { ok: false, error: `${PAGES_MOST} pages is the most one manual takes.`, status: 400 };
  if (types.some((t) => !PAGE_TYPES.has(t))) return { ok: false, error: "A page has to be a photo.", status: 400 };
  const batch = randomUUID();
  const uploadUrls: string[] = [];
  for (let n = 0; n < types.length; n++) {
    const { data, error } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(pagePath(ctx.orgId, batch, n));
    if (error || !data) return { ok: false, error: NOT_ADDED, status: 409 };
    uploadUrls.push(data.signedUrl);
  }
  return { ok: true, value: { batch, uploadUrls } };
}

const forget = (orgId: string, documentId: string) => supabaseAdmin.from("kb_documents").delete().eq("org_id", orgId).eq("id", documentId);

export async function addPages(
  ctx: MobileCtx,
  batch: string,
  count: number,
  choice: { title: string; category: string; tagIds: string[] },
): Promise<Answer<InLibrary>> {
  if (!UUID.test(batch) || !Number.isInteger(count) || count < 1 || count > PAGES_MOST) return { ok: false, error: NOT_ADDED, status: 400 };
  const title = kbTitle(choice.title);
  const paths = Array.from({ length: count }, (_, n) => pagePath(ctx.orgId, batch, n));

  const photos: Uint8Array[] = [];
  for (const path of paths) {
    const got = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).download(path);
    if (got.error || !got.data) return { ok: false, error: `Page ${photos.length + 1} didn't upload. Try again.`, status: 409 };
    photos.push(new Uint8Array(await got.data.arrayBuffer()));
  }

  let pdf: Uint8Array;
  try {
    pdf = await pagesToPdf(photos, title);
  } catch (err) {
    console.error(`[kb-pages] ${batch}: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: "A page couldn't be read as a photo. Take it again.", status: 409 };
  }

  const slot = await actAsPhoneUser(ctx, () =>
    beginKbUpload({ ...choice, title, fileName: `${title}.pdf`, mime: "application/pdf", sizeBytes: pdf.byteLength }),
  );
  if (!slot.ok) return { ok: false, error: slot.error, status: 409 };
  const documentId = slot.documentId;

  const { error: put } = await supabaseAdmin.storage.from(KB_BUCKET).upload(slot.ref, pdf, { contentType: "application/pdf", upsert: true });
  if (put) {
    await forget(ctx.orgId, documentId);
    return { ok: false, error: NOT_ADDED, status: 409 };
  }
  const landed = await actAsPhoneUser(ctx, () => confirmKbUpload(documentId));
  if (!landed.ok) {
    await supabaseAdmin.storage.from(KB_BUCKET).remove([slot.ref]);
    await forget(ctx.orgId, documentId);
    return { ok: false, error: landed.error, status: 409 };
  }
  /* its pages are to be read: the Library says Reading until they are */
  await supabaseAdmin
    .from("kb_documents")
    .update({ pages_reading_until: new Date(Date.now() + READING_FOR_MS).toISOString() })
    .eq("org_id", ctx.orgId)
    .eq("id", documentId);
  await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).remove(paths);
  return { ok: true, value: { id: documentId, title, category: choice.category, status: "processing" } };
}
