/* Merging the two search legs, and deciding what fits in the question.

   TWO LEGS RETURN TWO DIFFERENT KINDS OF NUMBER. `kb_fts` scores by cover
   density (bigger is better, unbounded); `kb_vec` returns cosine distance
   (smaller is better, 0–2). Comparing them directly means inventing a scale
   factor that is wrong for every query. RECIPROCAL RANK FUSION avoids the
   question entirely: it throws the scores away and keeps only the POSITION in
   each list, so a chunk that both legs rank highly wins, and a chunk only one
   leg found still places. `k` is the standard damping constant — it flattens
   the difference between 1st and 2nd so a single confident leg can't dominate.

   THE BUDGET IS A REAL CONSTRAINT, not a tidiness rule: every chunk is a
   `document` block on the answer call, and each one is billed on every turn of
   the conversation. Twelve chunks of ~1,400 characters is a generous answer
   and a few cents; thirty is neither better nor affordable.

   ALL PURE. This is the part of retrieval whose behaviour must be provable
   without a database, so nothing here touches one. */

import type { KbCategory } from "./files";

/** One row from a search leg, in the order that leg ranked it. */
export type LegRow = { id: string; documentId: string };

export type MergedChunk = {
  id: string;
  documentId: string;
  /** The fused score. Higher is better; only the ordering is meaningful. */
  score: number;
  /** 1-based position in each leg, or null when that leg didn't find it. */
  ftsRank: number | null;
  vecRank: number | null;
};

/** The RRF damping constant. 60 is the value the original paper settled on and
    the one every implementation since has used; it is exposed so a test can
    reason about the arithmetic with a smaller number. */
export const RRF_K = 60;

/* Reciprocal Rank Fusion: score = Σ 1/(k + rank), rank 1-based per leg.

   ORDER IS STABLE. Ties are common — two chunks found only by the keyword leg
   at adjacent positions differ in the sixth decimal place — so insertion order
   (keyword leg first, then anything only the vector leg found) breaks them.
   A stable sort over a map built in that order is the whole mechanism. */
export function rrfMerge(
  ftsRows: readonly LegRow[],
  vecRows: readonly LegRow[],
  k: number = RRF_K
): MergedChunk[] {
  const byId = new Map<string, MergedChunk>();

  const add = (rows: readonly LegRow[], leg: "ftsRank" | "vecRank") => {
    rows.forEach((row, i) => {
      if (!row?.id) return;
      const rank = i + 1;
      const existing = byId.get(row.id);
      if (existing) {
        // a leg listing the same chunk twice is the leg's problem, not ours:
        // the first (better) position is the one that counts
        if (existing[leg] !== null) return;
        existing[leg] = rank;
        existing.score += 1 / (k + rank);
        return;
      }
      byId.set(row.id, {
        id: row.id,
        documentId: row.documentId,
        score: 1 / (k + rank),
        ftsRank: leg === "ftsRank" ? rank : null,
        vecRank: leg === "vecRank" ? rank : null,
      });
    });
  };

  add(ftsRows, "ftsRank");
  add(vecRows, "vecRank");

  return [...byId.values()].sort((a, b) => b.score - a.score);
}

/** ~48k characters is roughly 12k tokens of excerpt — a large but sane share
    of one answer call, and well inside what stays coherent to read. */
export const MAX_CONTEXT_CHARS = 48_000;

/** Past a dozen excerpts the answer stops citing the later ones anyway. */
export const MAX_CONTEXT_CHUNKS = 12;

/* Take from the top until either ceiling is reached.

   THE FIRST CHUNK ALWAYS GOES IN, even if it is on its own bigger than the
   budget: "the best match was too long to show you" is not an answer anybody
   wants, and the alternative is an empty context that reads as "nothing in
   your library covered this" — a lie. */
export function capByBudget<T extends { content: string }>(
  chunks: readonly T[],
  maxChars: number = MAX_CONTEXT_CHARS,
  maxCount: number = MAX_CONTEXT_CHUNKS
): T[] {
  const out: T[] = [];
  let chars = 0;

  for (const chunk of chunks) {
    if (out.length >= maxCount) break;
    const size = chunk.content?.length ?? 0;
    if (out.length > 0 && chars + size > maxChars) break;
    out.push(chunk);
    chars += size;
  }
  return out;
}

export type TraceDoc = { title: string; category: KbCategory };

export type TraceCategory = {
  /** Chunks this category contributed to the merged set. */
  hits: number;
  /** The best-ranked document's title, or null when the category had none. */
  topDoc: string | null;
};

export type KbTrace = {
  categories: Record<KbCategory, TraceCategory>;
  /** The categories the answer is actually built from, best first. */
  winners: KbCategory[];
};

const EMPTY_CATEGORIES = (): Record<KbCategory, TraceCategory> => ({
  install: { hits: 0, topDoc: null },
  faults: { hits: 0, topDoc: null },
  specs: { hits: 0, topDoc: null },
  sops: { hits: 0, topDoc: null },
});

/* What the search actually found, per shelf — the numbers the four cards show
   and (next phase) the numbers the lines animate.

   HITS COUNT THE MERGED SET, WINNERS COME FROM THE CAPPED ONE. They answer two
   different questions: "did this shelf have anything to say" (everything the
   legs found) versus "is this shelf in the answer" (only what was actually
   sent). A category with four hits that all fell off the budget is honestly
   reported as searched-and-found but not cited. `capped` defaults to the
   merged set so a caller with no budgeting step still gets a sane trace. */
export function buildTrace<T extends { documentId: string }>(
  merged: readonly T[],
  docsById: Readonly<Record<string, TraceDoc>>,
  capped: readonly T[] = merged
): KbTrace {
  const categories = EMPTY_CATEGORIES();

  for (const chunk of merged) {
    const doc = docsById[chunk.documentId];
    if (!doc) continue; // a chunk whose document went away mid-question
    const row = categories[doc.category];
    if (!row) continue;
    row.hits += 1;
    // merged order is rank order, so the first one seen is the best one
    if (row.topDoc === null) row.topDoc = doc.title;
  }

  const winners: KbCategory[] = [];
  for (const chunk of capped) {
    const doc = docsById[chunk.documentId];
    if (!doc) continue;
    if (!winners.includes(doc.category)) winners.push(doc.category);
  }

  return { categories, winners };
}

/* Retrieved order in, CITED order out.

   The answer call is given the documents in ranking order and cites them by
   index into it — but the reader's "1" should be the first source the ANSWER
   leaned on, not the first one the search happened to rank. So the chips are
   renumbered against the order the citations arrived in, and anything the
   answer never cited drops off entirely rather than sitting under the answer
   implying it was used.

   Generic so it stays here, next to the ranking it undoes, without this module
   having to know what a source is. */
export function citationOrder<T>(sources: readonly T[], citedIndexes: readonly number[]): T[] {
  const out: T[] = [];
  const seen = new Set<number>();

  for (const index of citedIndexes) {
    if (!Number.isInteger(index) || index < 0 || index >= sources.length) continue;
    if (seen.has(index)) continue;
    seen.add(index);
    out.push(sources[index]);
  }
  return out;
}
