/* Searching inside ONE document — a keyword box, not a question.

   NOT THE SAME THING AS ASKING TIFF, and deliberately so. Asking is for "why
   does this unit short-cycle"; this is for "where does it say P8", which is
   what you do to a manual you already have open. No model, no embedding, no
   allowance spent — just the full-text index every chunk already carries in
   its generated `tsv` column.

   AND IT SEARCHES WHAT A PDF VIEWER CANNOT. The browser's Ctrl+F reads the
   PDF's own text layer, so a page that arrived as a scanned image is invisible
   to it forever. These chunks are what INGESTION read, including anything
   vision recovered from those pages — so a hit can land on a page the viewer
   itself would swear is blank.

   THE MATCHING IS POSTGRES'S, THE WINDOWING IS OURS. `tsv` is a generated
   column and `websearch_to_tsquery` already understands quotes, OR and -, so
   the query goes over as the person typed it. What is pure and testable here
   is the part that decides what a person SEES: which slice of a 1,400-character
   chunk to show, and which runs inside it to mark. */

/** Characters of a chunk shown around the match. Enough for the sentence the
    term sits in plus its neighbours — a hit with no context is a page number,
    not an answer. */
export const SNIPPET_CHARS = 260;

/** Hits returned for one search. Past this the list stops being read. */
export const MAX_DOC_HITS = 50;

/** Longest query worth sending. Beyond this it isn't a keyword any more. */
export const QUERY_MAX_CHARS = 120;

export type Segment = { text: string; hit: boolean };

export type DocHit = {
  chunkId: string;
  pageFrom: number;
  pageTo: number;
  heading: string | null;
  segments: Segment[];
};

/** Is this worth sending? One character isn't — Postgres would happily match
    a prefix of half the manual and the list would be noise. */
export function isSearchable(raw: string): boolean {
  return normaliseQuery(raw).length >= 2;
}

/* The query as it goes to `websearch_to_tsquery`: trimmed and bounded, never
   rewritten. Postgres owns the grammar; a quote the person typed is theirs.

   ANYTHING THAT ISN'T A STRING IS NOTHING, rather than coerced. A server
   action is reachable by direct POST, so this is a boundary — and
   `String({})` would otherwise send "[object Object]" to the index as if
   somebody had typed it. Same rule as the `trim` helper in actions/kb.ts. */
export function normaliseQuery(raw: string): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, QUERY_MAX_CHARS);
}

/* The words to MARK, which is not the same list as the words to MATCH.

   Postgres matched on stems and its own operators; highlighting is a reading
   aid, so it works on what the person actually typed. Operators and the minus
   of an excluded term are dropped — marking "-" helps nobody — and a quoted
   phrase survives whole, because somebody who typed "high pressure" wants that
   pair marked, not every "high" on the page. */
export function searchTerms(raw: string): string[] {
  const query = normaliseQuery(raw);
  const terms: string[] = [];

  for (const [, phrase, word] of query.matchAll(/"([^"]+)"|(\S+)/g)) {
    const term = (phrase ?? word ?? "").trim();
    if (!term) continue;
    /* Tested BEFORE the minus is stripped, not after: `-drain` is a term
       Postgres EXCLUDED, so every row that came back is one the word isn't in.
       Marking it would promise a highlight that can never appear. */
    if (phrase === undefined && term.startsWith("-")) continue;
    if (term.toUpperCase() === "OR" || term.toUpperCase() === "AND") continue;
    terms.push(term);
  }

  /* Deduped case-INSENSITIVELY, because the matching is: "P1" and "p1" mark
     the same runs, and keeping both would walk the content twice for nothing.
     First spelling wins, as it does in keyword shaping. */
  const seen = new Set<string>();
  const unique = terms.filter((t) => {
    const key = t.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // longest first, so "zone controller" marks before "zone" claims its start
  return unique.sort((a, b) => b.length - a.length);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Span = { from: number; to: number };

/** Every place a term appears, merged where they overlap, in order. */
function spansOf(content: string, terms: readonly string[]): Span[] {
  const found: Span[] = [];
  for (const term of terms) {
    if (!term) continue;
    /* Word-ish boundaries, but only where the term's own edge is a word
       character: "PUZ-ZM250VKA" ends on a digit and starts on a letter, while
       a term like "-40" would never match behind \b. */
    const lead = /^\w/.test(term) ? "\\b" : "";
    const tail = /\w$/.test(term) ? "\\b" : "";
    const re = new RegExp(`${lead}${escapeRe(term)}${tail}`, "giu");
    for (const m of content.matchAll(re)) {
      found.push({ from: m.index, to: m.index + m[0].length });
    }
  }

  found.sort((a, b) => a.from - b.from || b.to - a.to);

  const merged: Span[] = [];
  for (const span of found) {
    const last = merged[merged.length - 1];
    if (last && span.from <= last.to) last.to = Math.max(last.to, span.to);
    else merged.push({ ...span });
  }
  return merged;
}

/* The slice of the chunk a person sees, with the matches marked.

   CENTRED ON THE FIRST MATCH, not on the start of the chunk: a 1,400-character
   chunk whose term sits at character 1,200 would otherwise show a window that
   proves nothing, and the reader has to take the hit on trust. Falls back to
   the head of the chunk when nothing matched literally — which happens
   honestly, because Postgres matched a STEM ("charging" found by "charge") and
   the highlighter only marks what was typed. */
export function snippetOf(
  content: string,
  terms: readonly string[],
  max: number = SNIPPET_CHARS
): Segment[] {
  const text = String(content ?? "").replace(/\s+/g, " ").trim();
  const width = Math.max(40, Math.trunc(max) || SNIPPET_CHARS);
  if (!text) return [];

  const spans = spansOf(text, terms);

  let start = 0;
  if (spans.length > 0) {
    // a little room before the term so the sentence it opens still reads
    start = Math.max(0, spans[0].from - Math.floor(width / 3));
  }
  let end = Math.min(text.length, start + width);
  // pull the window back when the tail is short, rather than leaving a gap
  if (end - start < width) start = Math.max(0, end - width);

  /* Don't cut a word in half at either edge — the ellipsis says it continues,
     a severed word just looks like a typo. */
  if (start > 0) {
    const space = text.indexOf(" ", start);
    if (space > 0 && space - start < 20) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space > start && end - space < 20) end = space;
  }

  const head = start > 0 ? "…" : "";
  const tail = end < text.length ? "…" : "";

  const out: Segment[] = [];
  let at = start;
  for (const span of spans) {
    if (span.to <= start) continue;
    if (span.from >= end) break;
    const from = Math.max(span.from, start);
    const to = Math.min(span.to, end);
    if (from > at) out.push({ text: text.slice(at, from), hit: false });
    out.push({ text: text.slice(from, to), hit: true });
    at = to;
  }
  if (at < end) out.push({ text: text.slice(at, end), hit: false });

  if (out.length === 0) return [{ text: `${head}${text.slice(start, end)}${tail}`, hit: false }];
  if (head) out[0] = { ...out[0], text: `${head}${out[0].text}` };
  if (tail) out[out.length - 1] = { ...out[out.length - 1], text: `${out[out.length - 1].text}${tail}` };
  return out;
}

/** "p.42" or "p.42–43" — the same shape the citation chips use. */
export function pageLabel(hit: { pageFrom: number; pageTo: number }): string {
  return hit.pageTo > hit.pageFrom ? `p.${hit.pageFrom}–${hit.pageTo}` : `p.${hit.pageFrom}`;
}
