import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { kbDocsForOrg, type KbDocRow } from "@/lib/tiff/query";
import { kbTagsByDocument, kbTagsForOrg } from "@/lib/tiff/tags-query";
import { shelvesOf } from "@/lib/tiff/shelves";
import type { KbTagRef } from "@/lib/tiff/tags";
import { isSearchable, normaliseQuery, searchTerms, snippetOf, type Segment } from "@/lib/tiff/doc-search";
import { ftsQueryOf } from "@/lib/tiff/query-prep";

/* SEARCHING THE WHOLE LIBRARY AS YOU TYPE, on the phone (Isaac, 30 October
   2026, the Library's second go: "does Tiff work as a search bar too? Or
   always API?"). No model and nothing spent: the manuals whose names say
   what was typed, and the pages that say it, from the full-text index every
   page already carries (drawings included, now that they're read into
   words), the best first. Every word typed is asked for together; where no
   page has them all, any of them, still the best first. Asking Tiff is the
   phone's separate tap. */

/** Pages shown for one search. */
export const LIBRARY_PAGE_HITS = 8;

export type LibraryPageHit = { documentId: string; title: string; pageFrom: number; pageTo: number; segments: Segment[] };
export type LibrarySearch = { manuals: string[]; pages: LibraryPageHit[] };

const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ");

/** The manuals whose names say the most of what was typed: name, maker,
    edition, file name and tags all count. Nothing when no word is in any. Pure. */
export function manualsNamed(q: string, docs: readonly Pick<KbDocRow, "id" | "title" | "source" | "edition" | "fileName">[], tagsOf: Readonly<Record<string, readonly KbTagRef[]>>): string[] {
  const terms = searchTerms(q)
    .map((t) => words(t).trim())
    .filter((t) => t.length >= 2);
  if (!terms.length) return [];
  const scored = docs.map((d) => {
    const hay = ` ${words([d.title, d.source, d.edition, d.fileName, ...(tagsOf[d.id] ?? []).map((t) => t.label)].filter(Boolean).join(" "))} `;
    return { id: d.id, score: terms.filter((t) => hay.includes(t)).length };
  });
  const best = Math.max(0, ...scored.map((s) => s.score));
  return best ? scored.filter((s) => s.score === best).map((s) => s.id) : [];
}

type Ranked = { id: string; document_id: string };

/** Pages read for one search, before the best are kept. */
const CANDIDATES = 40;
/** Read for a search of one brand's manuals, most of which the index's best won't be. */
const CANDIDATES_ONE_BRAND = 160;

/** The pages to choose from: every word together first, then any of them. */
async function pagesFor(orgId: string, q: string, wide: boolean): Promise<Ranked[]> {
  const ask = async (query: string, k: number) => {
    if (!query) return [];
    const { data } = await supabaseAdmin.rpc("kb_fts", { p_org: orgId, p_query: query, p_cats: null, p_k: k, p_doc: null });
    return ((data ?? []) as Ranked[]).filter((r) => r && r.id && r.document_id);
  };
  const [all, any] = await Promise.all([
    ask(normaliseQuery(q), wide ? CANDIDATES : LIBRARY_PAGE_HITS),
    ask(ftsQueryOf(q, []), wide ? CANDIDATES_ONE_BRAND : CANDIDATES),
  ]);
  const seen = new Set(all.map((r) => r.id));
  return [...all, ...any.filter((r) => !seen.has(r.id))];
}

/** How many of the words typed a page says: a page with more of them
    beats one that says one word often ("pumy 140 feet" wants the page with
    the feet, not the page that names the PUMY twenty times). Pure. */
export function wordsSaid(content: string, q: string): number {
  const hay = words(content);
  return searchTerms(q)
    .map((t) => words(t).trim())
    .filter((t) => t.length >= 2 && hay.includes(t)).length;
}

/** What the Library says about what was typed, in this workspace only. */
export async function searchLibrary(orgId: string, raw: string, brand?: string | null): Promise<LibrarySearch> {
  if (!isSearchable(raw)) return { manuals: [], pages: [] };
  const q = normaliseQuery(raw);
  const [docs, tagsOf, orgTags, ranked] = await Promise.all([kbDocsForOrg(orgId), kbTagsByDocument(orgId), kbTagsForOrg(orgId), pagesFor(orgId, q, !!brand)]);
  /* searched from a brand's own page: that brand's manuals only, as its shelves show them */
  const shelving = brand ? shelvesOf(docs, tagsOf, orgTags) : null;
  const ready = docs.filter((d) => d.status === "ready" && (!shelving || shelving.get(d.id)?.maker === brand));
  const titleOf = new Map(ready.map((d) => [d.id, d.title]));
  const hits = ranked.filter((r) => titleOf.has(r.document_id));

  const { data } = hits.length
    ? await supabaseAdmin
        .from("kb_chunks")
        .select("id, content, page_from, page_to")
        .eq("org_id", orgId)
        .in(
          "id",
          hits.map((h) => h.id),
        )
    : { data: [] };
  const chunks = new Map(((data ?? []) as { id: string; content: string | null; page_from: number | null; page_to: number | null }[]).map((c) => [c.id, c]));
  const terms = searchTerms(q);
  /* the most of the words typed first; the index's own order otherwise */
  const best = hits
    .map((h, at) => ({ h, at, said: wordsSaid(chunks.get(h.id)?.content ?? "", q) }))
    .sort((a, b) => b.said - a.said || a.at - b.at)
    .slice(0, LIBRARY_PAGE_HITS);

  return {
    manuals: manualsNamed(q, ready, tagsOf),
    pages: best.flatMap(({ h }) => {
      const c = chunks.get(h.id);
      if (!c) return [];
      const from = Number(c.page_from) || 1;
      return [{ documentId: h.document_id, title: titleOf.get(h.document_id)!, pageFrom: from, pageTo: Number(c.page_to) || from, segments: snippetOf(c.content ?? "", terms) }];
    }),
  };
}
