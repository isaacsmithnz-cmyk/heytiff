"use client";

import { useRef, useState, type ReactNode } from "react";
import { uploadFile } from "@/lib/documents/upload-client";
import { fileToUprightBase64 } from "@/lib/images/upright";
import type { DocumentKind } from "@/lib/documents/files";
import { Button } from "@/components/parts/button";
import { StateWord } from "@/components/parts/state";
import { TiffGlyph } from "@/components/notes/tiff-mark";
import { Icon } from "@/components/shell/icon";
import { Group } from "./parts";

/* The scan flow every record panel shares: idle → reading → scanned → fields,
   with "Enter it by hand" as the way in that skips the reading. A group under
   a hairline, as the old-modals mock draws "Renew this licence": the paper's
   drop, then what was read in its word, then the fields.

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

/* A SCAN IN PROGRESS OUTLIVES A STRAY ESCAPE. Escape is the easiest key on the
   board to press by accident — it is also how a name box's suggestion list is
   dismissed — and closing the modal on it threw away a card that had already
   been read and uploaded, leaving the file in storage owned by nothing. The
   panel marks itself while it holds a file, and the modals ask this before
   Escape or a click on the backdrop closes anything. Close, Cancel and Scan again
   still do what they say. A scan that isn't a ScanCard — the rego
   certificate, the purchase invoice, the fuel docket — carries the same mark. */
export function scanInProgress(): boolean {
  return typeof document !== "undefined" && document.querySelector("[data-scan-in-progress]") !== null;
}

export function ScanCard<R extends { ok: boolean }>({
  heading,
  prompt,
  note,
  paper = "the document",
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
  /** A fact about the reading, under the prompt: what is never taken off the paper. */
  note?: string;
  /** What was read from, in "Read from the card": "the card", "the certificate". */
  paper?: string;
  /** The manual path's optional attach row: "Attach the green slip". */
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
  /* What LANDED, which is not what was picked: a scan whose upload failed
     still has a file name, and the attach row said "Attached:" under the line
     saying the document couldn't be stored. Only a stored document is
     attached; without one the row keeps its Upload button, which is the retry. */
  const [attached, setAttached] = useState<string | null>(null);
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
    setAttached(documentId ? file.name : null);
    if (!stored.ok) setWarn("The document couldn't be stored, so the details save without it");
    if (result && result.ok) {
      onRead(result, documentId, file.name);
      onMode("scanned");
    } else {
      /* Nothing read: the fields open empty and the file, if it landed, is
         still filed. Same outcome as "Enter it by hand", and said plainly. */
      if (documentId) onAttached(documentId, file.name);
      setWarn((w) => w ?? "Tiff couldn't read that one");
      onMode("manual");
    }
  };

  const attach = async (file: File | null | undefined) => {
    if (!file) return;
    setWarn(null);
    const stored = await uploadFile(file, docKind).catch(() => ({ ok: false, error: "upload" }) as const);
    if (stored.ok) {
      setFileName(file.name);
      setAttached(file.name);
      onAttached(stored.file.documentId, file.name);
    } else setWarn("That upload didn't finish, so try it again");
  };

  const reset = () => {
    setFileName(null);
    setAttached(null);
    setWarn(null);
    onMode("idle");
  };

  /* The guard reads the PICKED file, never `attached`. A scan whose upload
     failed still holds Tiff's read or the fields it opened, and a stray Escape
     would lose them all the same. */
  return (
    <div data-scan-in-progress={mode === "reading" || (mode !== "idle" && fileName !== null) ? "" : undefined}>
      <Group
        name={heading}
        action={
          <>
            {mode === "idle" ? (
              <Button kind="quiet" size={32} onClick={() => onMode("manual")}>
                Enter it by hand
              </Button>
            ) : mode === "manual" && fileName === null ? (
              <Button kind="quiet" size={32} onClick={reset}>
                Scan it instead
              </Button>
            ) : null}
            {onCancel && (
              <Button kind="quiet" size={32} onClick={onCancel}>
                Cancel
              </Button>
            )}
          </>
        }
      >
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

        <div className="mk-form">
          {mode === "idle" && (
            <div
              className="rcw-drop rcw-drop--slim"
              data-over={dragOver ? "" : undefined}
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
              <span className="rcw-drop-ic">
                <Icon name="upload" size={20} />
              </span>
              <p className="rcw-drop-what">{prompt}</p>
              {note && <p className="rcw-drop-note">{note}</p>}
              <Button kind="second" size={32} onClick={() => scanInput.current?.click()}>
                Choose a file
              </Button>
            </div>
          )}

          {mode === "reading" && (
            <div className="rcw-paper" role="status">
              <span className="rcw-paper-says rcw-reading">
                <TiffGlyph size={24} working />
                Reading {fileName ?? "the document"}
              </span>
            </div>
          )}

          {(mode === "scanned" || (mode === "manual" && fileName !== null)) && (
            <div className="rcw-paper">
              <span className="rcw-paper-says">
                {mode === "scanned" && <StateWord tone="good">{`Read from ${paper}`}</StateWord>}
                {warn && <StateWord tone="look">{warn}</StateWord>}
                <span className="rcw-paper-file">{fileName}</span>
              </span>
              <Button kind="quiet" size={32} onClick={reset}>
                Scan again
              </Button>
            </div>
          )}
          {mode === "manual" && fileName === null && warn && <StateWord tone="look">{warn}</StateWord>}

          {(mode === "scanned" || mode === "manual") && (
            <>
              {children}
              {mode === "manual" && (
                <div className="rcw-attach">
                  <span>{attached ? `Attached: ${attached}` : attachLabel}</span>
                  <Button kind="second" size={32} onClick={() => attachInput.current?.click()}>
                    {attached ? "Replace file" : "Upload file"}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </Group>
    </div>
  );
}
