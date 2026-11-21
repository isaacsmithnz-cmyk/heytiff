"use client";

import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { blockHtml, blocksOf, inlineOf, markOf, runsHtml, type Inline } from "@/lib/quotes/proposal-marks";

/* THE PROPOSAL'S WORDS WITH THEIR FORMATTING (proposal-marks.ts): drawn to
   read on the paper, the Price tab's preview and the PDF, and typed on
   where they sit, the bar over the page (format-bar.tsx) acting on the box
   the caret is in. A paragraph block holds headings, lists and photos as
   well as bold, italic and underline; a list's item holds the three. */

/** a job's photo, by its id, for the paper: its address, or null where the
    page has none (not brought across yet) */
export type PhotoUrl = (id: string) => string | null;
const noPhotos: PhotoUrl = () => null;

function Runs({ runs }: { runs: Inline[] }) {
  return (
    <>
      {runs.map((r, n) => {
        let el: ReactNode = r.text;
        if (r.u) el = <u>{el}</u>;
        if (r.i) el = <i>{el}</i>;
        if (r.b) el = <b>{el}</b>;
        return <span key={n}>{el}</span>;
      })}
    </>
  );
}

/** A line's words with their marks, drawn: a list's item, a heading. */
export function MarkedLine({ value }: { value: string }) {
  return <Runs runs={inlineOf(value)} />;
}

/** A paragraph block, drawn to read. */
export function MarkedBlock({ value, className, photoUrl = noPhotos }: { value: string; className?: string; photoUrl?: PhotoUrl }) {
  return (
    <div className={className ? `${className} lp-rich` : "lp-rich"}>
      {blocksOf(value).map((b, k) => {
        if (b.kind === "p")
          return (
            <p key={k}>
              <Runs runs={b.runs} />
            </p>
          );
        if (b.kind === "h")
          return (
            <h3 key={k}>
              <Runs runs={b.runs} />
            </h3>
          );
        if (b.kind === "photo") {
          const url = photoUrl(b.id);
          /* eslint-disable-next-line @next/next/no-img-element -- a signed address from storage, printed as it is */
          return <figure key={k}>{url && <img src={url} alt="" />}</figure>;
        }
        const List = b.kind;
        return (
          <List key={k}>
            {b.items.map((it, n) => (
              <li key={n}>
                <Runs runs={it} />
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

/* ── THE BOXES THE BAR ACTS ON ──
   Each paragraph block registers itself by name, so the bar can read what's
   typed in it and save a change of style or a photo to it, even after the
   style menu or the photo picker took the caret away. While one of those is
   open the box doesn't save itself on leaving: the bar saves it, once. */

type Box = { box: { current: HTMLElement | null }; save: (md: string) => void };
const boxes = new Map<string, Box>();
let holding = false;
export const hold = (on: boolean) => {
  holding = on;
};

/** The box a node is in, and its kind: "block" for a paragraph block,
    "inline" for a list's item. */
export function boxOf(node: Node | null): HTMLElement | null {
  const el = node && (node.nodeType === 1 ? (node as Element) : node.parentElement);
  return (el?.closest?.("[data-fmt]") as HTMLElement | null) ?? null;
}

/** Which block of its box the caret is in, counted as the words keep them. */
export function caretBlock(root: HTMLElement): number {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  const node = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
  if (!node || !root.contains(node)) return -1;
  let top: Node = node;
  while (top.parentNode && top.parentNode !== root) top = top.parentNode;
  const r = document.createRange();
  r.setStart(root, 0);
  if (top === root) r.setEnd(node, 0);
  else r.setEndAfter(top);
  return blocksOf(markOf(r.cloneContents())).length - 1;
}

/** What's typed in a named box now, and saving it. */
export function boxNamed(name: string): { md: string; save: (md: string) => void } | null {
  const b = boxes.get(name);
  const el = b?.box.current;
  if (!b || !el) return null;
  return { md: markOf(el), save: b.save };
}

/* the markup goes in once, as the box is made: React never writes into a
   box someone is typing in */
const fillHtml = (el: HTMLElement | null, html: string) => {
  if (el && el.dataset.filled !== "1") {
    el.innerHTML = html;
    el.dataset.filled = "1";
  }
};

/** the browser's own editing command, where the browser has one */
export const exec = (cmd: string, value?: string) => (typeof document.execCommand === "function" ? document.execCommand(cmd, false, value) : false);

/** pasted words come in as words, not as another page's styling */
const plainPaste = (e: ClipboardEvent<HTMLElement>) => {
  e.preventDefault();
  exec("insertText", e.clipboardData.getData("text/plain"));
};

/** A paragraph block, typed where it sits, formatted from the bar. */
export function RichTyped({
  name,
  value,
  label,
  className,
  empty,
  readOnly = false,
  photoUrl = noPhotos,
  photosKnown = false,
  onSave,
}: {
  /** the block's own name ("intro", "summary-0"), for the bar */
  name: string;
  value: string;
  label: string;
  className?: string;
  empty?: string;
  readOnly?: boolean;
  photoUrl?: PhotoUrl;
  /** the job's photos have their addresses: draw the box again with them */
  photosKnown?: boolean;
  onSave: (value: string) => void;
}) {
  const el = useRef<HTMLElement | null>(null);
  const keep = useRef({ value, onSave });
  useEffect(() => {
    keep.current = { value, onSave };
  });
  useEffect(() => {
    if (readOnly) return;
    const box: Box = {
      box: el,
      save: (md) => {
        if (md !== keep.current.value) keep.current.onSave(md);
      },
    };
    boxes.set(name, box);
    return () => {
      if (boxes.get(name) === box) boxes.delete(name);
    };
  }, [name, readOnly]);
  if (readOnly) return value ? <MarkedBlock value={value} className={className} photoUrl={photoUrl} /> : empty ? <p className="lp-none">{empty}</p> : null;
  return (
    <div
      /* a fresh box when the kept words change under it, so they show */
      key={`${value}|${photosKnown}`}
      ref={(node) => {
        el.current = node;
        fillHtml(node, blockHtml(value, photoUrl));
      }}
      className={className ? `${className} lp-rich lp-typed` : "lp-rich lp-typed"}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={label}
      aria-multiline
      data-fmt="block"
      data-name={name}
      data-empty={empty}
      spellCheck
      onFocus={() => exec("defaultParagraphSeparator", "p")}
      onPaste={plainPaste}
      onBlur={(e) => {
        if (holding) return;
        const t = markOf(e.currentTarget);
        if (t !== value) onSave(t);
      }}
      onKeyDown={(e: KeyboardEvent<HTMLElement>) => {
        if (e.key === "Escape") {
          e.currentTarget.innerHTML = blockHtml(value, photoUrl);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** a list item's box: filled with its marks, read back with them */
export const fillItem = (el: HTMLElement | null, text: string) => fillHtml(el, runsHtml(inlineOf(text)));
export const itemOf = (el: HTMLElement) => markOf(el, true);
export { plainPaste };
