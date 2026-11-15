"use client";

import { Tray } from "@/components/parts/tabs";
import { fmtQuantity, materialsExTotalCents, type JobMaterialLine } from "@/lib/workboard/job-ledger";
import type { JobMediaItem } from "@/lib/workboard/job-media";
import { fmtAud } from "@/lib/workboard/project-money";

/* The Price tab's own small parts (job-price-tab.tsx): a paper laid in the
   left, lines as ServiceM8 holds them, and the tray of views. */

/** A paper laid in the left, as the quote's Preview lays its own. */
export function Paper({ item, none }: { item: JobMediaItem | null; none: string }) {
  if (!item) return <p className="jpr-none">{none}</p>;
  if (!item.url) return <p className="jpr-none">{`${item.name} hasn't been brought across from ServiceM8 yet.`}</p>;
  const pdf = (item.fileType ?? "").toLowerCase().endsWith("pdf") || /\.pdf$/i.test(item.name);
  return pdf ? (
    /* the paper alone, fitted to the width: no viewer's toolbar or page
       thumbnails (the walk of 15 November 2026, T1); Open the PDF on the
       rail still opens it whole */
    <iframe className="jpr-paper" src={item.url.includes("#") ? item.url : `${item.url}#toolbar=0&navpanes=0&view=FitH`} aria-label={item.name} />
  ) : (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img className="jpr-paper jpr-paper--img" src={item.url} alt={item.name} />
  );
}

/** Lines as ServiceM8 holds them: the name, how many, and the ex-GST figure
    to whoever sees money. */
export function Sm8Lines({ lines, money, none }: { lines: readonly JobMaterialLine[]; money: boolean; none: string }) {
  if (lines.length === 0) return <p className="jpr-none">{none}</p>;
  const total = money ? materialsExTotalCents(lines) : null;
  return (
    <ul className="jpr-lines">
      {lines.map((m) => (
        <li key={m.remoteId}>
          <span className="jpr-line">
            <b>{m.name}</b>
            {m.quantity !== null && <em>{`× ${fmtQuantity(m.quantity)}`}</em>}
          </span>
          {money && <span className="jpr-amt">{m.exLineCents != null ? fmtAud(m.exLineCents) : "—"}</span>}
        </li>
      ))}
      {/* no total when a line has no ex-GST price */}
      {total !== null && (
        <li className="jpr-total">
          <span className="jpr-line">
            <b>Total ex GST</b>
          </span>
          <span className="jpr-amt">{fmtAud(total)}</span>
        </li>
      )}
    </ul>
  );
}

export type View = "lines" | "preview";
export function Views({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  return (
    <div className="qc-views">
      <Tray
        ariaLabel="What it shows"
        value={value}
        options={[
          { value: "lines", label: "Line items" },
          { value: "preview", label: "Preview" },
        ]}
        onChange={onChange}
      />
    </div>
  );
}
