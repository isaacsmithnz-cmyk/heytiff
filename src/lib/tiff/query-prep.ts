/* Turning a question into something a keyword index can answer.

   "Why is the City Multi throwing P8 in heating?" is a sentence. The manual
   that answers it says "P8 · piping temperature abnormality · check the
   thermistor harness" and never uses the word "throwing". So one cheap call
   expands the question into the terms a document would actually contain —
   codes, components, symptoms, the brand's own vocabulary — and those terms,
   not the sentence, are what the index is asked for.

   THE QUERY FAVOURS RECALL, DELIBERATELY. Every atom is OR-joined: a chunk
   matching any one of them is a candidate, and the ranking (and then the
   fusion with the vector leg) sorts out which ones were worth it. AND-ing the
   terms would demand a chunk containing all of them, which for an expanded
   term list is almost always nothing. A miss here is invisible — the answer
   just quietly doesn't cite the page that had it.

   RETRIEVAL MUST NOT DIE BECAUSE PREPARATION DID. No key, a refusal, a 500 —
   all of them fall back to the raw question as the query, which is what a
   search box would have done anyway. That is why this returns a plan rather
   than a result: there is no failure to report. */

import Anthropic from "@anthropic-ai/sdk";

/* Opus 5 at LOW effort, same lever as keyword tagging: the judgement is
   shallow ("what would the manual call this"), it runs on every research
   question, and a cheaper model invents model numbers that were never real. */
const MODEL = "claude-opus-5";
const MAX_TOKENS = 2_000;

/** Terms per question. Past a dozen the expansion stops being the question. */
export const MAX_TERMS = 12;

/** A search term, not a sentence. */
export const TERM_MAX_CHARS = 60;

/** Atoms in the composed query — the model's terms plus the question's own. */
export const MAX_QUERY_ATOMS = 24;

export type QueryPlan = {
  /** What the model thinks a document would say. Empty when it couldn't be asked. */
  terms: string[];
  /** The composed websearch_to_tsquery string handed to `kb_fts`. */
  ftsQuery: string;
};

const PREP_SCHEMA = {
  type: "object",
  properties: {
    terms: { type: "array", items: { type: "string" } },
  },
  required: ["terms"],
  additionalProperties: false,
} as const;

const SYSTEM = [
  "You expand a technician's question into the terms an HVAC or electrical",
  "document would actually use, so a keyword index can find the right pages.",
  "",
  "List the terms a manual, datasheet or SOP would contain:",
  "- the fault or error code exactly as a document writes it (P8, U4, E5)",
  "- model and part numbers mentioned, normalised to uppercase",
  "- component and system names, including the formal ones a tech wouldn't say",
  "  ('reversing valve', 'liquid line thermistor', 'inverter board')",
  "- the failure mode in the words a manual uses ('abnormal piping temperature')",
  "",
  "Rules:",
  `- at most ${MAX_TERMS} terms, most specific first`,
  "- terms only. Not sentences, not questions.",
  "- expand, don't invent: never produce a model number the question didn't",
  "  give you, and never guess which brand a bare code belongs to.",
  "- a question with nothing searchable in it gets an empty list.",
].join("\n");

const clean = (value: unknown): string =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, TERM_MAX_CHARS) : "";

/** Model output → the terms the query is composed from. Everything is clamped
    here rather than trusted: the schema guarantees an array of strings and
    nothing else about them. */
export function shapePrep(raw: unknown): string[] {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rows = Array.isArray(r.terms) ? r.terms : [];

  const seen = new Set<string>();
  const terms: string[] = [];
  for (const item of rows) {
    const term = clean(item);
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= MAX_TERMS) break;
  }
  return terms;
}

/* The words that carry no meaning to an index, plus the three that ARE
   operators in websearch syntax — a bare "or" atom would change the shape of
   the query rather than search for anything. */
const STOP = new Set([
  "and", "or", "not", "the", "a", "an", "is", "are", "was", "were", "be", "been",
  "for", "with", "what", "why", "how", "when", "where", "which", "who", "does",
  "did", "do", "can", "should", "would", "could", "will", "this", "that", "these",
  "those", "it", "its", "on", "in", "at", "of", "to", "from", "by", "as", "if",
  "but", "our", "we", "you", "your", "i", "me", "my", "there", "here", "get",
  "got", "any", "all", "out", "up", "off", "one", "two", "about", "into", "than",
  "then", "them", "they", "have", "has", "had", "just", "like", "need", "needs",
]);

/* A term the query can carry: no quotes (they'd close the phrase early), no
   leading operator character (`-x` is NOT in websearch syntax), nothing left
   over once punctuation is stripped. */
const scrub = (term: string): string =>
  term.replace(/["'`]/g, " ").replace(/\s+/g, " ").trim().replace(/^[-+]+/, "");

const isUseful = (token: string): boolean => {
  if (STOP.has(token.toLowerCase())) return false;
  // "P8" and "R32" are two characters of pure signal; "is" is two of noise
  return token.length >= 3 || /\d/.test(token);
};

/* The question's own distinctive words, in the order it said them. The model's
   expansion is better vocabulary but it can miss the one word the question was
   actually about, so the question is always represented in its own query. */
function tokensOf(question: string): string[] {
  const words = String(question ?? "")
    .split(/[^\p{L}\p{N}\-_/.]+/u)
    .map((w) => scrub(w).replace(/[.]+$/, ""))
    .filter(Boolean);

  return words.filter(isUseful);
}

/* Compose the query `kb_fts` runs.

   websearch_to_tsquery's grammar: a space is AND, the literal word OR is OR,
   and double quotes make a phrase. So a multi-word term is quoted (otherwise
   "reversing valve" would AND its two words across the whole chunk, matching
   a page that says "valve" in one paragraph and "reversing" in another), and
   every atom is joined with OR.

   Deterministic: same question and terms, same string, every time. */
export function ftsQueryOf(question: string, terms: readonly string[]): string {
  const atoms: string[] = [];
  const seen = new Set<string>();

  const push = (value: string) => {
    const term = scrub(value);
    if (!term) return;
    const key = term.toLowerCase();
    if (seen.has(key) || STOP.has(key)) return;
    seen.add(key);
    atoms.push(term.includes(" ") ? `"${term}"` : term);
  };

  for (const term of terms ?? []) push(term);
  for (const token of tokensOf(question)) push(token);

  return atoms.slice(0, MAX_QUERY_ATOMS).join(" OR ");
}

/** No key, no expansion — and no error either. The question searches for
    itself, which is exactly what a search box would have done. */
const offline = () => !process.env.ANTHROPIC_API_KEY;

/** Expand the question, or don't. Never throws, and never returns a plan the
    caller can't search with. */
export async function prepareQuery(question: string): Promise<QueryPlan> {
  const text = String(question ?? "").trim();
  const plain = (): QueryPlan => ({ terms: [], ftsQuery: ftsQueryOf(text, []) });

  if (!text || offline()) return plain();

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: PREP_SCHEMA },
      },
      system: SYSTEM,
      messages: [{ role: "user", content: `Question:\n${text}` }],
    });

    /* A refusal is a content outcome, not an error — checked before reading
       content, which is empty or partial in that case. Here it simply means
       the question searches for itself. */
    if (response.stop_reason === "refusal") return plain();

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return plain();

    const terms = shapePrep(JSON.parse(block.text));
    return { terms, ftsQuery: ftsQueryOf(text, terms) };
  } catch {
    return plain();
  }
}
