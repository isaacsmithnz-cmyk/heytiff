/* Pages in, searchable chunks out. Pure and deterministic.

   A CHUNK IS WHAT AN ANSWER GETS QUOTED FROM, so its edges matter more than
   its size. Two rules do the work:

     BREAK WHERE THE DOCUMENT BREAKS. Paragraphs are the unit; a chunk is a run
     of whole paragraphs. Cutting mid-sentence is how "do not exceed 500
     microns" ends up as two chunks that each say something else. Only a
     paragraph longer than the target on its own gets split, and then at
     sentence boundaries.

     OVERLAP, so a fact that straddles an edge survives in one piece. The next
     chunk re-opens with the trailing paragraphs that fit the overlap budget —
     never the whole previous chunk, so the walk always advances.

   PAGE RANGES ARE CARRIED, not guessed: a chunk records the page its first
   paragraph came from and the page its last one did, which is what a citation
   reads ("p.42–43"). Blank pages contribute nothing and are simply absent from
   the ranges. */

export type PageText = { page: number; text: string };

export type Chunk = {
  content: string;
  pageFrom: number;
  pageTo: number;
  /** The chunk's own leading heading line, when it has one. */
  heading?: string;
};

export type ChunkOpts = {
  /** Characters. ~1,400 is about 350 tokens — big enough to hold a procedure
      step with its conditions, small enough that a dozen fit in a prompt. */
  target?: number;
  /** Characters of the previous chunk re-opened at the top of the next. */
  overlap?: number;
};

const TARGET = 1400;
const OVERLAP = 200;

/** A paragraph (or a sentence out of an oversized one) and where it came from.
    `para` is false when this block continues the paragraph before it, so the
    joined content keeps the document's own shape. */
type Block = { text: string; page: number; para: boolean };

const HEADING_MAX = 80;

/* "6.2 Refrigerant charge", "3) Wiring" — a numbered clause opener. */
const NUMBERED = /^\d+(\.\d+)*[.)]?\s+\S/;

/** The chunk's heading, or null. Two shapes only: a numbered clause line, and
    a short ALL-CAPS line — the two things a manual actually uses. Anything
    longer than a line of a page is prose, whatever its case. */
export function headingOf(line: string): string | null {
  const l = line.trim();
  if (!l || l.length > HEADING_MAX) return null;
  if (NUMBERED.test(l)) return l;
  const hasLetters = /[A-Za-z]/.test(l);
  if (hasLetters && l === l.toUpperCase()) return l;
  return null;
}

/* Sentence ends, for the one case that needs them: a paragraph longer than the
   whole chunk target. Abbreviations will occasionally split early — harmless
   here, because the pieces are rejoined into the same chunk unless they
   straddle the target. */
const SENTENCE_END = /(?<=[.!?])\s+/;

function splitOversized(text: string, target: number): string[] {
  const out: string[] = [];
  for (const sentence of text.split(SENTENCE_END)) {
    const s = sentence.trim();
    if (!s) continue;
    if (s.length <= target) {
      out.push(s);
      continue;
    }
    /* One sentence longer than a whole chunk — a table row dumped as a line,
       usually. Cut it at whitespace so no word is severed. */
    let rest = s;
    while (rest.length > target) {
      const cut = rest.lastIndexOf(" ", target);
      const at = cut > target / 2 ? cut : target;
      out.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) out.push(rest);
  }
  return out;
}

function blocksFor(pages: readonly PageText[], target: number): Block[] {
  const blocks: Block[] = [];
  for (const p of pages) {
    const text = String(p.text ?? "").trim();
    if (!text) continue; // a scanned or blank page contributes nothing
    for (const raw of text.split(/\n\s*\n+/)) {
      const paragraph = raw.trim().replace(/\s*\n\s*/g, " ");
      if (!paragraph) continue;
      if (paragraph.length <= target) {
        blocks.push({ text: paragraph, page: p.page, para: true });
        continue;
      }
      const parts = splitOversized(paragraph, target);
      parts.forEach((text, i) => blocks.push({ text, page: p.page, para: i === 0 }));
    }
  }
  return blocks;
}

const sepFor = (b: Block) => (b.para ? "\n\n" : " ");

function render(blocks: readonly Block[]): string {
  return blocks.map((b, i) => (i === 0 ? b.text : sepFor(b) + b.text)).join("");
}

/** Cut a document into chunks. Deterministic: the same pages always produce
    the same chunks, which is what makes a re-run of a failed batch safe. */
export function chunkPages(pages: readonly PageText[], opts: ChunkOpts = {}): Chunk[] {
  const target = Math.max(200, opts.target ?? TARGET);
  const overlap = Math.max(0, Math.min(opts.overlap ?? OVERLAP, target - 1));

  const blocks = blocksFor(pages, target);
  const chunks: Chunk[] = [];

  let start = 0;
  while (start < blocks.length) {
    let end = start; // inclusive
    let length = blocks[start].text.length;
    while (end + 1 < blocks.length) {
      const next = blocks[end + 1];
      const grown = length + sepFor(next).length + next.text.length;
      if (grown > target) break;
      length = grown;
      end += 1;
    }

    const run = blocks.slice(start, end + 1);
    const content = render(run);
    const heading = headingOf(content.split("\n", 1)[0]);
    chunks.push({
      content,
      pageFrom: run[0].page,
      pageTo: run[run.length - 1].page,
      ...(heading ? { heading } : {}),
    });

    if (end + 1 >= blocks.length) break;

    /* Re-open with the trailing blocks that fit the overlap budget. `> start`
       is the progress guarantee: the next chunk can never begin where this one
       did, so a single oversized block simply gets no overlap rather than
       looping forever. */
    let next = end + 1;
    let carried = 0;
    while (next - 1 > start && carried + blocks[next - 1].text.length <= overlap) {
      next -= 1;
      carried += blocks[next].text.length;
    }
    start = next;
  }

  return chunks;
}
