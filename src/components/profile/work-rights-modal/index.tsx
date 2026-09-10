"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import { readWorkRightsDocument, type ReadWorkRightsResult } from "@/app/actions/work-rights-ai";
import type { StoredDocument } from "@/lib/documents/query";
import { uploadFile } from "@/lib/documents/upload-client";
import { fmtDay } from "@/lib/format/day";
import { REMINDER_LEADS, leadLabel } from "@/lib/fleet/reminders";
import { Btn, Card, DetailGrid, Eyebrow, Inline, type DetailItem } from "@/components/record-modal/parts";
import { DocRows } from "@/components/record-modal/doc-rows";
import { ScanCard, type ScanMode } from "@/components/record-modal/scan-card";
import {
  WORK_RIGHTS_DOC_KIND,
  checkAddedText,
  checkDocuments,
  checkEvent,
  checkFacts,
  checkHeadline,
  checkState,
  checkSubline,
  currentCheck,
  looseCheckDocuments,
  previousChecks,
  type WorkRightsCheckInput,
  type WorkRightsRecord,
} from "@/lib/staff/work-rights-records";
import type { SaveResult } from "../types";
import { CheckFields, SCAN_COPY, checkInput, emptyCheck, type Check } from "./check-fields";

/* ONE PERSON'S RIGHT TO WORK, as a history of CHECKS.

   ONE SCREEN, unlike the licence and credential modals. Those have an identity
   to name — what kind of ticket, what colour — and a wall of many. A person
   has exactly one right to work, and it is not a thing you name; it is a thing
   you keep establishing. So there is no details screen and no add flow: the
   modal IS the record.

   WHAT MAKES THIS ONE DIFFERENT FROM THE OTHER TWO, and it is worth reading
   before changing anything here: the record in force is the LATEST CHECK, not
   the latest expiry. Status goes backwards — a substantive visa lapses to a
   bridging visa, full rights become conditional — and the most recent thing
   the employer verified is what they may rely on. See
   lib/staff/work-rights-records.ts.

   PORTALLED TO <body>: the shell keeps `will-change` on `.page.in`, which
   makes it a containing block for position:fixed. */

export function WorkRightsModal({
  staffId,
  subject,
  records,
  documents,
  reminders,
  today,
  warnDays,
  onRecord,
  onAttach,
  onRemoveCheck,
  onRemind,
  onClose,
}: {
  staffId: string;
  /** Whose card this is — null when it is your own, which is how the copy
      knows to say "your" rather than a name. */
  subject: string | null;
  records: WorkRightsRecord[];
  documents: StoredDocument[];
  reminders: number[];
  today: string;
  warnDays: number;
  onRecord: (input: WorkRightsCheckInput) => Promise<SaveResult>;
  onAttach: (recordId: string, documentId: string) => Promise<SaveResult>;
  onRemoveCheck: (recordId: string) => Promise<SaveResult>;
  onRemind: (leadDays: number, on: boolean) => Promise<SaveResult>;
  onClose: () => void;
}) {
  const current = currentCheck(records);
  const history = previousChecks(records);
  const state = checkState(current, today, warnDays);
  const recorded = current !== null;

  const [panelOpen, setPanelOpen] = useState(!recorded);
  const [mode, setMode] = useState<ScanMode>("idle");
  const [check, setCheck] = useState<Check>(emptyCheck);
  const [docId, setDocId] = useState<string | null>(null);
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const [openHist, setOpenHist] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attachInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async (fn: () => Promise<SaveResult>) => {
    setPending(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) setError(res.error);
    } finally {
      setPending(false);
    }
  };

  const showFields = mode === "scanned" || mode === "manual";
  const canSave = check.status.trim() !== "" && check.checkedOn.trim() !== "" && !pending;

  const fill = (r: ReadWorkRightsResult) => {
    if (!r.ok) return;
    setCheck((p) => ({
      status: r.status ?? p.status,
      visaType: r.visaType ?? p.visaType,
      hoursCondition: r.hoursCondition ?? p.hoursCondition,
      expiresOn: r.expiresOn ?? p.expiresOn,
      checkedOn: r.checkedOn ?? p.checkedOn,
    }));
  };

  const save = () => {
    if (!canSave) return;
    void run(async () => {
      const res = await onRecord({
        ...checkInput(check, mode === "scanned" ? "scan" : "manual"),
        documentId: docId,
      });
      if (res.ok) {
        setCheck(emptyCheck);
        setDocId(null);
        setMode("idle");
        setPanelOpen(false);
      }
      return res;
    });
  };

  const facts: DetailItem[] = current ? checkFacts(current, state) : [];
  const currentDocs = current ? checkDocuments(documents, current) : [];
  const loose = looseCheckDocuments(documents, records);
  const who = subject?.trim();

  return createPortal(
    <div className="vm-ov" onClick={onClose}>
      <div
        className="vm"
        role="dialog"
        aria-modal="true"
        aria-label={who ? `Right to work — ${who}` : "Right to work"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="vm-head sub">
          <div className="vm-headl">
            <div className="vm-titles">
              <span className="vm-eyebrow">{who ? who.toUpperCase() : "YOUR RECORD"}</span>
              <h2 className="vm-title sub">Right to work</h2>
            </div>
          </div>
          <div className="vm-headr">
            <button type="button" className="vm-iconbtn" aria-label="Close" onClick={onClose}>
              <Icon name="x" size={18} />
            </button>
          </div>
        </div>

        <div className="vm-body">
          {error && <div className="vm-err">{error}</div>}

          <div className={`vm-status ${state === "none" ? "neutral" : state === "forever" ? "ok" : state}`}>
            <div className="vm-statusl">
              <Eyebrow tone={state === "ok" || state === "forever" ? "accent" : state === "none" ? undefined : "warn"}>
                STATUS
              </Eyebrow>
              <span className="vm-headline">{checkHeadline(current, today, warnDays)}</span>
              <span className="vm-subline">{checkSubline(current)}</span>
            </div>
            {recorded && !panelOpen && (
              <Btn kind="primary" onClick={() => setPanelOpen(true)}>
                Record a check
              </Btn>
            )}
          </div>

          {current && (
            <Card>
              <div className="vm-cardhead">
                <Eyebrow>CURRENT CHECK</Eyebrow>
                <span className="vm-added">{checkAddedText(current)}</span>
              </div>
              <DetailGrid items={facts} />
              <div className="vm-divider">
                <Eyebrow>EVIDENCE</Eyebrow>
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
                    const up = await uploadFile(file, WORK_RIGHTS_DOC_KIND).catch(() => null);
                    if (up?.ok) void run(() => onAttach(current.id, up.file.documentId));
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
                emptyText="No evidence filed under this check yet."
              />
            </Card>
          )}

          <Card>
            <div className="vm-cardhead">
              <Eyebrow>REMIND ME</Eyebrow>
              <span className="vm-caption">
                {state === "forever" ? "Nothing to count down to" : current?.expiresOn ? "Before it expires" : "Record a check first"}
              </span>
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
                    disabled={!current?.expiresOn || pending}
                    onClick={() => void run(() => onRemind(lead, !on))}
                  >
                    {leadLabel(lead)}
                  </button>
                );
              })}
            </div>
            <span className="vm-hint">
              Each one is a task on your own dashboard — the bell nudges you the morning it falls due, and it goes
              out in that day&apos;s reminder email. A check that says the entitlement no longer expires closes them.
            </span>
          </Card>

          {panelOpen && (
            <ScanCard<ReadWorkRightsResult>
              heading={current ? "RECORD A NEW CHECK" : "RECORD THE FIRST CHECK"}
              prompt={SCAN_COPY.prompt}
              hint={SCAN_COPY.hint}
              attachLabel={SCAN_COPY.attach}
              docKind={WORK_RIGHTS_DOC_KIND}
              read={(b64, mt) => readWorkRightsDocument(b64, mt, staffId)}
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
                  setCheck(emptyCheck);
                  setDocId(null);
                }
              }}
            >
              <CheckFields value={check} onChange={setCheck} today={today} />
            </ScanCard>
          )}

          <Card className="vm-histcard">
            <div className="vm-cardhead">
              <Eyebrow>PREVIOUS CHECKS</Eyebrow>
            </div>
            {history.length === 0 ? (
              <div className="vm-empty">No previous checks recorded.</div>
            ) : (
              history.map((r) => {
                const expanded = openHist === r.id;
                const docs = checkDocuments(documents, r);
                return (
                  <div key={r.id} className="vm-hist">
                    <button
                      type="button"
                      className="vm-histrow"
                      aria-expanded={expanded}
                      onClick={() => {
                        setOpenHist(expanded ? null : r.id);
                        setOpenDoc(null);
                        setArmed(null);
                      }}
                    >
                      <span className="vm-docl">
                        <b>{checkEvent(r)}</b>
                        <em>{docs.length === 1 ? "1 document" : `${docs.length} documents`}</em>
                      </span>
                      <span className="vm-histr">
                        <span className="vm-evdate">checked {fmtDay(r.checkedOn)}</span>
                        <Icon name={expanded ? "chevU" : "chevR"} size={14} />
                      </span>
                    </button>
                    {expanded && (
                      <div className="vm-histbody">
                        <div className="vm-inset">
                          <DetailGrid dense items={checkFacts(r, "ok")} />
                        </div>
                        <span className="vm-fl">EVIDENCE</span>
                        <DocRows docs={docs} openId={openDoc} onOpen={setOpenDoc} emptyText="No evidence filed." />
                        <div className="vm-attach">
                          <span>{checkAddedText(r) || "Filed by hand"}</span>
                          <button
                            type="button"
                            className={`vm-inline danger${armed === r.id ? " arm" : ""}`}
                            disabled={pending}
                            onClick={() => (armed === r.id ? void run(() => onRemoveCheck(r.id)) : setArmed(r.id))}
                          >
                            {armed === r.id ? "Tap again to remove" : "Remove check"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </Card>

          {loose.length > 0 && (
            <Card>
              <div className="vm-cardhead">
                <Eyebrow>OTHER DOCUMENTS</Eyebrow>
                <span className="vm-caption">Filed under no check</span>
              </div>
              <DocRows docs={loose} openId={openDoc} onOpen={setOpenDoc} />
            </Card>
          )}
        </div>

        <div className="vm-foot">
          <Btn kind="outline" onClick={onClose}>
            Close
          </Btn>
          {showFields && (
            <Btn kind="primary" onClick={save} disabled={!canSave}>
              {pending ? "Saving…" : "Save check"}
            </Btn>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
