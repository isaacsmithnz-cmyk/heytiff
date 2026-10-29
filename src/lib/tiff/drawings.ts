/* Reading a manual's DRAWINGS into words: the dimensions printed on an
   outline, a foundation plan or a clearance diagram, said the way a person
   would ask for them.

   WHY (Isaac, 29 October 2026): asked for the feet spacing on a PUMY-SP140,
   Tiff searched the Library twice and came back without it, though it is the
   first drawing in the unit's install manual (page 4, Fig. 2-1). The text
   layer had the page, as "(mm) Fig. 2-1 370 1050 225 600 981 330+25": every
   figure on the drawing and not one word of what it measures, so nothing a
   person could type would ever find 600 mm between the feet. A drawing's
   numbers mean something only beside the picture, so the picture is read.

   THE SAME MACHINERY AS THE SCANNED PAGES (./ocr), for the same reasons: the
   pages are sliced out with pdf-lib rather than the whole manual sent, and
   the answer is one entry per page IN THE ORDER ASKED, re-seated by position,
   never by a page number the model wrote.

   WHICH PAGES: one with a figure label, the words a dimensioned drawing sits
   under, or a run of bare numbers no sentence explains. Generous on purpose:
   a page with no drawing on it comes back empty, which costs a page read and
   stores nothing. */

import Anthropic from "@anthropic-ai/sdk";
import { mapCapped } from "./fanout";
import { planOcrGroups, shapePageTexts, slicePdf } from "./ocr";

/* Reading what a dimension MEASURES is interpretation, not transcription,
   which is why this asks for more effort than the scanned pages do. */
const MODEL = "claude-opus-5";
const MAX_TOKENS = 16_000;
const CONCURRENCY = 3;

/** The heading a drawing's chunk carries: how a re-run knows the page is read. */
export const drawingHeading = (page: number) => `Drawing, page ${page}`;
export const DRAWING_HEADING_PREFIX = "Drawing, page ";

const FIGURE = /\bfig(?:ure|\.)?\s*\d/i;
const DRAWING_WORDS = /\b(dimensions?|outline|foundation|anchor bolts?|mounting|installation space|service space|clearances?|bolt pitch|drain (?:hole|outlet)s?)\b/i;
/** Four or more bare figures in a row: "370 1050 225 600 981". */
const BARE_FIGURES = /(?:^|\s)(?:\d{2,4}(?:\+\d{1,3})?\s+){3,}\d{2,4}(?:\+\d{1,3})?(?:\s|$)/;

/** Might this page carry a dimensioned drawing? */
export function isDrawingCandidate(text: string): boolean {
  return FIGURE.test(text) || DRAWING_WORDS.test(text) || BARE_FIGURES.test(text);
}

const SYSTEM = [
  "You are reading the DRAWINGS on pages from HVAC equipment manuals, so a",
  "technician on site can find a dimension by asking for it in words.",
  "",
  "For each page, find every drawing that carries dimensions: unit outlines,",
  "foundation and anchor-bolt plans, wall-mounting plates, clearance and",
  "service-space diagrams, pipe and drain positions. For each one write, in",
  "plain sentences:",
  "- what the drawing is and which models it applies to, as printed, with its",
  "  figure number ('Fig. 2-1, outline of the PUMY-SP80 to SP140')",
  "- every dimension: what it measures and its value with its unit, in the",
  "  words a tradesperson would use ('the feet / anchor bolts are 600 mm apart",
  "  across the width', 'overall width 1050 mm', 'minimum 300 mm behind the",
  "  unit')",
  "",
  "Rules:",
  "- only what the drawing shows. When it isn't clear what a dimension",
  "  measures, say where it sits ('a 225 mm dimension from the left edge to",
  "  the first foot') rather than naming it confidently",
  "- copy every number and model code exactly. A '+25' beside a figure stays",
  "  with it ('330 mm, plus 25 mm for the valve cover' only if the drawing",
  "  says what the 25 is; otherwise '330 + 25 mm')",
  "- no text that is already printed as sentences on the page: the drawing's",
  "  numbers in words, nothing else",
  "- a page with no dimensioned drawing gets an empty string. That is a",
  "  correct answer",
  "",
  "Return one entry per page, in the order the pages were given, with exactly",
  "as many entries as there were pages.",
].join("\n");

const PAGES_SCHEMA = {
  type: "object",
  properties: { pages: { type: "array", items: { type: "string" } } },
  required: ["pages"],
  additionalProperties: false,
} as const;

export type DrawingResult = { ok: true; texts: string[] } | { ok: false; error: string };

/** Read one group of pages' drawings. Never throws: a failure is a value. */
export async function readDrawingGroup(bytes: Uint8Array, pages: readonly number[]): Promise<DrawingResult> {
  if (pages.length === 0) return { ok: true, texts: [] };
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: "Reading drawings isn't switched on." };
  let pdf: Uint8Array;
  try {
    pdf = await slicePdf(bytes, pages);
  } catch {
    return { ok: false, error: "Those pages couldn't be prepared." };
  }
  try {
    const response = await new Anthropic().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: "medium", format: { type: "json_schema", schema: PAGES_SCHEMA } },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(pdf).toString("base64") } },
            { type: "text", text: `${pages.length} pages. Write each page's dimensioned drawings in words.` },
          ],
        },
      ],
    });
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return { ok: false, error: "Those drawings couldn't be read." };
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return { ok: false, error: "Those drawings couldn't be read." };
    return { ok: true, texts: shapePageTexts(JSON.parse(block.text), pages.length) };
  } catch {
    return { ok: false, error: "Those drawings couldn't be read." };
  }
}

/** Every group's answer, seated back on its real page; empty pages left out. */
export function seatDrawings(groups: readonly (readonly number[])[], results: readonly DrawingResult[]): { page: number; text: string }[] {
  return groups.flatMap((group, at) => {
    const r = results[at];
    if (!r?.ok) return [];
    return group.flatMap((page, i) => {
      const text = r.texts[i]?.trim() ?? "";
      return text ? [{ page, text }] : [];
    });
  });
}

/** Read these pages' drawings: what came back, and whether every group failed. */
export async function readDrawings(bytes: Uint8Array, pages: readonly number[]): Promise<{ ok: true; pages: { page: number; text: string }[] } | { ok: false; error: string }> {
  const groups = planOcrGroups(pages);
  const results = await mapCapped(groups, CONCURRENCY, (g) => readDrawingGroup(bytes, g));
  const failed = results.find((r) => !r.ok);
  if (failed && !failed.ok && results.every((r) => !r.ok)) return { ok: false, error: failed.error };
  return { ok: true, pages: seatDrawings(groups, results) };
}
