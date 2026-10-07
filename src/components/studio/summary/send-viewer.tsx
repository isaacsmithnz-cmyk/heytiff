"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";

/* A PAGE OF WHAT IS BEING SENT, FULL SIZE (Isaac, 2026-10-07: "you should be
   able to click into each preview to show you how it's going to come up,
   rather than just show you some small window").

   The previews in Send are the document shrunk to a column. Opened, a page is
   not a bigger copy of that picture: for a PDF it is THE PDF — made on the
   server from the same print page the file comes from, shown in the browser's
   own PDF viewer at the page that was clicked — because the shrunk picture is
   laid out as a web page and the PDF is paginated paper, and only the file can
   show where a page breaks. A live link is a web page, so it opens as one.

   The frame is the Plans step's page lightbox (`.ds-lightbox`), lifted to sit
   over the Send dialog it opens from. */

export function SendViewer({
  title,
  sub,
  onClose,
  children,
}: {
  title: string;
  /** beside the title: where in the document this is */
  sub?: string | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  /* Escape closes THIS, not the dialog under it as well: the dialog listens
     on the window too, so this one listens first (capture) and stops it */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="ds-lightbox ds-lb-over" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ds-lb-backdrop" onClick={onClose} />
      <div className="ds-lb-frame">
        <div className="ds-lb-top">
          <div className="ds-lb-heading">
            <span className="ds-lb-title">
              {title}
              {sub && <em>{sub}</em>}
            </span>
            <button className="ds-lb-close" aria-label="Close" onClick={onClose}>
              <Icon name="x" size={16} />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

/** How many pages a PDF has, read off its page tree — the largest `/Count`
    is the root's. Null when the file does not say (a compressed object stream
    hides it), and the viewer then simply opens at the top. */
export function pdfPageCount(bytes: Uint8Array): number | null {
  const text = new TextDecoder("latin1").decode(bytes);
  let most = 0;
  for (const m of text.matchAll(/\/Count\s+(\d+)/g)) most = Math.max(most, Number(m[1]));
  return most > 0 ? most : null;
}

/** The page a preview opens at. The sheet is the front; a floor's plan page
    is counted back from the end of its copy, because how many pages the sheet
    runs to is only known once it is printed. Several copies (a design and its
    options) are taken as alike, which is near enough to land on the page or
    beside it — the viewer scrolls from there. */
export function pageOfPart(
  part: { kind: "sheet" } | { kind: "plan"; index: number },
  opts: { total: number | null; floors: number; copies: number }
): number {
  if (part.kind === "sheet" || !opts.total) return 1;
  const perCopy = Math.round(opts.total / Math.max(opts.copies, 1));
  const sheetPages = Math.max(0, perCopy - opts.floors);
  return Math.min(Math.max(sheetPages + part.index + 1, 1), opts.total);
}

/* the file, then its pages — a function the effect CALLS, so the component
   holds no try (React Compiler 1.0 will not lower one) */
async function openPdf(make: () => Promise<Blob>): Promise<{ url: string; total: number | null }> {
  const blob = await make();
  const total = pdfPageCount(new Uint8Array(await blob.arrayBuffer()));
  return { url: URL.createObjectURL(blob), total };
}

/** The PDF itself, at the page that was clicked. */
export function PdfPages({
  make,
  pageOf,
  onTotal,
}: {
  /** the file — the dialog's own, so a Download afterwards needn't make it again */
  make: () => Promise<Blob>;
  pageOf: (total: number | null) => number;
  onTotal?: (total: number | null, page: number) => void;
}) {
  const [state, setState] = useState<
    { kind: "making" } | { kind: "error" } | { kind: "ready"; url: string; page: number }
  >({ kind: "making" });

  /* the file is made ONCE per opening, whatever the dialog re-renders with:
     the callbacks are read through a ref, never as the effect's inputs (a
     new tick closes this view before it could need a new file) */
  const args = useRef({ make, pageOf, onTotal });
  useEffect(() => {
    args.current = { make, pageOf, onTotal };
  });
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    openPdf(args.current.make).then(
      ({ url, total }) => {
        made = url;
        if (!live) return URL.revokeObjectURL(url);
        const page = args.current.pageOf(total);
        args.current.onTotal?.(total, page);
        setState({ kind: "ready", url, page });
      },
      (err) => {
        console.error(`[send] page view failed: ${String(err)}`);
        if (live) setState({ kind: "error" });
      }
    );
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, []);

  if (state.kind === "making") return <p className="ds-lb-wait">Making the pages…</p>;
  if (state.kind === "error")
    return (
      <p className="ds-lb-wait" role="alert">
        Couldn&apos;t make the pages. Print still works.
      </p>
    );
  return (
    <iframe
      className="ds-lb-pdf"
      title="The pages as they print"
      src={`${state.url}#page=${state.page}&view=Fit`}
    />
  );
}
