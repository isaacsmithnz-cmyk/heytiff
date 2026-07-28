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
   It isn't one — it is the same information. */

const UNITS: Record<string, number> = {
  zero: 0, oh: 0, o: 0, nought: 0,
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9,
};

const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const SCALES: Record<string, number> = { hundred: 100, thousand: 1000 };

const REPEATS: Record<string, number> = { double: 2, triple: 3 };

function valueOf(token: string): number | null {
  if (token in UNITS) return UNITS[token];
  if (token in TEENS) return TEENS[token];
  if (token in TENS) return TENS[token];
  if (token in SCALES) return SCALES[token];
  return null;
}

const isNumberWord = (t: string): boolean => valueOf(t) !== null;

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

/* The cardinal reading: thirty + six = 36, three + hundred + thirty + seven = 337.
   Bare `current || 1` handles "a hundred"-shaped runs where the multiplier was
   never spoken. */
function cardinal(tokens: string[]): number {
  let total = 0;
  let current = 0;
  for (const token of tokens) {
    const v = valueOf(token);
    if (v === null) continue;
    if (v === 100) current = (current || 1) * 100;
    else if (v === 1000) {
      total += (current || 1) * 1000;
      current = 0;
    } else current += v;
  }
  return total + current;
}

/** Read a run of number words the way a person meant it. Exported for tests —
    the run-splitting above it is the part that is easy to get wrong. */
export function readNumberRun(tokens: string[]): string {
  const words = tokens.filter((t) => t !== "and");
  if (words.length === 0) return "";
  // A single word is always its own value: "seven" is 7, never the string "7"
  // by a different route, and "ten" must not become "10" via concatenation.
  if (words.length === 1) return String(valueOf(words[0]) ?? "");
  const structured = words.some((t) => t in TEENS || t in TENS || t in SCALES);
  if (structured) return String(cardinal(words));
  // All bare units, more than one of them: read out, not added up.
  return words.map((t) => String(UNITS[t])).join("");
}

/** Replace every run of spoken number words in `text` with its digits.
    Non-number words pass through untouched. */
export function spokenToDigits(text: string): string {
  const tokens = expandRepeats(text.split(/\s+/).filter(Boolean));
  const out: string[] = [];
  let run: string[] = [];

  const flush = () => {
    if (run.length === 0) return;
    // A trailing "and" was a conjunction, not part of the number — it belongs
    // AFTER the digits it followed ("ordered two and the..." → "ordered 2 and
    // the..."), so hold it aside rather than emitting it first.
    const trailing: string[] = [];
    while (run.length > 0 && run[run.length - 1] === "and") {
      trailing.unshift(run.pop() as string);
    }
    const read = readNumberRun(run);
    if (read !== "") out.push(read);
    out.push(...trailing);
    run = [];
  };

  for (const token of tokens) {
    if (isNumberWord(token)) {
      run.push(token);
      continue;
    }
    // "and" only stays inside a run if a number word follows it; that is
    // decided on flush, so hold it and let the next token settle it.
    if (token === "and" && run.length > 0) {
      run.push(token);
      continue;
    }
    flush();
    out.push(token);
  }
  flush();
  return out.join(" ");
}
