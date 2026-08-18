"use client";

import { useState } from "react";
import type { DesignDocument } from "@/lib/studio/document";
import type { DataPack } from "@/lib/studio/packs/schema";
import type {
  DesignBasis,
  DesignSnapshot,
  SummaryModel,
} from "@/lib/studio/summary";
import type { OrgBrand } from "@/lib/org/brand";
import { BrandMark } from "@/components/org/letterhead";
import { SheetDoc } from "@/components/studio/summary/sheet-doc";
import { LiveViewer } from "./live-viewer";
import "./live-sheet.css";

/* WHAT THE CUSTOMER OPENS — the design, in the chrome for someone outside the
   business.

   The link used to land on the simulator. A simulation is a good thing to be
   able to show, but it is not what a person clicked a link from their
   installer to see: they wanted the design of their own house. So the link
   serves the SHEET, and the simulation is a way in from it rather than the
   destination.

   ONE DOCUMENT, TWO CHROMES. Everything below the bar is `SheetDoc`, the same
   component and the same derived model the owner and the printed pack render.
   What differs is only what wraps it, and what the owner's chrome carries is
   ABSENT here rather than hidden:

   - the checks pill, which names what is WRONG with the design before anyone
     has decided how to present it. It must never reach a client.
   - Share and Export, which act on a design this reader does not own.
   - the Material picklist and the Contributors — a warehouse list and staff
     names, both internal.

   What it gains: a live chip that says this is a window rather than a
   snapshot, when the link stops working, and a way to print. */

export function LiveSheet({
  doc,
  pack,
  planUrls,
  brand,
  model,
  snapshot,
  basis,
  preparedOn,
  expiresOn,
  /** the simulation has been ticked as fit to show a customer, on every floor
      that can run one. False means the option is ABSENT — nothing here
      advertises a simulation this reader cannot open. See sim-approval.ts. */
  simOffered,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  planUrls: Record<string, string>;
  brand: OrgBrand;
  model: SummaryModel;
  snapshot: DesignSnapshot;
  basis: DesignBasis;
  /* both formatted on the server: a date built in a render body breaks
     hydration for the whole tree */
  preparedOn: string;
  expiresOn: string;
  simOffered: boolean;
}) {
  const [simOpen, setSimOpen] = useState(false);

  if (simOpen)
    return (
      <LiveViewer
        doc={doc}
        pack={pack}
        planUrls={planUrls}
        brand={brand}
        onExit={() => setSimOpen(false)}
      />
    );

  return (
    <div className="dsd-page fg dstudio">
      <nav className="dsd-bar">
        <span className="dsd-mark">
          <BrandMark brand={brand} fallback="HeyTiff" />
        </span>
        {/* the link is a WINDOW on the latest saved design, not a snapshot of
            the day it was sent — and it stops working on its own, so both
            facts belong side by side */}
        <span className="dsd-livechip">
          <s aria-hidden />
          Live design
        </span>
        <span className="dsd-exp">Link expires {expiresOn}</span>
        <span className="dsd-sp" />
        {simOffered && (
          <button className="dsd-btn" onClick={() => setSimOpen(true)}>
            <span aria-hidden>▶</span> Open the simulation
          </button>
        )}
        {/* ONE button, not the two the mock drew. "Print" and "Download PDF"
            would be the same call — there is no server-side PDF — and the
            browser's own print dialog is where Save as PDF lives. Two
            controls doing one thing is a promise about the second one. */}
        <button className="dsd-btn cta" onClick={() => window.print()}>
          Print
        </button>
      </nav>

      <main className="dsd-body">
        <SheetDoc
          doc={doc}
          model={model}
          snapshot={snapshot}
          basis={basis}
          brand={brand}
          eyebrow={
            doc.meta.variantLabel
              ? `Design summary, ${doc.meta.variantLabel.toLowerCase()}`
              : "Design summary"
          }
          preparedOn={preparedOn}
        />
      </main>
    </div>
  );
}
