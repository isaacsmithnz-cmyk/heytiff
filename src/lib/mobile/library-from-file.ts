import "server-only";

import { beginKbUpload, confirmKbUpload } from "@/app/actions/kb";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { supabaseAdmin } from "@/lib/supabase-server";
import { checkKbUpload, isLargeKb, KB_BUCKET } from "@/lib/tiff/files";
import { guessKbCategory, titleFromFilename } from "@/lib/tiff/guess";
import { kbLargeAllowance } from "@/lib/tiff/large";
import { guessKbTags } from "@/lib/tiff/tags";
import { ensureKbSeedTags, kbTagsForOrg } from "@/lib/tiff/tags-query";
import { actAsPhoneUser, type MobileCtx } from "./auth";

/* A PDF YOU GAVE TIFF, INTO THE LIBRARY (Isaac, 1 November 2026: "Yes, that looks
   fine"; the mock https://claude.ai/artifact/MnGDRUVvNSbWMueKi2PLVP). The web's
   own steps, so the same result, with the upload swapped for a copy, as the bytes
   are already in storage. Only the person who added a file can put it in, and the
   manual keeps its own copy. `source_document` says which file it came from, so
   the chat can say it's there and the same file can't go in twice. */

type Answer<T> = { ok: true; value: T } | { ok: false; error: string; status: number };

export type InLibrary = { id: string; title: string; category: string; status: string; error?: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GONE = "That file isn't here any more.";
const NOT_ADDED = "That file couldn't go in the Library. Try again.";

/** What the Add sheet offers for a file's name and size, the same from a direct upload or a file she has. */
export async function kbOffer(ctx: MobileCtx, file: string, size: number, mime: string) {
  const large = isLargeKb(size) ? await kbLargeAllowance(ctx.orgId, ctx.role === "owner") : null;
  const check = checkKbUpload({ type: mime, size }, large);
  await ensureKbSeedTags(ctx.orgId);
  const tags = await kbTagsForOrg(ctx.orgId);
  return {
    refused: check.ok ? null : check.error,
    title: titleFromFilename(file),
    category: guessKbCategory(file),
    tagIds: guessKbTags(file, tags),
    tags: tags.map((t) => ({ id: t.id, label: t.label, kind: t.kind })),
  };
}

type Pdf = { id: string; storage_ref: string; file_name: string; mime_type: string; size_bytes: number };

/** A PDF this person added, handed to Tiff or on a job from her box, with its bytes in. */
async function yourPdf(ctx: MobileCtx, fileId: string): Promise<Pdf | null> {
  if (!UUID.test(fileId)) return null;
  const staffId = await staffProfileIdFor(ctx.orgId, ctx.userId).catch(() => null);
  if (!staffId) return null;
  const { data } = await supabaseAdmin
    .from("documents")
    .select("id, storage_ref, file_name, mime_type, size_bytes")
    .eq("org_id", ctx.orgId)
    .eq("id", fileId)
    .eq("uploaded_by", staffId)
    .in("kind", ["tiff_file", "job_document"])
    .not("uploaded_at", "is", null)
    .maybeSingle();
  const pdf = data as Pdf | null;
  return pdf?.mime_type.toLowerCase() === "application/pdf" && pdf.storage_ref ? pdf : null;
}

/** The manual this file became, if it has. */
export async function manualFromFile(orgId: string, fileId: string): Promise<InLibrary | null> {
  if (!UUID.test(fileId)) return null;
  const { data } = await supabaseAdmin.from("kb_documents").select("id, title, category, status, error").eq("org_id", orgId).eq("source_document", fileId).maybeSingle();
  return (data as InLibrary | null) ?? null;
}

/** The sheet's offer for a file she has, with its name and size. */
export async function offerForFile(ctx: MobileCtx, fileId: string) {
  const pdf = await yourPdf(ctx, fileId);
  if (!pdf) return null;
  return { ...(await kbOffer(ctx, pdf.file_name, Number(pdf.size_bytes), pdf.mime_type)), fileName: pdf.file_name, sizeBytes: Number(pdf.size_bytes) };
}

const forget = (orgId: string, documentId: string) => supabaseAdmin.from("kb_documents").delete().eq("org_id", orgId).eq("id", documentId);

export async function addFileToLibrary(ctx: MobileCtx, fileId: string, choice: { title: string; category: string; tagIds: string[] }): Promise<Answer<InLibrary>> {
  const pdf = await yourPdf(ctx, fileId);
  if (!pdf) return { ok: false, error: GONE, status: 404 };
  const already = await manualFromFile(ctx.orgId, pdf.id);
  if (already) return { ok: true, value: already };

  const slot = await actAsPhoneUser(ctx, () => beginKbUpload({ ...choice, fileName: pdf.file_name, mime: pdf.mime_type, sizeBytes: Number(pdf.size_bytes) }));
  if (!slot.ok) return { ok: false, error: slot.error, status: 409 };
  const documentId = slot.documentId;

  /* the index holds two presses to one manual: the second gives way to the first */
  const { error: claimed } = await supabaseAdmin.from("kb_documents").update({ source_document: pdf.id }).eq("org_id", ctx.orgId).eq("id", documentId);
  if (claimed) {
    await forget(ctx.orgId, documentId);
    const first = await manualFromFile(ctx.orgId, pdf.id);
    return first ? { ok: true, value: first } : { ok: false, error: NOT_ADDED, status: 409 };
  }

  const { error: copied } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).copy(pdf.storage_ref, slot.ref, { destinationBucket: KB_BUCKET });
  if (copied) {
    await forget(ctx.orgId, documentId);
    return { ok: false, error: NOT_ADDED, status: 409 };
  }

  const landed = await actAsPhoneUser(ctx, () => confirmKbUpload(documentId));
  if (!landed.ok) {
    await supabaseAdmin.storage.from(KB_BUCKET).remove([slot.ref]);
    await forget(ctx.orgId, documentId);
    return { ok: false, error: landed.error, status: 409 };
  }
  return { ok: true, value: { id: documentId, title: choice.title.trim(), category: choice.category, status: "processing" } };
}
