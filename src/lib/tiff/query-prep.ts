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

import { logUsage } from "./usage";

/* Sonnet 5 at LOW effort. The judgement is shallow ("what would the manual
   call this") and it runs on every question, so it is the wrong place to spend
   an Opus call.

   A CHEAPER MODEL INVENTING A MODEL NUMBER IS INERT HERE, which is what makes
   this swap safe and the same swap in keyword tagging unsafe. Every atom is
   OR-joined, so a term for a part that never existed matches no chunk and
   changes no ranking — it is a wasted atom, not a wrong answer. A keyword
   invented during ingestion is STORED ON THE CHUNK and goes on matching
   searches for as long as the document is in the library. Same failure, one
   inert and one permanent; only the permanent one is worth Opus money. */
const MODEL = "claude-sonnet-5";
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
  /* THE QUESTION AS IT WOULD BE ASKED COLD, which is the only form the library
     can answer. "Can you give me step by step?" is a complete sentence and a
     useless query: the subject is two turns up the conversation, so retrieval
     searched for "step by step", found pages about nothing in particular, and
     the answer came back reading as if the topic had been dropped and picked
     up again from scratch (reported live, 2026-08-08).

     Equal to the question itself when there is no history to fold in, so the
     first question of every conversation is untouched. */
  standalone: string;
};

const PREP_SCHEMA = {
  type: "object",
  properties: {
    standalone: { type: "string" },
    terms: { type: "array", items: { type: "string" } },
  },
  required: ["standalone", "terms"],
  additionalProperties: false,
} as const;

/** Turns replayed to the condenser. Two is enough to resolve "it" and "that";
    more is a summary of the conversation, which is a different job. */
export const PREP_HISTORY_TURNS = 4;

/** A rewritten question longer than this is an essay, not a query. */
export const STANDALONE_MAX_CHARS = 300;

const SYSTEM = [
  "You prepare a technician's question for a search over HVAC and electrical",
  "documents. Two jobs, and the first one comes first.",
  "",
  "1. `standalone` — the question as it would be asked with nobody listening.",
  "   A follow-up carries its subject in the conversation, not in its own words:",
  "   'can you give me step by step?' after an answer about the vacuum setting",
  "   is 'what is the step-by-step procedure for the vacuum setting?'. Resolve",
  "   'it', 'that', 'those' and every bare pronoun against the turns above, and",
  "   carry down the model, code or component under discussion.",
  "   - copy the question verbatim when it already stands on its own",
  "   - never answer it, never add a fact the conversation didn't establish",
  `   - one sentence, at most ${STANDALONE_MAX_CHARS} characters`,
  "",
  "2. `terms` — the words a document would use, expanded from the STANDALONE",
  "   question (not the raw one, or a follow-up expands into nothing).",
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

/* The rewritten question, or the original.

   THE ORIGINAL IS ALWAYS THE SAFE ANSWER. A condenser that returns nothing, an
   empty string, or a paragraph has failed at a job the raw question does
   adequately — searching for itself is how this worked before condensation
   existed. It is never allowed to fail louder than that. */
export function shapeStandalone(raw: unknown, question: string): string {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const value = typeof r.standalone === "string" ? r.standalone : "";
  const text = value.trim().replace(/\s+/g, " ").slice(0, STANDALONE_MAX_CHARS);
  return text || question;
}

/** The turns the condenser reads, oldest first — trimmed to the last few and
    to one line each, because it needs the subject, not the transcript. */
export function historyLines(history: readonly { role: string; text: string }[]): string[] {
  return (history ?? [])
    .slice(-PREP_HISTORY_TURNS)
    .map((turn) => {
      const text = String(turn?.text ?? "").trim().replace(/\s+/g, " ").slice(0, 400);
      if (!text) return "";
      return `${turn.role === "assistant" ? "Tiff" : "Tech"}: ${text}`;
    })
    .filter(Boolean);
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
export async function prepareQuery(
  question: string,
  history: readonly { role: string; text: string }[] = []
): Promise<QueryPlan> {
  const text = String(question ?? "").trim();
  /* Every failure path lands here, and it is the pre-condensation behaviour
     exactly: the question searches for itself. A follow-up asked in a broken
     moment retrieves the way it did before this existed — imperfectly, never
     emptily. */
  const plain = (): QueryPlan => ({ terms: [], ftsQuery: ftsQueryOf(text, []), standalone: text });

  if (!text || offline()) return plain();

  const lines = historyLines(history);

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
      messages: [
        {
          role: "user",
          content: lines.length
            ? `Conversation so far:\n${lines.join("\n")}\n\nQuestion:\n${text}`
            : `Question:\n${text}`,
        },
      ],
    });

    logUsage("prep", MODEL, response.usage);

    /* A refusal is a content outcome, not an error — checked before reading
       content, which is empty or partial in that case. Here it simply means
       the question searches for itself. */
    if (response.stop_reason === "refusal") return plain();

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return plain();

    const parsed = JSON.parse(block.text);
    const terms = shapePrep(parsed);
    /* The rewritten question is what gets searched for — both legs. Composing
       the keyword query from the ORIGINAL would put "step by step" back in the
       atoms and leave the subject out of them. */
    const standalone = shapeStandalone(parsed, text);
    return { terms, ftsQuery: ftsQueryOf(standalone, terms), standalone };
  } catch {
    return plain();
  }
}
