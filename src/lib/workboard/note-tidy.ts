/* THE ONE NOTE ON A JOB (Isaac, 26 October 2026: "TIFF and service mate
   both get the same note, but TIFF gets the features of the actions"). A
   note said to Tiff on a job is kept as the note Tiff tidied from it
   (note-brain's `jobNote`): the job's diary shows it and ServiceM8 gets it,
   word for word the same, and Tiff's tasks, flags and entries are made from
   the note as ever. Pure, so the rules are tested without a model.

   THE FACTS ARE THE GUARD. A tidy may drop the ums and the false starts; it
   may never lose a figure. Every number in what was said must be in the
   tidied note (14 metres stays 14 m, a 600 bracket stays 600), or the note
   is kept as it was said: a messy note costs a reread, a wrong figure costs
   a wrong coil on site.

   A MENTION IS A HANDLE SERVICEM8 KNOWS. The tidy writes the person a note
   asks something of as their ServiceM8 handle (@davidhann), from the
   account's roster, so ServiceM8 alerts them. An @ the roster doesn't hold
   is no mention: it is left as the word without its @. */

/** Every number in some words, as written: "14", "1.5", "600", "3/4". */
export function numbersIn(words: string): string[] {
  return [...words.matchAll(/\d+(?:[.,/]\d+)?/g)].map((m) => m[0]);
}

/** Whether every number said is still in the tidied note, each as many
    times as it was said. */
export function factsKept(said: string, tidied: string): boolean {
  const left = new Map<string, number>();
  for (const n of numbersIn(tidied)) left.set(n, (left.get(n) ?? 0) + 1);
  for (const n of numbersIn(said)) {
    const k = left.get(n) ?? 0;
    if (k === 0) return false;
    left.set(n, k - 1);
  }
  return true;
}

/* An @ that starts a word, with what can carry a handle after it; an @
   inside an address ("susie@peterson.com") names nobody and is left. */
const MENTION = /(^|[^a-z0-9._%+-])@([a-z0-9.'-]+)/gi;

/** The note with every @ that isn't a known handle taken off its word. */
export function knownMentionsOnly(text: string, handles: ReadonlySet<string>): string {
  return text.replace(MENTION, (whole, lead: string, word: string) => {
    const bare = word.toLowerCase();
    const trimmed = bare.replace(/[.'-]+$/, "");
    return handles.has(bare) || handles.has(trimmed) ? whole : `${lead}${word}`;
  });
}

/** The words a note on a job is kept as: Tiff's tidied note when it keeps
    every figure said, the words as said otherwise. Capped as the diary
    caps an entry. */
export function jobNoteWords(said: string, tidied: string, handles: ReadonlySet<string>, cap = 4000): string {
  const raw = said.trim().slice(0, cap);
  const tidy = knownMentionsOnly(tidied.trim(), handles).trim().slice(0, cap);
  if (!tidy) return raw;
  return factsKept(said, tidy) ? tidy : raw;
}
