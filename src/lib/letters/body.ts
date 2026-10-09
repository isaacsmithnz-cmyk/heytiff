/* A LETTER'S BODY — the editor's document (Tiptap's JSON), kept to what a
   letter is made of: paragraphs and two levels of heading, bullet and
   numbered lists, simple tables, line breaks, and bold, italic and
   underlined text, each paragraph aligned left, centre, right or justified.

   Everything else the editor might hand over is dropped here, on every save
   and every render, so what is stored and printed is always one of these
   and never markup somebody typed. Pure. */

export type Align = "left" | "center" | "right" | "justify";
export type Mark = "bold" | "italic" | "underline";

export type TextNode = { type: "text"; text: string; marks?: { type: Mark }[] };
export type InlineNode = TextNode | { type: "hardBreak" };
export type Block =
  | { type: "paragraph"; attrs?: { textAlign: Align }; content?: InlineNode[] }
  | { type: "heading"; attrs: { level: 2 | 3; textAlign?: Align }; content?: InlineNode[] }
  | { type: "bulletList" | "orderedList"; content: ListItem[] }
  | { type: "table"; content: TableRow[] };
export type ListItem = { type: "listItem"; content: Block[] };
export type TableRow = { type: "tableRow"; content: TableCell[] };
export type TableCell = { type: "tableHeader" | "tableCell"; content: Block[] };
export type LetterBody = { type: "doc"; content: Block[] };

export const EMPTY_BODY: LetterBody = { type: "doc", content: [] };

/* a letter, not a book: past these it is cut, never thrown */
const MAX_BLOCKS = 400;
const MAX_TEXT = 20_000;
const MAX_DEPTH = 6;
const MAX_ROWS = 60;
const MAX_COLS = 8;

const ALIGNS: readonly Align[] = ["left", "center", "right", "justify"];
const MARKS: readonly Mark[] = ["bold", "italic", "underline"];

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function alignOf(attrs: unknown): Align | null {
  const a = rec(attrs).textAlign;
  return ALIGNS.includes(a as Align) && a !== "left" ? (a as Align) : null;
}

function inline(raw: unknown, budget: { text: number }): InlineNode[] {
  const out: InlineNode[] = [];
  for (const n of arr(raw)) {
    const o = rec(n);
    if (o.type === "hardBreak") out.push({ type: "hardBreak" });
    else if (o.type === "text" && typeof o.text === "string" && o.text.length > 0 && budget.text > 0) {
      const text = o.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, budget.text);
      budget.text -= text.length;
      if (!text) continue;
      const marks = [...new Set(arr(o.marks).map((m) => rec(m).type).filter((t): t is Mark => MARKS.includes(t as Mark)))];
      out.push(marks.length ? { type: "text", text, marks: marks.map((type) => ({ type })) } : { type: "text", text });
    }
  }
  return out;
}

function blocks(raw: unknown, budget: { blocks: number; text: number }, depth: number): Block[] {
  const out: Block[] = [];
  if (depth > MAX_DEPTH) return out;
  for (const n of arr(raw)) {
    if (budget.blocks <= 0) break;
    const o = rec(n);
    budget.blocks -= 1;
    if (o.type === "paragraph") {
      const align = alignOf(o.attrs);
      const content = inline(o.content, budget);
      out.push({ type: "paragraph", ...(align ? { attrs: { textAlign: align } } : {}), ...(content.length ? { content } : {}) });
    } else if (o.type === "heading") {
      const level = rec(o.attrs).level === 3 ? 3 : 2;
      const align = alignOf(o.attrs);
      const content = inline(o.content, budget);
      out.push({ type: "heading", attrs: { level, ...(align ? { textAlign: align } : {}) }, ...(content.length ? { content } : {}) });
    } else if (o.type === "bulletList" || o.type === "orderedList") {
      const items = arr(o.content)
        .filter((i) => rec(i).type === "listItem")
        .map((i): ListItem => ({ type: "listItem", content: blocks(rec(i).content, budget, depth + 1) }))
        .filter((i) => i.content.length > 0);
      if (items.length) out.push({ type: o.type, content: items });
    } else if (o.type === "table") {
      const rows = arr(o.content)
        .filter((r) => rec(r).type === "tableRow")
        .slice(0, MAX_ROWS)
        .map(
          (r): TableRow => ({
            type: "tableRow",
            content: arr(rec(r).content)
              .filter((c) => rec(c).type === "tableCell" || rec(c).type === "tableHeader")
              .slice(0, MAX_COLS)
              .map((c): TableCell => ({ type: rec(c).type as TableCell["type"], content: blocks(rec(c).content, budget, depth + 1) })),
          })
        )
        .filter((r) => r.content.length > 0);
      if (rows.length) out.push({ type: "table", content: rows });
    }
  }
  return out;
}

/** The body as it may be stored and printed; an empty letter for anything
    that isn't one. */
export function normaliseBody(raw: unknown): LetterBody {
  const o = rec(raw);
  if (o.type !== "doc") return { type: "doc", content: [] };
  return { type: "doc", content: blocks(o.content, { blocks: MAX_BLOCKS, text: MAX_TEXT }, 0) };
}

/** The body's words, for the list's preview line. */
export function bodyText(body: LetterBody, max = 160): string {
  const words: string[] = [];
  const walk = (nodes: readonly unknown[]) => {
    for (const n of nodes) {
      const o = rec(n);
      if (o.type === "text" && typeof o.text === "string") words.push(o.text);
      else if (o.type === "hardBreak") words.push(" ");
      else {
        walk(arr(o.content));
        if (o.type === "paragraph" || o.type === "heading" || o.type === "tableCell" || o.type === "tableHeader") words.push(" ");
      }
    }
  };
  walk(body.content);
  return words.join("").replace(/\s+/g, " ").trim().slice(0, max);
}
