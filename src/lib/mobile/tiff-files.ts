import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import type { AskFileBlock } from "@/lib/brain/ask";
import { isImage } from "@/lib/documents/files";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { landSlot, openSlot } from "@/lib/documents/upload-slots";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { imageForClaude } from "@/lib/images/for-claude";
import { sendJobPhotoAs } from "@/app/actions/job-sm8";
import type { Sm8Press } from "@/lib/integrations/sm8-press";
import { openPdf } from "@/lib/tiff/extract";
import { slicePdf } from "@/lib/tiff/ocr";
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
/** Past this a PDF can't go whole: the pages that matter go instead, with its words. */
const MOST_PDF_PAGES = 100;
/** Of a big PDF, how many pages she sees for one answer. */
const MOST_SHOWN = 30;
const MOST_WORDS = 60_000;

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

const SMALL_WORDS = new Set("the and for with this that what which where when how does are was were has have had from into can could should would will you your our its it's there here about show tell give look find read page pages please need want get".split(" "));

/** The words of a question worth looking for on a page: a model code or a room, not "what". Pure. */
export function wordsToFind(question: string): string[] {
  const found = question.toLowerCase().match(/[a-z0-9][a-z0-9./-]*/g) ?? [];
  return [...new Set(found.map((w) => w.replace(/[./-]+$/, "")).filter((w) => w.length >= 3 && !SMALL_WORDS.has(w)))];
}

/** Which pages of a big PDF to show for this question: any it names, then the ones
    saying the most of its words with the pages beside them, else the first ones.
    In page order, 1-based. Pure. */
export function pagesFor(question: string, texts: readonly string[], most = MOST_SHOWN): number[] {
  const total = texts.length;
  const chosen = new Set<number>();
  for (const m of question.matchAll(/\bpages?\s+(\d{1,4})(?:\s*(?:-|to)\s*(\d{1,4}))?/gi)) {
    const from = Number(m[1]);
    const to = Math.min(Number(m[2] ?? m[1]), from + most - 1);
    for (let n = from; n <= to && chosen.size < most; n++) if (n >= 1 && n <= total) chosen.add(n);
  }
  const words = wordsToFind(question);
  if (words.length > 0) {
    const scored = texts
      .map((t, i) => {
        const page = t.toLowerCase();
        return { n: i + 1, hits: words.filter((w) => page.includes(w)).length };
      })
      .filter((p) => p.hits > 0)
      .sort((a, b) => b.hits - a.hits || a.n - b.n);
    for (const p of scored) {
      for (const n of [p.n, p.n + 1, p.n - 1]) if (chosen.size < most && n >= 1 && n <= total) chosen.add(n);
      if (chosen.size >= most) break;
    }
  }
  if (chosen.size === 0) for (let n = 1; n <= Math.min(total, most); n++) chosen.add(n);
  return [...chosen].sort((a, b) => a - b);
}

/** A PDF as the model takes it: the file while it fits; else the pages that matter
    to this question and its words; else its words; else a line saying so. */
async function pdfBlocks(row: Row, bytes: Buffer, question: string): Promise<AskFileBlock[]> {
  const name = row.file_name;
  const words = `${name} is a PDF.`;
  let pdf: Awaited<ReturnType<typeof openPdf>> | null = null;
  try {
    pdf = await openPdf(new Uint8Array(bytes));
    if (pdf.numPages <= MOST_PDF_PAGES && bytes.length <= MOST_BYTES) {
      return [{ type: "text", text: words }, { type: "document", source: { type: "base64", media_type: "application/pdf", data: bytes.toString("base64") } }];
    }
    const texts: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) texts.push((await pdf.pageText(n).catch(() => "")).trim());
    const wordsBlock = (lead: string): AskFileBlock => {
      const all = texts.flatMap((t, i) => (t ? [`[page ${i + 1}]\n${t}`] : [])).join("\n\n");
      return { type: "text", text: all ? `${lead} Its words:\n${all.slice(0, MOST_WORDS)}` : lead };
    };
    /* the pages, halved until they fit: drawings can be many MB each */
    let shown = pagesFor(question, texts);
    while (shown.length > 0) {
      const slice = await slicePdf(new Uint8Array(bytes), shown).catch(() => null);
      if (!slice) break;
      if (slice.length <= MOST_BYTES) {
        return [
          wordsBlock(`${name} has ${pdf.numPages} pages, too many to see at once. The PDF attached next is only pages ${shown.join(", ")} of it, in that order; say which pages you looked at. Ask for any other page by its number.`),
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(slice).toString("base64") } },
        ];
      }
      shown = shown.slice(0, Math.floor(shown.length / 2));
    }
    return [wordsBlock(`${name} is too big to see here, so you only have its words, not its pictures; say so.`)];
  } catch {
    return [{ type: "text", text: `${name} couldn't be opened.` }];
  } finally {
    await pdf?.destroy().catch(() => undefined);
  }
}

/** The files named, this person's own and landed, as the model's blocks. A file that can't be read is said to be, so she says so too. */
export async function readTiffFiles(ctx: MobileCtx, ids: unknown, question = ""): Promise<AskFileBlock[]> {
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
      return row.mime_type === "application/pdf" ? pdfBlocks(row, bytes, question) : cant;
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

/** A note filed with files in Tiff's own box: on a job, they go on that job as a job's
    photo or document would, a photo on to ServiceM8. With no job there's nowhere for
    them yet, as a task holds no files, and she says so rather than let it seem done. */
export async function fileWithNote(ctx: MobileCtx, press: Sm8Press | null, noteId: string, ids: readonly string[]): Promise<string | null> {
  const staffId = await staffProfileIdFor(ctx.orgId, ctx.userId).catch(() => null);
  if (!staffId) return null;
  const { data: rows } = await supabaseAdmin
    .from("documents")
    .select("id, file_name, mime_type")
    .eq("org_id", ctx.orgId)
    .eq("uploaded_by", staffId)
    .eq("kind", "tiff_file")
    .in("id", [...ids]);
  const files = (rows ?? []) as { id: string; file_name: string; mime_type: string }[];
  if (files.length === 0) return null;
  const { data: note } = await supabaseAdmin.from("workboard_notes").select("target_kind, target_id").eq("org_id", ctx.orgId).eq("id", noteId).maybeSingle();
  const on = note as { target_kind: string; target_id: string | null } | null;
  if (on?.target_kind !== "job" || !on.target_id) {
    return files.length === 1
      ? `${files[0]!.file_name} isn't with it, as a task can't hold a file yet. Name the job and it goes on that.`
      : "The files aren't with it, as a task can't hold a file yet. Name the job and they go on that.";
  }
  const job = on.target_id;
  await Promise.all(
    files.map(async (f) => {
      const image = isImage(f.mime_type);
      const { error } = await supabaseAdmin
        .from("documents")
        .update({ kind: image ? "job_photo" : "job_document", sm8_job_uuid: job })
        .eq("org_id", ctx.orgId)
        .eq("id", f.id)
        .eq("kind", "tiff_file");
      if (!error && image && press && press.orgId === ctx.orgId && press.userId === ctx.userId) await sendJobPhotoAs(press, { jobUuid: job, documentId: f.id });
    })
  );
  return null;
}
