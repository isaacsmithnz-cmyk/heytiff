/* Filling in the passages that went in without a vector.

   WHY THERE ARE ANY. Ingestion is allowed to store a chunk with a null
   embedding — no key yet, or Voyage refused the batch — because the keyword
   leg still finds it and half a manual indexed beats none. What was missing is
   the second half of that promise: "a later re-run backfills them". Nothing
   ever re-ran. A 385-page manual finished `ready` with 106 of its 285
   passages permanently invisible to the vector leg, and the library said
   nothing, because the document itself was fine.

   READY DOCUMENTS ONLY. A document still being read will get its embeddings
   from its own next batch, at the same time as its chunks — filling those in
   from here would race the ingest loop for the same rows and spend the same
   Voyage requests twice.

   THE LOOP IS THE CLIENT'S, same as ingestion: no queue exists (Vercel Hobby
   allows one cron a day), so the library page calls the route, reads what is
   left, and calls again. Every batch is self-contained — it reads what is
   still null, so an abandoned run costs nothing and the next press carries on
   from wherever it stopped.

   IT STOPS RATHER THAN THRASHING. A rate-limited account answers 429 to every
   request in the minute; asking sixty more times would spend the invocation
   and change nothing. The batch says WHY it stopped and the screen says it in
   English. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { embedTexts, isSemanticConfigured, type EmbedFailure } from "./embeddings";

/** Passages per batch. One Voyage request (well under EMBED_BATCH), and 64
    single-row updates, which is a comfortable share of a 300s invocation. */
export const BACKFILL_BATCH = 64;

/** Why a batch stopped early. Absent means it simply finished. */
export type BackfillStop = "rate-limited" | "unconfigured" | "failed";

export type BackfillResult = {
  /** Passages given a vector by this batch. */
  done: number;
  /** Passages still without one, after this batch. */
  remaining: number;
  stopped?: BackfillStop;
};

/* ── the decisions, without the network ────────────────────────────────────*/

/** What a Voyage failure means for the run. Only the rate limit is worth
    saying out loud — it is the one a person can do something about, and the
    one that comes right on its own. */
export function stopForEmbedFailure(reason: EmbedFailure): BackfillStop {
  return reason === "rate-limited" ? "rate-limited" : "failed";
}

/** What is left after a batch. Never negative: the total is read at the start
    of the batch, and an ingest run finishing alongside can make it stale. */
export function remainingAfter(total: number, done: number): number {
  return Math.max(0, Math.max(0, total) - Math.max(0, done));
}

/* ── the work ──────────────────────────────────────────────────────────────*/

/* The org's finished documents.

   A separate read rather than a join: `!inner` embedding depends on PostgREST
   resolving the composite (id, org_id) foreign key, and a library is tens of
   rows, so two round trips is the cheaper thing to be sure about. */
async function readyDocumentIds(orgId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("kb_documents")
    .select("id")
    .eq("org_id", orgId)
    .eq("status", "ready");

  return ((data ?? []) as unknown as { id: unknown }[]).map((r) => String(r.id)).filter(Boolean);
}

/** How many stored passages have no vector — the number the library shows. */
export async function countUnembedded(orgId: string): Promise<number> {
  const docIds = await readyDocumentIds(orgId);
  if (docIds.length === 0) return 0;

  const { count } = await supabaseAdmin
    .from("kb_chunks")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .in("document_id", docIds)
    .is("embedding", null);

  return Number(count) || 0;
}

/* One batch: embed what is still null, and write the vectors back.

   THE ORDER IS STABLE (document, then chunk index) so consecutive calls walk
   the library rather than re-rolling the same rows, and a manual is filled in
   front to back — which is also the order somebody would notice it in.

   Never throws. Every failure comes back as a `stopped` reason with the count
   that was true when the batch started. */
export async function backfillBatch(
  orgId: string,
  limit: number = BACKFILL_BATCH
): Promise<BackfillResult> {
  /* Checked before any work, like the quota in the ingest loop: with no key
     there is nothing to fill these in WITH, and the honest answer is the count
     plus the reason rather than a run that appears to do nothing. */
  if (!isSemanticConfigured())
    return { done: 0, remaining: await countUnembedded(orgId), stopped: "unconfigured" };

  const docIds = await readyDocumentIds(orgId);
  if (docIds.length === 0) return { done: 0, remaining: 0 };

  const { data, count } = await supabaseAdmin
    .from("kb_chunks")
    .select("id, content", { count: "exact" })
    .eq("org_id", orgId)
    .in("document_id", docIds)
    .is("embedding", null)
    .order("document_id", { ascending: true })
    .order("chunk_index", { ascending: true })
    .limit(Math.max(1, Math.trunc(limit) || BACKFILL_BATCH));

  const rows = ((data ?? []) as unknown as Record<string, unknown>[])
    .map((r) => ({ id: String(r.id ?? ""), content: String(r.content ?? "") }))
    .filter((r) => r.id && r.content);

  // the count is the whole backlog; the rows are this batch's share of it
  const total = Number.isFinite(Number(count)) ? Number(count) : rows.length;
  if (rows.length === 0) return { done: 0, remaining: 0 };

  const embedded = await embedTexts(rows.map((r) => r.content), "document");
  if (!embedded.ok) {
    console.error(`[kb-backfill] embed failed for ${orgId} — ${embedded.reason}: ${embedded.detail}`);
    return { done: 0, remaining: total, stopped: stopForEmbedFailure(embedded.reason) };
  }

  // the key went away between the check above and the call — treat it as the
  // same unconfigured answer rather than as zero work for no stated reason
  const vectors = embedded.vectors;
  if (!vectors) return { done: 0, remaining: total, stopped: "unconfigured" };

  /* Row by row, and the same text form ingestion inserts — pgvector parses it,
     and a bulk upsert would have to restate every NOT NULL column of a row we
     only read two fields of. */
  let done = 0;
  for (let i = 0; i < rows.length; i++) {
    const vector = vectors[i];
    if (!vector) break;

    const { error } = await supabaseAdmin
      .from("kb_chunks")
      .update({ embedding: JSON.stringify(vector) })
      .eq("org_id", orgId)
      .eq("id", rows[i].id);

    // the rows already written keep their vectors; the rest are still null and
    // the next batch reads them again
    if (error) {
      console.error(`[kb-backfill] update failed for ${orgId}/${rows[i].id} — ${error.message}`);
      return { done, remaining: remainingAfter(total, done), stopped: "failed" };
    }
    done += 1;
  }

  return { done, remaining: remainingAfter(total, done) };
}
