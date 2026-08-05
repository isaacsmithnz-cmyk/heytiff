/* Finding the pages that answer the question.

   TWO LEGS, RUN TOGETHER, FUSED IN TYPESCRIPT. The keyword leg matches what a
   tech types — a code, a model number, a part name — and the vector leg
   matches what they meant. Neither is enough on its own: "P8" is invisible to
   an embedding, and "it keeps icing up in defrost" is invisible to a keyword
   index. `lib/tiff/rank.ts` merges them without either leg's scores having to
   mean anything to the other.

   THE VECTOR LEG IS OPTIONAL, ALWAYS. Without VOYAGE_API_KEY there are no
   query vectors and no stored ones either, so that leg is skipped and the
   keyword leg carries search alone. Everything downstream is written as though
   a leg returning nothing is ordinary, because on day one it is.

   THE ORG IS ON EVERY QUERY. The RPCs take it, the chunk read takes it, the
   document read takes it. Three chances to be right about whose library this
   is, which is the number the rest of the app uses. */

import { supabaseAdmin } from "@/lib/supabase-server";
import type { AskSourceItem } from "./ask-client";
import { embedTexts, isSemanticConfigured, type EmbedResult } from "./embeddings";
import { asKbCategory, type KbCategory } from "./files";
import { prepareQuery } from "./query-prep";
import { addKbUsage } from "./quota";
import {
  buildTrace,
  capByBudget,
  rrfMerge,
  type KbTrace,
  type LegRow,
  type TraceDoc,
} from "./rank";

/** Candidates per leg. Wide enough that fusion has something to fuse, small
    enough that the two hydrating reads stay one round trip each. */
export const LEG_LIMIT = 30;

/** Characters of a chunk kept for the peek panel. About a screen of text. */
export const EXCERPT_CHARS = 1_200;

export type RetrievedChunk = {
  id: string;
  documentId: string;
  content: string;
  pageFrom: number;
  pageTo: number;
  heading: string | null;
  /** The document's title and shelf, carried so the answer call can label it. */
  title: string;
  category: KbCategory;
};

export type Retrieval = {
  /** What the answer is allowed to read, best first. */
  chunks: RetrievedChunk[];
  trace: KbTrace & { terms: string[] };
  /** One per chunk, numbered in retrieval order — renumbered once cited. */
  sources: AskSourceItem[];
};

const EMPTY_TRACE = (terms: string[]): Retrieval["trace"] => ({
  categories: {
    install: { hits: 0, topDoc: null },
    faults: { hits: 0, topDoc: null },
    specs: { hits: 0, topDoc: null },
    sops: { hits: 0, topDoc: null },
  },
  winners: [],
  terms,
});

const legRowsOf = (data: unknown): LegRow[] =>
  ((data ?? []) as Record<string, unknown>[])
    .map((r) => ({ id: String(r?.id ?? ""), documentId: String(r?.document_id ?? "") }))
    .filter((r) => r.id && r.documentId);

const num = (value: unknown, fallback: number): number =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

/** Search the org's library for the question. Never throws: a leg that errors
    is a leg that found nothing, and zero hits is a real answer the caller
    renders honestly rather than an exception. */
export async function retrieveForQuestion(orgId: string, question: string): Promise<Retrieval> {
  /* The expansion call and the query embedding are independent and both cost
     a network round trip on the critical path — the user is watching a typing
     indicator for the sum of everything here. */
  const [plan, embedded] = await Promise.all([
    prepareQuery(question),
    isSemanticConfigured()
      ? embedTexts([question], "query")
      : Promise.resolve<EmbedResult>({ ok: true, vectors: null }),
  ]);

  const qvec = embedded.ok ? (embedded.vectors?.[0] ?? null) : null;

  const [fts, vec] = await Promise.all([
    supabaseAdmin.rpc("kb_fts", {
      p_org: orgId,
      p_query: plan.ftsQuery,
      // no category filter: the whole point of the trace is to show WHICH
      // shelf answered, which means every shelf has to have been asked
      p_cats: null,
      p_k: LEG_LIMIT,
    }),
    qvec
      ? supabaseAdmin.rpc("kb_vec", {
          p_org: orgId,
          // pgvector parses its own text form; the same shape ingestion stores
          p_qvec: JSON.stringify(qvec),
          p_cats: null,
          p_k: LEG_LIMIT,
        })
      : Promise.resolve({ data: null }),
  ]);

  const merged = rrfMerge(legRowsOf(fts?.data), legRowsOf(vec?.data));
  if (merged.length === 0) return { chunks: [], trace: EMPTY_TRACE(plan.terms), sources: [] };

  /* Both legs already told us which document each chunk belongs to, so the
     two hydrating reads don't depend on each other. */
  const chunkIds = merged.map((m) => m.id);
  const docIds = [...new Set(merged.map((m) => m.documentId))];

  const [chunkRes, docRes] = await Promise.all([
    supabaseAdmin
      .from("kb_chunks")
      .select("id, document_id, content, page_from, page_to, heading")
      .eq("org_id", orgId)
      .in("id", chunkIds),
    supabaseAdmin
      .from("kb_documents")
      .select("id, title, category")
      .eq("org_id", orgId)
      .in("id", docIds),
  ]);

  const docsById: Record<string, TraceDoc> = {};
  for (const row of (docRes?.data ?? []) as unknown as Record<string, unknown>[]) {
    const category = asKbCategory(row.category);
    if (!category) continue;
    docsById[String(row.id)] = { title: String(row.title ?? "Untitled"), category };
  }

  const rowsById = new Map<string, Record<string, unknown>>();
  for (const row of (chunkRes?.data ?? []) as unknown as Record<string, unknown>[]) {
    rowsById.set(String(row.id), row);
  }

  /* Back into ranking order. A chunk whose row or document has gone missing
     between the search and the read is dropped rather than rendered as a
     citation to nothing. */
  const ordered: RetrievedChunk[] = [];
  for (const m of merged) {
    const row = rowsById.get(m.id);
    const doc = docsById[m.documentId];
    if (!row || !doc) continue;
    const pageFrom = num(row.page_from, 1);
    ordered.push({
      id: m.id,
      documentId: m.documentId,
      content: String(row.content ?? ""),
      pageFrom,
      pageTo: num(row.page_to, pageFrom),
      heading: (row.heading as string) ?? null,
      title: doc.title,
      category: doc.category,
    });
  }

  const chunks = capByBudget(ordered);
  const trace = buildTrace(ordered, docsById, chunks);

  return {
    chunks,
    trace: { ...trace, terms: plan.terms },
    sources: chunks.map((c, i) => ({
      n: i + 1,
      chunkId: c.id,
      docId: c.documentId,
      title: c.title,
      category: c.category,
      pageFrom: c.pageFrom,
      pageTo: c.pageTo,
      excerpt: c.content.slice(0, EXCERPT_CHARS),
    })),
  };
}

/* One more question this month.

   COUNTED, NOT CAPPED — the counter exists from day one so a ceiling later is
   a constant and a check rather than a migration. Research questions only: a
   general-knowledge answer never touches the library.

   Fire-and-forget by design, and it swallows its own failure: a counter that
   didn't increment is a reporting inaccuracy, and making the person wait for
   it (or fail because of it) would be a worse trade than the number. */
export async function recordQuestion(orgId: string): Promise<void> {
  try {
    await addKbUsage(orgId, { questions: 1 });
  } catch {
    /* the answer is the product; the count is bookkeeping */
  }
}
