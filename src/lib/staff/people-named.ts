/* WHO IS NAMED IN THE WORDS, THE PHONE'S RULES (heytiff-mobile
   src/lib/people.ts; Isaac, 10 November 2026: "saying a person's name turned
   their name a different color to register that it was connected to someone
   else in the organization", and 11 November 2026, "yes" to the web's box
   doing the same).

   Everyone active on the workspace, by the words that name them: full name,
   first name, preferred name and the nicknames Tiff has learned. The box
   colours them as they're typed or said, so you can see Tiff has them; who a
   task goes to is still the note flow's to decide.

   - Longest name first: "Alex Lorenz" is one name, not Alex and a word.
   - A name two different people go by stays plain: "Alex", with an Alex
     Lorenz and an Alex Morozoff. Two profiles with the one full name are one
     person, as the phone counts them.
   - A name that's an everyday word too (Will, Mark) counts only with a
     capital: "will" is not Will.
   - A name ServiceM8 keeps with a note in brackets, "Brent (Service)
     Gilmore", is also the name without it: Brent, Brent Gilmore.

   Pure: no server imports, so the route, the box and the tests share it. */

export type Person = { id: string; name: string; words: string[] };

/** The name without a bracketed note in it: "Brent (Service) Gilmore" is Brent Gilmore. */
const bare = (s: string) => s.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();

/** One person's words, as the workspace keeps them: full name, first name,
    preferred name and learned nicknames, each also without a note in brackets. */
export function personWords(p: { fullName: string; firstName?: string | null; preferredName?: string | null; aliases?: readonly string[] }): string[] {
  const name = p.fullName.trim().replace(/\s+/g, " ");
  const first = p.firstName?.trim() || name.split(" ")[0] || "";
  const all = [name, first, p.preferredName?.trim() ?? "", ...(p.aliases ?? [])].flatMap((w) => [w.trim(), bare(w)]);
  return [...new Set(all.filter((w) => w.length >= 2))];
}

/* Names that are everyday words too only count with a capital: "will" is not Will. */
const EVERYDAY = new Set([
  "will", "may", "mark", "bill", "frank", "grant", "rob", "pat", "sue", "art", "ray", "jack", "dawn", "rose", "drew", "chase",
  "gene", "faith", "hope", "joy", "june", "april", "august", "summer", "max", "sky", "dean", "miles", "lance", "wade", "hunter",
  "page", "cliff", "dale", "glen", "brook", "reed", "cole", "nick", "sonny", "sunny", "buck", "chip", "dash", "gus", "lee",
]);

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

export type Named = { start: number; end: number; name: string };

/** Where people are named in the words, longest name first, a name two different people go by left plain. */
export function namedIn(text: string, people: readonly Person[]): Named[] {
  if (!text || people.length === 0) return [];
  const byWord = new Map<string, Set<string>>();
  for (const p of people) {
    for (const w of p.words) {
      const k = w.trim().toLowerCase();
      if (k.length < 2) continue;
      byWord.set(k, (byWord.get(k) ?? new Set()).add(p.name));
    }
  }
  const words = [...byWord.entries()].filter(([, names]) => names.size === 1).sort((a, b) => b[0].length - a[0].length);
  const lower = text.toLowerCase();
  const found: Named[] = [];
  for (const [w, names] of words) {
    let at = lower.indexOf(w);
    while (at >= 0) {
      const end = at + w.length;
      const bounded = !isWordChar(lower[at - 1]) && !isWordChar(lower[end]);
      const capital = !EVERYDAY.has(w) || /\p{Lu}/u.test(text[at] ?? "");
      const free = !found.some((f) => at < f.end && end > f.start);
      if (bounded && capital && free) found.push({ start: at, end, name: [...names][0]! });
      at = lower.indexOf(w, end);
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

export type Run = { text: string; name: string | null };

/** The words cut at each name: plain runs and named runs, in order. */
export function nameRuns(text: string, people: readonly Person[]): Run[] {
  const named = namedIn(text, people);
  if (named.length === 0) return [{ text, name: null }];
  const runs: Run[] = [];
  let at = 0;
  for (const n of named) {
    if (n.start > at) runs.push({ text: text.slice(at, n.start), name: null });
    runs.push({ text: text.slice(n.start, n.end), name: n.name });
    at = n.end;
  }
  if (at < text.length) runs.push({ text: text.slice(at), name: null });
  return runs;
}

/** Which of the words, joined by single spaces, are part of a person's name. */
export function namedWords(words: readonly string[], people: readonly Person[]): boolean[] {
  const flags = words.map(() => false);
  if (people.length === 0 || words.length === 0) return flags;
  const starts: number[] = [];
  let at = 0;
  for (const w of words) {
    starts.push(at);
    at += w.length + 1;
  }
  for (const n of namedIn(words.join(" "), people)) {
    words.forEach((w, i) => {
      if (starts[i]! < n.end && starts[i]! + w.length > n.start) flags[i] = true;
    });
  }
  return flags;
}
