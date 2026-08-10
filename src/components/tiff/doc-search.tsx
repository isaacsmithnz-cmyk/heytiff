"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import { kbDocUrl, searchKbDoc } from "@/app/actions/kb";
import { pageLabel, type DocHit } from "@/lib/tiff/doc-search";

/* Find a word inside one document.

   A SEARCH BOX, NOT A QUESTION. The assistant is for "why is it short-cycling";
   this is the thing you do to a manual already in front of you — type P8, get
   the pages that say P8. Nothing here costs an allowance or reaches a model.

   IT FINDS WHAT THE PDF VIEWER CANNOT. Ctrl+F in the browser reads the file's
   own text layer, so a page that arrived as a scanned image is invisible to it
   for good; this searches what ingestion READ, which includes anything vision
   recovered. That is the reason it exists in here rather than as a note
   telling people to press Ctrl+F.

   A HIT IS A DOORWAY. Every result opens the PDF at its own page, so the
   answer to "where does it say that" is one click from the sentence that says
   it. Portalled to <body> for the reason every dashboard modal is: `.page.in`
   sets will-change and traps position:fixed inside the shell. */

const MIN_CHARS = 2;

export function DocSearch({
  doc,
  onClose,
}: {
  doc: { id: string; title: string };
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<DocHit[] | null>(null);
  const [capped, setCapped] = useState(false);
  const [asked, setAsked] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const search = () => {
    const term = query.trim();
    if (term.length < MIN_CHARS) return;
    setError(null);
    start(async () => {
      const res = await searchKbDoc(doc.id, term);
      if (!res.ok) {
        setError(res.error);
        setHits(null);
        return;
      }
      setHits(res.hits);
      setCapped(res.capped);
      setAsked(term);
    });
  };

  /* The page opens in a new tab, like every other way into a document here.
     The tab is opened SYNCHRONOUSLY on the click so the pop-up blocker sees a
     gesture — the signed URL is a round trip away and would arrive too late to
     be trusted. Same dance as the library row and the source peek. */
  const open = async (page: number) => {
    setError(null);
    const tab = typeof window === "undefined" ? null : window.open("", "_blank");
    const res = await kbDocUrl(doc.id);
    if (!res.ok) {
      tab?.close();
      setError(res.error);
      return;
    }
    const url = `${res.url}#page=${page}`;
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fl-ov" onClick={onClose}>
      <div
        className="fl-modal wide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Search inside ${doc.title}`}
      >
        {/* The DOCUMENT is the heading, because this panel is now where
            opening one lands — the search is what it offers, not what it is. */}
        <div className="fl-mh">
          <span>
            <b>{doc.title}</b>
            <em>Search inside it, or open the PDF</em>
          </span>
          <button className="fl-x" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="fl-mb">
          <form
            className="tk-dsbar"
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
          >
            {/* `.fl-i` rather than a field of its own: this modal is portalled
                to <body>, where `.fg` styles never reach, and the proven input
                inside `.fl-modal` is the one the edit sheet already uses. */}
            <input
              className="fl-i"
              autoFocus
              placeholder="A term, a code, a part number…"
              aria-label="Search inside this document"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type="submit"
              className="fl-btn primary"
              disabled={busy || query.trim().length < MIN_CHARS}
            >
              <Icon name="search" size={15} />
              {busy ? "Searching…" : "Search"}
            </button>
          </form>

          {error && <div className="fl-err">{error}</div>}

          {hits !== null && !busy && (
            <>
              <p className="tk-dscount">
                {hits.length === 0
                  ? `Nothing in this document matches “${asked}”.`
                  : `${hits.length}${capped ? "+" : ""} ${hits.length === 1 ? "passage" : "passages"} matching “${asked}” — press one to open the page.`}
              </p>

              {/* An empty result is not a dead end: the same word may be in
                  another manual, and asking Tiff is the other way to look. */}
              {hits.length === 0 && (
                <p className="tk-dsnone">
                  Try a shorter term, or ask Tiff — the assistant searches every
                  document at once and can answer from more than one.
                </p>
              )}

              <div className="tk-dshits">
                {hits.map((hit) => (
                  <button
                    key={hit.chunkId}
                    type="button"
                    className="tk-dshit"
                    onClick={() => open(hit.pageFrom)}
                  >
                    <span className="tk-dsp">
                      {pageLabel(hit)}
                      <Icon name="arrowUR" size={13} />
                    </span>
                    <span className="tk-dstxt">
                      {hit.heading && <b>{hit.heading}</b>}
                      <span>
                        {hit.segments.map((seg, i) =>
                          seg.hit ? <mark key={i}>{seg.text}</mark> : <span key={i}>{seg.text}</span>
                        )}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {hits === null && !busy && (
            <p className="tk-dsnone">
              Searches what Tiff read — including pages the PDF viewer&rsquo;s own
              search can&rsquo;t see, because they arrived as scanned images.
            </p>
          )}

          {/* The whole file, from the top. Still here, and still one press —
              this panel replaced the raw PDF as the landing place, it did not
              take it away. */}
          <div className="fl-foot">
            <button className="fl-btn ghost" onClick={onClose}>
              Close
            </button>
            <button className="fl-btn ghost" onClick={() => open(1)}>
              <Icon name="arrowUR" size={15} />
              Open the PDF
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
