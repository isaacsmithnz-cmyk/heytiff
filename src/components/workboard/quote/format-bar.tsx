"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Button } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import { Menu } from "@/components/parts/menu";
import { Icon } from "@/components/shell/icon";
import { blocksOf, markOf, restyle, styleOf, withPhoto, type BlockStyle } from "@/lib/quotes/proposal-marks";
import { boxNamed, boxOf, caretBlock, exec, hold } from "./marked";

/* THE BAR OVER THE PROPOSAL'S PAGE, AS A DOCUMENT'S (Isaac, 20 November
   2026: "format should be a header like googe docs", then "Build all three"
   to https://claude.ai/artifact/EAB8Y8FsbnPbcuBXKDhT93): the style of the
   block the caret is in (Paragraph, Heading, Bulleted list, Numbered list),
   Bold, Italic and Underline for the words picked, the two lists, and Add a
   photo from the job's photos; Saved and when, then Share, at its end.

   It acts on the box the caret is in (marked.tsx). A paragraph block (the
   introduction, an option's summary) takes all of it; a list's item takes
   bold, italic and underline; a heading or a figure takes none, and the
   bar's buttons wait. B, I and U say what they do in their own letters,
   and the lists in their own glyphs, as every document's do (rule 27, on
   Isaac's word to the mock). */

const STYLES: { key: BlockStyle; label: string }[] = [
  { key: "p", label: "Paragraph" },
  { key: "h", label: "Heading" },
  { key: "ul", label: "Bulleted list" },
  { key: "ol", label: "Numbered list" },
];

const svg = (d: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
const BULLETS = svg(
  <>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <circle cx="4.5" cy="6" r="1" />
    <circle cx="4.5" cy="12" r="1" />
    <circle cx="4.5" cy="18" r="1" />
  </>,
);
const NUMBERS = svg(<path d="M10 6h10M10 12h10M10 18h10M4 4h1.5v4M3.5 8h3M3.5 12.5a1.5 1.5 0 1 1 2.5 1L3.5 16h3" />);
const PHOTO = svg(
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="9" cy="11" r="2" />
    <path d="m21 17-5-5-9 7" />
  </>,
);

type Where = { kind: "block" | "inline"; name: string | null; style: BlockStyle | null; b: boolean; i: boolean; u: boolean; ul: boolean; ol: boolean };
/** what the bar picked up as the style menu or the picker opened */
type Grab = { name: string; md: string; k: number };

const state = (cmd: string) => {
  try {
    return document.queryCommandState(cmd);
  } catch {
    return false;
  }
};

export type BarPhoto = { id: string; url: string; name: string };

export function FormatBar({ photos, children }: { photos: readonly BarPhoto[]; children?: ReactNode }) {
  const [at, setAt] = useState<Where | null>(null);
  const [menu, setMenu] = useState(false);
  const [picking, setPicking] = useState(false);
  const grab = useRef<Grab | null>(null);
  const styleRef = useRef<HTMLButtonElement>(null);
  const bar = useRef<HTMLDivElement>(null);

  const read = () => {
    const sel = window.getSelection();
    const box = boxOf(sel?.anchorNode ?? null);
    if (!box) {
      /* the caret went to the bar or its menu: the box it was in is still the one */
      if (bar.current?.contains(document.activeElement) || grab.current) return;
      return setAt(null);
    }
    const kind = box.dataset.fmt === "inline" ? "inline" : "block";
    const k = kind === "block" ? caretBlock(box) : -1;
    setAt({
      kind,
      name: box.dataset.name ?? null,
      style: kind === "block" ? styleOf(blocksOf(markOf(box))[k]) : null,
      b: state("bold"),
      i: state("italic"),
      u: state("underline"),
      ul: state("insertUnorderedList"),
      ol: state("insertOrderedList"),
    });
  };
  useEffect(() => {
    document.addEventListener("selectionchange", read);
    return () => document.removeEventListener("selectionchange", read);
  });

  /* bold, italic, underline and the lists: the browser's own, on the words
     picked, the caret never leaving its box */
  const run = (cmd: string) => {
    exec("styleWithCSS", "false");
    exec(cmd);
    read();
  };
  const keepCaret = (e: MouseEvent) => e.preventDefault();

  /* the style menu and the picker take the caret: what's typed, and which
     block, are picked up first, and saved once, with the change */
  const take = () => {
    const box = boxOf(window.getSelection()?.anchorNode ?? null);
    const name = box?.dataset.name;
    if (!box || !name) return false;
    grab.current = { name, md: markOf(box), k: caretBlock(box) };
    hold(true);
    return true;
  };
  const done = (change?: (g: Grab) => string) => {
    const g = grab.current;
    grab.current = null;
    hold(false);
    if (!g) return;
    boxNamed(g.name)?.save(change ? change(g) : g.md);
    setAt(null);
  };

  const block = at?.kind === "block";
  const words = !!at;
  const styleWord = STYLES.find((s) => s.key === at?.style)?.label ?? "Paragraph";
  const tool = (label: string, on: boolean, enabled: boolean, cmd: string, face: ReactNode, cls: string) => (
    <button
      type="button"
      className={`qc-tb-g ${cls}${on ? " on" : ""}`}
      aria-label={label}
      aria-pressed={on}
      disabled={!enabled}
      onMouseDown={keepCaret}
      onClick={() => run(cmd)}
    >
      {face}
    </button>
  );

  return (
    <div ref={bar} className="qc-fmt qc-tb" role="toolbar" aria-label="Format">
      <Button
        ref={styleRef}
        size={32}
        className="qc-tb-sty"
        disabled={!block}
        aria-haspopup="menu"
        aria-expanded={menu}
        onMouseDown={(e) => {
          if (take()) return;
          e.preventDefault();
        }}
        onClick={() => setMenu(true)}
      >
        {styleWord}
        <span className="jp-chev" aria-hidden="true">
          <Icon name="chevD" size={16} />
        </span>
      </Button>
      <Menu
        open={menu}
        anchor={styleRef}
        label="The block's style"
        items={STYLES}
        chosen={at?.style ?? null}
        onClose={() => {
          setMenu(false);
          done();
        }}
        onSelect={(key) => {
          setMenu(false);
          done((g) => restyle(g.md, g.k, key as BlockStyle));
        }}
      />
      <i className="qc-tb-sep" aria-hidden="true" />
      {tool("Bold", !!at?.b, words, "bold", "B", "b")}
      {tool("Italic", !!at?.i, words, "italic", "I", "i")}
      {tool("Underline", !!at?.u, words, "underline", "U", "u")}
      <i className="qc-tb-sep" aria-hidden="true" />
      {tool("Bulleted list", !!at?.ul, block, "insertUnorderedList", BULLETS, "")}
      {tool("Numbered list", !!at?.ol, block, "insertOrderedList", NUMBERS, "")}
      <i className="qc-tb-sep" aria-hidden="true" />
      <Button
        kind="quiet"
        size={32}
        icon={PHOTO}
        disabled={!block || photos.length === 0}
        onMouseDown={(e) => {
          if (take()) return;
          e.preventDefault();
        }}
        onClick={() => setPicking(true)}
      >
        Add a photo
      </Button>
      <span className="qc-tb-end">{children}</span>
      <Dialog
        open={picking}
        heading="Add a photo"
        width={720}
        onClose={() => {
          setPicking(false);
          done();
        }}
      >
        <ul className="qc-tb-pics" aria-label="The job's photos">
          {photos.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                aria-label={p.name || "A photo"}
                onClick={() => {
                  setPicking(false);
                  done((g) => withPhoto(g.md, g.k, p.id));
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a signed address from storage */}
                <img src={p.url} alt="" />
              </button>
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}
