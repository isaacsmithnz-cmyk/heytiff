/* Reading the pages the text layer couldn't: scanned images, through vision.

   OPT-IN, AND OFFERED WHERE IT MEANS SOMETHING. You only learn a document has
   image-only pages AFTER it has been read, so this is not an upload switch —
   it is an action on the row that says "3 pages unreadable", pressed by
   somebody who has just been told those pages exist. Ingestion stays cheap and
   predictable by default; this is the deliberate spend on top.

   THE PAGES ARE SLICED OUT, NOT SENT WHOLE. Claude reads a PDF natively, so
   there is no canvas and no rasterising here — but posting a 385-page manual
   to recover three pages would cost several hundred thousand tokens of the
   other 382. pdf-lib copies just the pages we want into a small document,
   which is the whole reason a PDF WRITER is a dependency of a library that
   otherwise only reads them.

   POSITION IS THE CONTRACT, NOT THE MODEL'S PAGE NUMBERS. A sliced PDF is
   numbered 1..n and the model can only see those; the real page numbers live
   in the array we sliced FROM. So the answer is one entry per page in order,
   re-seated by index — never a page number the model wrote down, which would
   put a citation on the wrong page of the manual.

   IT IS ALLOWED TO FIND NOTHING. A page can be a photograph, a blank scan or a
   diagram with no lettering; those come back empty and stay counted as
   unreadable rather than being indexed as a chunk of nothing. */

import Anthropic from "@anthropic-ai/sdk";
import { mapCapped } from "./fanout";
import { isScannedPage } from "./extract";
import type { PageText } from "./chunk";

/* Vision, so the model choice is about perception rather than reasoning — but
   the text being perceived is model numbers, dip-switch tables and wiring
   labels, where a plausible misread is worse than a gap. Low effort keeps a
   transcription pass affordable; the same lever, for the same reason, as
   keyword tagging. */
const MODEL = "claude-opus-5";

/** Room for the transcription AND the thinking above it — Opus 5 thinks by
    default and `max_tokens` caps the pair. Kept under the streaming threshold
    so a batch stays one plain request. */
const MAX_TOKENS = 16_000;

/* Pages per request. Five dense scanned pages is a comfortable answer inside
   MAX_TOKENS with headroom to spare; twenty would risk a truncation that costs
   the whole group its text and tells us so only via `stop_reason`. */
export const OCR_PAGE_BATCH = 5;

/** Groups in flight at once. Same bounded fan-out as tagging, one notch
    tighter — a vision request is a much heavier call. */
export const OCR_CONCURRENCY = 3;

/** The most pages one press will read. A ceiling on the spend a single click
    can authorise; what's left stays counted and the button comes back. */
export const OCR_RUN_CAP = 40;

const SYSTEM = [
  "You are transcribing scanned pages from HVAC and electrical documentation so",
  "a technician can search them. Read every page image and write out the text",
  "exactly as it appears.",
  "",
  "- transcribe ALL visible text: body copy, headings, table cells, diagram",
  "  labels, callouts, part and model numbers, error codes, footnotes",
  "- keep the reading order a person would use, and keep table rows on one line",
  "  with cells separated by ' | '",
  "- copy identifiers character by character. PUZ-ZM250VKA is not PUZ-ZM25OVKA,",
  "  and a zero is not the letter O",
  "- transcribe. Never summarise, never explain, never describe what a diagram",
  "  shows — only the words printed on it",
  "- a page with no legible text (a photograph, a blank scan, a drawing with no",
  "  lettering) gets an empty string. That is a correct answer, and a better one",
  "  than a guess",
  "",
  "Return one entry per page, in the order the pages were given, with exactly as",
  "many entries as there were pages.",
].join("\n");

const PAGES_SCHEMA = {
  type: "object",
  properties: {
    pages: { type: "array", items: { type: "string" } },
  },
  required: ["pages"],
  additionalProperties: false,
} as const;

export type OcrResult =
  | { ok: true; texts: string[] }
  | { ok: false; error: string };

/* ── the decisions, kept pure ────────────────────────────────────────────── */

/** The model's answer → exactly `expected` strings, in the order asked for.

    Same alignment contract as `shapeKeywords`, and it matters more here: entry
    i is page `pages[i]` of the real manual, so a short answer must PAD rather
    than shift, or every page after the gap gets somebody else's text. */
export function shapePageTexts(raw: unknown, expected: number): string[] {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rows = Array.isArray(r.pages) ? r.pages : [];

  const out: string[] = [];
  for (let i = 0; i < Math.max(0, Math.trunc(expected)); i++) {
    const row = rows[i];
    out.push(typeof row === "string" ? row.trim() : "");
  }
  return out;
}

/** Page numbers, in order, cut into request-sized groups. */
export function planOcrGroups(
  pages: readonly number[],
  size: number = OCR_PAGE_BATCH
): number[][] {
  const step = Math.max(1, Math.trunc(size) || 1);
  const groups: number[][] = [];
  for (let i = 0; i < pages.length; i += step) groups.push(pages.slice(i, i + step));
  return groups;
}

/* Recovered pages, split into runs of CONSECUTIVE page numbers.

   THIS IS A CITATION RULE, NOT A TIDINESS ONE. `chunkPages` merges whatever it
   is given into chunks and stamps each with its first and last page, so pages
   7, 23 and 44 handed over together produce a chunk that claims to be "p.7–44"
   — a range covering thirty-five pages nobody read. Scanned pages arrive
   scattered by nature, so they are chunked run by run: a scanned appendix on
   pages 40–45 still flows into itself, and an isolated page can only ever cite
   itself. */
export function contiguousRuns(pages: readonly PageText[]): PageText[][] {
  const sorted = [...pages].sort((a, b) => a.page - b.page);
  const runs: PageText[][] = [];

  for (const page of sorted) {
    const run = runs[runs.length - 1];
    if (run && page.page === run[run.length - 1].page + 1) run.push(page);
    else runs.push([page]);
  }
  return runs;
}

/* ── the work ────────────────────────────────────────────────────────────── */

/** A new PDF holding just these pages of `bytes`, in the order given.
    1-based page numbers, like everything else a person says out loud. */
export async function slicePdf(
  bytes: Uint8Array,
  pages: readonly number[]
): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const source = await PDFDocument.load(bytes, { ignoreEncryption: false });
  const slice = await PDFDocument.create();

  const copied = await slice.copyPages(
    source,
    pages.map((n) => n - 1)
  );
  for (const page of copied) slice.addPage(page);

  return slice.save();
}

const offline = () => !process.env.ANTHROPIC_API_KEY;

function reasonFor(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Reading scanned pages isn't switched on.";
  if (err instanceof Anthropic.RateLimitError) return "Too busy to read scanned pages right now.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the page reader.";
  if (err instanceof Anthropic.APIError) return "The page reader errored.";
  return "Those pages couldn't be read.";
}

/** Transcribe one group of pages. Never throws — a failure is a value, so the
    groups either side of it still land. */
export async function readPageGroup(
  bytes: Uint8Array,
  pages: readonly number[]
): Promise<OcrResult> {
  if (pages.length === 0) return { ok: true, texts: [] };
  if (offline()) return { ok: false, error: "Reading scanned pages isn't switched on." };

  let pdf: Uint8Array;
  try {
    pdf = await slicePdf(bytes, pages);
  } catch {
    return { ok: false, error: "Those pages couldn't be prepared." };
  }

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: PAGES_SCHEMA },
      },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          /* The document goes BEFORE the ask — the model reads the pages, then
             the instruction about them. */
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: Buffer.from(pdf).toString("base64"),
              },
            },
            { type: "text", text: `${pages.length} scanned pages. Transcribe each one.` },
          ],
        },
      ],
    });

    /* A refusal and a truncation are both content outcomes rather than errors,
       and both mean the same thing here: this group has no trustworthy text.
       Truncation especially — half a transcription looks exactly like a short
       page, and would be stored as one. */
    if (response.stop_reason === "refusal")
      return { ok: false, error: "Those pages couldn't be read." };
    if (response.stop_reason === "max_tokens")
      return { ok: false, error: "Those pages were too dense to read in one go." };

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return { ok: false, error: "Those pages couldn't be read." };

    return { ok: true, texts: shapePageTexts(JSON.parse(block.text), pages.length) };
  } catch (err) {
    return { ok: false, error: reasonFor(err) };
  }
}

export type OcrPagesResult =
  /** `pages` carries only what came back with text worth indexing on it. */
  | { ok: true; pages: PageText[] }
  | { ok: false; error: string };

/* Group answers → the pages actually recovered, at their real page numbers.

   THE SAME FLOOR THAT CONDEMNED THE PAGE LETS IT BACK. `isScannedPage` is what
   declared these pages unreadable, so text that still wouldn't clear it hasn't
   recovered anything — and against the real library that is most of them: a
   full-bleed photo with "02" printed in the corner, a divider with a document
   code on it. Storing those would put chunks of nothing in the index, each one
   able to win a search and cite a page with no answer on it. A page below the
   floor stays counted as unreadable, which is what it still is.

   Pure, because "which page did this text come from" is the answer that must
   never be wrong and the one a network call makes hardest to observe. */
export function seatRecovered(
  groups: readonly (readonly number[])[],
  results: readonly OcrResult[]
): PageText[] {
  const out: PageText[] = [];

  groups.forEach((group, at) => {
    const result = results[at];
    if (!result?.ok) return;
    group.forEach((page, i) => {
      const text = result.texts[i] ?? "";
      if (!isScannedPage(text)) out.push({ page, text });
    });
  });

  return out;
}

/** Transcribe every page listed, in bounded parallel. Fails only when EVERY
    group failed — one bad group costs its own pages, not the run, because the
    pages that did come back are worth storing either way. */
export async function readScannedPages(
  bytes: Uint8Array,
  pages: readonly number[]
): Promise<OcrPagesResult> {
  if (pages.length === 0) return { ok: true, pages: [] };

  const groups = planOcrGroups(pages);
  const results = await mapCapped(groups, OCR_CONCURRENCY, (group) =>
    readPageGroup(bytes, group)
  );

  /* Fails only when EVERY group failed. One bad group costs its own pages
     rather than the run, because the pages that did come back are worth
     storing either way — and the ones that didn't stay counted, so pressing
     again picks them up. */
  const first = results.find((r) => !r.ok);
  if (first && !first.ok && results.every((r) => !r.ok)) {
    return { ok: false, error: first.error };
  }

  return { ok: true, pages: seatRecovered(groups, results) };
}
