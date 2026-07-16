"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { DesignDocument, FloorSimplePlan } from "@/lib/studio/document";
import { buildSimplePlanFromExtraction } from "@/lib/studio/simple-extract";
import { renderSimplePlanSVG } from "@/lib/studio/simple-plan";
import type { PlanImages } from "@/lib/studio/plans";

/* Simple-view review modal — the accept gate between an AI extraction and the
   document. Shows the original raster beside the redrawn plan (rendered by
   the SAME emitter the export path uses), plus the model's uncertainties and
   any pipeline issues. Nothing touches the document until Accept. Portalled
   to body (the shell's .page transform breaks position:fixed inside it), so
   all colours are explicit — it renders outside .dstudio. */

export function SimpleReviewModal({
  doc,
  floorId,
  pending,
  planImages,
  onAccept,
  onDiscard,
  onRegenerate,
}: {
  doc: DesignDocument;
  floorId: string;
  pending: FloorSimplePlan;
  planImages?: PlanImages;
  onAccept: () => void;
  onDiscard: () => void;
  onRegenerate: () => void;
}) {
  /* preview = the real pipeline run over a doc that carries the PENDING
     extraction — what Accept would put on the canvas, exactly */
  const { svg, uncertainties, issues } = useMemo(() => {
    const docWithPending: DesignDocument = {
      ...doc,
      floors: doc.floors.map((f) =>
        f.id === floorId ? { ...f, simplePlan: pending } : f
      ),
    };
    const model = buildSimplePlanFromExtraction(docWithPending, floorId);
    return {
      svg: renderSimplePlanSVG(model, { widthPx: 900 }),
      uncertainties: pending.sheets.flatMap(
        (s) => s.extraction.notes.uncertainties
      ),
      issues: model.issues,
    };
  }, [doc, floorId, pending]);

  /* the raster side: first sheet of the floor */
  const [rasterUrl, setRasterUrl] = useState<string | null>(null);
  const firstRef = doc.floors.find((f) => f.id === floorId)?.plans[0]?.imageRef;
  useEffect(() => {
    let alive = true;
    if (firstRef && planImages) {
      void planImages.url(firstRef).then((u) => {
        if (alive) setRasterUrl(u);
      });
    }
    return () => {
      alive = false;
    };
  }, [firstRef, planImages]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDiscard();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDiscard]);

  const notes = [...uncertainties, ...issues];

  const body = (
    <div className="ds-sx-scrim" role="dialog" aria-label="Review simple view">
      <div className="ds-sx">
        <div className="ds-sx-head">
          <span>REVIEW — SIMPLE VIEW</span>
          <button onClick={onDiscard} title="Discard" aria-label="Discard">
            ×
          </button>
        </div>
        <div className="ds-sx-panes">
          <figure>
            <figcaption>Original plan</figcaption>
            <div className="ds-sx-pane">
              {rasterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={rasterUrl} alt="Original plan raster" />
              ) : (
                <span className="ds-sx-wait">Loading plan…</span>
              )}
            </div>
          </figure>
          <figure>
            <figcaption>Redrawn simple view</figcaption>
            <div
              className="ds-sx-pane"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </figure>
        </div>
        {notes.length > 0 && (
          <div className="ds-sx-notes">
            <span className="ds-sx-notes-h">
              The extraction flagged {notes.length}{" "}
              {notes.length === 1 ? "note" : "notes"}
            </span>
            <ul>
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="ds-sx-foot">
          <button className="ds-sx-btn" onClick={onDiscard}>
            Discard
          </button>
          <button className="ds-sx-btn" onClick={onRegenerate}>
            Regenerate
          </button>
          <button className="ds-sx-btn primary" onClick={onAccept}>
            Accept &amp; apply
          </button>
        </div>
      </div>
    </div>
  );
  return createPortal(body, document.body);
}
