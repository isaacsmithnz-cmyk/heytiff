"use client";

import { useRef, useState } from "react";
import type { StoredDocument } from "@/lib/documents/query";
import { uploadFile } from "@/lib/documents/upload-client";
import { Plate } from "../plate";
import { displayName, type Vehicle, type VehicleLog } from "../logic";
import { entryFacts, entryTitle, logDocuments } from "./derive";
import { DocPreview, DocRows } from "@/components/record-modal/doc-rows";
import { Btn, Card, DetailGrid, Eyebrow, Inline, SubHeader } from "@/components/record-modal/parts";

/* One entry, read on its own: the facts a row could not hold, and the paper
   behind them.

   The card's history said "Fuel logged — 62 L, $118.40" and offered a pencil.
   Isaac's instinct was to click the line and see the receipt, and there was
   nowhere for that click to land — the docket was stored, marked with a chip,
   and openable only from the Tax screen months later. This is where it lands:
   the litres and the cost, the station, the GST and the ABN off the docket,
   who logged it, and the docket itself, open. A service shows what was done
   and the workshop's invoice; an issue shows its state and can be closed.

   Correcting moves here from the row. The one thing this screen will not do
   is swap the paper behind a figure — an entry logged WITHOUT its document can
   be given one, and an entry that has one keeps it (see attachLogDocument). */

const PAPER: Partial<Record<VehicleLog["kind"], { word: string; kind: "fuel_receipt" | "service_record"; none: string; heading: string }>> = {
  fuel: { word: "receipt", kind: "fuel_receipt", none: "No receipt was kept for this fill.", heading: "Receipt" },
  service: { word: "service record", kind: "service_record", none: "No record filed for this service.", heading: "Service record" },
};

export function EntryScreen({
  vehicle,
  log,
  eco,
  documents,
  today,
  error,
  onBack,
  onCorrect,
  onResolve,
  onAttach,
}: {
  vehicle: Vehicle;
  log: VehicleLog;
  eco?: number;
  documents: StoredDocument[];
  today: string;
  error: string | null;
  onBack: () => void;
  onCorrect: (log: VehicleLog) => void;
  onResolve: (logId: string) => void;
  /** Files the paper against an entry that was logged without it. */
  onAttach: (logId: string, documentId: string) => void;
}) {
  const docs = logDocuments(documents, log);
  /* Opened on arrival: the document is what the click was for. With ONE
     document — the usual case — it is shown straight, with no row above it
     naming the same file a second time; the row list is for the entry that
     somehow has several. */
  const [openDoc, setOpenDoc] = useState<string | null>(docs[0]?.id ?? null);
  const [attachWarn, setAttachWarn] = useState<string | null>(null);
  const attachInput = useRef<HTMLInputElement>(null);
  const paper = PAPER[log.kind];
  const facts = entryFacts(log, eco);
  const only = docs.length === 1 ? docs[0] : null;

  const attach = async (file: File | null | undefined) => {
    if (!file || !paper) return;
    setAttachWarn(null);
    const up = await uploadFile(file, paper.kind).catch(() => null);
    if (up?.ok) onAttach(log.id, up.file.documentId);
    else setAttachWarn(up && !up.ok ? up.error : "That upload didn't finish — try again.");
  };

  return (
    <>
      <SubHeader
        eyebrow={displayName(vehicle)}
        title={entryTitle(log, today)}
        onBack={onBack}
        right={<Plate plate={vehicle.plate} state={vehicle.plateState} size="sm" />}
      />

      <div className="vm-body">
        {error && <div className="vm-err">{error}</div>}

        {(log.kind === "service" || log.kind === "issue") && (
          <Card>
            <div className="vm-cardhead">
              <Eyebrow>{log.kind === "service" ? "What was done" : "What's wrong"}</Eyebrow>
            </div>
            <div className={log.note ? "vm-entrynote" : "vm-entrynote faint"}>
              {log.note ?? (log.kind === "service" ? "No note on this service" : "No detail given")}
            </div>
            {log.workDone && <div className="vm-worklist">{log.workDone}</div>}
          </Card>
        )}

        <Card>
          <div className="vm-cardhead">
            <Eyebrow>Details</Eyebrow>
          </div>
          <DetailGrid
            cols={4}
            items={facts.map((f) => ({
              label: f.label,
              value: f.value,
              tone: f.warn ? "warn" : f.faint ? "faint" : undefined,
            }))}
          />
        </Card>

        {paper && (
          <Card>
            <div className="vm-cardhead">
              <Eyebrow>{paper.heading}</Eyebrow>
              {docs.length === 0 && (
                <Inline onClick={() => attachInput.current?.click()}>Attach the {paper.word}</Inline>
              )}
              {only && openDoc === null && <Inline onClick={() => setOpenDoc(only.id)}>Show</Inline>}
            </div>
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
            {attachWarn && <div className="vm-warnline">{attachWarn}</div>}
            {only ? (
              openDoc !== null && <DocPreview doc={only} onClose={() => setOpenDoc(null)} height={480} />
            ) : (
              <DocRows docs={docs} openId={openDoc} onOpen={setOpenDoc} previewHeight={480} emptyText={paper.none} />
            )}
          </Card>
        )}
      </div>

      <div className="fl-foot bar spread">
        <Btn kind="outline" onClick={() => onCorrect(log)}>
          Correct entry
        </Btn>
        {log.kind === "issue" && log.status === "open" && (
          <Btn kind="primary" onClick={() => onResolve(log.id)}>
            Mark resolved
          </Btn>
        )}
      </div>
    </>
  );
}
