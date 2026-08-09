/* IS THIS RECORD IN ENGLISH? — the check behind the instruction.

   `policy.ts` TELLS the router to write every stored record in Australian
   English, and the models follow it. An instruction is not a guarantee
   though, and the failure it guards against is the quiet kind: a task
   titled in Tagalog on somebody else's board, three weeks later, with
   nothing to point at. So the proposal is read once more before it reaches
   the review card, and this is the reading.

   PURE, LOCAL AND FREE — the same rule the sniff and the question gate
   follow. Deciding "is this English" properly is a model call, and paying
   one on every note to check the work of the call that just ran would
   double the cost of the feature to catch something rare. This is evidence
   counting instead: it is a NET, not a proof, and the repair it triggers is
   what actually fixes the text.

   THE ASYMMETRY, because every gate in this app has one. A false yes costs
   one cheap translation pass over text that was already English, and the
   pass leaves English alone. A false no leaves a foreign record on the
   board — the thing we are trying to prevent. So this leans toward yes,
   with one exception that outranks it: a name.

   THE TRAP THAT SHAPED IT. Records are FULL of non-English strings that are
   not non-English: "Muñoz", "José", "Meridian Café", "kΩ", "µm", "±2°C".
   A single accented token therefore proves nothing, which is why nothing
   here fires on one piece of Latin-script evidence alone — it takes two,
   or one in a text short enough that one is most of it. Non-Latin SCRIPT is
   different and fires immediately: no client name, model number or unit in
   this trade is written in Han, Arabic or Thai. Greek is deliberately absent
   from that list — Ω and µ are how this trade writes resistance and microns. */

import { hasWord } from "./text";
import {
  DEADLINE_CUES,
  FAULT_CUES,
  IMPERATIVE_CUES,
  OBLIGATION_CUES,
} from "@/lib/notes/sniff-cues";

/** Scripts no HVAC record has any business being written in. Greek is NOT
    here: Ω, µ and Δ are trade notation, not language. */
const FOREIGN_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Cyrillic}\p{Script=Thai}\p{Script=Devanagari}]/u;

/** Letters Vietnamese uses and nobody else here does. A client name can
    carry á or ñ; it does not carry ộ. */
const VIETNAMESE_LETTER = /[ăằắẳẵặâầấẩẫậđêềếểễệôồốổỗộơờớởỡợưừứửữựạảẹẻẽỉịọỏũụủỳỵỷỹ]/u;

/** Punctuation only Spanish writes. */
const SPANISH_MARK = /[¿¡]/u;

/** Function words — the skeleton of a sentence, and the part a translation
    never leaves behind. Deliberately excludes the ones that are also
    English words or common in English text: Tagalog "at" and "na", the
    bare "no" of "no funciona". */
const FUNCTION_WORDS = new Set([
  // Spanish
  "que", "qué", "de", "la", "el", "los", "las", "del", "con", "por", "para",
  "una", "unos", "unas", "al", "es", "está", "están", "son", "hay", "pero",
  "cuando", "donde", "sin", "sobre", "muy", "también", "desde", "hasta",
  "antes", "después", "todo", "toda", "esta", "este", "ese", "esa",
  // Vietnamese
  "và", "của", "cho", "với", "là", "được", "này", "đã", "sẽ", "khi", "thì",
  "ở", "có", "không", "người", "những", "một", "các", "rồi", "nữa", "để",
  // Tagalog
  "ang", "ng", "mga", "sa", "kay", "yung", "nang", "naman", "kasi", "dahil",
  "siya", "niya", "natin", "namin", "ay", "ito", "iyan",
]);

/** The trade vocabulary the sieve already knows in five languages. Reused
    rather than retyped: a translated task says "cambiar el filtro" or "thay
    lọc gió", and those are exactly the words `sniff-cues.ts` collects. */
const TRADE_CUES: readonly string[] = [
  ...OBLIGATION_CUES,
  ...IMPERATIVE_CUES,
  ...DEADLINE_CUES,
  ...FAULT_CUES,
];

export type EnglishCheck = {
  /** Should this string be repaired before it is stored? */
  foreign: boolean;
  /** What was found — no UI reads this; it makes a wrong call diagnosable. */
  reasons: string[];
};

const CLEAN: EnglishCheck = { foreign: false, reasons: [] };

/** Read one stored string. */
export function checkEnglish(text: string): EnglishCheck {
  const t = text.trim().toLowerCase();
  if (!t) return CLEAN;

  /* A script no record is written in is the end of the question — one
     character is enough, and no threshold applies. */
  if (FOREIGN_SCRIPT.test(t)) return { foreign: true, reasons: ["non-Latin script"] };

  const reasons: string[] = [];
  if (SPANISH_MARK.test(t)) reasons.push("Spanish punctuation");

  const words = t.split(/[\s,.;:!?()"']+/u).filter(Boolean);
  for (const w of words) {
    if (FUNCTION_WORDS.has(w)) reasons.push(`"${w}"`);
    else if (VIETNAMESE_LETTER.test(w)) reasons.push(`"${w}"`);
  }

  const cue = TRADE_CUES.find((c) => hasWord(t, c));
  if (cue) reasons.push(`"${cue.trim()}"`);

  /* TWO PIECES OF EVIDENCE, or one in a text short enough that one piece is
     most of it. "Call José about the grilles" has a single accented name and
     stays; "cambiar filtro" is two words of which one is a trade cue, and
     goes. */
  const foreign = reasons.length >= 2 || (reasons.length === 1 && words.length <= 2);
  return foreign ? { foreign, reasons } : CLEAN;
}

/** Convenience for a caller that only wants the verdict. */
export const looksNonEnglish = (text: string): boolean => checkEnglish(text).foreign;
