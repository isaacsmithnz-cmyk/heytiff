"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import type { DesignDocument } from "@/lib/studio/document";
import type { PlanImages } from "@/lib/studio/plans";

/* Reference sheets — browse every uploaded page from the canvas, without
   placing any of it. The plan set often carries information you need while
   designing (room/ceiling heights in a section, details, schedules) that never
   goes on the canvas. We stored the original source files, so this just serves
   them: a PDF renders in the browser's own viewer (paging + zoom for free), an
   image shows as-is. Portalled to <body> (the shell's .page transform breaks
   position:fixed — see the modal-portal rule). */

export function ReferenceViewer({
  doc,
  planImages,
  onClose,
}: {
  doc: DesignDocument;
  planImages: PlanImages;
  onClose: () => void;
}) {
  const sources = doc.planImport?.sources ?? [];
  const [active, setActive] = useState(0);
  // the resolved URL is tagged with the ref it belongs to, so a stale result
  // never shows for the wrong sheet and "loading" is derived, not synced
  const [loaded, setLoaded] = useState<{ ref: string; url: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const src = sources[active];
  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    planImages
      .url(src.ref)
      .then((u) => !cancelled && setLoaded({ ref: src.ref, url: u }))
      .catch(() => !cancelled && setLoaded({ ref: src.ref, url: "" }));
    return () => {
      cancelled = true;
    };
  }, [src, planImages]);

  if (!src) return null;

  const ready = loaded?.ref === src.ref ? loaded : null; // else still loading
  const url = ready && ready.url ? ready.url : null;
  const error = ready != null && ready.url === "";

  return createPortal(
    <div
      className="ds-ref-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="ds-ref" role="dialog" aria-modal="true" aria-label="Reference sheets">
        <header className="ds-ref-head">
          <div className="ds-ref-title">
            <Icon name="library" size={16} />
            <b>Reference sheets</b>
            <span className="ds-ref-sub">
              Every uploaded page — read heights, sections and details without
              placing them on the canvas.
            </span>
          </div>
          <button className="ds-ub-close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </header>

        {sources.length > 1 && (
          <div className="ds-ref-tabs" role="tablist">
            {sources.map((s, i) => (
              <button
                key={s.ref}
                role="tab"
                aria-selected={i === active}
                className={i === active ? "on" : ""}
                onClick={() => setActive(i)}
              >
                {s.kind === "pdf" ? "PDF" : "Image"} {i + 1}
              </button>
            ))}
          </div>
        )}

        <div className="ds-ref-body">
          {error ? (
            <div className="ds-ref-msg">Couldn&apos;t load this file.</div>
          ) : !url ? (
            <div className="ds-ref-msg">Loading…</div>
          ) : src.kind === "pdf" ? (
            <iframe className="ds-ref-frame" src={url} title="Reference PDF" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="ds-ref-img" src={url} alt="Reference sheet" />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
