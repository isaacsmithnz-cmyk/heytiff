/* THE PROPOSAL'S FORMATTING, KEPT IN ITS WORDS (Isaac, 20 November 2026:
   "format should be a header like googe docs", then "Build all three" to
   https://claude.ai/artifact/EAB8Y8FsbnPbcuBXKDhT93). The words stay
   strings, as they were, so nothing kept before changes and every reader
   that wants plain words still gets them (`plainOf`). A few marks carry the
   rest:

     **bold**  *italic*  __underline__        inside any line
     # A heading                              a line of its own
     - an item          1. an item           a list, one item a line
     ![](photo:<id>)                          one of the job's photos

   The paragraph blocks (the introduction, each option's summary) hold all
   of them; a list's item and a heading hold the inline marks alone. Pure. */

export type Inline = { text: string; b?: boolean; i?: boolean; u?: boolean };

export type MarkBlock =
  | { kind: "p"; runs: Inline[] }
  | { kind: "h"; runs: Inline[] }
  | { kind: "ul" | "ol"; items: Inline[][] }
  | { kind: "photo"; id: string };

const MARKS = ["**", "__", "*"] as const;
type Mark = (typeof MARKS)[number];
const FLAG: Record<Mark, "b" | "u" | "i"> = { "**": "b", __: "u", "*": "i" };

/** where a mark opened at `from` closes: the next one of it, with words
    between; a lone `*` never closes on half of a `**` */
function closeOf(s: string, mark: Mark, from: number): number {
  let j = s.indexOf(mark, from);
  while (j >= 0) {
    /* "***" closing bold round an italic: the bold is its last two */
    while (mark === "**" && s[j + 2] === "*") j++;
    const single = mark === "*" && (s[j + 1] === "*" || s[j - 1] === "*");
    if (!single && j > from && s[from] !== " " && s[j - 1] !== " ") return j;
    j = s.indexOf(mark, j + 1);
  }
  return -1;
}

/** A line's words and their marks. A mark with no partner is just the
    character, so a "*" typed in words stays one. */
export function inlineOf(s: string, on: Omit<Inline, "text"> = {}): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ text: buf, ...on });
    buf = "";
  };
  let i = 0;
  while (i < s.length) {
    let took = false;
    for (const m of MARKS) {
      if (!s.startsWith(m, i) || (m === "*" && s[i + 1] === "*")) continue;
      const close = closeOf(s, m, i + m.length);
      if (close < 0) continue;
      flush();
      out.push(...inlineOf(s.slice(i + m.length, close), { ...on, [FLAG[m]]: true }));
      i = close + m.length;
      took = true;
      break;
    }
    if (!took) buf += s[i++];
  }
  flush();
  return out;
}

/** a line's words with its marks taken off */
export const inlinePlain = (s: string) =>
  inlineOf(s)
    .map((r) => r.text)
    .join("");

/* a photo of ours goes by "doc:<uuid>" (job-media-query ourDocumentRemoteId):
   without the colon a phone's photo came off the proposal as it was put on (bug 123) */
const PHOTO = /^!\[[^\]]*\]\(photo:([A-Za-z0-9_:-]{1,80})\)$/;
const BULLET = /^[-•*]\s+(.*)$/;
const NUMBER = /^\d{1,3}[.)]\s+(.*)$/;
const HEAD = /^#{1,3}\s+(.*)$/;

/** A paragraph block, read into its blocks: each line a paragraph, a
    heading or a photo, lines in a row with the same list mark one list. */
export function blocksOf(md: string): MarkBlock[] {
  const out: MarkBlock[] = [];
  for (const raw of md.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const photo = PHOTO.exec(line);
    const bullet = !photo && BULLET.exec(line);
    const number = !photo && !bullet && NUMBER.exec(line);
    const head = !photo && !bullet && !number && HEAD.exec(line);
    const last = out.at(-1);
    if (photo) out.push({ kind: "photo", id: photo[1]! });
    else if (bullet || number) {
      const kind = bullet ? "ul" : "ol";
      const runs = inlineOf((bullet ? bullet[1] : number ? number[1] : "") ?? "");
      if (last && last.kind === kind) last.items.push(runs);
      else out.push({ kind, items: [runs] });
    } else if (head) out.push({ kind: "h", runs: inlineOf(head[1]!) });
    else out.push({ kind: "p", runs: inlineOf(line) });
  }
  return out;
}

/** The words with no formatting, for whatever wants plain words
    (ServiceM8, the job's Scope, the phone, Tiff's reads): marks off,
    a heading its words, a photo gone; a list keeps its "- " or "1. ". */
export function plainOf(md: string): string {
  return blocksOf(md)
    .flatMap((b) => {
      const words = (runs: Inline[]) => runs.map((r) => r.text).join("");
      if (b.kind === "photo") return [];
      if (b.kind === "ul") return b.items.map((it) => `- ${words(it)}`);
      if (b.kind === "ol") return b.items.map((it, n) => `${n + 1}. ${words(it)}`);
      return [words((b as { runs: Inline[] }).runs)];
    })
    .join("\n");
}

/** The photos a block holds, by id, in order. */
export const photosIn = (md: string) => blocksOf(md).flatMap((b) => (b.kind === "photo" ? [b.id] : []));

/* ── to and from the page's own markup, for the box typed in ── */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** a line's runs as markup: <b>, <i>, <u> */
export function runsHtml(runs: Inline[]): string {
  return runs
    .map((r) => {
      let h = esc(r.text);
      if (r.u) h = `<u>${h}</u>`;
      if (r.i) h = `<i>${h}</i>`;
      if (r.b) h = `<b>${h}</b>`;
      return h;
    })
    .join("");
}

/** A paragraph block as the markup its box is filled with. A photo is an
    image the box can't type into, its id kept on it; a photo the page has
    no address for is a quiet frame that still holds its place. */
export function blockHtml(md: string, photoUrl: (id: string) => string | null): string {
  return blocksOf(md)
    .map((b) => {
      if (b.kind === "p") return `<p>${runsHtml(b.runs)}</p>`;
      if (b.kind === "h") return `<h3>${runsHtml(b.runs)}</h3>`;
      if (b.kind === "photo") {
        const url = photoUrl(b.id);
        return url
          ? `<figure contenteditable="false" data-photo="${esc(b.id)}"><img src="${esc(url)}" alt=""></figure>`
          : `<figure contenteditable="false" data-photo="${esc(b.id)}"></figure>`;
      }
      return `<${b.kind}>${b.items.map((it) => `<li>${runsHtml(it)}</li>`).join("")}</${b.kind}>`;
    })
    .join("");
}

/** The words of a box as typed, marks and all: its blocks a line each,
    bold, italic and underline as the browser drew them. Anything else
    pasted in is its words. */
export function markOf(root: Node, inlineOnly = false): string {
  const lines: string[] = [];
  let cur = "";
  const flush = () => {
    const t = cur.replace(/ /g, " ").replace(/[ \t]+/g, " ").trim();
    if (t) lines.push(t);
    cur = "";
  };
  const wrap = (el: Element, inner: string) => {
    if (!inner.trim()) return inner;
    const tag = el.tagName;
    const st = (el as HTMLElement).style;
    const b = tag === "B" || tag === "STRONG" || (st && (st.fontWeight === "bold" || Number(st.fontWeight) >= 600));
    const i = tag === "I" || tag === "EM" || (st && st.fontStyle === "italic");
    const u = tag === "U" || (st && /underline/.test(st.textDecoration || st.textDecorationLine || ""));
    /* the mark goes round the words, never their spaces */
    const lead = inner.match(/^\s*/)![0];
    const tail = inner.match(/\s*$/)![0];
    let core = inner.trim();
    if (u) core = `__${core}__`;
    if (i) core = `*${core}*`;
    if (b) core = `**${core}**`;
    return lead + core + tail;
  };
  const inline = (node: Node): string => {
    if (node.nodeType === 3) return node.textContent ?? "";
    if (node.nodeType !== 1) return "";
    const el = node as Element;
    if (el.tagName === "BR") return "\n";
    return wrap(el, Array.from(el.childNodes).map(inline).join(""));
  };
  const BLOCKS = /^(P|DIV|H[1-6]|UL|OL|LI|FIGURE|BLOCKQUOTE|SECTION)$/;
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== 1 || !BLOCKS.test((child as Element).tagName)) {
        const t = inline(child);
        const parts = t.split("\n");
        parts.forEach((p, k) => {
          if (k > 0) flush();
          cur += p;
        });
        continue;
      }
      const el = child as Element;
      flush();
      if (inlineOnly) {
        walk(el);
        flush();
        continue;
      }
      const tag = el.tagName;
      if (tag === "FIGURE") {
        const id = el.getAttribute("data-photo");
        if (id) lines.push(`![](photo:${id})`);
      } else if (tag === "UL" || tag === "OL") {
        let n = 0;
        for (const li of Array.from(el.children)) {
          if (li.tagName !== "LI") continue;
          const t = Array.from(li.childNodes).map(inline).join("").replace(/\s+/g, " ").trim();
          if (t) lines.push(tag === "UL" ? `- ${t}` : `${++n}. ${t}`);
        }
      } else if (/^H[1-6]$/.test(tag)) {
        const t = Array.from(el.childNodes).map(inline).join("").replace(/\s+/g, " ").trim();
        if (t) lines.push(`# ${t}`);
      } else {
        walk(el);
        flush();
      }
    }
  };
  walk(root);
  flush();
  return (inlineOnly ? lines.join(" ") : lines.join("\n")).trim();
}

/* ── a block's style, changed from the bar ── */

const runsMark = (runs: Inline[]) =>
  runs
    .map((r) => {
      const t = r.text;
      if (!t.trim()) return t;
      const lead = t.match(/^\s*/)![0];
      const tail = t.match(/\s*$/)![0];
      let core = t.trim();
      if (r.u) core = `__${core}__`;
      if (r.i) core = `*${core}*`;
      if (r.b) core = `**${core}**`;
      return lead + core + tail;
    })
    .join("");

/** Blocks back into the words as kept. */
export function markOfBlocks(blocks: readonly MarkBlock[]): string {
  return blocks
    .flatMap((b) => {
      if (b.kind === "photo") return [`![](photo:${b.id})`];
      if (b.kind === "h") return [`# ${runsMark(b.runs)}`];
      if (b.kind === "p") return [runsMark(b.runs)];
      return b.items.map((it, n) => (b.kind === "ul" ? `- ${runsMark(it)}` : `${n + 1}. ${runsMark(it)}`));
    })
    .join("\n");
}

export type BlockStyle = "p" | "h" | "ul" | "ol";

/** What the bar's style menu says of a block. */
export const styleOf = (b: MarkBlock | undefined): BlockStyle | null => (!b || b.kind === "photo" ? null : b.kind);

/** The block at `k` in another style: a paragraph or a heading becomes a
    one-item list and back; a list's items each become a paragraph or a
    heading. A photo stays a photo. */
export function restyle(md: string, k: number, to: BlockStyle): string {
  const blocks = blocksOf(md);
  const b = blocks[k];
  if (!b || b.kind === "photo" || b.kind === to) return md;
  const lines: Inline[][] = b.kind === "ul" || b.kind === "ol" ? b.items : [(b as { runs: Inline[] }).runs];
  const next: MarkBlock[] = to === "ul" || to === "ol" ? [{ kind: to, items: lines }] : lines.map((runs) => ({ kind: to, runs }));
  return markOfBlocks([...blocks.slice(0, k), ...next, ...blocks.slice(k + 1)]);
}

/** One of the job's photos put in after the block at `k`; at the end when
    there's no such block. */
export function withPhoto(md: string, k: number, id: string): string {
  const blocks = blocksOf(md);
  const at = k < 0 || k >= blocks.length ? blocks.length : k + 1;
  return markOfBlocks([...blocks.slice(0, at), { kind: "photo", id }, ...blocks.slice(at)]);
}
