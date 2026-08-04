/* Keyword tagging — the half of search that an embedding is bad at.

   "P8", "PUZ-ZM250VKA", "TXV", "5-way valve". A vector model turns those into
   a fuzzy neighbourhood of similar-looking strings; a keyword index matches
   them exactly, which is what a tech standing in front of a controller needs.
   So every chunk carries a short list of the terms someone would actually type,
   and those terms are weighted 'A' in the tsvector — above the heading, above
   the prose.

   WHY A MODEL RATHER THAN A REGEX: model numbers have no single shape across
   brands, fault codes collide with ordinary words ("E5", "U0"), and the useful
   symptom terms ("short cycling", "iced up") are never verbatim in the text.

   TWO LAYERS OF VALIDATION, as everywhere else here: `output_config.format`
   guarantees the SHAPE, `shapeKeywords` guarantees the CONTENT — alignment to
   the chunks it was given, a cap per chunk, and nothing long enough to be a
   sentence. It is pure, so those rules are tested without a network call.

   FAILURE IS NOT FATAL. Keywords are an enhancement on top of full-text search
   over the content itself; a batch that can't be tagged is indexed untagged,
   and ingestion carries on. */

import Anthropic from "@anthropic-ai/sdk";

/* Opus 5 at LOW effort. The judgement needed is "which of these strings would
   somebody search for", which is shallow — but it is applied to trade text
   full of part numbers, and a cheaper model reliably hallucinates plausible
   model numbers that were never on the page. Low effort is the lever that
   makes tagging a 300-page manual affordable. */
const MODEL = "claude-opus-5";
const MAX_TOKENS = 16_000;

/** Chunks per call. Twenty-five 1,400-character chunks is ~9k tokens in — a
    comfortable request that still amortises the call across a whole batch. */
export const KEYWORD_BATCH = 25;

/** Per chunk. Past ten, the terms stop being what anyone would type. */
export const MAX_KEYWORDS = 10;

/** A keyword is a term, not a sentence. */
export const KEYWORD_MAX_CHARS = 40;

export type KeywordResult =
  | { ok: true; keywords: string[][] }
  | { ok: false; error: string };

const KEYWORDS_SCHEMA = {
  type: "object",
  properties: {
    keywords: {
      type: "array",
      items: { type: "array", items: { type: "string" } },
    },
  },
  required: ["keywords"],
  additionalProperties: false,
} as const;

const SYSTEM = [
  "You tag excerpts from HVAC and electrical documentation so a technician can",
  "find them again by searching. For each excerpt, list the terms someone would",
  "actually type into a search box to reach it:",
  "",
  "- model and part numbers, normalised to uppercase (PUZ-ZM250VKA, R32)",
  "- error and fault codes exactly as the document writes them (P8, U0, E5)",
  "- component names (reversing valve, TXV, inverter board)",
  "- symptoms and failure modes in a tech's words (short cycling, iced up)",
  "",
  "Rules:",
  `- at most ${MAX_KEYWORDS} terms per excerpt, fewest first — a precise term`,
  "  beats a generic one, and 'air conditioner' helps nobody",
  "- terms only. Not sentences, not descriptions.",
  "- ONLY what the excerpt actually says. Never infer a model number from a",
  "  brand, or a code from a symptom.",
  "- an excerpt with nothing searchable in it (a title page, a legal notice)",
  "  gets an empty list. That is a correct answer.",
  "",
  "Return one list per excerpt, in the same order you were given them, with",
  "exactly as many lists as there were excerpts.",
].join("\n");

/* Model output → the keyword rows ingestion will store.

   ALIGNMENT IS THE WHOLE CONTRACT: row i belongs to chunk i, and a response
   that is short, long, ragged or not an array at all must still produce
   exactly `expectedLen` rows — otherwise a keyword list silently attaches to
   the wrong chunk, which is worse than no keywords. */
export function shapeKeywords(raw: unknown, expectedLen: number): string[][] {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rows = Array.isArray(r.keywords) ? r.keywords : [];

  const out: string[][] = [];
  for (let i = 0; i < Math.max(0, Math.trunc(expectedLen)); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) {
      out.push([]); // a missing row is no keywords, never a shifted one
      continue;
    }
    const seen = new Set<string>();
    const terms: string[] = [];
    for (const item of row) {
      if (typeof item !== "string") continue;
      const term = item.trim().slice(0, KEYWORD_MAX_CHARS);
      if (!term) continue;
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      terms.push(term);
      if (terms.length >= MAX_KEYWORDS) break;
    }
    out.push(terms);
  }
  return out;
}

/** No key, no tagging — and no error either. The library still ingests, still
    searches, and simply carries no 'A'-weighted terms until a key exists. */
const offline = () => !process.env.ANTHROPIC_API_KEY;

/* The same four-branch ladder as note-brain.ts and fleet-ai.ts, worded for
   ingestion. The APIError branch matters: without it every 4xx and 5xx that
   isn't auth or rate-limit lands on the generic sentence, which is the one
   that tells you least. */
function reasonFor(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Keyword tagging isn't switched on.";
  if (err instanceof Anthropic.RateLimitError) return "Too busy to tag keywords right now.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the keyword tagger.";
  if (err instanceof Anthropic.APIError) return "The keyword tagger errored.";
  return "Those pages couldn't be keyword-tagged.";
}

async function tagOne(chunks: readonly string[]): Promise<KeywordResult> {
  const client = new Anthropic();
  const content = chunks
    .map((text, i) => `<excerpt index="${i}">\n${text}\n</excerpt>`)
    .join("\n\n");

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: KEYWORDS_SCHEMA },
      },
      system: SYSTEM,
      messages: [
        { role: "user", content: `${chunks.length} excerpts:\n\n${content}` },
      ],
    });

    /* A refusal is a content outcome, not an error — check it before reading
       content, which is empty or partial in that case. */
    if (response.stop_reason === "refusal") return { ok: false, error: "Those pages couldn't be keyword-tagged." };

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return { ok: false, error: "Those pages couldn't be keyword-tagged." };

    return { ok: true, keywords: shapeKeywords(JSON.parse(block.text), chunks.length) };
  } catch (err) {
    return { ok: false, error: reasonFor(err) };
  }
}

/** Tag a batch of chunks, one call per KEYWORD_BATCH of them. Never throws.

    A failed sub-batch fails the whole call rather than returning a partly
    tagged set — the caller's fallback is "index this batch untagged", and a
    result that is half-tagged with no way to tell which half is a worse thing
    to store than one that is honestly empty. */
export async function tagChunks(chunks: readonly string[]): Promise<KeywordResult> {
  if (chunks.length === 0) return { ok: true, keywords: [] };
  if (offline()) return { ok: true, keywords: chunks.map(() => []) };

  const keywords: string[][] = [];
  for (let i = 0; i < chunks.length; i += KEYWORD_BATCH) {
    const slice = chunks.slice(i, i + KEYWORD_BATCH);
    const result = await tagOne(slice);
    if (!result.ok) return result;
    keywords.push(...result.keywords);
  }
  return { ok: true, keywords };
}
