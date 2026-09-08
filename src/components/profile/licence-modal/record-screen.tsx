"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { readStaffLicenceDocument, type ReadLicenceResult } from "@/app/actions/staff-licence-ai";
import type { StoredDocument } from "@/lib/documents/query";
import { uploadFile } from "@/lib/documents/upload-client";
import { fmtDay } from "@/lib/format/day";
import { REMINDER_LEADS, leadLabel } from "@/lib/fleet/reminders";
import { Btn, Card, DetailGrid, Eyebrow, Inline, type DetailItem } from "@/components/record-modal/parts";
import { DocRows } from "@/components/record-modal/doc-rows";
import { ScanCard, type ScanMode } from "@/components/record-modal/scan-card";
import type { StaffLicence } from "@/lib/staff/types";
import {
  LICENCE_DOC_KIND,
  currentTerm,
  licenceDays,
  looseTermDocuments,
  previousTerms,
  termAddedText,
  termDocuments,
  termEvent,
  termFacts,
  termHeadline,
  termState,
  termStatusText,
  type LicenceTermInput,
  type StaffLicenceRecord,
} from "@/lib/staff/licence-records";
import { SCAN_COPY, TermFields, emptyTerm, termInput, type Term } from "./term-fields";

/* ONE TICKET'S TERMS.

   The organisation's credential screen, one level down, and the fleet's
   renewal screen one level below that: a status, the term in force with its
   paperwork, the reminders each person set for themselves, a way to file the
   next term by scanning it, and the history underneath.

   What it replaces is not a worse version of this — it is nothing. A staff
   licence had no detail view at all: the only way to record a renewal was to
   delete the card and add it again, which threw the previous term away. */

export function RecordScreen({
  licence,
  staffId,
  records,
  documents,
  reminders,
  today,
  pending,
  error,
  onRecord,
  onAttach,
  onRemoveTerm,
  onRemind,
  onEdit,
  onClose,
}: {
  licence: StaffLicence;
  staffId: string;
  records: StaffLicenceRecord[];
  documents: StoredDocument[];
  /** The leads the VIEWER has switched on, in days. */
  reminders: number[];
  today: string;
  pending: boolean;
  error: string | null;
  onRecord: (input: LicenceTermInput) => void;
  onAttach: (termId: string, documentId: string) => void;
  onRemoveTerm: (termId: string) => void;
  onRemind: (leadDays: number, on: boolean) => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const current = currentTerm(records);
  const history = previousTerms(records);
  const expiry = current?.expiresOn ?? licence.expiryDate;
  const days = licenceDays(expiry, today);
  const state = termState(expiry, today);
  const recorded = current !== null;

  /* Open by default when there is nothing on file — the panel IS the screen
     for a ticket nobody has scanned. Opened on demand once a term exists, so
     the screen leads with the ticket you hold rather than with a form. */
  const [panelOpen, setPanelOpen] = useState(!recorded);
  const [mode, setMode] = useState<ScanMode>("idle");
  const [term, setTerm] = useState<Term>(emptyTerm);
  const [docId, setDocId] = useState<string | null>(null);
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const [openHist, setOpenHist] = useState<string | null>(null);
  const [armedTerm, setArmedTerm] = useState<string | null>(null);
  const attachInput = useRef<HTMLInputElement>(null);

  const showFields = mode === "scanned" || mode === "manual";
  const canSave = term.expiresOn.trim().length > 0 && !pending;

  const fill = (r: ReadLicenceResult) => {
    if (!r.ok) return;
    setTerm((p) => ({
      number: r.number ?? p.number,
      issuer: r.issuer ?? p.issuer,
      issuingState: r.issuingState ?? p.issuingState,
      classes: r.classes ?? p.classes,
      startsOn: r.startsOn ?? p.startsOn,
      expiresOn: r.expiresOn ?? p.expiresOn,
    }));
  };

  const save = () => {
    if (!canSave) return;
    onRecord({ ...termInput(term), documentId: docId, source: mode === "scanned" ? "scan" : "manual" });
  };

  const headline = termHeadline(expiry, today);
  const subline = !recorded
    ? licence.expiryDate
      ? `Expires ${fmtDay(licence.expiryDate)} — scan the card to start the history.`
      : "Scan the card or enter the details below."
    : [current?.number ? `No. ${current.number}` : null, current?.issuer, expiry ? `expires ${fmtDay(expiry)}` : null]
        .filter(Boolean)
        .join(" · ") || termStatusText(days);
  const tone = state === "none" ? "neutral" : state;

  const facts: DetailItem[] = current ? termFacts(current, state) : [];
  const currentDocs = current ? termDocuments(documents, current) : [];
  const loose = looseTermDocuments(documents, records);

  return (
    <>
      <div className="vm-body">
        {error && <div className="vm-err">{error}</div>}

        <div className={`vm-status ${tone}`}>
          <div className="vm-statusl">
            <Eyebrow tone={state === "ok" ? "accent" : state === "none" ? undefined : "warn"}>STATUS</Eyebrow>
            <span className="vm-headline">{headline}</span>
            <span className="vm-subline">{subline}</span>
          </div>
          {recorded && !panelOpen && (
            <Btn kind="primary" onClick={() => setPanelOpen(true)}>
              Record renewal
            </Btn>
          )}
        </div>

        {current && (
          <Card>
            <div className="vm-cardhead">
              <Eyebrow>CURRENT TERM</Eyebrow>
              <span className="vm-added">{termAddedText(current)}</span>
            </div>
            <DetailGrid items={facts} />
            <div className="vm-divider">
              <Eyebrow>DOCUMENTS</Eyebrow>
              <Inline onClick={() => attachInput.current?.click()}>Add document</Inline>
              <input
                ref={attachInput}
                type="file"
                accept="image/*,application/pdf"
                aria-label="Add document"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  const up = await uploadFile(file, LICENCE_DOC_KIND).catch(() => null);
                  if (up?.ok) onAttach(current.id, up.file.documentId);
                }}
              />
            </div>
            <DocRows
              docs={currentDocs}
              openId={openDoc}
              onOpen={(id) => {
                setOpenDoc(id);
                if (id) setOpenHist(null);
              }}
              emptyText="No photo or scan filed under this term yet."
            />
          </Card>
        )}

        {/* ---- remind me: each chip is a task of your own ---- */}
        <Card>
          <div className="vm-cardhead">
            <Eyebrow>REMIND ME</Eyebrow>
            <span className="vm-caption">{expiry ? "Before it expires" : "Record the term first"}</span>
          </div>
          <div className="vm-chips" role="group" aria-label="Remind me">
            {REMINDER_LEADS.map((lead) => {
              const on = reminders.includes(lead);
              return (
                <button
                  key={lead}
                  type="button"
                  className={`vm-chip${on ? " on" : ""}`}
                  aria-pressed={on}
                  disabled={!expiry || pending}
                  onClick={() => onRemind(lead, !on)}
                >
                  {leadLabel(lead)}
                </button>
              );
            })}
          </div>
          <span className="vm-hint">
            Each one is a task on your own dashboard — the bell nudges you the morning it falls due, and it goes out
            in that day&apos;s reminder email. They move with the expiry when a renewal is recorded.
          </span>
        </Card>

        {panelOpen && (
          <ScanCard<ReadLicenceResult>
            heading={current ? "RENEW THIS TICKET" : "RECORD THE TERM"}
            prompt={SCAN_COPY.prompt}
            hint={SCAN_COPY.hint}
            attachLabel={SCAN_COPY.attach}
            docKind={LICENCE_DOC_KIND}
            read={(b64, mt) => readStaffLicenceDocument(b64, mt, staffId)}
            onRead={(r, id) => {
              fill(r);
              setDocId(id);
            }}
            onAttached={(id) => setDocId(id)}
            onCancel={recorded ? () => setPanelOpen(false) : undefined}
            mode={mode}
            onMode={(m) => {
              setMode(m);
              if (m === "idle") {
                setTerm(emptyTerm);
                setDocId(null);
              }
            }}
          >
            <TermFields value={term} onChange={setTerm} today={today} />
          </ScanCard>
        )}

        <Card className="vm-histcard">
          <div className="vm-cardhead">
            <Eyebrow>PREVIOUS TERMS</Eyebrow>
          </div>
          {history.length === 0 ? (
            <div className="vm-empty">No previous terms recorded.</div>
          ) : (
            history.map((r) => {
              const expanded = openHist === r.id;
              const docs = termDocuments(documents, r);
              return (
                <div key={r.id} className="vm-hist">
                  <button
                    type="button"
                    className="vm-histrow"
                    aria-expanded={expanded}
                    onClick={() => {
                      setOpenHist(expanded ? null : r.id);
                      setOpenDoc(null);
                      setArmedTerm(null);
                    }}
                  >
                    <span className="vm-docl">
                      <b>{termEvent(r)}</b>
                      <em>{docs.length === 1 ? "1 document" : `${docs.length} documents`}</em>
                    </span>
                    <span className="vm-histr">
                      {r.number && <span>{r.number}</span>}
                      <span className="vm-evdate">{fmtDay(r.expiresOn)}</span>
                      <Icon name={expanded ? "chevU" : "chevR"} size={14} />
                    </span>
                  </button>
                  {expanded && (
                    <div className="vm-histbody">
                      <div className="vm-inset">
                        <DetailGrid dense items={termFacts(r, "ok")} />
                      </div>
                      <span className="vm-fl">DOCUMENTS</span>
                      <DocRows docs={docs} openId={openDoc} onOpen={setOpenDoc} emptyText="No paperwork filed." />
                      <div className="vm-attach">
                        <span>{termAddedText(r) || "Filed by hand"}</span>
                        <button
                          type="button"
                          className={`vm-inline danger${armedTerm === r.id ? " arm" : ""}`}
                          disabled={pending}
                          onClick={() => (armedTerm === r.id ? onRemoveTerm(r.id) : setArmedTerm(r.id))}
                        >
                          {armedTerm === r.id ? "Tap again to remove" : "Remove term"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </Card>

        {/* Paperwork the ticket owns that sits under no term — filed before the
            first renewal was recorded. Invisible otherwise, which is the one
            thing a document store must never be. */}
        {loose.length > 0 && (
          <Card>
            <div className="vm-cardhead">
              <Eyebrow>OTHER DOCUMENTS</Eyebrow>
              <span className="vm-caption">Filed under no term</span>
            </div>
            <DocRows docs={loose} openId={openDoc} onOpen={setOpenDoc} />
          </Card>
        )}
      </div>

      <div className="vm-foot between">
        <Btn kind="outline" onClick={onEdit} icon="edit">
          Edit details
        </Btn>
        <span style={{ display: "flex", gap: 10 }}>
          <Btn kind="outline" onClick={onClose}>
            Close
          </Btn>
          {showFields && (
            <Btn kind="primary" onClick={save} disabled={!canSave}>
              {pending ? "Saving…" : "Save term"}
            </Btn>
          )}
        </span>
      </div>
    </>
  );
}
