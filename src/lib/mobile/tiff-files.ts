import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import type { AskFileBlock } from "@/lib/brain/ask";
import { isImage } from "@/lib/documents/files";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { landSlot, openSlot } from "@/lib/documents/upload-slots";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { imageForClaude } from "@/lib/images/for-claude";
import { openPdf } from "@/lib/tiff/extract";
import type { MobileCtx } from "./auth";

/* WHAT YOU HAND TIFF FROM THE PHONE (Isaac, 1 November 2026: "the plus symbol
   to add photo or other file"; "Go and do both"). The documents track's two
   steps, the bytes going straight to storage, then read back for her answer
   as the model's own blocks. In her box a file is a `tiff_file`, on nothing;
   on a job's box it's the job's own (job-photos). Either way only the person
   who added it can have it read. */

export const TIFF_FILE_LOOK = "Have a look at what I've attached.";

/** How many files go with one answer, the last added kept. */
const MOST_FILES = 5;
/** The model's request takes 32 MB, and base64 is a third bigger. */
const MOST_BYTES = 20 * 1024 * 1024;
/** Past this a PDF can't go as a document; its words still can. */
const MOST_PDF_PAGES = 100;
const MOST_WORDS = 200_000;

type Answer<T> = { ok: true; value: T } | { ok: false; error: string; status: number };
const NO_CARD = "You need a staff card in HeyTiff to add files.";

export async function beginTiffFile(
  ctx: MobileCtx,
  file: { fileName?: unknown; mimeType?: unknown; sizeBytes?: unknown }
): Promise<Answer<{ documentId: string; uploadUrl: string }>> {
  const staffId = await staffProfileIdFor(ctx.orgId, ctx.userId).catch(() => null);
  if (!staffId) return { ok: false, error: NO_CARD, status: 403 };
  const slot = await openSlot(ctx.orgId, staffId, "tiff_file", {
    fileName: typeof file.fileName === "string" ? file.fileName : "",
    mimeType: typeof file.mimeType === "string" ? file.mimeType : "",
    sizeBytes: typeof file.sizeBytes === "number" ? file.sizeBytes : 0,
  });
  if (!slot.ok) return { ok: false, error: slot.error, status: 400 };
  return { ok: true, value: { documentId: slot.documentId, uploadUrl: slot.signedUrl } };
}

export async function landTiffFile(ctx: MobileCtx, documentId: string): Promise<Answer<{ documentId: string }>> {
  const staffId = await staffProfileIdFor(ctx.orgId, ctx.userId).catch(() => null);
  if (!staffId) return { ok: false, error: NO_CARD, status: 403 };
  const { data } = await supabaseAdmin.from("documents").select("kind").eq("org_id", ctx.orgId).eq("id", documentId).maybeSingle();
  if ((data as { kind: string } | null)?.kind !== "tiff_file") return { ok: false, error: "That upload no longer exists.", status: 404 };
  const landed = await landSlot(ctx.orgId, staffId, documentId);
  if (!landed.ok) return { ok: false, error: landed.error, status: 409 };
  return { ok: true, value: { documentId } };
}

type Row = { id: string; storage_ref: string; file_name: string; mime_type: string; size_bytes: number };

/** A PDF as the model takes it: the file while it fits, else its words, else a line saying so. */
async function pdfBlocks(row: Row, bytes: Buffer): Promise<AskFileBlock[]> {
  const name = row.file_name;
  const words = `${name} is a PDF.`;
  let pdf: Awaited<ReturnType<typeof openPdf>> | null = null;
  try {
    pdf = await openPdf(new Uint8Array(bytes));
    if (pdf.numPages <= MOST_PDF_PAGES && bytes.length <= MOST_BYTES) {
      return [{ type: "text", text: words }, { type: "document", source: { type: "base64", media_type: "application/pdf", data: bytes.toString("base64") } }];
    }
    const pages: string[] = [];
    let size = 0;
    for (let n = 1; n <= pdf.numPages && size < MOST_WORDS; n++) {
      const t = (await pdf.pageText(n)).trim();
      if (!t) continue;
      pages.push(`[page ${n}]\n${t}`);
      size += t.length;
    }
    if (pages.length === 0) return [{ type: "text", text: `${name} is too big to read here, and has no words to read without its pictures.` }];
    return [{ type: "text", text: `${name} is too big to read whole, so here are its words only, without its pictures:\n${pages.join("\n\n").slice(0, MOST_WORDS)}` }];
  } catch {
    return [{ type: "text", text: `${name} couldn't be opened.` }];
  } finally {
    await pdf?.destroy().catch(() => undefined);
  }
}

/** The files named, this person's own and landed, as the model's blocks. A file that can't be read is said to be, so she says so too. */
export async function readTiffFiles(ctx: MobileCtx, ids: unknown): Promise<AskFileBlock[]> {
  const wanted = (Array.isArray(ids) ? ids : []).filter((i): i is string => typeof i === "string" && /^[0-9a-f-]{36}$/i.test(i)).slice(-MOST_FILES);
  if (wanted.length === 0) return [];
  const staffId = await staffProfileIdFor(ctx.orgId, ctx.userId).catch(() => null);
  if (!staffId) return [];
  const { data } = await supabaseAdmin
    .from("documents")
    .select("id, storage_ref, file_name, mime_type, size_bytes")
    .eq("org_id", ctx.orgId)
    .eq("uploaded_by", staffId)
    .in("id", wanted)
    .in("kind", ["tiff_file", "job_photo", "job_document"])
    .not("uploaded_at", "is", null);
  const rows = ((data ?? []) as Row[]).sort((a, b) => wanted.indexOf(a.id) - wanted.indexOf(b.id));

  const read = await Promise.all(
    rows.map(async (row): Promise<AskFileBlock[]> => {
      const cant: AskFileBlock[] = [{ type: "text", text: `${row.file_name} couldn't be opened.` }];
      const { data: blob, error } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).download(row.storage_ref);
      if (error || !blob) return cant;
      const bytes = Buffer.from(await blob.arrayBuffer());
      if (isImage(row.mime_type)) {
        const image = await imageForClaude(bytes, row.mime_type);
        if (!image) return cant;
        return [{ type: "text", text: `${row.file_name} is a photo.` }, { type: "image", source: { type: "base64", media_type: image.mime, data: image.bytes.toString("base64") } }];
      }
      return row.mime_type === "application/pdf" ? pdfBlocks(row, bytes) : cant;
    })
  );

  /* the whole request has to fit: the newest are kept, the older said to be left out */
  let room = MOST_BYTES;
  const kept: AskFileBlock[][] = [];
  for (let i = read.length - 1; i >= 0; i--) {
    const size = read[i]!.reduce((n, b) => n + (b.type === "text" ? b.text.length : b.source.data.length), 0);
    if (size > room * 1.34) {
      kept.unshift([{ type: "text", text: `${rows[i]!.file_name} was left out of this answer: there's too much attached.` }]);
      continue;
    }
    room -= size / 1.34;
    kept.unshift(read[i]!);
  }
  return kept.flat();
}
