/* One pass over a document's drawings: the IO around ./drawings.

   Run when a document finishes being read (api/tiff/drawings, called by the
   ingest route), and once over the Library as it stood on 29 October 2026.
   Each drawing read becomes a chunk of its own, on its own page, headed
   "Drawing, page N", embedded and tagged like every other chunk, so a search
   for "feet spacing" can land on it. A page that already has one is never
   read again; the document never leaves `ready`. Counted against the page
   allowance like the scanned pages, for what was attempted. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { KB_BUCKET, kbRefIsOrgs } from "./files";
import { openPdf } from "./extract";
import { DRAWING_HEADING_PREFIX, drawingHeading, isDrawingCandidate, readDrawings } from "./drawings";
import { embedTexts } from "./embeddings";
import { tagChunks } from "./keywords";
import { addKbUsage, kbQuotaFor } from "./quota";

/** The most pages one pass reads: a ceiling on what one document can spend. */
export const DRAWINGS_RUN_CAP = 80;

export type DrawingsOutcome = { ok: true; read: number; described: number } | { ok: false; error: string };

/** The candidate pages still to read, in order, at most `cap`. Pure. */
export function pagesToRead(texts: readonly string[], described: ReadonlySet<number>, cap: number = DRAWINGS_RUN_CAP): number[] {
  const out: number[] = [];
  texts.forEach((t, i) => {
    const page = i + 1;
    if (!described.has(page) && isDrawingCandidate(t)) out.push(page);
  });
  return out.slice(0, Math.max(0, cap));
}

/** `renew` keeps the document's lease while the pages are read, when the caller holds one. */
export async function describeDrawings(documentId: string, orgId: string, renew?: () => Promise<void>): Promise<DrawingsOutcome> {
  const { data } = await supabaseAdmin
    .from("kb_documents")
    .select("status, chunk_count, storage_ref, title")
    .eq("org_id", orgId)
    .eq("id", documentId)
    .maybeSingle();
  const doc = data as { status: string; chunk_count: number | null; storage_ref: string | null; title: string | null } | null;
  if (!doc) return { ok: false, error: "That document is gone." };
  if (doc.status !== "ready") return { ok: false, error: "That document is still being read." };
  if (!doc.storage_ref || !kbRefIsOrgs(doc.storage_ref, orgId)) return { ok: false, error: "That document has no file." };

  const quota = await kbQuotaFor(orgId);
  if (quota.pagesRemaining <= 0) return { ok: false, error: "This month's pages are used up." };

  const { data: done } = await supabaseAdmin
    .from("kb_chunks")
    .select("page_from")
    .eq("org_id", orgId)
    .eq("document_id", documentId)
    .like("heading", `${DRAWING_HEADING_PREFIX}%`);
  const described = new Set(((done ?? []) as { page_from: number }[]).map((r) => r.page_from));

  const file = await supabaseAdmin.storage.from(KB_BUCKET).download(doc.storage_ref);
  if (file.error || !file.data) return { ok: false, error: "That file couldn't be read." };
  const bytes = new Uint8Array(await file.data.arrayBuffer());

  /* pdfjs takes ownership of the buffer it is given: its own copy, so the
     slicing after still has the bytes (./ocr-run says the same) */
  const pdf = await openPdf(bytes.slice()).catch(() => null);
  if (!pdf) return { ok: false, error: "That PDF couldn't be opened." };
  let pages: number[];
  try {
    const texts: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) texts.push(await pdf.pageText(n));
    pages = pagesToRead(texts, described, Math.min(DRAWINGS_RUN_CAP, quota.pagesRemaining));
  } finally {
    await pdf.destroy().catch(() => {});
  }
  if (pages.length === 0) return { ok: true, read: 0, described: 0 };

  const read = await readDrawings(bytes, pages);
  if (!read.ok) return { ok: false, error: read.error };
  await renew?.().catch(() => undefined);
  /* the count as it is now, not as it was before the read */
  const { data: fresh } = await supabaseAdmin.from("kb_documents").select("chunk_count").eq("org_id", orgId).eq("id", documentId).maybeSingle();
  if (fresh) doc.chunk_count = (fresh as { chunk_count: number | null }).chunk_count;

  const texts = read.pages.map((p) => p.text);
  if (texts.length) {
    const [tagged, embedded] = await Promise.all([tagChunks(texts, documentId), embedTexts(texts, "document")]);
    const keywords = tagged.ok ? tagged.keywords : texts.map(() => []);
    const vectors = embedded.ok ? embedded.vectors : null;
    const base = Number(doc.chunk_count) || 0;
    const { error } = await supabaseAdmin.from("kb_chunks").insert(
      read.pages.map((p, i) => ({
        org_id: orgId,
        document_id: documentId,
        chunk_index: base + i,
        content: p.text,
        page_from: p.page,
        page_to: p.page,
        heading: drawingHeading(p.page),
        keywords: keywords[i] ?? [],
        embedding: vectors?.[i] ? JSON.stringify(vectors[i]) : null,
      })),
    );
    if (error) return { ok: false, error: "Those drawings couldn't be saved." };
    await supabaseAdmin
      .from("kb_documents")
      .update({ chunk_count: base + texts.length, updated_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("id", documentId);
  }
  await addKbUsage(orgId, { pages: pages.length });
  return { ok: true, read: pages.length, described: texts.length };
}
