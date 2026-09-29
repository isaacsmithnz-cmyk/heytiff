/* The names people go by — the pure half (Isaac, 2026-09-29).

   Crews call each other by nicknames all the time: "Bobo" is Leonardo
   Martins. A nickname is kept against the person (staff_aliases), learned
   the first time somebody tells Tiff who a name is, or typed on the staff
   card, and from then on it resolves to that person for everyone.

   A REAL NAME ALWAYS BEATS A NICKNAME. A name that is somebody's full or
   first name is never kept as a nickname for somebody else: Tiff reads the
   real one first, so the nickname could never be reached, and keeping it
   would only put a wrong fact on a card.

   Pure module: no server imports, so the router, the card and the tests can
   all use it. */

/** Every sentence the names say. */
export const ALIAS_WORDS = {
  label: "Also called",
  placeholder: "e.g. Bobo, Leo",
  notAName: (s: string) => `“${s}” isn't a name. Use letters, and commas between names.`,
  realName: (s: string) => `${s} is somebody's real name here, so it can't be a nickname.`,
  taken: (s: string, who: string | null) => (who ? `${s} is already what ${who} is called.` : `${s} is already somebody else's name.`),
  unsaved: "The names couldn't be saved. Try again.",
};

/** The most names one card keeps. */
export const ALIASES_MAX = 12;

/** The longest name kept, in characters. */
export const ALIAS_MAX_LEN = 40;

/** How a name is compared: lower case, one space between words, trimmed. */
export function normAlias(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** A name as it is kept: the words as said, one space between them. */
export function tidyAlias(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/** What a person says about themselves, never a nickname. The router's own
    list of self words (note-brain's SELF) says the same in more languages;
    these are the ones that could come back as an answer in English. */
const NOT_NAMES = new Set(["me", "i", "myself", "you", "him", "her", "them", "us", "we", "someone", "somebody", "anyone", "nobody", "everyone"]);

const DETERMINERS = new Set(["the", "a", "an", "my", "our", "your", "his", "her", "their", "that", "this"]);

/** Whether a name could be a nickname at all: one to three words of letters
    (an apostrophe or hyphen inside one is fine: "O'Neil", "Jean-Luc"), not a
    word a person uses for themselves or for nobody in particular. */
export function looksLikeName(s: string): boolean {
  const t = tidyAlias(s);
  if (!t || t.length > ALIAS_MAX_LEN) return false;
  const words = t.split(" ");
  if (words.length > 3) return false;
  if (NOT_NAMES.has(normAlias(t))) return false;
  /* "the sparky", "my apprentice": a role, which changes hands, not a name */
  if (DETERMINERS.has(normAlias(words[0]))) return false;
  return words.every((w) => /^\p{L}[\p{L}'’-]*$/u.test(w));
}

/** A name somebody has for real — their full name, or its first word. */
export function realNamesOf(people: readonly { fullName: string }[]): Set<string> {
  const out = new Set<string>();
  for (const p of people) {
    const full = normAlias(p.fullName);
    if (!full) continue;
    out.add(full);
    out.add(full.split(" ")[0]);
  }
  return out;
}

/** Whether `said` may be kept as a nickname: it looks like a name, and it is
    nobody's real name. */
export function learnable(said: string, people: readonly { fullName: string }[]): boolean {
  return looksLikeName(said) && !realNamesOf(people).has(normAlias(said));
}

/** The card's "Also called" box → the names it keeps: split on commas,
    tidied, each kept once whatever its case, in the order typed, capped.
    Anything that isn't a name is left out and reported, so the card can
    say which. */
export function parseAliasList(text: string): { names: string[]; refused: string[] } {
  const names: string[] = [];
  const refused: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(/[,;\n]/)) {
    const t = tidyAlias(part);
    if (!t) continue;
    if (!looksLikeName(t)) {
      refused.push(t);
      continue;
    }
    const n = normAlias(t);
    if (seen.has(n)) continue;
    seen.add(n);
    names.push(t);
  }
  return { names: names.slice(0, ALIASES_MAX), refused };
}

/** The names a card lists, in the box's own shape: "Bobo, Leo". */
export function aliasListText(names: readonly string[]): string {
  return names.join(", ");
}

/** WHAT TIFF LEARNS FROM AN ANSWER. Her plan had people nobody on the team
    answers to (`unknown`: the names as the note said them); the reply names
    the people it names (`named`, ids, never the speaker). Exactly one of
    each, and the one name is learnable: that name is that person. Anything
    else — two unknown names, an answer naming two people, "Me" — teaches
    nothing, because it can't say which name is whom. */
export function aliasFromAnswer(
  unknown: readonly string[],
  named: readonly string[],
  people: readonly { fullName: string }[],
): { alias: string; staffId: string } | null {
  const byNorm = new Map<string, string>();
  for (const u of unknown) if (!byNorm.has(normAlias(u))) byNorm.set(normAlias(u), tidyAlias(u)); // as first said
  const names = [...byNorm.values()];
  const ids = [...new Set(named)];
  if (names.length !== 1 || ids.length !== 1) return null;
  if (!learnable(names[0], people)) return null;
  return { alias: names[0], staffId: ids[0] };
}
