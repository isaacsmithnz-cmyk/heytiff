"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { readOrgCredentialDocument, type ReadOrgCredResult } from "@/app/actions/org-credential-ai";
import type { StoredDocument } from "@/lib/documents/query";
import { uploadFile } from "@/lib/documents/upload-client";
import { fmtDay } from "@/lib/format/day";
import { REMINDER_LEADS, leadLabel } from "@/lib/fleet/reminders";
import { Btn, Card, DetailGrid, Eyebrow, Inline, type DetailItem } from "@/components/record-modal/parts";
import { DocRows } from "@/components/record-modal/doc-rows";
import { ScanCard, type ScanMode } from "@/components/record-modal/scan-card";
import type { OrgCredKind, OrgCredential } from "@/lib/org/credentials";
import {
  CREDENTIAL_DOC_KIND,
  credentialDays,
  credentialHeadline,
  credentialState,
  credentialStatusText,
  currentRecord,
  fmtCredMoney,
  looseDocuments,
  previousRecords,
  recordAddedText,
  recordDocuments,
  recordEvent,
  recordFacts,
  type CredentialRecordInput,
  type OrgCredentialRecord,
} from "@/lib/org/credential-records";
import { SCAN_COPY, TermFields, emptyTerm, termInput, type Term } from "./term-fields";

/* ONE CARD'S TERMS — the screen the whole rebuild is for.

   It is the fleet's renewal screen, one level up and with the vocabulary
   changed: a status, the term in force with its paperwork, the reminders each
   person set for themselves, a way to file the next term by scanning it, and
   the history underneath. Nothing is overwritten — a renewal is a new row, and
   the card's expiry follows the newest one.

   WHAT THE TWO KINDS DON'T SHARE is two boxes and a handful of words, both
   tables (see term-fields.tsx). A policy screen and a licence screen would
   have been the same file twice. */

const CURRENT_LABEL: Record<OrgCredKind, string> = {
  insurance: "CURRENT POLICY",
  licence: "CURRENT LICENCE",
};
const HISTORY_LABEL: Record<OrgCredKind, string> = {
  insurance: "POLICY HISTORY",
  licence: "LICENCE HISTORY",
};
const RECORD_LABEL: Record<OrgCredKind, { fresh: string; again: string; button: string; save: string }> = {
  insurance: {
    fresh: "RECORD POLICY",
    again: "RENEW POLICY",
    button: "Record renewal",
    save: "Save policy",
  },
  licence: {
    fresh: "RECORD LICENCE",
    again: "RENEW LICENCE",
    button: "Record renewal",
    save: "Save licence",
  },
};
const EMPTY_HISTORY: Record<OrgCredKind, string> = {
  insurance: "No previous policy terms recorded.",
  licence: "No previous licence terms recorded.",
};

export function RecordScreen({
  credential,
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
  credential: OrgCredential;
  records: OrgCredentialRecord[];
  documents: StoredDocument[];
  /** The leads the viewer has switched on, in days. */
  reminders: number[];
  today: string;
  pending: boolean;
  error: string | null;
  onRecord: (input: CredentialRecordInput) => void;
  onAttach: (recordId: string, documentId: string) => void;
  onRemoveTerm: (recordId: string) => void;
  onRemind: (leadDays: number, on: boolean) => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const kind = credential.kind;
  const current = currentRecord(records);
  const history = previousRecords(records);
  const expiry = current?.expiresOn ?? credential.expiryDate;
  const days = credentialDays(expiry, today);
  const state = credentialState(expiry, today);
  const recorded = current !== null;

  /* Open by default when there is nothing on file — the panel IS the screen
     for a card nobody has filed a certificate against. Opened on demand once a
     term exists, so the screen leads with the cover you hold rather than with
     a form. */
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

  const fill = (r: ReadOrgCredResult) => {
    if (!r.ok) return;
    setTerm((p) => ({
      issuer: r.issuer ?? p.issuer,
      number: r.number ?? p.number,
      cover: r.cover ?? p.cover,
      sumInsured: r.sumInsured != null ? String(r.sumInsured) : p.sumInsured,
      premium: r.premium != null ? String(r.premium) : p.premium,
      excess: r.excess != null ? String(r.excess) : p.excess,
      startsOn: r.startsOn ?? p.startsOn,
      expiresOn: r.expiresOn ?? p.expiresOn,
    }));
  };

  const save = () => {
    if (!canSave) return;
    onRecord({
      ...termInput(term),
      documentId: docId,
      source: mode === "scanned" ? "scan" : "manual",
    });
  };

  const headline = credentialHeadline(kind, expiry, today);
  const subline = !recorded
    ? credential.expiryDate
      ? `Expires ${fmtDay(credential.expiryDate)} — scan the ${SCAN_COPY[kind].prompt.replace(/^Scan or upload the /, "")} to start the history.`
      : `Scan the ${SCAN_COPY[kind].prompt.replace(/^Scan or upload the /, "")} or enter the details below.`
    : [
        current?.issuer,
        current?.number ? `No. ${current.number}` : null,
        expiry ? `expires ${fmtDay(expiry)}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || credentialStatusText(days);
  const tone = state === "none" ? "neutral" : state;

  const facts: DetailItem[] = current ? recordFacts(kind, current, state) : [];
  const currentDocs = current ? recordDocuments(documents, current) : [];
  const loose = looseDocuments(documents, records);

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
              {RECORD_LABEL[kind].button}
            </Btn>
          )}
        </div>

        {current && (
          <Card>
            <div className="vm-cardhead">
              <Eyebrow>{CURRENT_LABEL[kind]}</Eyebrow>
              <span className="vm-added">{recordAddedText(current)}</span>
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
                  const up = await uploadFile(file, CREDENTIAL_DOC_KIND[kind]).catch(() => null);
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
              emptyText="No paperwork filed under this term yet."
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
            Each one is a task on your dashboard — the bell nudges you the morning it falls due, and it goes out in
            that day&apos;s reminder email. They move with the expiry when you record a renewal.
          </span>
        </Card>

        {panelOpen && (
          <ScanCard<ReadOrgCredResult>
            heading={current ? RECORD_LABEL[kind].again : RECORD_LABEL[kind].fresh}
            prompt={SCAN_COPY[kind].prompt}
            hint={SCAN_COPY[kind].hint}
            attachLabel={SCAN_COPY[kind].attach}
            docKind={CREDENTIAL_DOC_KIND[kind]}
            read={(b64, mt) => readOrgCredentialDocument(b64, mt, kind)}
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
            <TermFields kind={kind} value={term} onChange={setTerm} today={today} />
          </ScanCard>
        )}

        <Card className="vm-histcard">
          <div className="vm-cardhead">
            <Eyebrow>{HISTORY_LABEL[kind]}</Eyebrow>
          </div>
          {history.length === 0 ? (
            <div className="vm-empty">{EMPTY_HISTORY[kind]}</div>
          ) : (
            history.map((r) => {
              const expanded = openHist === r.id;
              const docs = recordDocuments(documents, r);
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
                      <b>{recordEvent(kind, r)}</b>
                      <em>{docs.length === 1 ? "1 document" : `${docs.length} documents`}</em>
                    </span>
                    <span className="vm-histr">
                      {r.premium != null && <span>{fmtCredMoney(r.premium)}</span>}
                      <span className="vm-evdate">{fmtDay(r.expiresOn)}</span>
                      <Icon name={expanded ? "chevU" : "chevR"} size={14} />
                    </span>
                  </button>
                  {expanded && (
                    <div className="vm-histbody">
                      <div className="vm-inset">
                        <DetailGrid dense items={recordFacts(kind, r, "ok")} />
                      </div>
                      <span className="vm-fl">DOCUMENTS</span>
                      <DocRows docs={docs} openId={openDoc} onOpen={setOpenDoc} emptyText="No paperwork filed." />
                      <div className="vm-attach">
                        <span>{recordAddedText(r) || "Filed by hand"}</span>
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

        {/* Paperwork that belongs to the card but sits under no term — filed
            before the first renewal was recorded, or attached to the card
            itself. It would otherwise be invisible, which is the one thing a
            document store must never be. */}
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
              {pending ? "Saving…" : RECORD_LABEL[kind].save}
            </Btn>
          )}
        </span>
      </div>
    </>
  );
}
