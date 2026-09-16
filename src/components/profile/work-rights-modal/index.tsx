"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import { readWorkRightsDocument, type ReadWorkRightsResult } from "@/app/actions/work-rights-ai";
import type { StoredDocument } from "@/lib/documents/query";
import { uploadFile } from "@/lib/documents/upload-client";
import { fmtDay } from "@/lib/format/day";
import { Btn, Card, DetailGrid, Eyebrow, Inline, type DetailItem } from "@/components/record-modal/parts";
import { DocRows } from "@/components/record-modal/doc-rows";
import { ScanCard, scanInProgress, type ScanMode } from "@/components/record-modal/scan-card";
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
import {
  CheckFields,
  SCAN_COPY,
  SCAN_COPY_NO_VISA,
  checkInput,
  emptyCheck,
  type Check,
} from "./check-fields";
import { isNoVisa } from "@/lib/staff/work-rights";

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
  today,
  warnDays,
  onRecord,
  onAttach,
  onRemoveCheck,
  onClose,
}: {
  staffId: string;
  /** Whose card this is — null when it is your own, which is how the copy
      knows to say "your" rather than a name. */
  subject: string | null;
  records: WorkRightsRecord[];
  documents: StoredDocument[];
  today: string;
  warnDays: number;
  onRecord: (input: WorkRightsCheckInput) => Promise<SaveResult>;
  onAttach: (recordId: string, documentId: string) => Promise<SaveResult>;
  onRemoveCheck: (recordId: string) => Promise<SaveResult>;
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

  /* Escape closes, and so does the backdrop, except while a scan is in
     progress — see scanInProgress. The X and Close still close. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (scanInProgress()) return;
      onClose();
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

  /* Which check this is: the one being typed if a status has been chosen,
     else the record's. A citizen has no site to visit. */
  const noVisaStatus = isNoVisa(check.status || current?.status || "");
  const scanCopy = noVisaStatus ? SCAN_COPY_NO_VISA : SCAN_COPY;
  const facts: DetailItem[] = current ? checkFacts(current, state) : [];
  const currentDocs = current ? checkDocuments(documents, current) : [];
  const loose = looseCheckDocuments(documents, records);
  const who = subject?.trim();

  return createPortal(
    <div className="vm-ov" onClick={() => (scanInProgress() ? undefined : onClose())}>
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
              <h2 className="vm-title sub">Right to work</h2>
              <span className="vm-kind">{who ?? "Your record"}</span>
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
                Status
              </Eyebrow>
              <span className="vm-headline">{checkHeadline(current, today, warnDays)}</span>
              <span className="vm-subline">{checkSubline(current)}</span>
            </div>
            {/* THE ACTION IS IN THE FOOTER, not in here. A status card is a
                thing you read; this one carried the screen's only black
                button in its corner, competing with the headline beside it —
                and the licence modal on the very same tab keeps its action in
                the footer, so two windows on one screen put the same kind of
                button in two places. Isaac, on the walk: "looks a bit weird",
                and then "I don't know what record a check actually means".

                SO THE WORDS CHANGED TOO, everywhere in this window. "A check"
                is the compliance industry's noun for the row in the table;
                what a person DOES is check whether someone may work here —
                look at a passport, or look a visa up — and write down what
                they saw. Every button and heading is that verb now, and the
                noun only appears where the verb has already given it its
                meaning. */}
          </div>

          {current && (
            <Card>
              <div className="vm-cardhead">
                <Eyebrow>Checked {fmtDay(current.checkedOn)}</Eyebrow>
                <span className="vm-added">{checkAddedText(current)}</span>
              </div>
              {facts.length > 0 && <DetailGrid items={facts} />}
              <div className={facts.length > 0 ? "vm-divider" : "vm-divider bare"}>
                <Eyebrow>Evidence</Eyebrow>
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


          {/* WHERE THE CHECKING ACTUALLY HAPPENS, and it is not in here.
              Isaac, on the walk: "You're not actually checking it. You're just
              updating the visa. Checking it should maybe send you to the
              website where you check it."

              He is right: this window only ever FILED a result somebody got
              somewhere else. An employer checks a visa on the Home Affairs
              site (their name for it is VEVO, which is why that acronym is
              said here once and nowhere else in the app — it is what the sign
              on the door reads); a citizen or permanent resident has no visa
              to look up, so the check is sighting the passport or the
              citizenship certificate. So the panel opens on the check, and
              the scan below it files what the check said. Both links were
              read off immi.homeaffairs.gov.au, not from memory. */}
          {panelOpen && (
            <Card>
              <div className="vm-cardhead">
                <Eyebrow>{noVisaStatus ? "Sight the document" : "Look the visa up"}</Eyebrow>
              </div>
              {noVisaStatus ? (
                <p className="vm-note">
                  There is no visa to look up. The evidence is the passport or the citizenship
                  certificate itself — file it below with the date you saw it.
                </p>
              ) : (
                <>
                  <p className="vm-note">
                    Home Affairs checks visas online, on the site they call VEVO. An employer needs
                    a free organisation account.
                  </p>
                  <div className="vm-doors">
                    <a
                      className="vm-btn outline"
                      href="https://online.immi.gov.au/evo/thirdParty"
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Open the Home Affairs check
                    </a>
                    <a
                      className="vm-inline"
                      href="https://online.immi.gov.au/lusc/register"
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Register an organisation account
                    </a>
                  </div>
                </>
              )}
            </Card>
          )}

          {panelOpen && (
            <ScanCard<ReadWorkRightsResult>
              heading={scanCopy.heading}
              prompt={scanCopy.prompt}
              hint={scanCopy.hint}
              attachLabel={scanCopy.attach}
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
              <Eyebrow>Checked before</Eyebrow>
            </div>
            {history.length === 0 ? (
              <div className="vm-empty">Nothing checked before this.</div>
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
                        <span className="vm-fl">Evidence</span>
                        <DocRows docs={docs} openId={openDoc} onOpen={setOpenDoc} emptyText="No evidence filed." />
                        <div className="vm-attach">
                          <span>{checkAddedText(r) || "Filed by hand"}</span>
                          <button
                            type="button"
                            className={`vm-inline danger${armed === r.id ? " arm" : ""}`}
                            disabled={pending}
                            onClick={() => (armed === r.id ? void run(() => onRemoveCheck(r.id)) : setArmed(r.id))}
                          >
                            {armed === r.id ? "Click again to remove" : "Remove this check"}
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
                <Eyebrow>Other documents</Eyebrow>
                <span className="vm-caption">Not filed under a check</span>
              </div>
              <DocRows docs={loose} openId={openDoc} onOpen={setOpenDoc} />
            </Card>
          )}
        </div>

        <div className="fl-foot bar spread">
          {/* left, as "Edit details" sits on the licence modal's footer */}
          {recorded && !panelOpen ? (
            <Btn kind="outline" onClick={() => setPanelOpen(true)} icon="shield">
              Check it again
            </Btn>
          ) : (
            <span />
          )}
          <span className="fl-footright">
            <Btn kind="outline" onClick={onClose}>
              Close
            </Btn>
            {showFields && (
              <Btn kind="primary" onClick={save} disabled={!canSave}>
                {pending ? "Saving…" : "Save what you found"}
              </Btn>
            )}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
