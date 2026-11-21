"use client";

import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { fillItem, itemOf, MarkedLine, plainPaste } from "./marked";

/* TYPED ON THE PAGE (the Price overhaul, 18 November 2026: "the proposal is
   a pretty much full screen display of what the customer will see, and it's
   a fully editable section, like a Word document"). The proposal's words
   are typed where they sit, as on a page in Word: a heading or a paragraph
   is its own box, a list is one line an item, Enter starts the next item and
   Backspace on an empty one takes it away. Each block saves itself as you
   leave it; Escape puts it back as it was. A list's items take bold, italic
   and underline from the bar over the page (format-bar.tsx); a heading is
   plain words. The figures are the lines', changed in Breakdown (decision 4). */

/* the words go in once, as the box is made, and the page keeps them from
   then on: React never writes into a box someone is typing in */
const fill = (el: HTMLElement | null, text: string) => {
  if (el && el.dataset.filled !== "1") {
    el.textContent = text;
    el.dataset.filled = "1";
  }
};

/* what's typed in a box: the page's own reading of it, its lines as typed */
const textOf = (el: HTMLElement) => (typeof el.innerText === "string" ? el.innerText : (el.textContent ?? ""));

const clean = (t: string) => t.replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").trim();
const oneLine = (t: string) => clean(t).replace(/\s+/g, " ");

type Tag = "p" | "h2" | "h4";

/** A heading or a paragraph, typed in place. */
export function Typed({
  as: El = "p",
  value,
  label,
  className,
  empty,
  multiline = false,
  readOnly = false,
  onSave,
}: {
  as?: Tag;
  value: string;
  /** what it is, for a screen reader: "The introduction" */
  label: string;
  className?: string;
  /** said, quiet, while there's nothing written */
  empty?: string;
  multiline?: boolean;
  readOnly?: boolean;
  onSave: (value: string) => void;
}) {
  if (readOnly) return value ? <El className={className}>{value}</El> : empty ? <p className="lp-none">{empty}</p> : null;
  return (
    <El
      /* a fresh box when the kept words change under it, so they show */
      key={value}
      ref={(el: HTMLElement | null) => fill(el, value)}
      className={className ? `${className} lp-typed` : "lp-typed"}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      /* a heading stays a heading, named by its words; a paragraph is a box to type in */
      role={El === "p" ? "textbox" : undefined}
      aria-label={El === "p" ? label : undefined}
      aria-multiline={El === "p" ? multiline : undefined}
      data-empty={empty}
      spellCheck
      onBlur={(e: FocusEvent<HTMLElement>) => {
        const t = multiline ? clean(textOf(e.currentTarget)) : oneLine(textOf(e.currentTarget));
        if (t !== value) onSave(t);
      }}
      onKeyDown={(e: KeyboardEvent<HTMLElement>) => {
        if (e.key === "Escape") {
          e.currentTarget.textContent = value;
          e.currentTarget.blur();
        } else if (e.key === "Enter" && !multiline) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

let seq = 0;
const rowOf = (text: string) => ({ id: ++seq, text });

/** A list, one item a line, typed in place: Enter starts the next item,
    Backspace on an empty one takes it away, and the list saves as you leave it. */
export function TypedList({
  items,
  label,
  className,
  empty,
  readOnly = false,
  onSave,
}: {
  items: readonly string[];
  label: string;
  className?: string;
  empty?: string;
  readOnly?: boolean;
  onSave: (items: string[]) => void;
}) {
  const sig = items.join("\n");
  const [rows, setRows] = useState(() => (items.length ? items : [""]).map(rowOf));
  const [seen, setSeen] = useState(sig);
  /* the kept list changed under it (saved, or Tiff wrote it): show it */
  if (seen !== sig) {
    setSeen(sig);
    setRows((items.length ? items : [""]).map(rowOf));
  }
  /* what's typed, read from the page as it's typed: the boxes keep their own words */
  const typed = useRef(new Map<number, string>());
  const boxes = useRef(new Map<number, HTMLLIElement>());
  const [focusOn, setFocusOn] = useState<{ id: number; end: boolean } | null>(null);
  useEffect(() => {
    if (!focusOn) return;
    const el = boxes.current.get(focusOn.id);
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(!focusOn.end);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [focusOn]);

  if (readOnly)
    return items.length ? (
      <ul className={className}>
        {items.map((it, n) => (
          <li key={n}>
            <MarkedLine value={it} />
          </li>
        ))}
      </ul>
    ) : empty ? (
      <p className="lp-none">{empty}</p>
    ) : null;

  const now = () => rows.map((r) => typed.current.get(r.id) ?? r.text);
  return (
    <ul
      className={className}
      aria-label={label}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        const out = now().map(oneLine).filter(Boolean);
        if (out.join("\n") !== sig) onSave(out);
      }}
    >
      {rows.map((r, n) => (
        <li
          key={r.id}
          ref={(el) => {
            fillItem(el, r.text);
            if (el) boxes.current.set(r.id, el);
            else boxes.current.delete(r.id);
          }}
          className="lp-typed"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label={`${label}, item ${n + 1}`}
          data-empty={rows.length === 1 ? empty : undefined}
          data-fmt="inline"
          onPaste={plainPaste}
          onInput={(e) => typed.current.set(r.id, itemOf(e.currentTarget))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const texts = now();
              const next = rowOf("");
              rows.forEach((x, k) => typed.current.set(x.id, texts[k] ?? x.text));
              setRows([...rows.slice(0, n + 1), next, ...rows.slice(n + 1)]);
              setFocusOn({ id: next.id, end: false });
            } else if (e.key === "Backspace" && !(e.currentTarget.textContent ?? "").trim() && rows.length > 1) {
              e.preventDefault();
              const back = rows[n - 1] ?? rows[n + 1];
              typed.current.delete(r.id);
              setRows(rows.filter((x) => x.id !== r.id));
              if (back) setFocusOn({ id: back.id, end: true });
            } else if (e.key === "Escape") {
              typed.current.clear();
              setRows((items.length ? items : [""]).map(rowOf));
              e.currentTarget.blur();
            }
          }}
        />
      ))}
    </ul>
  );
}
