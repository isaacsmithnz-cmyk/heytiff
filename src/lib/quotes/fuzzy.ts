/* A WORD NEAR ENOUGH (Isaac, 2026-10-11: "Just do fuzzy book now"): a
   search of the book still finds "diffuser" typed "difuser", or "isolator"
   typed "isolater". Two words are near when they share enough of their
   three-letter runs, counted as Postgres's pg_trgm counts them, so the
   book's search here and the database's (quote_items_like) agree. Only
   for a search a person or Tiff reads the hits of: a kit never picks a
   part by a near word. Pure. */

/** How near two words must be: half their runs shared. */
export const NEAR = 0.5;

/** A word worth matching loosely: four letters or more, and a word, not a
    code (a code a letter out is another part). */
export const fuzzyWord = (w: string) => w.length >= 4 && /^[a-z]+$/.test(w);

/** A word's three-letter runs, padded as pg_trgm pads it. */
export function trigrams(word: string): Set<string> {
  const s = `  ${word.toLowerCase()} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}

/** How near two words are: the runs they share over the runs either has. */
export function similarity(a: string, b: string): number {
  const x = trigrams(a);
  const y = trigrams(b);
  let shared = 0;
  for (const t of x) if (y.has(t)) shared++;
  const all = x.size + y.size - shared;
  return all === 0 ? 0 : shared / all;
}

/** The nearest of a text's words to this one, 0 to 1; 0 when none is near. */
export function nearestIn(word: string, words: readonly string[]): number {
  let best = 0;
  for (const w of words) {
    if (w.length < 3) continue;
    const s = similarity(word, w);
    if (s > best) best = s;
  }
  return best >= NEAR ? best : 0;
}

/** A text's words, as a near match reads them. */
export const wordsOf = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
