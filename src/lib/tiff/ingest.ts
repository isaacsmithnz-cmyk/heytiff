/* One batch of ingestion: pages off the bookmark, chunks into the table.

   THE LOOP IS THE CLIENT'S. There is no queue — Vercel Hobby has one cron a
   day — so the library page calls /api/tiff/ingest, gets progress back, and
   calls again. Each call does ~20 pages and advances `next_page`, which means
   a 400-page manual crosses twenty requests and a failure costs one batch
   rather than the document. A document left mid-processing resumes on the next
   visit, at the page it stopped on.

   THE DECISION IS PURE, THE WORK IS NOT. `planBatch` answers "given this row
   and this allowance, what should happen" and `progressPatch` answers "given
   what happened, what does the row become" — both without touching storage, a
   PDF or an API, because those two answers are the ones that must never be
   wrong. Everything between them is IO.

   NOTHING PARTIAL IS EVER LEFT BEHIND with the bookmark advanced: chunks are
   inserted first, and only a successful insert moves `next_page`. The other
   order would silently drop pages nobody would ever notice were missing. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { KB_BUCKET, kbRefIsOrgs } from "./files";
import { chunkPages, type PageText } from "./chunk";
import { isScannedPage, openPdf, PAGE_BATCH, pageWindow } from "./extract";
import { embedTexts } from "./embeddings";
import { tagChunks } from "./keywords";
import { addKbUsage, kbQuotaFor } from "./quota";

/* The reason, kept where it can be read.

   THE SENTENCE ON THE SCREEN IS NOT THE SENTENCE IN THE LOG. A person gets
   "That PDF couldn't be opened."; the log gets whatever pdfjs actually threw,
   with the document it was reading. The first version of this file discarded
   the exception entirely, which cost a live afternoon: a manual that opens in
   one line locally failed in production and there was nothing anywhere saying
   why. Same split as lib/voice/transcribe.ts — the rule is about the RESPONSE,
   never about our own logs. */
function logIngestFailure(documentId: string, stage: string, err: unknown) {
  const detail =
    err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? "unknown");
  console.error(`[kb-ingest] ${stage} failed for ${documentId} — ${detail}`);
}

/* What to put on the row when a PDF won't open.

   pdfjs names its own failures, and three of them are things the person
   holding the file can actually act on — a password, a corrupt download, a
   file that isn't a PDF at all. Those get said. Anything else stays the
   house sentence, because a stack trace on a library row helps nobody. */
export function reasonForOpenFailure(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : "";
  if (name === "PasswordException" || /password/i.test(message))
    return "That PDF is password-protected — remove the password and upload it again.";
  if (name === "InvalidPDFException" || /invalid pdf/i.test(message))
    return "That file isn't a readable PDF — it may have been damaged in transit.";
  if (name === "MissingPDFException") return "That file couldn't be read.";
  return "That PDF couldn't be opened.";
}

export type IngestStatus = "processing" | "paused" | "ready" | "failed";

export type IngestProgress = {
  status: IngestStatus;
  /** Pages read so far, across every batch — `next_page - 1`. */
  pagesDone: number;
  /** Null until the document has been opened once. */
  pageCount: number | null;
  chunkCount: number;
  /** Set when status is 'paused': the day the allowance resets. */
  resetsOn?: string;
  /** Set when status is 'failed'. */
  error?: string;
};

/** The columns the decision actually depends on. */
export type DocState = {
  status: string;
  nextPage: number;
  pageCount: number | null;
  chunkCount: number;
  storageRef: string | null;
};

export type BatchPlan =
  | { kind: "process"; from: number; allowance: number }
  | { kind: "paused"; resetsOn: string }
  | { kind: "done" }
  | { kind: "refused"; error: string };

const DOC_COLUMNS = "status, next_page, page_count, chunk_count, scanned_pages, storage_ref";

/* What to do with this document right now.

   `paused` is checked BEFORE any work, never during it: a document parks at
   its bookmark with nothing half-done, and the same call on the first of next
   month picks up exactly where it stopped. An allowance smaller than a full
   batch shortens the window rather than refusing it — a trial org with 7 pages
   left gets 7 pages, not nothing. */
export function planBatch(
  doc: DocState,
  quota: { pagesRemaining: number; resetsOn: string },
  batch: number = PAGE_BATCH
): BatchPlan {
  if (doc.status === "ready") return { kind: "done" };
  if (doc.status !== "processing" && doc.status !== "paused")
    return { kind: "refused", error: "That document isn't ready to be processed." };
  if (!doc.storageRef) return { kind: "refused", error: "That document has no file." };

  // page_count is known only after the first successful open
  if (doc.pageCount !== null && doc.nextPage > doc.pageCount) return { kind: "done" };

  if (quota.pagesRemaining <= 0) return { kind: "paused", resetsOn: quota.resetsOn };

  return {
    kind: "process",
    from: Math.max(1, doc.nextPage),
    allowance: Math.min(batch, quota.pagesRemaining),
  };
}

export type BatchOutcome = {
  /** The last page actually read this batch. */
  lastPage: number;
  /** The document's real length, now that it has been opened. */
  numPages: number;
  newChunks: number;
  /** Pages in this batch whose text layer was empty. */
  scanned: number;
};

/* The row after a successful batch. `ready` the moment the last page is read —
   there is no separate "finalise" step to be interrupted. */
export function progressPatch(
  doc: DocState,
  scannedSoFar: number,
  outcome: BatchOutcome
): Record<string, unknown> {
  const done = outcome.lastPage >= outcome.numPages;
  return {
    status: done ? "ready" : "processing",
    next_page: outcome.lastPage + 1,
    page_count: outcome.numPages,
    chunk_count: doc.chunkCount + outcome.newChunks,
    scanned_pages: scannedSoFar + outcome.scanned,
    error: null,
    updated_at: new Date().toISOString(),
  };
}

const progressOf = (
  status: IngestStatus,
  doc: DocState,
  extra: Partial<IngestProgress> = {}
): IngestProgress => ({
  status,
  pagesDone: Math.max(0, doc.nextPage - 1),
  pageCount: doc.pageCount,
  chunkCount: doc.chunkCount,
  ...extra,
});

async function fail(
  documentId: string,
  orgId: string,
  doc: DocState,
  error: string
): Promise<IngestProgress> {
  await supabaseAdmin
    .from("kb_documents")
    .update({ status: "failed", error, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", documentId);
  return progressOf("failed", doc, { error });
}

/** Read the next window of pages into kb_chunks. Never throws: every failure
    lands on the row as `failed` + a reason, which the library shows with a
    Retry that re-enters at the bookmark. */
export async function processBatch(documentId: string, orgId: string): Promise<IngestProgress> {
  const { data } = await supabaseAdmin
    .from("kb_documents")
    .select(DOC_COLUMNS)
    .eq("org_id", orgId)
    .eq("id", documentId)
    .maybeSingle();
  if (!data) return { status: "failed", pagesDone: 0, pageCount: null, chunkCount: 0, error: "That document is gone." };

  const row = data as Record<string, unknown>;
  const doc: DocState = {
    status: String(row.status),
    nextPage: Number(row.next_page) || 1,
    pageCount: row.page_count === null || row.page_count === undefined ? null : Number(row.page_count),
    chunkCount: Number(row.chunk_count) || 0,
    storageRef: (row.storage_ref as string) ?? null,
  };
  const scannedSoFar = Number(row.scanned_pages) || 0;

  const quota = await kbQuotaFor(orgId);
  const plan = planBatch(doc, quota);

  if (plan.kind === "done") {
    await supabaseAdmin
      .from("kb_documents")
      .update({ status: "ready", error: null, updated_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("id", documentId);
    return progressOf("ready", doc);
  }

  if (plan.kind === "refused") return progressOf("failed", doc, { error: plan.error });

  if (plan.kind === "paused") {
    await supabaseAdmin
      .from("kb_documents")
      .update({ status: "paused", updated_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("id", documentId);
    return progressOf("paused", doc, { resetsOn: plan.resetsOn });
  }

  // the path in the row is the one thing here that came from a previous
  // request; a ref that isn't this org's never reaches storage
  if (!kbRefIsOrgs(doc.storageRef!, orgId))
    return fail(documentId, orgId, doc, "That file doesn't belong to this organisation.");

  const file = await supabaseAdmin.storage.from(KB_BUCKET).download(doc.storageRef!);
  if (file.error || !file.data) {
    logIngestFailure(documentId, "download", file.error);
    return fail(documentId, orgId, doc, "That file couldn't be read.");
  }

  let pdf: Awaited<ReturnType<typeof openPdf>>;
  try {
    pdf = await openPdf(new Uint8Array(await file.data.arrayBuffer()));
  } catch (err) {
    logIngestFailure(documentId, "openPdf", err);
    return fail(documentId, orgId, doc, reasonForOpenFailure(err));
  }

  try {
    const window = pageWindow(plan.from, pdf.numPages, PAGE_BATCH, plan.allowance);
    if (window.count === 0) {
      await supabaseAdmin
        .from("kb_documents")
        .update({
          status: "ready",
          page_count: pdf.numPages,
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("org_id", orgId)
        .eq("id", documentId);
      return progressOf("ready", doc, { pageCount: pdf.numPages });
    }

    const pages: PageText[] = [];
    let scanned = 0;
    for (let n = window.from; n <= window.to; n++) {
      const text = await pdf.pageText(n);
      if (isScannedPage(text)) {
        scanned += 1; // counted, and surfaced honestly — never indexed as blank
        continue;
      }
      pages.push({ page: n, text });
    }

    const chunks = chunkPages(pages);

    /* Neither of these is allowed to stop ingestion. Untagged chunks still
       match on their own content; null embeddings still match on keywords, and
       a later run backfills them once a key exists. */
    const tagged = await tagChunks(chunks.map((c) => c.content), documentId);
    const keywords = tagged.ok ? tagged.keywords : chunks.map(() => []);

    /* Stored either way — but NOT silently, any more. 106 of one 285-chunk
       manual went in with null embeddings and nothing anywhere said so: Voyage
       caps an account with no payment method at 3 RPM and ingestion fires a
       call per batch, so most of them 429'd. The reason is what makes the log
       worth keeping — `rate-limited` is worth trying again, `unauthorised`
       never is. */
    const embedded = await embedTexts(chunks.map((c) => c.content), "document");
    if (!embedded.ok)
      logIngestFailure(documentId, "embed", `${embedded.reason} — ${embedded.detail}`);
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
      // the bookmark has NOT moved, so a retry re-reads these same pages
      if (error) return fail(documentId, orgId, doc, "Those pages couldn't be saved.");
    }

    const patch = progressPatch(doc, scannedSoFar, {
      lastPage: window.to,
      numPages: pdf.numPages,
      newChunks: chunks.length,
      scanned,
    });

    const { error: updateErr } = await supabaseAdmin
      .from("kb_documents")
      .update(patch)
      .eq("org_id", orgId)
      .eq("id", documentId);
    if (updateErr) return fail(documentId, orgId, doc, "That document couldn't be updated.");

    // counted AFTER the work, so a failed batch is never billed
    await addKbUsage(orgId, { pages: window.count });

    return {
      status: patch.status as IngestStatus,
      pagesDone: window.to,
      pageCount: pdf.numPages,
      chunkCount: Number(patch.chunk_count),
    };
  } catch (err) {
    logIngestFailure(documentId, "readPages", err);
    return fail(documentId, orgId, doc, "Those pages couldn't be read.");
  } finally {
    await pdf.destroy().catch(() => {});
  }
}
