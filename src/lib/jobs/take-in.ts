/* EVERY PDF ON A JOB IS READ ONCE AND USED (Isaac, 11 November 2026: "I just
   want it so that you're not uploading things and it's not using the
   information anywhere"; the builder's package mock,
   https://claude.ai/artifact/6FP52g4ropVpfAqqzNLk2c).

   Whatever door a PDF comes through, an upload, a drop on Documents, an
   email filed on the job, the phone, its own words and its page sizes say
   what it is, in code and for nothing:
   - a set of DRAWINGS: sheets A3 and up, or a scale in the title block on
     most pages. Into Plans, read for its floors as Add plans reads one.
   - a SPECIFICATION or a builder's SCOPE: words of air conditioning,
     ventilation, exhaust, ductwork or mechanical services. Into Plans as a
     spec, its pages on the air read by their words, for the supplied scope.
   - OUR OWN PAPERWORK: our name on its first page with an invoice's or a
     quote's words, or a short file under our name. Not used, and says so.
   - anything else, and a scan with no words on small pages: Not used, with
     why, so it is never a file nobody knows was skipped.
   Photos are never sorted here: a picture of a plan goes in by a press.

   Pure: the server side is take-in-server.ts. */

export type TakeSort = "drawings" | "spec" | "ours" | "other" | "same" | "unreadable" | "failed";

/** A page as the sort sees it: its size in points and its own words. */
export type PdfPage = { w: number; h: number; text: string };

/** The pages the sort looks at: the first 40 are enough for a set's sheets
    and a specification's contents page. */
export const SORT_PAGES = 40;

/** A sheet A3 or bigger: A3's long side is 1191 points. */
const BIG_PT = 1150;
/** A drawing scale, "1:100", as title blocks print it. */
const SCALE = /\b1\s?:\s?(5|10|20|25|50|75|100|200|250|500|1000)\b/;
/** The words of the air side, each to the topic it names. */
const TOPICS: readonly [RegExp, string][] = [
  [/\bair[- ]?condition\w*|\ba\/c\b|\bhvac\b|\bducted\b|split system/i, "air conditioning"],
  [/\bventilat\w*/i, "ventilation"],
  [/\bexhaust\w*/i, "exhaust"],
  [/\bduct ?work|\bflexible duct|\brigid duct/i, "ductwork"],
  [/\bmechanical (services|design|install\w*|ventilation)\b/i, "mechanical services"],
];
/* a maker's brochure prints "Specifications" too: these are a project's own */
const SPEC_WORDS = /\b(project specification|tender (specification|documents?|issue|set|package)|scope of works?|schedule of works|specification of works)\b/i;
const PAPER_WORDS = /\b(tax invoice|invoice|quotation|quote|statement|purchase order|remittance|receipt)\b/i;

/** The paper size a long side in points is, by the A sizes. */
export function sheetSize(longPt: number): string {
  if (longPt >= 3300) return "A0";
  if (longPt >= 2300) return "A1";
  if (longPt >= 1600) return "A2";
  if (longPt >= 1150) return "A3";
  return "A4";
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The topics a file's words name, in their order of weight. */
export function topicsOf(text: string): string[] {
  return TOPICS.filter(([re]) => re.test(text)).map(([, t]) => t);
}

/** What the sort knows besides the pages: the business's own names, the
    job's site, the whole file's page count where only the first pages were
    looked at, and the title the PDF carries in its details. */
export type SortContext = { own: readonly string[]; site?: string; pageCount?: number; title?: string | null };

/** A PDF's words with its ligatures undone: "ﬁ" hides "specification",
    and a font that lost its "ti" prints "ven?la?on" or "Ven6la6on" (the 7
    Cutler Rd tender specification), so a ? or a 6 between two letters is
    put back as "ti". */
export const plainWords = (t: string): string =>
  t
    .normalize("NFKC")
    .replace(/(?<=[a-z])[?6](?=[a-z])/gi, "ti")
    .replace(/\s+/g, " ")
    .trim();

/** What a PDF is, by its own words and sizes, and why, in the words "Scope
    built from" shows. */
export function sortPdf(raw: readonly PdfPage[], ctx: SortContext): { sort: TakeSort; why: string } {
  const pages = raw.map((p) => ({ ...p, text: plainWords(p.text) }));
  const pageCount = ctx.pageCount ?? pages.length;
  if (pages.length === 0) return { sort: "unreadable", why: "It has no pages to read" };
  /* printed from HeyTiff itself: a design sheet, a quote */
  if (ctx.title && /\bheytiff\b/i.test(ctx.title)) return { sort: "ours", why: "Printed from HeyTiff" };
  const longest = (p: PdfPage) => Math.max(p.w, p.h);
  const big = pages.filter((p) => longest(p) >= BIG_PT);
  const mostlyBig = big.length / pages.length >= 0.5;
  const words = pages.map((p) => p.text).join(" ");
  const size = sheetSize(Math.max(...(mostlyBig ? big : pages).map(longest)));

  if (words.length < 40) {
    return mostlyBig
      ? { sort: "drawings", why: `${plural(pageCount, "sheet")} at ${size}, scanned` }
      : { sort: "unreadable", why: "A scan with no words to read" };
  }

  /* ours: our name on the first page, with an invoice's or a quote's words, or a short file */
  const first = pages[0]!.text.toLowerCase();
  const ours = ctx.own.map((n) => n.trim().toLowerCase()).filter((n) => n.length >= 3).some((n) => first.includes(n));
  if (ours && (PAPER_WORDS.test(pages[0]!.text) || pageCount <= 6)) return { sort: "ours", why: "Our own paperwork" };

  const scaled = pages.filter((p) => SCALE.test(p.text)).length;
  if (mostlyBig || scaled / pages.length >= 0.5) return { sort: "drawings", why: `${plural(pageCount, "sheet")} at ${size}` };

  /* a maker's brochure or manual names the air side too: a spec or a scope
     also says it is the project's, or names the job's own street */
  const topics = topicsOf(words);
  if (topics.length >= 1 && (SPEC_WORDS.test(`${ctx.title ?? ""} ${words}`) || namesSite(words, ctx.site ?? ""))) {
    const what = /\bspecification\b/i.test(`${ctx.title ?? ""} ${words}`) ? "A specification" : "A scope";
    return { sort: "spec", why: `${what}, ${plural(pageCount, "page")}, that names ${andTopics(topics)}` };
  }
  return { sort: "other", why: "Not drawings, a specification or a scope" };
}

/** The job's street in a file's words: its number and its name's longest word. */
export function namesSite(text: string, site: string): boolean {
  const line = site.split(/[,\n]/)[0]!.toLowerCase();
  const number = line.match(/\d+/)?.[0];
  const name = line.replace(/[^a-z ]/g, " ").split(" ").filter((w) => w.length >= 4).sort((a, b) => b.length - a.length)[0];
  if (!number || !name) return false;
  const t = text.toLowerCase();
  return t.includes(name) && new RegExp(`\\b${number}\\b`).test(t);
}

const andTopics = (t: readonly string[]): string => (t.length <= 1 ? (t[0] ?? "") : `${t.slice(0, -1).join(", ")} and ${t.at(-1)}`);

/** The pages of a specification that are on the air side: any page naming
    two of its topics, or one with a heading of its own, and the page after
    each, which finishes the clause. In order, without repeats. */
export function airPages(raw: readonly string[]): number[] {
  const hit = new Set<number>();
  const texts = raw.map(plainWords);
  texts.forEach((t, i) => {
    const n = i + 1;
    const topics = topicsOf(t);
    const heading = /\b(mechanical|air[- ]?conditioning|ventilation|exhaust)\b[^.]{0,40}\b(design|install\w*|system|services|schedule)\b/i.test(t);
    if (topics.length >= 2 || heading) {
      hit.add(n);
      if (n < texts.length) hit.add(n + 1);
    }
  });
  return [...hit].sort((a, b) => a - b);
}

/** "pages 178 to 186", "pages 12, 14 and 30 to 31": runs of pages in words. */
export function pagesWords(pages: readonly number[]): string {
  if (pages.length === 0) return "no pages";
  const runs: [number, number][] = [];
  for (const n of pages) {
    const last = runs.at(-1);
    if (last && n === last[1] + 1) last[1] = n;
    else runs.push([n, n]);
  }
  const parts = runs.map(([a, b]) => (a === b ? `${a}` : `${a} to ${b}`));
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `${pages.length === 1 ? "page" : "pages"} ${list}`;
}
