"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import type { StoredDocument } from "@/lib/documents/query";
import { fmtDay } from "@/lib/format/day";
import { REMINDER_LEADS, leadLabel } from "@/lib/fleet/reminders";
import { Btn, Card, DetailGrid, Eyebrow, type DetailItem } from "@/components/record-modal/parts";
import { AddDocument } from "@/components/record-modal/add-document";
import { DocRows } from "@/components/record-modal/doc-rows";
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
  type OrgCredentialRecord,
} from "@/lib/org/credential-records";

/* ONE CARD'S TERMS — the screen the whole rebuild is for.

   It is the fleet's renewal screen, one level up and with the vocabulary
   changed: a status, the term in force with its paperwork, the reminders each
   person set for themselves, and the history underneath. Nothing is
   overwritten — a new term is a new row, and the card's expiry follows the
   newest one.

   WHAT THIS SCREEN NO LONGER DOES is file the next term. That unrolled here as
   a panel below the history, off the bottom of a long modal; it is its own
   screen now (update-screen.tsx), reached by the one button in the status
   card. */

const CURRENT_LABEL: Record<OrgCredKind, string> = {
  insurance: "CURRENT POLICY",
  licence: "CURRENT LICENCE",
};
const HISTORY_LABEL: Record<OrgCredKind, string> = {
  insurance: "POLICY HISTORY",
  licence: "LICENCE HISTORY",
};
/* ONE VERB, BOTH STATES. "Record renewal" was wrong the first time anything
   was filed — nothing had renewed — and wrong again when a broker reissues a
   certificate mid-term. Updating is what the person is doing either way. */
const UPDATE_LABEL: Record<OrgCredKind, string> = {
  insurance: "Update policy",
  licence: "Update licence",
};

export function RecordScreen({
  credential,
  records,
  documents,
  reminders,
  today,
  warnDays,
  pending,
  error,
  onAttach,
  onRemoveTerm,
  onRemind,
  onUpdate,
  onEdit,
  onClose,
}: {
  credential: OrgCredential;
  records: OrgCredentialRecord[];
  documents: StoredDocument[];
  /** The leads the viewer has switched on, in days. */
  reminders: number[];
  today: string;
  /** The org's expiry window — lib/expiry.ts. */
  warnDays: number;
  pending: boolean;
  error: string | null;
  /** Files a document against the card; a null term means the card itself. */
  onAttach: (recordId: string | null, documentId: string) => void;
  onRemoveTerm: (recordId: string) => void;
  onRemind: (leadDays: number, on: boolean) => void;
  onUpdate: () => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const kind = credential.kind;
  const current = currentRecord(records);
  const history = previousRecords(records);
  const expiry = current?.expiresOn ?? credential.expiryDate;
  const days = credentialDays(expiry, today);
  const state = credentialState(expiry, today, warnDays);
  const recorded = current !== null;

  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const [openHist, setOpenHist] = useState<string | null>(null);
  const [armedTerm, setArmedTerm] = useState<string | null>(null);

  const headline = credentialHeadline(kind, expiry, today, warnDays);
  const subline = !recorded
    ? credential.expiryDate
      ? `Expires ${fmtDay(credential.expiryDate)} — nothing filed against it yet`
      : "Nothing filed against this card yet"
    : [
        current?.issuer,
        current?.number ? `No. ${current.number}` : null,
        expiry ? `expires ${fmtDay(expiry)}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || credentialStatusText(days);
  const tone = state === "none" ? "neutral" : state;

  const facts: DetailItem[] = current ? recordFacts(kind, current, state, credential.name) : [];
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
          <div className="vm-statusr">
            <RemindMenu reminders={reminders} expiry={expiry} pending={pending} onRemind={onRemind} />
            <Btn kind="primary" onClick={onUpdate}>
              {UPDATE_LABEL[kind]}
            </Btn>
          </div>
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
              <AddDocument docKind={CREDENTIAL_DOC_KIND[kind]} onAdded={(id) => onAttach(current.id, id)} />
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

        {/* THE CARD'S OWN PAPERWORK, when it has no term to file it under.

            A term is a PERIOD and expires_on is NOT NULL, so a licence with no
            renewal date on it can hold no term at all — and a certificate is
            exactly the thing a person opens that card to keep. */}
        {!current && (
          <Card>
            <div className="vm-cardhead">
              <Eyebrow>DOCUMENTS</Eyebrow>
              <AddDocument docKind={CREDENTIAL_DOC_KIND[kind]} onAdded={(id) => onAttach(null, id)} />
            </div>
            <DocRows
              docs={loose}
              openId={openDoc}
              onOpen={setOpenDoc}
              emptyText="No paperwork filed against this card yet."
            />
          </Card>
        )}

        {/* ONLY WHEN THERE IS ONE. A card holding its first term was showing a
            full-width panel headed POLICY HISTORY whose only content was the
            sentence "No previous policy terms recorded" — a heading, a border
            and a shadow spent on the absence of a thing. The history appears
            the moment there is history, which is also the moment it means
            something. */}
        {history.length > 0 && (
          <Card className="vm-histcard">
            <div className="vm-cardhead">
              <Eyebrow>{HISTORY_LABEL[kind]}</Eyebrow>
            </div>
            {history.map((r) => {
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
                        <DetailGrid dense items={recordFacts(kind, r, "ok", credential.name)} />
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
            })}
          </Card>
        )}

        {/* Paperwork that belongs to the card but sits under no term — filed
            before the first term was recorded, or attached to the card itself.
            It would otherwise be invisible, which is the one thing a document
            store must never be. */}
        {current && loose.length > 0 && (
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
        <Btn kind="outline" onClick={onClose}>
          Close
        </Btn>
      </div>
    </>
  );
}

/* REMINDERS, FOLDED INTO A MENU.

   Four chips, a heading, a caption and two lines of explanation used a whole
   card near the bottom of the screen to hold what is, on most cards, one
   switched-on lead. It is a menu on the status card now, beside the one button
   that matters, and its label carries the answer — "Remind me" when none is
   set, the lead itself when one is, a count when there are several — so the
   state is legible without opening anything.

   The leads are not exclusive, so these are checkboxes and the menu stays open
   as they are pressed. It closes on Escape or on a click outside it, which is
   the same contract every other `.vm-menu` in this codebase keeps. */
function RemindMenu({
  reminders,
  expiry,
  pending,
  onRemind,
}: {
  reminders: number[];
  expiry: string | null;
  pending: boolean;
  onRemind: (leadDays: number, on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      /* Stops at this menu rather than reaching the modal's own Escape
         handler, which would close the whole card behind it. */
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);

  const on = REMINDER_LEADS.filter((l) => reminders.includes(l));
  const label =
    on.length === 0 ? "Remind me" : on.length === 1 ? leadLabel(on[0]) : `${on.length} reminders`;

  return (
    <div className="vm-menuwrap" ref={wrap}>
      <button
        type="button"
        className={`vm-remind${on.length ? " on" : ""}`}
        aria-haspopup="true"
        aria-expanded={open}
        disabled={!expiry}
        title={expiry ? undefined : "Record a term first — a reminder counts down to an expiry"}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="bell" size={14} />
        {label}
        <Icon name={open ? "chevU" : "chevD"} size={12} />
      </button>
      {open && (
        <div className="vm-menu" role="menu" aria-label="Remind me">
          {REMINDER_LEADS.map((lead) => {
            const set = reminders.includes(lead);
            return (
              <button
                key={lead}
                type="button"
                role="menuitemcheckbox"
                aria-checked={set}
                className={set ? "on" : undefined}
                disabled={pending}
                onClick={() => onRemind(lead, !set)}
              >
                <Icon name={set ? "check" : "circle"} size={14} />
                {leadLabel(lead)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
