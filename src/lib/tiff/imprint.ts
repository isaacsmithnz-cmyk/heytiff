/* A DOCUMENT'S MAKER AND EDITION, READ OFF ITS OWN FIRST PAGES (Isaac, 20
   October: the edition, "2025 or whatever it was, that's what Tiff should be
   reading"). The Library's card says "Mitsubishi Electric, M-P0860 (Oct
   2022)" under the title; until now only what somebody typed in Edit details
   could say it.

   READ ONCE, WHERE THE PAGES ALREADY ARE: the first batch of the reading
   (ingest.ts) has the cover and the imprint page in hand, so it asks then.
   A title somebody wrote is never written over; a file name is (see
   `imprintPatch` for exactly what moves).

   A SMALL MODEL, HELD TO THE PAGE. Haiku reads three pages of a cover and an
   imprint, which is shallow work; what it may not do is invent, so
   `shapeImprint` keeps a value only when its words are on those pages. An
   edition the book doesn't print is no edition, not a guess. Never throws:
   a document with no maker or edition on its cover is still a document. */

import Anthropic from "@anthropic-ai/sdk";
import type { KbCategory } from "./files";
import { guessKbCategory, titleFromFilename } from "./guess";
import { logUsage } from "./usage";

const MODEL = "claude-haiku-5-5";
const MAX_TOKENS = 1000;
/** The cover and imprint: the first three pages, at most this much of them. */
export const IMPRINT_CHARS = 6_000;
/** Longest value kept: a maker or an edition, never a sentence. */
const MAX_LEN = 60;
/** Longest title kept: the Library's own ceiling is 160, a good title is far shorter. */
const TITLE_LEN = 120;

/* WHAT ELSE THE COVER SAYS (Isaac, 24 November 2026: "you cant fix theirs").
   A business that uploads "service-manual---artg45_54lhta.pdf" got that file
   name as its title, a Daikin sheet stayed under the Samsung someone picked,
   a manufacturer's test sheet sat on Company SOPs, and a scanned or converted
   sheet wore the year it was scanned. Fixed by hand for one library on that
   day; every other library needs the reading to do it. So the same small read
   now also says what the document IS (`title`), which shelf it belongs on
   (`shelf`) and the date it prints (`issued`). */
export type CoverShelf = "service" | "install" | "specs" | "company";
export type Imprint = {
  maker: string | null;
  edition: string | null;
  title?: string | null;
  shelf?: CoverShelf | null;
  issued?: string | null;
};

const SHELVES: readonly CoverShelf[] = ["service", "install", "specs", "company"];

const SCHEMA = {
  type: "object",
  properties: {
    maker: { type: "string" },
    edition: { type: "string" },
    title: { type: "string" },
    shelf: { type: "string", enum: ["service", "install", "specs", "company", ""] },
    issued: { type: "string" },
  },
  required: ["maker", "edition", "title", "shelf", "issued"],
  additionalProperties: false,
} as const;

const SYSTEM = `You read the first pages of an air conditioning document: its cover, title page or imprint.
Answer with five things.

Copied exactly as they are printed on these pages:
- maker: the brand that made the equipment or published the document (e.g. "Mitsubishi Electric", "Daikin"). The brand alone, not the legal company, factory or country ("Daikin", not "Daikin Industries Czech Republic s.r.o."), not a distributor, a reseller or a person.
- edition: what says which version this is: a printed year, month and year, revision, or document code (e.g. "M-P0860 (Oct 2022)", "December 2023", "Rev. B", "2025").
- issued: the date the document was issued, as printed (e.g. "July 2023", "2019.07.25", "21 April 2017"). Not a copyright line, a software licence, or a date filled in on a form.

Written by you, from these pages:
- title: what this document is, for a technician scanning a list. The model numbers it covers, as printed (indoor and outdoor units both, series written once, e.g. "ARTC36/45/60LCTU and AOTD36/45/60LATT"), then what kind of document it is in plain words (service manual, installation manual, fault codes, wiring diagram, data sheet, brochure, user manual, commissioning sheet, testing procedure). Sentence case. No maker name, no document or part codes, no file names. At most 90 characters. Example: "PEAD-M50-140JAA ducted indoor unit installation manual".
- shelf: "service" for service manuals, fault codes, diagnosis and testing procedures; "install" for installation manuals, setup, settings, commissioning, wiring and controller manuals; "specs" for brochures, catalogues, data sheets and data books; "company" only for a business's own procedures or policies that no manufacturer published.

If a thing is not on these pages, answer "" for it. Never guess a model number, never take anything from the file name.`;

/** Letters and digits only, upper case: how a value is looked for on the page. */
const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Keep a value only when it is short and its words are on the page. A title is
    written rather than copied, so it is held looser: every piece of it that
    carries a digit (a model number) must be on the page, which is the part a
    small model could invent and a technician would trust. */
export function shapeImprint(raw: unknown, pageText: string): Imprint {
  const page = squash(pageText);
  const clean = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const take = (v: unknown): string | null => {
    const s = clean(v);
    if (!s || s.length > MAX_LEN) return null;
    const words = s.split(/[\s,()]+/).map(squash).filter(Boolean);
    return words.length > 0 && words.every((w) => page.includes(w)) ? s : null;
  };
  const r = (raw ?? {}) as { maker?: unknown; edition?: unknown; title?: unknown; shelf?: unknown; issued?: unknown };
  return {
    maker: brandOf(take(r.maker)),
    edition: take(r.edition),
    title: titleHeldToPage(clean(r.title), page),
    shelf: SHELVES.includes(r.shelf as CoverShelf) ? (r.shelf as CoverShelf) : null,
    issued: take(r.issued),
  };
}

/* THE BRAND, NOT THE COMPANY. Asked for the brand, a cover's imprint still
   came back as "Daikin Industries Czech Republic s.r.o." (24 November 2026),
   which would have been a brand card of its own beside Daikin's. Everything
   from the company words on is cut, and a name printed in capitals is written
   the way the Library writes brands. */
const COMPANY = /[\s,]+(?:industries|corporation|corp\.?|limited|ltd\.?|pty\.?|inc\.?|co\.,?|company|s\.r\.o\.?|gmbh|s\.a\.|n\.v\.|australia|new zealand|europe|czech|thailand|malaysia)(?:[\s,.].*)?$/i;
export function brandOf(maker: string | null): string | null {
  if (!maker) return null;
  /* "Fujitsu General" is the company; the brand on every unit is Fujitsu */
  const cut = maker.replace(COMPANY, "").replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+general$/i, "").trim();
  if (!cut) return maker;
  return cut === cut.toUpperCase() && /[A-Z]{3}/.test(cut)
    ? cut.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())
    : cut;
}

/* "ARTC36/45/60LCTU" prints on the cover as ARTC36LCTU, ARTC45LCTU and
   ARTC60LCTU, so a slashed series is checked as its first member plus each
   later number standing somewhere on the page. */
function titleHeldToPage(title: string, page: string): string | null {
  if (!title || title.length > TITLE_LEN || !/[a-z]/i.test(title)) return null;
  for (const token of title.split(/[\s,()]+/)) {
    if (!/\d/.test(token)) continue;
    const [first, ...rest] = token.split("/");
    if (!page.includes(squash(first!))) return null;
    if (!rest.every((r) => page.includes(squash(r)))) return null;
  }
  return title;
}

/** The Library's shelf for what the cover says it is. */
const SHELF_CATEGORY: Record<CoverShelf, KbCategory> = { service: "faults", install: "install", specs: "specs", company: "sops" };

/* A FILE NAME'S TITLE, OR ONE A PERSON GAVE IT. The drawer offers the file's
   name as the title and its words' shelf as the category; somebody who kept
   them typed nothing, so the cover may say better. A title that still carries
   a file's marks (underscores, a long run of digits or hex, an extension) is
   a file name whoever left it. */
export function looksLikeFileName(title: string, fileName: string | null): boolean {
  const t = title.trim();
  if (!t) return true;
  if (fileName && (t === titleFromFilename(fileName) || t === fileName.replace(/\.[a-z0-9]{1,5}$/i, "").trim())) return true;
  return /_|\.(pdf|docx?)$|[0-9a-f]{12,}|\d{9,}|-{2,}/i.test(t);
}

/* WHAT TO WRITE.
   - Maker and edition: into an empty field, as always.
   - Maker: also over one the cover doesn't print anywhere, when it prints
     another (the Daikin malfunction sheets filed under Samsung).
   - Title: over a file name, never over one somebody wrote.
   - Shelf: over the drawer's guess from the file name, and off Company SOPs
     for anything a manufacturer published; never onto Company SOPs. */
export function imprintPatch(
  row: { source: string | null; edition: string | null; title?: string | null; category?: string | null; file_name?: string | null },
  found: Imprint,
  pageText = ""
): { source?: string; edition?: string; title?: string; category?: KbCategory } {
  const patch: { source?: string; edition?: string; title?: string; category?: KbCategory } = {};
  const page = squash(pageText);
  const source = row.source?.trim() ?? "";
  if (found.maker && (!source || (page && !page.includes(squash(source)) && squash(source) !== squash(found.maker)))) patch.source = found.maker;
  if (!row.edition?.trim() && found.edition) patch.edition = found.edition;
  if (found.title && row.title !== undefined && looksLikeFileName(row.title ?? "", row.file_name ?? null) && found.title !== row.title) patch.title = found.title;
  if (found.shelf && found.shelf !== "company" && row.category) {
    const to = SHELF_CATEGORY[found.shelf];
    const guessed = row.file_name ? guessKbCategory(row.file_name) === row.category : false;
    const madeByMaker = row.category === "sops" && Boolean(found.maker || source);
    if (to !== row.category && (guessed || madeByMaker)) patch.category = to;
  }
  return patch;
}

/** Ask once. Nothing found, or anything going wrong, is an empty imprint. */
export async function readImprint(pageText: string): Promise<Imprint> {
  const text = pageText.slice(0, IMPRINT_CHARS).trim();
  if (!text) return { maker: null, edition: null, title: null, shelf: null, issued: null };
  try {
    const response = await new Anthropic().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: `<pages>\n${text}\n</pages>` }],
    });
    logUsage("imprint", MODEL, response.usage);
    if (response.stop_reason === "refusal") return { maker: null, edition: null, title: null, shelf: null, issued: null };
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return { maker: null, edition: null, title: null, shelf: null, issued: null };
    return shapeImprint(JSON.parse(block.text), text);
  } catch (err) {
    console.warn(`[kb-imprint] couldn't read the imprint: ${err instanceof Error ? err.message : String(err)}`);
    return { maker: null, edition: null, title: null, shelf: null, issued: null };
  }
}
