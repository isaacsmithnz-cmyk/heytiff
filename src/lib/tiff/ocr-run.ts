/* One press of "Read the scanned pages": the IO around lib/tiff/ocr.ts.

   THE SAME SHAPE AS A BATCH, deliberately. `planOcrRun` answers "given this
   row and this allowance, what should happen" without touching storage or an
   API, exactly as `planBatch` does — because "how many pages is this click
   allowed to spend" is the answer that must never be wrong. Everything after
   it is IO.

   WHICH PAGES ARE SCANNED IS RE-DERIVED, NEVER STORED. `isScannedPage` is
   deterministic, so re-opening the PDF answers it again for free — and that
   means every document already in the library can be read today, with no
   migration and no backfill of a column ingestion never wrote.

   A DOCUMENT NEVER LEAVES `ready`. It was readable before this ran and it is
   readable after: running out of the month's pages reports `paused` to the
   caller without parking the row, because a library row that hid itself
   because an OPTIONAL extra didn't finish would be a worse bug than the gap.
   The only thing that changes on the row is what was actually recovered. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { KB_BUCKET, kbRefIsOrgs } from "./files";
import { chunkPages, type Chunk } from "./chunk";
import { isScannedPage, openPdf } from "./extract";
import { contiguousRuns, OCR_RUN_CAP, readScannedPages } from "./ocr";
import { embedTexts } from "./embeddings";
import { tagChunks } from "./keywords";
import { addKbUsage, kbQuotaFor } from "./quota";

function logOcrFailure(documentId: string, stage: string, err: unknown) {
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? "unknown");
  console.error(`[kb-ocr] ${stage} failed for ${documentId} — ${detail}`);
}

export type OcrStatus = "ready" | "paused" | "failed";

export type OcrProgress = {
  status: OcrStatus;
  /** Pages that came back with text this run. */
  pagesRead: number;
  /** Pages still unreadable afterwards — what the row's caveat will say. */
  scannedLeft: number;
  chunkCount: number;
  /** Set when paused: the day the page allowance resets. */
  resetsOn?: string;
  /** Set when failed. */
  error?: string;
};

/** The columns the decision depends on. */
export type OcrDocState = {
  status: string;
  scannedPages: number;
  chunkCount: number;
  storageRef: string | null;
};

export type OcrPlan =
  | { kind: "read"; allowance: number }
  | { kind: "paused"; resetsOn: string }
  | { kind: "done" }
  | { kind: "refused"; error: string };

const DOC_COLUMNS = "status, chunk_count, scanned_pages, storage_ref";

/* What this press is allowed to do.

   ONLY A READY DOCUMENT. Mid-ingestion the scanned count is still moving and
   the bookmark is another loop's to advance; offering both at once would have
   two writers on one row. An allowance smaller than the run cap shortens the
   run rather than refusing it — the same courtesy `planBatch` extends. */
export function planOcrRun(
  doc: OcrDocState,
  quota: { pagesRemaining: number; resetsOn: string },
  cap: number = OCR_RUN_CAP
): OcrPlan {
  if (doc.status !== "ready")
    return { kind: "refused", error: "That document is still being read." };
  if (!doc.storageRef) return { kind: "refused", error: "That document has no file." };
  if (doc.scannedPages <= 0) return { kind: "done" };
  if (quota.pagesRemaining <= 0) return { kind: "paused", resetsOn: quota.resetsOn };

  return { kind: "read", allowance: Math.min(cap, quota.pagesRemaining) };
}

/** Chunks for a set of recovered pages — each contiguous run on its own, so no
    chunk can ever span pages that aren't next to each other. */
export function chunkRecovered(pages: readonly { page: number; text: string }[]): Chunk[] {
  return contiguousRuns(pages).flatMap((run) => chunkPages(run));
}

const failed = (error: string, doc: OcrDocState): OcrProgress => ({
  status: "failed",
  pagesRead: 0,
  scannedLeft: doc.scannedPages,
  chunkCount: doc.chunkCount,
  error,
});

/** Read a document's scanned pages with vision and store what comes back.
    Never throws: every failure is an `OcrProgress` the row can render. */
export async function processScannedPages(
  documentId: string,
  orgId: string
): Promise<OcrProgress> {
  const { data } = await supabaseAdmin
    .from("kb_documents")
    .select(DOC_COLUMNS)
    .eq("org_id", orgId)
    .eq("id", documentId)
    .maybeSingle();
  if (!data)
    return { status: "failed", pagesRead: 0, scannedLeft: 0, chunkCount: 0, error: "That document is gone." };

  const row = data as Record<string, unknown>;
  const doc: OcrDocState = {
    status: String(row.status),
    scannedPages: Number(row.scanned_pages) || 0,
    chunkCount: Number(row.chunk_count) || 0,
    storageRef: (row.storage_ref as string) ?? null,
  };

  const quota = await kbQuotaFor(orgId);
  const plan = planOcrRun(doc, quota);

  if (plan.kind === "done")
    return { status: "ready", pagesRead: 0, scannedLeft: 0, chunkCount: doc.chunkCount };
  if (plan.kind === "refused") return failed(plan.error, doc);
  if (plan.kind === "paused")
    return {
      status: "paused",
      pagesRead: 0,
      scannedLeft: doc.scannedPages,
      chunkCount: doc.chunkCount,
      resetsOn: plan.resetsOn,
    };

  if (!kbRefIsOrgs(doc.storageRef!, orgId))
    return failed("That file doesn't belong to this organisation.", doc);

  const file = await supabaseAdmin.storage.from(KB_BUCKET).download(doc.storageRef!);
  if (file.error || !file.data) {
    logOcrFailure(documentId, "download", file.error);
    return failed("That file couldn't be read.", doc);
  }

  const bytes = new Uint8Array(await file.data.arrayBuffer());

  /* pdfjs is given its OWN COPY, and this is not a micro-optimisation to
     remove later. `getDocument({data})` TRANSFERS the ArrayBuffer — it takes
     ownership and the caller's view is detached — so slicing the same `bytes`
     afterwards reads a zero-length buffer and pdf-lib fails with "No PDF
     header found". This file is the one place that reads a PDF twice (once to
     find the scanned pages, once to slice them out), so it is the only place
     that could ever hit it. */
  let pdf: Awaited<ReturnType<typeof openPdf>>;
  try {
    pdf = await openPdf(bytes.slice());
  } catch (err) {
    logOcrFailure(documentId, "openPdf", err);
    return failed("That PDF couldn't be opened.", doc);
  }

  try {
    /* Re-derived rather than read off the row: the same rule ingestion applied,
       applied again, so this works on every document in the library and not
       only ones ingested after the feature shipped. */
    const scanned: number[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      if (isScannedPage(await pdf.pageText(n))) scanned.push(n);
    }

    if (scanned.length === 0) {
      /* The row's count disagreed with the file. The file wins — and the row
         stops claiming a caveat that isn't there. */
      await supabaseAdmin
        .from("kb_documents")
        .update({ scanned_pages: 0, updated_at: new Date().toISOString() })
        .eq("org_id", orgId)
        .eq("id", documentId);
      return { status: "ready", pagesRead: 0, scannedLeft: 0, chunkCount: doc.chunkCount };
    }

    const taking = scanned.slice(0, plan.allowance);
    const read = await readScannedPages(bytes, taking);
    if (!read.ok) return failed(read.error, doc);

    const chunks = chunkRecovered(read.pages);
    const texts = chunks.map((c) => c.content);
    const [tagged, embedded] = await Promise.all([
      tagChunks(texts, documentId),
      embedTexts(texts, "document"),
    ]);
    const keywords = tagged.ok ? tagged.keywords : chunks.map(() => []);
    if (!embedded.ok) logOcrFailure(documentId, "embed", `${embedded.reason} — ${embedded.detail}`);
    const vectors = embedded.ok ? embedded.vectors : null;

    if (chunks.length > 0) {
      const { error } = await supabaseAdmin.from("kb_chunks").insert(
        chunks.map((c, i) => ({
          org_id: orgId,
          document_id: documentId,
          chunk_index: doc.chunkCount + i,
          content: c.content,
          page_from: c.pageFrom,
          page_to: c.pageTo,
          heading: c.heading ?? null,
          keywords: keywords[i] ?? [],
          embedding: vectors?.[i] ? JSON.stringify(vectors[i]) : null,
        }))
      );
      // nothing has been marked recovered yet, so a retry re-reads these pages
      if (error) return failed("Those pages couldn't be saved.", doc);
    }

    /* What's LEFT is the truth from the file minus what we just recovered — so
       a page we attempted and got nothing from stays counted as unreadable,
       which is what it still is. */
    const scannedLeft = Math.max(0, scanned.length - read.pages.length);
    const chunkCount = doc.chunkCount + chunks.length;

    const { error: updateErr } = await supabaseAdmin
      .from("kb_documents")
      .update({
        scanned_pages: scannedLeft,
        chunk_count: chunkCount,
        updated_at: new Date().toISOString(),
      })
      .eq("org_id", orgId)
      .eq("id", documentId);
    if (updateErr) return failed("That document couldn't be updated.", doc);

    // counted AFTER the work, and for what was attempted — same as ingestion
    await addKbUsage(orgId, { pages: taking.length });

    return {
      status: "ready",
      pagesRead: read.pages.length,
      scannedLeft,
      chunkCount,
    };
  } catch (err) {
    logOcrFailure(documentId, "readScanned", err);
    return failed("Those pages couldn't be read.", doc);
  } finally {
    await pdf.destroy().catch(() => {});
  }
}
