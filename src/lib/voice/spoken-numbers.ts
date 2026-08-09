/* Spoken numbers → digits. Pure, and load-bearing twice over.

   A tech says "job three three seven" and "thirty six Wyndham Street". Both are
   numbers, and neither arrives as digits reliably — every transcriber formats
   them differently, and the same one is inconsistent between takes. So the
   resolver never sees raw transcriber output: it sees this.

   THE ONE RULE: a run of number words is either a DIGIT STRING or a CARDINAL,
   and you can tell which by whether it contains a teen, a tens word or a scale.
   "three three seven" has none, so it is 337 read out digit by digit.
   "thirty six" has a tens word, so it is the value 36. "three hundred and
   thirty seven" has a scale, so it is 337 again — same job, said differently,
   and both must land on the same string or the picker opens for nothing.

   Also used to normalise BOTH sides before scoring a bake-off, so a transcriber
   writing "36" where the human wrote "thirty six" is not counted as an error.
   It isn't one — it is the same information.

   ─────────────────────────────────────────────────────────────────────────

   THE SAME JOB IN FIVE MORE LANGUAGES. Speech comes back in whatever was
   spoken, so "job three three seven" in Vietnamese used to pass through as
   words and match no job at all. Mandarin, Vietnamese, Arabic, Spanish and
   Tagalog are read here now, and each brought one thing English does not
   have:

     · A MULTIPLIER WHERE ENGLISH HAS A WORD. Vietnamese builds its tens as
       "two ten" (hai mươi = 20) and Chinese as 三十, so ten multiplies what
       is in hand rather than adding to it. That broke the old accumulator on
       the FIRST hundred — "một trăm ba mươi bảy" came out as 1030 — so the
       reader now carries a pending digit and a section, which is the shape
       every one of these languages actually spells.

     · DIGITS THAT AREN'T ASCII. Arabic speech comes back as ٣٣٧ and Chinese
       as 三三七; both are normalised before anything else looks at the text.

     · WORDS THAT ARE ALSO WORDS. "lima" is five in Tagalog and a city in
       English, "không" is zero and also "not", "ba" is three and also a
       Vietnamese kinship term. Those are marked WEAK: they count inside a
       run of numbers and are left alone when they stand by themselves, so
       "lima anim pito" is 567 and "Lima Street" stays Lima Street. */

import { westernDigits } from "@/lib/lang/text";

/** Words that are also ordinary words in one of the other languages read
    here — including in English, which is the trap that matters most:
    Spanish "once" is eleven and English "once the unit is off" is not a
    number at all. A weak token never becomes a digit on its own. */
const WEAK = new Set([
  "không",
  "ba",
  "hai",
  "năm",
  "tư",
  "isa",
  "lima",
  "pito",
  "dos",
  "once",
  "mil",
]);

const UNITS: Record<string, number> = {
  zero: 0, oh: 0, o: 0, nought: 0,
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9,

  // Spanish (and, in practice, half of Tagalog)
  cero: 0, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9,

  // Vietnamese. "mốt" is one in a compound (hai mươi mốt = 21) and "lăm"
  // is five in the same position (hai mươi lăm = 25).
  không: 0, một: 1, mốt: 1, hai: 2, ba: 3, bốn: 4, tư: 4,
  năm: 5, lăm: 5, nhăm: 5, sáu: 6, bảy: 7, bẩy: 7, tám: 8, chín: 9,

  // Tagalog
  isa: 1, dalawa: 2, tatlo: 3, apat: 4, lima: 5,
  anim: 6, pito: 7, walo: 8, siyam: 9,

  // Arabic, in the spellings people actually type
  صفر: 0, واحد: 1, واحدة: 1, اثنان: 2, اثنين: 2, ثلاثة: 3, ثلاث: 3,
  أربعة: 4, اربعة: 4, أربع: 4, خمسة: 5, خمس: 5, ستة: 6, ست: 6,
  سبعة: 7, سبع: 7, ثمانية: 8, ثمان: 8, تسعة: 9, تسع: 9,
};

const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,

  // Spanish writes 11–29 as single words, so they read like teens here
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciséis: 16, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veintiuno: 21, veintiún: 21, veintiuna: 21, veintidós: 22, veintidos: 22,
  veintitrés: 23, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiséis: 26, veintiseis: 26, veintisiete: 27, veintiocho: 28,
  veintinueve: 29,

  // Vietnamese ten — note this is "mười", the standalone word, and NOT the
  // multiplier "mươi" that builds the tens below. One vowel apart, and the
  // difference between 16 and 60.
  mười: 10,

  // Tagalog
  sampu: 10, "labing-isa": 11, labindalawa: 12, labintatlo: 13,
  "labing-apat": 14, labinlima: 15, "labing-anim": 16, labimpito: 17,
  labingwalo: 18, labinsiyam: 19,

  // Arabic
  عشرة: 10, عشر: 10,
};

const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,

  // Spanish
  veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50,
  sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,

  // Tagalog
  dalawampu: 20, tatlumpu: 30, apatnapu: 40, limampu: 50,
  animnapu: 60, pitumpu: 70, walumpu: 80, siyamnapu: 90,

  // Arabic, both cases the language inflects for
  عشرون: 20, عشرين: 20, ثلاثون: 30, ثلاثين: 30, أربعون: 40, اربعون: 40,
  أربعين: 40, اربعين: 40, خمسون: 50, خمسين: 50, ستون: 60, ستين: 60,
  سبعون: 70, سبعين: 70, ثمانون: 80, ثمانين: 80, تسعون: 90, تسعين: 90,
};

/** Multipliers, not values: each one multiplies the digit in hand. Ten is a
    multiplier in Vietnamese ("ba mươi" = three tens = 30) and nowhere else
    in this file — English "ten" is a teen and adds. */
const SCALES: Record<string, number> = {
  hundred: 100, thousand: 1000,
  mươi: 10, trăm: 100, nghìn: 1000, ngàn: 1000,
  cien: 100, ciento: 100, cientos: 100, mil: 1000,
  daan: 100, libo: 1000,
  مئة: 100, مائة: 100, ميه: 100, ألف: 1000, الف: 1000,
};

const REPEATS: Record<string, number> = { double: 2, triple: 3 };

/** Words that join two halves of one number without being part of it.
    Tagalog's "at" is deliberately absent: it is also English "at", and
    "three at four" is two numbers rather than thirty-four. */
const CONNECTORS = new Set(["and", "y", "lẻ", "linh"]);

function valueOf(token: string): number | null {
  if (token in UNITS) return UNITS[token];
  if (token in TEENS) return TEENS[token];
  if (token in TENS) return TENS[token];
  if (token in SCALES) return SCALES[token];
  return null;
}

const isNumberWord = (t: string): boolean => valueOf(t) !== null;

/** What a token means once its grammar is peeled off. Arabic writes "and"
    as a prefix on the next word (ستة وثلاثون = "six and thirty") and Tagalog
    contracts its "at" to a suffix (tatlumpu't anim = 36). Both are stripped
    ONLY when what is left is itself a number, so "don't" never becomes
    "don". */
function normalise(token: string): string {
  if (isNumberWord(token)) return token;
  if (token.startsWith("و") && isNumberWord(token.slice(1))) return token.slice(1);
  if (token.endsWith("'t") && isNumberWord(token.slice(0, -2))) return token.slice(0, -2);
  return token;
}

/* "double three" → "three three". Expanded before runs are found so the
   repeated digits join the run they belong to rather than breaking it. */
function expandRepeats(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const times = REPEATS[tokens[i]];
    const next = tokens[i + 1];
    if (times && next !== undefined && next in UNITS) {
      for (let n = 0; n < times; n++) out.push(next);
      i++;
      continue;
    }
    out.push(tokens[i]);
  }
  return out;
}

/* The cardinal reading, in the shape every one of these languages spells:

     pending  the digit waiting to find out what it multiplies
     section  everything below a thousand that is already settled
     total    the thousands and above

   Ten and a hundred multiply the PENDING DIGIT, never the running section —
   that is what makes "một trăm ba mươi bảy" 137 rather than 1030, and it
   costs English nothing, because "three hundred and thirty seven" reaches
   "thirty" with nothing pending and adds it. */
function cardinal(tokens: string[]): number {
  let total = 0;
  let section = 0;
  let pending = 0;

  for (const token of tokens) {
    const scale = SCALES[token];
    if (scale !== undefined) {
      if (scale >= 1000) {
        total += (section + pending || 1) * scale;
        section = 0;
      } else {
        section += (pending || 1) * scale;
      }
      pending = 0;
      continue;
    }

    const v = valueOf(token);
    if (v === null) continue;
    /* A tens or teens word is a value in its own right; a unit is a digit
       that might still be waiting for a multiplier. */
    if (token in TENS || token in TEENS) {
      section += pending + v;
      pending = 0;
    } else {
      section += pending;
      pending = v;
    }
  }
  return total + section + pending;
}

/** Read a run of number words the way a person meant it. Exported for tests —
    the run-splitting above it is the part that is easy to get wrong. */
export function readNumberRun(tokens: string[]): string {
  const words = tokens.filter((t) => !CONNECTORS.has(t));
  if (words.length === 0) return "";
  // A single word is always its own value: "seven" is 7, never the string "7"
  // by a different route, and "ten" must not become "10" via concatenation.
  if (words.length === 1) return String(valueOf(words[0]) ?? "");
  const structured = words.some((t) => t in TEENS || t in TENS || t in SCALES);
  if (structured) return String(cardinal(words));
  // All bare units, more than one of them: read out, not added up.
  return words.map((t) => String(UNITS[t])).join("");
}

/* Han numerals, which no amount of splitting on spaces will ever find.
   Same one rule as the words: a run holding 十 百 or 千 is a cardinal
   (三十六 = 36), a run of bare digits is read out (三三七 = 337).

   SINGLE CHARACTERS ARE LEFT ALONE, deliberately. 一 and 十 are ordinary
   words as often as they are numbers — 一起 (together), 十分 (very) — and
   rewriting those would corrupt the note to save a digit nobody was
   looking for. */
const HAN_DIGITS: Record<string, number> = {
  "零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4,
  "五": 5, "六": 6, "七": 7, "八": 8, "九": 9,
};
const HAN_SCALES: Record<string, number> = { "十": 10, "百": 100, "千": 1000 };
const HAN_RUN = /[零〇一二两三四五六七八九十百千]{2,}/gu;

function readHanRun(run: string): string {
  const chars = [...run];
  if (!chars.some((c) => c in HAN_SCALES)) {
    return chars.map((c) => String(HAN_DIGITS[c])).join("");
  }

  let total = 0;
  let section = 0;
  let pending = 0;
  for (const c of chars) {
    const scale = HAN_SCALES[c];
    if (scale !== undefined) {
      if (scale >= 1000) {
        total += (section + pending || 1) * scale;
        section = 0;
      } else {
        section += (pending || 1) * scale;
      }
      pending = 0;
      continue;
    }
    section += pending;
    pending = HAN_DIGITS[c];
  }
  return String(total + section + pending);
}

/** Replace every run of spoken number words in `text` with its digits.
    Non-number words pass through untouched. */
export function spokenToDigits(text: string): string {
  /* Digits first, in whatever script they arrived in — after this the rest
     of the file only ever sees words. */
  const normalised = westernDigits(text).replace(HAN_RUN, readHanRun);

  const tokens = expandRepeats(
    normalised.split(/\s+/).filter(Boolean).map(normalise)
  );
  const out: string[] = [];
  let run: string[] = [];

  const flush = () => {
    if (run.length === 0) return;
    // A trailing "and" was a conjunction, not part of the number — it belongs
    // AFTER the digits it followed ("ordered two and the..." → "ordered 2 and
    // the..."), so hold it aside rather than emitting it first.
    const trailing: string[] = [];
    while (run.length > 0 && CONNECTORS.has(run[run.length - 1])) {
      trailing.unshift(run.pop() as string);
    }
    /* A lone weak word is the word, not the number: "Lima Street" is an
       address and "không" on its own is "no". */
    const read = run.length === 1 && WEAK.has(run[0]) ? run[0] : readNumberRun(run);
    if (read !== "") out.push(read);
    out.push(...trailing);
    run = [];
  };

  for (const token of tokens) {
    if (isNumberWord(token)) {
      run.push(token);
      continue;
    }
    // A connector only stays inside a run if a number word follows it; that
    // is decided on flush, so hold it and let the next token settle it.
    if (CONNECTORS.has(token) && run.length > 0) {
      run.push(token);
      continue;
    }
    flush();
    out.push(token);
  }
  flush();
  return out.join(" ");
}
