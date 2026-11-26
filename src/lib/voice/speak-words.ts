/* Her answer as words to be said: the pure half of her voice, used by the
   speak route (speak.ts) and by the screen reading an answer as it arrives
   (speaker.ts). Runs anywhere. */

/** The most one answer is read out. About two and a half minutes of her
    talking, ten cents at the list price: an answer longer than that is a
    document, and the screen is the place to read it. */
export const SPEAK_MAX_CHARS = 2_500;

/* What a table, a link or a list becomes when it is said rather than seen.
   The rule is that she reads what a person would read aloud off the screen
   to someone beside them: the words, never the punctuation that lays them
   out, and a table is pointed at rather than read cell by cell. */
export const TABLE_WORDS = "The table's on the screen.";
export const REST_WORDS = "The rest is on the screen.";

/** One line of her answer as words to be said, or null for a line that says
    nothing (blank, a rule, a fence, the rest of a table). Stateful, because
    a table and a fence run over lines; one per answer, fed in order, which
    is how an answer still arriving is read a line at a time. */
export function lineCleaner(): (line: string) => string | null {
  let inTable = false;
  let inFence = false;
  return (line0: string) => {
    const line = line0.trim();
    if (line.startsWith("```")) {
      inFence = !inFence;
      return null;
    }
    if (inFence) return null;
    if (/^\|.*\|$/.test(line)) {
      const first = !inTable;
      inTable = true;
      return first ? TABLE_WORDS : null;
    }
    inTable = false;
    if (!line || /^[-*_]{3,}$/.test(line)) return null;
    return cleanLine(line);
  };
}

function cleanLine(line: string): string | null {
    let s = line
      .replace(/^#{1,6}\s+/, "")
      .replace(/^>\s?/, "")
      .replace(/^(?:[-*+•]|\d+[.)])\s+/, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(\*|_)(\S(?:.*?\S)?)\1/g, "$2")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (!s) return null;
    /* A list item or a heading read straight on into the next line runs two
       thoughts together; a full stop gives her the breath a reader takes. */
    if (!/[.!?:;,…]$/.test(s)) s += ".";
    return s;
}

/** Her answer as words to be said. Markdown out, links to their words, a
    table pointed at once, and cut at a sentence end under the cap. "" when
    nothing is left worth saying. */
export function speakable(raw: string): string {
  const clean = lineCleaner();
  const out: string[] = [];
  for (const line of raw.replace(/\r\n?/g, "\n").split("\n")) {
    const s = clean(line);
    if (s) out.push(s);
  }
  return capSaid(out.join(" ").replace(/\s+/g, " ").trim());
}

/** Under the cap, cut at a sentence end, and say where the rest is. */
export function capSaid(text: string, max = SPEAK_MAX_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return `${end > max / 2 ? cut.slice(0, end + 1) : cut.trimEnd()} ${REST_WORDS}`;
}

/** Said words as sentences, each with its own end, for reading out in
    pieces so the first sound comes while the rest are still being made. */
export function sentencesOf(text: string): string[] {
  return (text.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/gu) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
}

