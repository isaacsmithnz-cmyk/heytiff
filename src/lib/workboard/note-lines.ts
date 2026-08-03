/* Notes as bullets, without a notes table.

   Isaac, 2026-08-03: "the notes for the visit should have bullet point
   notes". The obvious reading is a new table with a row per bullet — and it
   would be the wrong move. A visit's notes are ONE field on the visit
   (`maintenance_visits.notes`, likewise agreements and projects), read by the
   sheet, by the note brain, and by anything that ever prints a job. Splitting
   the storage would mean teaching all of them a join for a gain of exactly
   nothing: a bullet is a line.

   So the column stays text and a LINE IS A BULLET. That keeps every note
   written before today readable (one paragraph = one bullet), keeps
   dictation's append-a-line habit correct by construction, and means a note
   copied out of here into an email still looks like a list.

   Markers people type by hand are eaten on the way in, so pasting a list
   that already has dashes doesn't produce "- - gate code". */

const MARKER = /^\s*(?:[-*•·]|\d{1,2}[.)])\s+/;

/** Text → bullets. Blank lines vanish; a marker at the start of a line is
    punctuation, not content. */
export function toLines(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(MARKER, "").trim())
    .filter((line) => line !== "");
}

/** Bullets → text, in the shape `toLines` reads back unchanged. */
export function fromLines(lines: string[]): string {
  return lines.map((line) => line.trim()).filter((line) => line !== "").join("\n");
}

/** Did the draft actually change? Compared as bullets so re-saving a note
    that only differs by trailing whitespace is correctly a no-op. */
export function linesEqual(a: string[], b: string[]): boolean {
  return fromLines(a) === fromLines(b);
}
