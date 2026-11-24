/* THE FILE'S PAGE AND THE BOOK'S PAGE (bug 85, 24 November 2026: in one
   answer about a Daikin RZA service manual Tiff cited "p. 228", the PDF's own
   page, and "CHECK 9 on p. 274", the number printed in the book's header. The
   viewer opens the file's page 274, which is CHECK 2 and 3; CHECK 9 is on the
   file's page 280. The book starts its numbering six pages in.)

   Chunks carry the FILE's pages, which is what the viewer opens. A book's
   printed number sits in each page's header or footer ("SiAU282005EA 274
   Part 6", "- 7 -"), so a document whose printed numbers run a steady few
   pages behind its file pages shows it on every page: the file page less a
   number standing on its own is the same difference, page after page. Other
   numbers on a page (a temperature, a step, a part count) land on a different
   difference each time, so the steady one wins by a mile or nothing wins.

   Pure: pages in, the difference out (file page = printed page + offset), or
   null where the book doesn't say one clearly. 0 is a book numbered as its
   file is. docs/migrations/kb_page_offset.sql runs the same count in SQL for
   the documents already read. */

export type PageTextLike = { page: number; text: string };

/** A number standing alone: "274" in "SiAU282005EA 274 Part 6", "7" in "- 7 -". */
const STANDALONE = /(?:^|\s)(\d{1,4})(?=\s|$)/g;

/** The range an offset can sit in: a cover and contents ahead of page 1, at most. */
const OFFSET_LOW = -20;
const OFFSET_HIGH = 100;

/** The least evidence a difference needs: pages, a share of the pages read, and
    a lead on the next best. Read off the Library as it stood on 24 November
    2026: the two Daikin manuals (6 and 5) and the Mitsubishi books (0, 3) clear
    it by twice over; a short installation manual's noise (8 pages against 7)
    doesn't. */
export const OFFSET_MIN_PAGES = 8;
export const OFFSET_MIN_SHARE = 0.25;
export const OFFSET_LEAD = 2;

export function printedPageOffset(pages: readonly PageTextLike[]): number | null {
  const votes = new Map<number, Set<number>>();
  const read = new Set<number>();
  for (const p of pages) {
    if (!Number.isInteger(p.page) || p.page < 1) continue;
    read.add(p.page);
    for (const m of String(p.text ?? "").matchAll(STANDALONE)) {
      const n = Number(m[1]);
      if (n < 1) continue;
      const off = p.page - n;
      if (off < OFFSET_LOW || off > OFFSET_HIGH) continue;
      let set = votes.get(off);
      if (!set) votes.set(off, (set = new Set()));
      set.add(p.page);
    }
  }
  const ranked = [...votes.entries()]
    .map(([off, s]) => ({ off, pages: s.size }))
    .sort((a, b) => b.pages - a.pages);
  const [best, next] = ranked;
  if (!best) return null;
  if (best.pages < OFFSET_MIN_PAGES || best.pages < read.size * OFFSET_MIN_SHARE) return null;
  if (next && best.pages < next.pages * OFFSET_LEAD) return null;
  return best.off;
}

/** "280" or "280–281": the file's pages, as the viewer opens them. */
export function pageSpan(from: number, to: number): string {
  return from === to ? `${from}` : `${from}–${to}`;
}

/** The book's printed numbers for those file pages, or null where they're the
    same or not known. Pages ahead of the book's page 1 (a cover, contents)
    have no printed number and aren't given one. */
export function printedSpan(from: number, to: number, offset: number | null | undefined): string | null {
  if (offset == null || offset === 0) return null;
  const b = to - offset;
  if (b < 1) return null;
  return pageSpan(Math.max(1, from - offset), b);
}
