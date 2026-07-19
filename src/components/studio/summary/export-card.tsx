"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import type { DesignDocument } from "@/lib/studio/document";
import type { DataPack } from "@/lib/studio/packs/schema";
import type { PlanImages } from "@/lib/studio/plans";
import {
  buildPrintModel,
  collectSheetRefs,
  defaultExportOptions,
  type PrintModel,
} from "@/lib/studio/export";
import { PrintDoc } from "./print-doc";

/* Export action card — drives the on-demand print document: build the model,
   resolve the plan-sheet URLs, mount PrintDoc hidden, print once it reports
   ready, unmount after the dialog closes. The design-file JSON download rides
   along. (The full customizer — content/floors/variants/layers/paper — grows
   here next.) */

export function ExportCard({
  doc,
  pack,
  planImages,
  empty,
  onExportJson,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  planImages: PlanImages;
  /** no systems yet — the printed pack would be blank */
  empty: boolean;
  onExportJson: () => void;
}) {
  const [printing, setPrinting] = useState<{
    model: PrintModel;
    urls: Record<string, string>;
  } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const cleanupArmed = useRef(false);

  /* afterprint = the dialog closed (printed OR cancelled) — tear down */
  useEffect(() => {
    if (!printing) return;
    const done = () => {
      if (cleanupArmed.current) {
        cleanupArmed.current = false;
        setPrinting(null);
      }
    };
    window.addEventListener("afterprint", done);
    return () => window.removeEventListener("afterprint", done);
  }, [printing]);

  const startPrint = useCallback(async () => {
    if (preparing || printing) return;
    setPreparing(true);
    try {
      const model = buildPrintModel([doc], pack, defaultExportOptions(doc));
      const refs = collectSheetRefs(model);
      const urls: Record<string, string> = {};
      await Promise.all(
        refs.map(async (ref) => {
          try {
            urls[ref] = await planImages.url(ref);
          } catch {
            /* a missing raster prints as white — never blocks the pack */
          }
        })
      );
      cleanupArmed.current = true;
      setPrinting({ model, urls });
    } finally {
      setPreparing(false);
    }
  }, [preparing, printing, doc, pack, planImages]);

  return (
    <div className="ds-act-card">
      <span className="ds-act-t">
        <Icon name="download" size={14} />
        Export
      </span>
      <span className="ds-act-s">
        Print the pack — plan pages included — as a PDF, or download the
        design file to re-import on the studio home.
      </span>
      <div className="ds-act-row">
        <button
          className="ds-tbbtn ds-job-print"
          onClick={() => void startPrint()}
          disabled={empty || preparing}
        >
          <Icon name="download" size={14} />
          {preparing ? "Preparing…" : "Print / Save PDF"}
        </button>
        {/* stays enabled when empty — a backup of an empty design is still a
            valid backup */}
        <button
          className="ds-tbbtn ds-job-export"
          onClick={onExportJson}
          title="Download this design as a .heytiff-design.json backup — re-open it with Import on the studio home"
        >
          <Icon name="arrowUp" size={14} />
          Design file
        </button>
      </div>
      {printing && (
        <PrintDoc
          model={printing.model}
          pack={pack}
          urls={printing.urls}
          onReady={() => window.print()}
        />
      )}
    </div>
  );
}
