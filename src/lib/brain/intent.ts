/* QUESTION OR NOTE? — local and free, like the sniff it stands beside.

   The one token now does two jobs: capture words (the note flow) and answer
   questions (the ask loop). Something has to pick, and that something runs
   on every submit, so it cannot be a model call — the same economics that
   built lib/notes/sniff.ts.

   THE ASYMMETRY RUNS THE OPPOSITE WAY TO THE SNIFF'S. There, a false "no"
   was invisible and a false "yes" cost one wasted call, so it leans
   generous. Here a false "question" EATS A NOTE — the words go to the
   answer loop and never reach the review card, so nothing is saved, and
   the person spoke a note that quietly became a conversation. A false
   "note" merely shows someone their own question on a review card, one
   Discard away. So this leans HARD toward note: it says "question" only on
   signals a note essentially never carries.

   Two such signals:
     · a trailing question mark — nobody dictates one into a site note
     · an INFORMATIONAL opener: "what's / where / when / who / why / how
       many / is there / do we / show me / tell me about…"

   The traps that shaped the opener list:
     · "can you order the grilles" is question-SHAPED and is a task. All the
       request modals (can/could/will/would/should) are excluded.
     · "tell Luke to order the grilles" is a task; "tell me about Meridian"
       is a question. The opener is "tell me", never "tell".
     · "is the crane booked" is a genuine question; "isolated the unit" is
       not — hence word-boundary matching, not prefixes.

   ─────────────────────────────────────────────────────────────────────────

   THE OTHER LANGUAGES ON AN AUSTRALIAN SITE. Speech comes back in whatever
   was spoken — the transcriber auto-detects and never translates — so an
   English-only opener list meant every non-English question fell through to
   the note flow and landed on a review card. Mandarin, Vietnamese, Arabic,
   Spanish and Tagalog are carried here, and three things about them decided
   the shape of the code:

     · PUNCTUATION TRAVELS FURTHEST. A question mark is a question mark in
       every one of them, and the transcriber punctuates. So the marks are
       matched in their own scripts too — ？ ؟ — and Spanish's opening ¿
       counts on its own, because nothing but a question carries it.

     · THE MARKER IS NOT ALWAYS IN FRONT. English fronts its question word;
       Vietnamese and Chinese put theirs LAST ("xong chưa", "好了吗"). A cue
       therefore says WHERE it counts, and "end" is a real position rather
       than a rounding error.

     · THE SAME CAUTION, HARDER. Every cue below had to survive "would a
       NOTE ever contain this?" in its own language and in the others, since
       one list reads all of them. Casualties, all deliberate: Spanish bare
       "hay" (statement "hay que cambiar el filtro" is an obligation, not a
       question), unaccented "cuando" and "porque" (both open statements),
       Tagalog "may" (collides with English "may need to…"), Tagalog bare
       "ba" (Vietnamese for three), Vietnamese bare "ai" (English "AI"),
       Chinese 什么 (没什么 = "nothing wrong"), 几 (几个 = "a few") and 怎么
       ("不知道怎么弄" = "don't know how to do it"). Losing a question costs
       a Discard; eating a note costs the note. */

import { endsWithCue, hasWord, startsWithCue } from "@/lib/lang/text";

const OPENERS = [
  "what",
  "what's",
  "whats",
  "where",
  "where's",
  "wheres",
  "when",
  "when's",
  "who",
  "who's",
  "whos",
  "which",
  "why",
  "how",
  "is there",
  "are there",
  "is the",
  "are the",
  "do we",
  "does the",
  "does anyone",
  "did we",
  "did anyone",
  "has the",
  "has anyone",
  "have we",
  "am i",
  "show me",
  "tell me about",
  "tell me what",
  "any idea",
  "anything outstanding",
  "anything open",
];

/** Where a cue has to sit before it counts. English and Spanish front their
    question words; Vietnamese and Chinese trail their particles; Chinese
    leaves its wh-words where they fell, which is what "anywhere" is for. */
type Where = "start" | "end" | "anywhere";

type Cue = { readonly word: string; readonly at: Where };

const at = (where: Where, ...words: string[]): Cue[] =>
  words.map((word) => ({ word, at: where }));

/* Spanish. The accent IS the disambiguator — an interrogative "qué" carries
   one and the conjunction "que" does not — so the accented forms are taken
   bare and the unaccented ones only inside a phrase that cannot be a
   statement. */
const SPANISH: Cue[] = [
  ...at(
    "start",
    "qué",
    "por qué",
    "para qué",
    "dónde",
    "adónde",
    "cuándo",
    "quién",
    "quiénes",
    "cuál",
    "cuáles",
    "cómo",
    "cuánto",
    "cuánta",
    "cuántos",
    "cuántas",
    "donde está",
    "donde esta",
    "donde están",
    "donde estan",
    "hay alguien",
    "hay algo",
    "alguien sabe",
    "sabes si",
    "sabe alguien"
  ),
];

/* Vietnamese. Most of it trails: "…chưa" (yet?), "…không" (the yes/no
   particle), "…ở đâu" (where), "…thế nào" (how). A note ending on the bare
   particle is not a shape anyone writes. */
const VIETNAMESE: Cue[] = [
  ...at("start", "tại sao", "vì sao", "khi nào", "bao giờ", "bao nhiêu", "có phải", "cái gì", "chỗ nào"),
  ...at("end", "không", "chưa", "ở đâu", "đâu", "thế nào", "gì", "bao nhiêu", "nhỉ", "hả"),
];

/* Chinese. No spaces, so these match as substrings; the trailing particles
   are the safest signal there is, and the wh-phrases kept are the ones with
   no statement reading. */
const CHINESE: Cue[] = [
  ...at("end", "吗", "呢"),
  ...at(
    "anywhere",
    "什么时候",
    "为什么",
    "哪里",
    "哪儿",
    "在哪",
    "多少",
    "几点",
    "是不是",
    "有没有"
  ),
];

/* Arabic. Questions are fronted, and the script's prefixes mean these match
   loosely rather than on a word boundary. Both the hamza spellings and the
   bare ones are here because people type either. */
const ARABIC: Cue[] = [
  ...at("start", "هل", "ماذا", "أين", "اين", "وين", "فين", "متى", "لماذا", "ليش", "كيف", "كم", "شو", "ايش", "إيش"),
];

/* Tagalog. Bare "ano" is also the universal filler ("ano, yung unit…"), so
   only its phrase forms count — and "ilan" (how many) is left out for a
   reason that has nothing to do with Tagalog: it is also a first name, and a
   note that opens with somebody's name is the commonest note there is. */
const TAGALOG: Cue[] = [
  ...at(
    "start",
    "anong",
    "ano ang",
    "ano ba",
    "ano na",
    "ano yung",
    "saan",
    "nasaan",
    "kailan",
    "sino",
    "bakit",
    "paano",
    "papaano",
    "magkano",
    "alin",
    "kumusta"
  ),
];

const CUES: readonly Cue[] = [
  ...at("start", ...OPENERS),
  ...SPANISH,
  ...VIETNAMESE,
  ...CHINESE,
  ...ARABIC,
  ...TAGALOG,
];

/** A question mark in the scripts we read: ASCII, CJK full-width, Arabic. */
const MARKS = ["?", "？", "؟"];

/** Trailing punctuation an end-cue can hide behind — a full stop typed out
    of habit, an ellipsis, the CJK stop. Not the question marks: those have
    already answered the question by the time this is used. */
const TRAILING = /[\s.!。！…、]+$/u;

function matches(text: string, cue: Cue): boolean {
  if (cue.at === "start") return startsWithCue(text, cue.word);
  if (cue.at === "end") return endsWithCue(text, cue.word);
  return hasWord(text, cue.word);
}

/** Should these words go to the ask loop instead of the note flow? */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (MARKS.some((m) => t.endsWith(m))) return true;
  /* Spanish opens its questions with a mark of its own, and only its
     questions carry it. */
  if (t.startsWith("¿")) return true;

  /* Cues match on the sentence with its trailing punctuation off, so a
     final particle is still final after a full stop. */
  const bare = t.replace(TRAILING, "");

  /* Openers match at the very start only. A question buried mid-note
     ("…and ask Dane what's left") is part of the note. */
  return CUES.some((c) => matches(bare, c));
}
