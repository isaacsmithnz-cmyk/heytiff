"use client";

import type { StoredDocument } from "@/lib/documents/query";
import { fmtBytes } from "@/lib/documents/files";
import { Icon } from "@/components/shell/icon";
import { fmtDay } from "./derive";

/* A policy's paperwork: a two-column grid of rows, one open at a time, with
   the open one previewed inline underneath.

   The link is signed per page view and expires (lib/documents/query.ts), so
   the preview is the browser's own rendering of that link — an <img> for a
   photo, an <iframe> for a PDF — not a copy of the file and not a stored URL.
   "Download" is the same link; the row never holds anything a person could
   keep past the hour. */

const TITLE: Partial<Record<StoredDocument["kind"], string>> = {
  green_slip: "Green slip",
  rego_notice: "Rego notice",
  insurance_policy: "Certificate of insurance",
  purchase_invoice: "Purchase invoice",
  fuel_receipt: "Fuel docket",
  vehicle_photo: "Photo",
  receipt: "Receipt",
};

export const documentTitle = (d: StoredDocument): string => TITLE[d.kind] ?? "Document";

export function DocRows({
  docs,
  openId,
  onOpen,
  emptyText = "No documents filed.",
}: {
  docs: StoredDocument[];
  openId: string | null;
  onOpen: (id: string | null) => void;
  emptyText?: string;
}) {
  const open = openId ? docs.find((d) => d.id === openId) : undefined;
  if (docs.length === 0) return <div className="vm-empty">{emptyText}</div>;
  return (
    <>
      <div className="vm-docs">
        {docs.map((d) => (
          <button
            key={d.id}
            type="button"
            className={`vm-doc${d.id === openId ? " open" : ""}`}
            onClick={() => onOpen(d.id === openId ? null : d.id)}
          >
            <span className="vm-docl">
              <b>{documentTitle(d)}</b>
              <em>
                {d.fileName} · {fmtBytes(d.sizeBytes)}
              </em>
            </span>
            <span className="vm-docview">{d.id === openId ? "Close" : "View"}</span>
          </button>
        ))}
      </div>
      {open && <DocPreview doc={open} onClose={() => onOpen(null)} />}
    </>
  );
}

export function DocPreview({ doc, onClose, height = 180 }: { doc: StoredDocument; onClose: () => void; height?: number }) {
  const pdf = doc.mimeType === "application/pdf";
  return (
    <div className="vm-preview">
      <div className="vm-previewhead">
        <span className="vm-docl">
          <b>{documentTitle(doc)}</b>
          <em>
            {doc.fileName} · uploaded {fmtDay(doc.createdAt)} · {fmtBytes(doc.sizeBytes)}
          </em>
        </span>
        <span className="vm-previewtools">
          {doc.url && (
            <a className="vm-inline" href={doc.url} target="_blank" rel="noreferrer">
              Download
            </a>
          )}
          <button type="button" className="vm-x" aria-label="Close preview" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </span>
      </div>
      <div className="vm-previewbody" style={{ height }}>
        {!doc.url ? (
          <span>This link couldn&apos;t be signed — reload to try again.</span>
        ) : doc.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed, expiring URL
          <img src={doc.url} alt={doc.fileName} />
        ) : pdf ? (
          <iframe src={doc.url} title={doc.fileName} />
        ) : (
          <span>No preview for this file type — download to view.</span>
        )}
      </div>
    </div>
  );
}
