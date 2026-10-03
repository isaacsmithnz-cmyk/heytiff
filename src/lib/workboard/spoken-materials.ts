/* A MATERIALS LIST SAID OUT LOUD (Isaac, 2026-10-03: "the materials step to
   improve to allow items from price books and speech to text input"). The
   words come back as one sentence — "two pair coils, a 20 amp isolator and
   3 m of trunking" — and become rows: what, and how many. Nothing is added
   from here; a person ticks the rows first. Pure. */

export type SpokenRow = { name: string; qty: string };

const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, twenty: 20 };
const UNIT = String.raw`(?:m|metres?|meters?|lengths?|rolls?|boxes?|packs?|bags?)`;
/* "3 m of trunking", "two lengths of trunking", "4 x brackets", "a 20 amp isolator" */
const LEADING = new RegExp(String.raw`^(\d+(?:\.\d+)?|(?:${Object.keys(WORDS).join("|")})\b)\s*(?:x\s+)?(?:(${UNIT})\b\s*(?:of\s+)?)?(.*)$`, "i");

export function splitSpokenList(text: string): SpokenRow[] {
  return text
    .split(/\n|[,;]|\s+and\s+|\s+plus\s+|\.\s+|\.$/i)
    .map((p) => p.replace(/^(?:\s*(?:and|also|plus|then)\s+)+/i, "").replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 1)
    .map((p): SpokenRow => {
      const m = LEADING.exec(p);
      if (!m || !m[3]?.trim()) return { name: cap(p), qty: "" };
      const n = WORDS[m[1]!.toLowerCase()] ?? Number(m[1]);
      const unit = m[2] ? ` ${/^m$|metre|meter/i.test(m[2]) ? "m" : m[2].toLowerCase()}` : "";
      return { name: cap(m[3].trim()), qty: `${n}${unit}` };
    });
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
