"use client";

import { useState, useTransition } from "react";
import { Dialog } from "@/components/parts/dialog";
import { Button } from "@/components/parts/button";
import { TextInput } from "@/components/parts/field";
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
   it. The Dialog part (the old-modals mock, 27 October 2026), at 720; the
   match is the passage's grey with the term in ink at 600, not a wash. */

const MIN_CHARS = 2;

export function DocSearch({
  doc,
  onClose,
}: {
  /* `storageRef` is the PDF. A field note has none — it was written from
     somebody's note — and the door below used to be offered anyway, answering
     "That file doesn't belong to this organisation." */
  doc: { id: string; title: string; storageRef?: string | null };
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

  /* THE DOCUMENT IS THE HEADING, because this dialog is where opening one
     lands: the search is what it offers, not what it is. The whole file,
     from the top, is still one press (Open the PDF). */
  return (
    <Dialog
      heading={doc.title}
      width={720}
      onClose={onClose}
      foot={
        <>
          <Button kind="quiet" onClick={onClose}>
            Close
          </Button>
          {doc.storageRef !== null && <Button onClick={() => open(1)}>Open the PDF</Button>}
        </>
      }
    >
      <div className="tk-ds">
        <form
          className="tk-dsbar"
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <TextInput
            data-autofocus
            placeholder="A term, a code, a part number"
            aria-label="Search inside this document"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button kind="main" type="submit" disabled={busy || query.trim().length < MIN_CHARS}>
            {busy ? "Searching the document" : "Search document"}
          </Button>
        </form>

        {error && <p className="tk-dserr">{error}</p>}

        {hits !== null && !busy && (
          <>
            <p className="tk-dscount">
              {hits.length === 0
                ? `Nothing in this document matches “${asked}”.`
                : `${hits.length}${capped ? "+" : ""} ${hits.length === 1 ? "passage matches" : "passages match"} “${asked}”.`}
            </p>
            {hits.length > 0 && (
              <ul className="tk-dshits">
                {hits.map((hit) => (
                  <li key={hit.chunkId}>
                    {/* A HIT IS A DOORWAY: it opens the PDF at its own page */}
                    <button type="button" className="tk-dshit" onClick={() => open(hit.pageFrom)}>
                      <span className="tk-dsp">{pageLabel(hit)}</span>
                      <span className="tk-dstxt">
                        {hit.heading && <b>{hit.heading}</b>}
                        <span>
                          {hit.segments.map((seg, i) =>
                            seg.hit ? <strong key={i}>{seg.text}</strong> : <span key={i}>{seg.text}</span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
