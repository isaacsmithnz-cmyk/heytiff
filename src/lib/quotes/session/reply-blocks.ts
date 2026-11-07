/* HER REPLY, READ INTO BLOCKS (Isaac, 30 October 2026, on 3423): her
   sentences, her points and her numbered questions, with what she put in bold.
   Only those: a heading, a line under a point or anything else stays her plain
   words, and a stray asterisk stands as it is. Pure. */

export type ReplySpan = { text: string; bold: boolean };
export type ReplyBlock =
  | { kind: "para"; spans: ReplySpan[] }
  | { kind: "bullets"; items: ReplySpan[][] }
  | { kind: "numbers"; start: number; items: ReplySpan[][] };

const spansOf = (text: string): ReplySpan[] => {
  const out: ReplySpan[] = [];
  let from = 0;
  for (const m of text.matchAll(/\*\*(.+?)\*\*/g)) {
    if (m.index > from) out.push({ text: text.slice(from, m.index), bold: false });
    out.push({ text: m[1]!, bold: true });
    from = m.index + m[0].length;
  }
  if (from < text.length) out.push({ text: text.slice(from), bold: false });
  return out;
};

/** "Question:" alone on its line: the numbers already say what follows. */
const LEAD_IN = /^(?:\*\*)?questions?:?(?:\*\*)?:?$/i;

export function replyBlocks(text: string): ReplyBlock[] {
  const blocks: ReplyBlock[] = [];
  let words: string[] = [];
  const endWords = () => {
    if (words.length) blocks.push({ kind: "para", spans: spansOf(words.join(" ")) });
    words = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      endWords();
      continue;
    }
    if (LEAD_IN.test(line)) {
      endWords();
      continue;
    }
    const point = /^[-*•]\s+(.+)$/.exec(line);
    const numbered = /^(\d+)[.)]\s+(.+)$/.exec(line);
    const last = blocks.at(-1);
    if (point) {
      endWords();
      /* a point under a point sits level with it: a list here is one level */
      if (last?.kind === "bullets") last.items.push(spansOf(point[1]!));
      else blocks.push({ kind: "bullets", items: [spansOf(point[1]!)] });
    } else if (numbered) {
      endWords();
      if (last?.kind === "numbers") last.items.push(spansOf(numbered[2]!));
      else blocks.push({ kind: "numbers", start: Number(numbered[1]), items: [spansOf(numbered[2]!)] });
    } else {
      words.push(line);
    }
  }
  endWords();
  return blocks;
}
