/* Matching words when the words are not English.

   Three cheap local gates read what somebody typed or dictated — the
   question/note split (`lib/brain/intent.ts`), the action sieve
   (`lib/notes/sniff.ts`) and the number reader (`lib/voice/spoken-numbers.ts`).
   All three were written against English and all three broke silently on
   anything else, so the string handling they share lives here rather than
   being got subtly wrong three times.

   TWO FACTS ABOUT OTHER SCRIPTS THAT ENGLISH LETS YOU FORGET.

     · A WORD BOUNDARY IS A LATIN IDEA. Chinese writes without spaces at all,
       so "word starts here" has nothing to test; Arabic glues its grammar
       onto the front of the word (و "and", ال "the"), so a cue that must
       start a word never matches once anyone speaks naturally. Both scripts
       therefore match as PLAIN SUBSTRINGS, and the choice is made by the
       CUE's script rather than by a flag someone has to remember to set.

     · COUNTING WORDS BY SPACES COUNTS ONE. That is what killed the sieve on
       Chinese outright: its first line drops out below four words, and a
       whole spoken paragraph of Chinese is one space-free token. Han, kana
       and Thai are counted by character instead, two to the word.

   Everything here is pure and boundary-shaped, so the cases that used to be
   invisible in production are pinned in a test file. */

/** Scripts that don't put spaces between words. */
const DENSE_CLASS = String.raw`[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]`;
const DENSE_ALL = new RegExp(DENSE_CLASS, "gu");

/** Scripts where a cue matches loosely — the dense ones plus Arabic, which
    spaces its words but prefixes them with its conjunctions and articles. */
const LOOSE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Arabic}]/u;

/** A letter or a digit in ANY script — what a word boundary is the absence
    of. `[a-z0-9]` was the old test and it reads "é", "ñ" and "ộ" as gaps,
    which turns half of Spanish and all of Vietnamese into word starts. */
const WORDISH = /[\p{L}\p{N}]/u;

const DENSE_ONE = new RegExp(DENSE_CLASS, "u");

/** Does this character continue a Latin-script word? A Han character does
    not: a name written straight against Chinese text ("提醒Dane带工具") has
    a boundary in front of it even though there is no space, and reading 醒
    as a letter is how "Dane" stopped being a name the sieve could see. */
function joinsWord(ch: string | undefined): boolean {
  return ch !== undefined && WORDISH.test(ch) && !DENSE_ONE.test(ch);
}

/** Does this cue belong to a script that has to match as a substring? */
export function isLooseScript(cue: string): boolean {
  return LOOSE.test(cue);
}

/** Does `needle` start a word in `hay`? Stops "order" matching "recorder"
    and "call" matching "recall" — both of which turn up in HVAC notes.
    Loose-script cues have no boundary to check and match anywhere. */
export function hasWord(hay: string, needle: string): boolean {
  if (needle === "") return false;
  if (isLooseScript(needle)) return hay.includes(needle);

  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at < 0) return false;
    /* Phrases carrying their own trailing space are already anchored on the
       right; only the left edge needs checking. */
    if (at === 0 || !joinsWord(hay[at - 1])) return true;
    from = at + 1;
  }
}

/** As `hasWord`, but the right edge must be a boundary too — "order" is an
    imperative, "ordered" is a description of work already done. */
export function hasWholeWord(hay: string, needle: string): boolean {
  if (needle === "") return false;
  if (isLooseScript(needle)) return hay.includes(needle);

  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at < 0) return false;
    from = at + 1;
    if (joinsWord(hay[at + needle.length])) continue;
    if (at === 0 || !joinsWord(hay[at - 1])) return true;
  }
}

/** Does `hay` open with this cue? The whole text being the cue counts. */
export function startsWithCue(hay: string, cue: string): boolean {
  if (isLooseScript(cue)) return hay.startsWith(cue);
  return hay === cue || hay.startsWith(cue + " ");
}

/** Does `hay` close with this cue? Vietnamese and Chinese put their question
    markers LAST ("…xong chưa", "…好了吗"), which is why this exists at all. */
export function endsWithCue(hay: string, cue: string): boolean {
  if (isLooseScript(cue)) return hay.endsWith(cue);
  return hay === cue || hay.endsWith(" " + cue);
}

/** The words that start a new clause mid-sentence, in every language the
    gates read. An imperative counts where a clause opens and nowhere else:
    "check the roof" is an ask, "did a check on the belts" is a report. */
const COORDINATORS = [
  "and",
  "then",
  "at", // Tagalog "and"
  "y", // Spanish
  "luego",
  "después",
  "despues",
  "và", // Vietnamese
  "rồi",
  "tapos", // Tagalog
  "然后", // Chinese
];

/** Start of text, or straight after clause punctuation or a coordinator.
    The punctuation class carries the CJK marks too — a Chinese sentence
    breaks on 。and ，, never on the ASCII pair. */
const CLAUSE_LEAD = new RegExp(
  String.raw`(?:^|[.;,!?。，、；！]\s*|(?:^|[^\p{L}\p{N}])(?:${COORDINATORS.join("|")})\s+)$`,
  "u"
);

/** Does `cue` open a clause in `hay`? Loose-script cues are accepted
    anywhere: Chinese has no clause-opening shape this could read, and in
    the sieve that uses it a false yes costs one routing call. */
export function opensClause(hay: string, cue: string): boolean {
  if (cue === "") return false;
  if (isLooseScript(cue)) return hay.includes(cue);

  let from = 0;
  for (;;) {
    const at = hay.indexOf(cue, from);
    if (at < 0) return false;
    from = at + 1;
    if (joinsWord(hay[at + cue.length])) continue;
    if (at === 0 || CLAUSE_LEAD.test(hay.slice(0, at))) return true;
  }
}

/** Roughly how many words is this, in any script? Spaced tokens count one
    each; Han, kana and Thai count two characters to the word, which is
    about what those scripts average. Only ever used for "is there enough
    here to be worth reading", so approximate is the whole point. */
export function looseWordCount(text: string): number {
  const t = text.trim();
  if (t === "") return 0;
  const dense = t.match(DENSE_ALL)?.length ?? 0;
  const spaced = t.replace(DENSE_ALL, " ").split(/\s+/).filter(Boolean).length;
  return spaced + Math.ceil(dense / 2);
}

/** Arabic-Indic and Persian digits → the ASCII ones. A job number spoken in
    Arabic comes back as ٣٣٧ and every downstream matcher reads digits. */
export function westernDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/gu, (d) => {
    const code = d.codePointAt(0) as number;
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}
