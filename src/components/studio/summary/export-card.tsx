"use client";

import { Icon } from "@/components/shell/icon";

/* Export action card — this stage: the job-pack print and the design-file
   download, unchanged in behaviour. The Stage-4/5 export work grows this
   into the full customizer (content, variants, layers, B&W, paper). */

export function ExportCard({
  empty,
  onExportJson,
}: {
  /** no systems yet — the printed pack would be blank */
  empty: boolean;
  onExportJson: () => void;
}) {
  return (
    <div className="ds-act-card">
      <span className="ds-act-t">
        <Icon name="download" size={14} />
        Export
      </span>
      <span className="ds-act-s">
        Print the job pack as a PDF, or download the design file to re-import
        on the studio home.
      </span>
      <div className="ds-act-row">
        <button
          className="ds-tbbtn ds-job-print"
          onClick={() => window.print()}
          disabled={empty}
        >
          <Icon name="download" size={14} />
          Print / Save PDF
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
    </div>
  );
}
