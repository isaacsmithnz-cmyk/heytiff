"use client";

import type { DesignDocument, Floor } from "@/lib/studio/document";
import { floorDisplayName } from "@/lib/studio/plans";
import { PlanFigure } from "./plan-figure";
import type { UnitMark } from "@/lib/studio/export";

/* THE PLANS ON THE SHEET ITSELF — for the customer's live link, and the Send
   dialog's preview of it. Paper gives each floor a page of its own
   (print-doc.tsx); a page on a screen has no pages, so the floors follow the
   systems down the same document.

   The customer is shown everything the drawing has, with its legend: they
   have no layer switches to reach for, and a key is what lets somebody who
   has never seen a plan read one. */

const ALL_LAYERS = { plan: true, units: true, pipes: true, labels: true };

export function SheetPlans({
  doc,
  floors,
  urls,
  marks,
}: {
  doc: DesignDocument;
  /** already chosen and in level order */
  floors: Floor[];
  /** sheet imageRef → a URL the reader can load */
  urls: Record<string, string>;
  /** each head's mark data by model (export.ts unitMarks) */
  marks?: Record<string, UnitMark>;
}) {
  if (floors.length === 0) return null;
  return (
    <section className="dsd-plans">
      {floors.map((f) => (
        <figure key={f.id} className="dsd-plan">
          <figcaption>{floorDisplayName(f)}</figcaption>
          <PlanFigure doc={doc} floor={f} layers={ALL_LAYERS} grayscale={false} legend urls={urls} markOf={(m) => marks?.[m]} />
        </figure>
      ))}
    </section>
  );
}
