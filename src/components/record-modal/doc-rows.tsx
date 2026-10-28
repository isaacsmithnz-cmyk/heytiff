"use client";

import type { StoredDocument } from "@/lib/documents/query";
import { fmtBytes } from "@/lib/documents/files";
import { fmtDay } from "@/lib/format/day";
import { Button, IconButton, LinkButton } from "@/components/parts/button";
import { Nothing } from "./parts";

/* A record's paperwork: a row each, under a hairline, one open at a time,
   with the open one previewed underneath.

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
  finance_agreement: "Finance agreement",
  licence: "Licence card",
  work_rights: "Work rights evidence",
  org_licence: "Licence certificate",
  org_insurance: "Certificate of insurance",
  fuel_receipt: "Fuel docket",
  service_record: "Service record",
  issue_photo: "Issue photo",
  vehicle_photo: "Photo",
  receipt: "Receipt",
};

export const documentTitle = (d: StoredDocument): string => TITLE[d.kind] ?? "Document";

/** The small picture at a row's start: the photo itself, or what kind of file it is. */
function Thumb({ doc }: { doc: StoredDocument }) {
  if (doc.image && doc.url) {
    // eslint-disable-next-line @next/next/no-img-element -- signed, expiring URL
    return <img className="rcw-thumb" src={doc.url} alt="" />;
  }
  return <span className="rcw-thumb">{doc.mimeType === "application/pdf" ? "PDF" : "File"}</span>;
}

export function DocRows({
  docs,
  openId,
  onOpen,
  emptyText = "No documents filed.",
  previewHeight,
}: {
  docs: StoredDocument[];
  openId: string | null;
  onOpen: (id: string | null) => void;
  emptyText?: string;
  /** Taller where the document IS the screen — a docket opened to be read. */
  previewHeight?: number;
}) {
  const open = openId ? docs.find((d) => d.id === openId) : undefined;
  if (docs.length === 0) return <Nothing>{emptyText}</Nothing>;
  return (
    <>
      <ul className="rcw-docs">
        {docs.map((d) => (
          <li key={d.id} className="rcw-doc">
            <Thumb doc={d} />
            <span className="rcw-doc-k">
              <b>{documentTitle(d)}</b>
              <span>
                {d.fileName}, {fmtBytes(d.sizeBytes)}
              </span>
            </span>
            <Button kind="quiet" size={32} aria-expanded={d.id === openId} onClick={() => onOpen(d.id === openId ? null : d.id)}>
              {d.id === openId ? "Close" : "Open"}
            </Button>
          </li>
        ))}
      </ul>
      {open && <DocPreview doc={open} onClose={() => onOpen(null)} height={previewHeight} />}
    </>
  );
}

export function DocPreview({ doc, onClose, height = 180 }: { doc: StoredDocument; onClose: () => void; height?: number }) {
  const pdf = doc.mimeType === "application/pdf";
  return (
    <div className="rcw-preview">
      <div className="rcw-preview-head">
        <span className="rcw-doc-k">
          <b>{documentTitle(doc)}</b>
          <span>
            {doc.fileName}, uploaded {fmtDay(doc.createdAt)}, {fmtBytes(doc.sizeBytes)}
          </span>
        </span>
        {doc.url && (
          <LinkButton href={doc.url} target="_blank" rel="noreferrer">
            Download
          </LinkButton>
        )}
        <IconButton glyph="close" label="Close preview" size={32} onClick={onClose} />
      </div>
      <div className="rcw-preview-body" style={{ height }}>
        {!doc.url ? (
          <span>This link couldn&apos;t be signed. Reload to try again.</span>
        ) : doc.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed, expiring URL
          <img src={doc.url} alt={doc.fileName} />
        ) : pdf ? (
          <iframe src={doc.url} title={doc.fileName} />
        ) : (
          <span>No preview for this file type. Download it to view.</span>
        )}
      </div>
    </div>
  );
}
