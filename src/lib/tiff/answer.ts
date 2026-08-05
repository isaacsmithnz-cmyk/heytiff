/* The answer itself — server only, and the one place in this feature that
   talks to a model while somebody is watching.

   IT IS A STREAM BECAUSE THE ALTERNATIVE IS A BLANK SCREEN. A researched
   answer over a dozen manual excerpts is tens of seconds of thinking before
   the first word; delivered as one response that is a spinner, delivered as
   deltas it is an answer being written. Everything downstream of here — the
   route's NDJSON framing, the client's reader — exists to keep that property.

   CITATIONS ARE THE API'S, NOT THE PROMPT'S. Each excerpt goes in as its own
   `document` block with `citations: { enabled: true }`, and the model reports
   which one it used as a `citations_delta` carrying the block's index. No "[3]"
   convention to explain in the prompt, no regex to parse it back out, and no
   way for the model to cite a source that wasn't given to it — the index is
   into the list we built.

   THINKING IS ON BY DEFAULT ON THIS MODEL and is never forwarded. Thinking
   blocks arrive with empty text anyway, but the rule is stated because the
   loop below deliberately forwards `text_delta` and nothing else.

   A GENERATOR IS THE SEAM. Tests drive the route by replacing this module, so
   the route never needs the SDK mocked — the house rule is that no test mocks
   `@anthropic-ai/sdk`. */

import Anthropic from "@anthropic-ai/sdk";
import type { AskTurn } from "./ask-client";

const MODEL = "claude-opus-5";
const MAX_TOKENS = 16_000;

/** One excerpt as the model sees it: a label, and the page's text. */
export type AnswerDocument = { title: string; content: string };

export type AnswerEvent =
  | { type: "delta"; text: string }
  /** Index into the documents array, in the order it was given. */
  | { type: "citation"; documentIndex: number }
  /** The answer hit the ceiling mid-sentence. */
  | { type: "truncated" }
  | { type: "error"; message: string };

/** general = no library at all · research = answer only from the excerpts ·
    miss = the library was searched and had nothing, say so and carry on. */
export type AnswerMode = "general" | "research" | "miss";

export type AnswerInput = {
  question: string;
  history: readonly AskTurn[];
  documents: readonly AnswerDocument[];
  mode: AnswerMode;
  /** The request's own signal — a closed tab must stop the generation. */
  signal?: AbortSignal;
};

/* ── what Tiff is told it is ─────────────────────────────────────────────── */

const BASE = [
  "You are Tiff, the HVAC assistant for an Australian trade business. You are",
  "talking to technicians, estimators and owners — people who will act on the",
  "answer, often standing in front of the equipment.",
  "",
  "Write in Australian English, for Australian practice: metric units, AS/NZS",
  "wiring rules, the refrigerants used here. Be direct and concrete. Lead with",
  "the answer, then the reasoning if it earns its place. Say plainly when you",
  "don't know something instead of filling the gap.",
  "",
  "FORMATTING — the screen renders exactly four things, and anything else",
  "arrives as literal characters in front of the reader:",
  "",
  "  1. Short paragraphs, separated by a blank line.",
  "  2. Bullet lines beginning '- ', where a list is the shape of the answer.",
  "  3. Numbered steps beginning '1. ', '2. ' — use these when the ORDER is",
  "     the instruction: a procedure, a diagnostic sequence, a commissioning",
  "     run. Never number a list whose order does not matter.",
  "  4. Pipe tables, for data that genuinely has columns — a resistance curve,",
  "     running pressures by ambient, capacities by model. Write them as:",
  "        | Coil temp | Resistance |",
  "        | --- | --- |",
  "        | 0°C | 15.0 kΩ |",
  "     The header row and the '| --- |' rule are both required. Keep tables",
  "     to four columns or fewer — they are read on a phone in a plant room.",
  "     Do NOT use a table for two numbers that belong in a sentence.",
  "",
  "No headings, no code fences, no bold or italic markers. Fault codes and",
  "model numbers are written as ordinary words in a sentence.",
].join("\n");

const GENERAL = [
  "",
  "You are answering from general HVAC knowledge. None of this company's own",
  "documents are in front of you for this question, so never write as though",
  "you are quoting one, and never invent a page or a manual to point at.",
].join("\n");

const RESEARCH = [
  "",
  "You have been given excerpts from this company's own library — manufacturer",
  "manuals, fault-code books, datasheets and SOPs. Answer ONLY from them, and",
  "cite the excerpt behind every factual claim.",
  "",
  "If the excerpts do not answer the question, say so plainly in a sentence and",
  "say what they DO cover. Do not pad the gap with general knowledge, and do not",
  "guess at the part of the question they miss — an honest short answer with a",
  "citation is worth more here than a long one without.",
].join("\n");

const MISS = [
  "",
  "The library was searched for this question and nothing in it matched.",
  "",
  "Open with one sentence saying exactly that, and name the kind of document",
  "that would have answered it — the installation manual for that model, the",
  "brand's fault-code book, the company SOP. Then answer from general HVAC",
  "knowledge, clearly framed as general knowledge rather than as this company's",
  "documented practice, and never imply a document said any of it.",
].join("\n");

/** The instruction for one mode. Pure, so the three variants are readable side
    by side in a test rather than only in production. */
export function systemPromptFor(mode: AnswerMode): string {
  if (mode === "research") return BASE + RESEARCH;
  if (mode === "miss") return BASE + MISS;
  return BASE + GENERAL;
}

/** The label on an excerpt — what the citation will name it. */
export function documentTitleOf(doc: { title: string; pageFrom: number; pageTo: number }): string {
  const pages = doc.pageTo > doc.pageFrom ? `${doc.pageFrom}–${doc.pageTo}` : `${doc.pageFrom}`;
  return `${doc.title} — p.${pages}`;
}

/* Prior turns, shaped into messages.

   A conversation must open on a `user` turn, and the caller hands us a window
   of the last few — which can begin anywhere. Leading assistant turns are
   dropped rather than sent, because the alternative is a 400 in the middle of
   somebody's follow-up question. */
export function historyMessages(turns: readonly AskTurn[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const turn of turns ?? []) {
    const text = typeof turn?.text === "string" ? turn.text.trim() : "";
    if (!text) continue;
    const role = turn.role === "assistant" ? "assistant" : "user";
    if (out.length === 0 && role === "assistant") continue;
    out.push({ role, content: text });
  }
  return out;
}

/* ── failures, in the house's four branches ──────────────────────────────── */

const NO_KEY = "Tiff isn't switched on yet — no answer service is configured.";
const REFUSED = "Tiff couldn't answer that one.";
const FAILED = "Tiff couldn't answer that just now. Try again.";

function reasonFor(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return NO_KEY;
  if (err instanceof Anthropic.RateLimitError) return "Tiff is too busy right now — try again in a moment.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Tiff just now. Try again.";
  if (err instanceof Anthropic.APIError) return FAILED;
  return FAILED;
}

const offline = () => !process.env.ANTHROPIC_API_KEY;

/* Ask, and hand back the answer a piece at a time.

   Never throws: every failure is a final `error` event, because the caller is
   already streaming to somebody and an exception there is a dead connection
   rather than a sentence on the screen.

   An abort ends the generator silently — the reader has gone, so there is
   nobody to tell. */
export async function* streamAnswer(input: AnswerInput): AsyncGenerator<AnswerEvent> {
  const question = String(input.question ?? "").trim();
  if (!question) return;
  if (offline()) {
    yield { type: "error", message: NO_KEY };
    return;
  }

  const client = new Anthropic();

  /* Each excerpt is its own document block, in the ranking order the search
     produced — `document_index` on a citation is an index into THIS array, so
     the order is the contract with the sources chips. */
  const documents = input.documents.map((doc) => ({
    type: "document" as const,
    source: {
      type: "text" as const,
      media_type: "text/plain" as const,
      data: doc.content,
    },
    title: doc.title,
    citations: { enabled: true },
  }));

  let stream: ReturnType<typeof client.beta.messages.stream>;
  try {
    /* The safety classifiers on this model can decline a benign trade question
       (HVAC brushes against "cyber" strings like fault-injection often enough
       to care). `fallbacks` re-runs a declined request on Opus 4.8 server-side
       instead of surfacing the refusal. The installed SDK (0.112.3) types the
       ARRAY form only — the newer `"default"` scalar is a different beta
       header and is not typed here, so the pinned model it is. */
    stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: "claude-opus-4-8" }],
      // stated rather than inherited: a trade answer over a dozen excerpts is
      // not a research task, and `high` spends minutes the person is watching
      output_config: { effort: "medium" },
      system: systemPromptFor(input.mode),
      messages: [
        ...historyMessages(input.history),
        {
          role: "user",
          content: [...documents, { type: "text", text: question }],
        },
      ],
    });
  } catch (err) {
    yield { type: "error", message: reasonFor(err) };
    return;
  }

  const abort = () => stream.controller.abort();
  input.signal?.addEventListener("abort", abort, { once: true });

  try {
    for await (const event of stream) {
      if (event.type !== "content_block_delta") continue;
      const delta = event.delta;

      if (delta.type === "text_delta") {
        yield { type: "delta", text: delta.text };
        continue;
      }
      if (delta.type === "citations_delta") {
        const citation = delta.citation;
        // web-search citations carry no document index; ours always do
        if ("document_index" in citation) {
          yield { type: "citation", documentIndex: citation.document_index };
        }
      }
      // thinking and signature deltas are never forwarded, by design
    }

    const final = await stream.finalMessage();

    /* Branch on stop_reason, never on stop_details — the details object is
       informational and is null even on some refusals. */
    if (final.stop_reason === "refusal") {
      yield { type: "error", message: REFUSED };
    } else if (final.stop_reason === "max_tokens") {
      yield { type: "truncated" };
    }
  } catch (err) {
    if (input.signal?.aborted) return;
    yield { type: "error", message: reasonFor(err) };
  } finally {
    input.signal?.removeEventListener("abort", abort);
  }
}
