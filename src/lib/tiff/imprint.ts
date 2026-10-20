/* A DOCUMENT'S MAKER AND EDITION, READ OFF ITS OWN FIRST PAGES (Isaac, 20
   October: the edition, "2025 or whatever it was, that's what Tiff should be
   reading"). The Library's card says "Mitsubishi Electric, M-P0860 (Oct
   2022)" under the title; until now only what somebody typed in Edit details
   could say it.

   READ ONCE, WHERE THE PAGES ALREADY ARE: the first batch of the reading
   (ingest.ts) has the cover and the imprint page in hand, so it asks then,
   and only for a field that is still empty. A value somebody typed is never
   written over.

   A SMALL MODEL, HELD TO THE PAGE. Haiku reads three pages of a cover and an
   imprint, which is shallow work; what it may not do is invent, so
   `shapeImprint` keeps a value only when its words are on those pages. An
   edition the book doesn't print is no edition, not a guess. Never throws:
   a document with no maker or edition on its cover is still a document. */

import Anthropic from "@anthropic-ai/sdk";
import { logUsage } from "./usage";

const MODEL = "claude-haiku-5-5";
const MAX_TOKENS = 400;
/** The cover and imprint: the first three pages, at most this much of them. */
export const IMPRINT_CHARS = 6_000;
/** Longest value kept: a maker or an edition, never a sentence. */
const MAX_LEN = 60;

export type Imprint = { maker: string | null; edition: string | null };

const SCHEMA = {
  type: "object",
  properties: {
    maker: { type: "string" },
    edition: { type: "string" },
  },
  required: ["maker", "edition"],
  additionalProperties: false,
} as const;

const SYSTEM = `You read the first pages of an air conditioning document: its cover, title page or imprint.
Answer with two things, copied exactly as they are printed on these pages:
- maker: the company that published it (e.g. "Mitsubishi Electric", "Daikin"). The brand, not a distributor or a person.
- edition: what says which version this is: a printed year, month and year, revision, or document code (e.g. "M-P0860 (Oct 2022)", "December 2023", "Rev. B", "2025").
If a thing is not printed on these pages, answer "" for it. Never guess, never reword, never take it from the file name.`;

/** Letters and digits only, upper case: how a value is looked for on the page. */
const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Keep a value only when it is short and its words are on the page. */
export function shapeImprint(raw: unknown, pageText: string): Imprint {
  const page = squash(pageText);
  const take = (v: unknown): string | null => {
    const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
    if (!s || s.length > MAX_LEN) return null;
    const words = s.split(/[\s,()]+/).map(squash).filter(Boolean);
    return words.length > 0 && words.every((w) => page.includes(w)) ? s : null;
  };
  const r = (raw ?? {}) as { maker?: unknown; edition?: unknown };
  return { maker: take(r.maker), edition: take(r.edition) };
}

/** What to write: only into a field that is still empty. */
export function imprintPatch(row: { source: string | null; edition: string | null }, found: Imprint): { source?: string; edition?: string } {
  const patch: { source?: string; edition?: string } = {};
  if (!row.source?.trim() && found.maker) patch.source = found.maker;
  if (!row.edition?.trim() && found.edition) patch.edition = found.edition;
  return patch;
}

/** Ask once. Nothing found, or anything going wrong, is an empty imprint. */
export async function readImprint(pageText: string): Promise<Imprint> {
  const text = pageText.slice(0, IMPRINT_CHARS).trim();
  if (!text) return { maker: null, edition: null };
  try {
    const response = await new Anthropic().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: `<pages>\n${text}\n</pages>` }],
    });
    logUsage("imprint", MODEL, response.usage);
    if (response.stop_reason === "refusal") return { maker: null, edition: null };
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return { maker: null, edition: null };
    return shapeImprint(JSON.parse(block.text), text);
  } catch (err) {
    console.warn(`[kb-imprint] couldn't read the imprint: ${err instanceof Error ? err.message : String(err)}`);
    return { maker: null, edition: null };
  }
}
