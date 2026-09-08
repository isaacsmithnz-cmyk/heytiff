"use client";

import { useRef, useState, type ReactNode } from "react";
import { uploadFile } from "@/lib/documents/upload-client";
import { fileToUprightBase64 } from "@/lib/images/upright";
import type { DocumentKind } from "@/lib/documents/files";
import { Eyebrow, Inline } from "./parts";

/* The scan flow every record panel shares: idle → reading → scanned → fields,
   with "Enter manually" as the way in that skips the reading.

   The prototype simulated this with a timer. The real one has two jobs that
   run SIDE BY SIDE because they are independent: KEEPING the document and
   READING it. The read is a convenience — the fields are editable either way —
   but the file is the thing that gets filed under the policy, so a failed read
   must not cost the upload and a failed upload must not cost the reading.
   Promise.all, not a chain (the fuel docket set this pattern).

   What Tiff read is handed up as a RESULT, not written into anything: the
   parent owns the field values and fills them, the person checks them against
   the paper, and only Save writes. The banner says so. */

export type ScanMode = "idle" | "reading" | "scanned" | "manual";

export function ScanCard<R extends { ok: boolean }>({
  heading,
  prompt,
  hint,
  attachLabel,
  docKind,
  read,
  onRead,
  onAttached,
  onCancel,
  mode,
  onMode,
  children,
}: {
  heading: string;
  /** "Scan or upload the green slip" */
  prompt: string;
  /** What gets read and where it is filed. */
  hint: string;
  /** The manual path's optional attach row: "Optional: attach the green slip". */
  attachLabel: string;
  docKind: DocumentKind;
  /** The reader for this document. */
  read: (fileBase64: string, mediaType: string) => Promise<R>;
  /** Tiff's answer plus the stored document, if the upload landed. The parent
      fills its fields from this; nothing is saved here. */
  onRead: (result: R, documentId: string | null, fileName: string) => void;
  /** Manual mode's attach: the document landed, nothing was read. */
  onAttached: (documentId: string, fileName: string) => void;
  /** Present when the panel can be dismissed (updating a record that exists). */
  onCancel?: () => void;
  mode: ScanMode;
  onMode: (mode: ScanMode) => void;
  /** The fields, shown once scanned or in manual mode. */
  children: ReactNode;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);
  const scanInput = useRef<HTMLInputElement>(null);
  const attachInput = useRef<HTMLInputElement>(null);

  const scan = async (file: File | null | undefined) => {
    if (!file || mode === "reading") return;
    setWarn(null);
    setFileName(file.name);
    onMode("reading");
    const [stored, result] = await Promise.all([
      uploadFile(file, docKind).catch(() => ({ ok: false, error: "upload" }) as const),
      fileToUprightBase64(file)
        .then((img) => read(img.data, img.mediaType))
        .catch(() => null),
    ]);
    const documentId = stored.ok ? stored.file.documentId : null;
    if (!stored.ok) setWarn("The document couldn't be stored — the details below will save without it.");
    if (result && result.ok) {
      onRead(result, documentId, file.name);
      onMode("scanned");
    } else {
      /* Nothing read: the fields open empty and the file, if it landed, is
         still filed. Same outcome as "Enter manually", and said plainly. */
      if (documentId) onAttached(documentId, file.name);
      setWarn((w) => w ?? "Tiff couldn't read that one — enter the details below.");
      onMode("manual");
    }
  };

  const attach = async (file: File | null | undefined) => {
    if (!file) return;
    setWarn(null);
    const stored = await uploadFile(file, docKind).catch(() => ({ ok: false, error: "upload" }) as const);
    if (stored.ok) {
      setFileName(file.name);
      onAttached(stored.file.documentId, file.name);
    } else setWarn("That upload didn't finish — try again.");
  };

  const reset = () => {
    setFileName(null);
    setWarn(null);
    onMode("idle");
  };

  return (
    <div className="vm-card vm-record">
      <div className="vm-cardhead">
        <Eyebrow>{heading}</Eyebrow>
        <div className="vm-recordtools">
          {mode === "idle" ? (
            <Inline onClick={() => onMode("manual")}>Enter manually</Inline>
          ) : (
            <Inline muted onClick={reset}>
              Start over
            </Inline>
          )}
          {onCancel && (
            <Inline muted onClick={onCancel}>
              Cancel
            </Inline>
          )}
        </div>
      </div>

      <input
        ref={scanInput}
        type="file"
        accept="image/*,application/pdf"
        aria-label="Scan document"
        hidden
        onChange={(e) => {
          void scan(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={attachInput}
        type="file"
        accept="image/*,application/pdf"
        aria-label="Attach document"
        hidden
        onChange={(e) => {
          void attach(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {mode === "idle" && (
        <button
          type="button"
          className={`vm-scan${dragOver ? " over" : ""}`}
          onClick={() => scanInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void scan(e.dataTransfer.files?.[0]);
          }}
        >
          <b>{prompt}</b>
          <span>{hint}</span>
        </button>
      )}

      {mode === "reading" && (
        <div className="vm-reading" role="status">
          <span className="vm-shimmer" />
          <span>Reading {fileName ?? "the document"}…</span>
        </div>
      )}

      {mode === "scanned" && (
        <div className="vm-scanned">
          <span className="vm-scannedl">
            <b>{fileName}</b>
            <em>Details read from document — check before saving</em>
          </span>
          <span className="vm-scannedtag">SCANNED</span>
        </div>
      )}

      {warn && <div className="vm-warnline">{warn}</div>}

      {(mode === "scanned" || mode === "manual") && (
        <>
          {children}
          {mode === "manual" && (
            <div className="vm-attach">
              <span>{fileName ? `Attached: ${fileName}` : attachLabel}</span>
              <Inline onClick={() => attachInput.current?.click()}>{fileName ? "Replace" : "Upload"}</Inline>
            </div>
          )}
        </>
      )}
    </div>
  );
}
