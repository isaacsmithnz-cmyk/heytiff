"use client";

import { useState } from "react";
import { Button } from "@/components/parts/button";
import type { StoredDocument } from "@/lib/documents/query";
import { fmtDay } from "@/lib/format/day";
import {
  DetailGrid,
  FrameFoot,
  Group,
  HistoryRow,
  RecordError,
  RecordStatus,
  RemoveFromHistory,
  type DetailItem,
} from "@/components/record-modal/parts";
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
   changed: a status, the term in force with its paperwork, and the history
   underneath. Nothing is
   overwritten — a new term is a new row, and the card's expiry follows the
   newest one.

   WHAT THIS SCREEN NO LONGER DOES is file the next term. That unrolled here as
   a panel below the history, off the bottom of a long modal; it is its own
   screen now (update-screen.tsx), reached by the one button in the status
   card, now the foot's main button. */

const CURRENT_LABEL: Record<OrgCredKind, string> = {
  insurance: "Current policy",
  licence: "Current licence",
};
const HISTORY_LABEL: Record<OrgCredKind, string> = {
  insurance: "Policy history",
  licence: "Licence history",
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
  today,
  warnDays,
  pending,
  error,
  onAttach,
  onRemoveTerm,
  onUpdate,
  onEdit,
  onClose,
}: {
  credential: OrgCredential;
  records: OrgCredentialRecord[];
  documents: StoredDocument[];
  today: string;
  /** The org's expiry window — lib/expiry.ts. */
  warnDays: number;
  pending: boolean;
  error: string | null;
  /** Files a document against the card; a null term means the card itself. */
  onAttach: (recordId: string | null, documentId: string) => void;
  onRemoveTerm: (recordId: string) => void;
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

  const headline = credentialHeadline(kind, expiry, today, warnDays);
  const loose = looseDocuments(documents, records);
  /* With no term to describe, the line says what IS on file. It used to say
     "nothing filed" beside a certificate listed under Documents. */
  const docsText = loose.length === 1 ? "1 document" : `${loose.length} documents`;
  const noTermLine = credential.expiryDate
    ? loose.length > 0
      ? `Expires ${fmtDay(credential.expiryDate)}`
      : `Expires ${fmtDay(credential.expiryDate)}, nothing filed against it yet`
    : loose.length > 0
      ? `${docsText} filed against this card`
      : "Nothing filed against this card yet";
  /* read into a name before the `||` below: React Compiler 1.0 refuses a
     logical whose left side holds a ternary or a `?.`, and gives up on the
     whole component when it meets one */
  const termLine = [
    current?.issuer,
    current?.number ? `No. ${current.number}` : null,
    expiry ? `expires ${fmtDay(expiry)}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const subline = !recorded ? noTermLine : termLine || credentialStatusText(days);

  const facts: DetailItem[] = current ? recordFacts(kind, current, state, credential.name) : [];
  const currentDocs = current ? recordDocuments(documents, current) : [];

  return (
    <>
      {error && <RecordError>{error}</RecordError>}

      <RecordStatus state={state} word={headline} line={subline} />

      {current && (
        <Group name={CURRENT_LABEL[kind]} aside={recordAddedText(current)}>
          <DetailGrid items={facts} />
        </Group>
      )}

      {/* THE CARD'S OWN PAPERWORK sits here when it has no term to file it
          under: a licence with no renewal date can hold no term at all, and a
          certificate is exactly what a person opens that card to keep. */}
      <Group
        name="Documents"
        action={<AddDocument docKind={CREDENTIAL_DOC_KIND[kind]} onAdded={(id) => onAttach(current ? current.id : null, id)} />}
      >
        <DocRows
          docs={current ? currentDocs : loose}
          openId={openDoc}
          onOpen={(id) => {
            setOpenDoc(id);
            if (id) setOpenHist(null);
          }}
          emptyText={
            current
              ? kind === "insurance"
                ? "No paperwork filed with this policy yet."
                : "No paperwork filed with this licence yet."
              : "No paperwork filed against this card yet."
          }
        />
      </Group>

      {/* ONLY WHEN THERE IS ONE: a heading spent on the absence of a thing
          says nothing. The history appears the moment there is history. */}
      {history.length > 0 && (
        <Group name={HISTORY_LABEL[kind]}>
          {history.map((r) => {
            const expanded = openHist === r.id;
            const docs = recordDocuments(documents, r);
            return (
              <HistoryRow
                key={r.id}
                name={recordEvent(kind, r)}
                line={docs.length === 1 ? "1 document" : `${docs.length} documents`}
                aside={[r.premium != null ? fmtCredMoney(r.premium) : null, fmtDay(r.expiresOn)]}
                open={expanded}
                onToggle={() => {
                  setOpenHist(expanded ? null : r.id);
                  setOpenDoc(null);
                }}
              >
                <DetailGrid dense items={recordFacts(kind, r, "ok", credential.name)} />
                <DocRows docs={docs} openId={openDoc} onOpen={setOpenDoc} emptyText="No paperwork filed." />
                <div className="rcw-histfoot">
                  <span>{recordAddedText(r) || "Filed by hand"}</span>
                  <RemoveFromHistory
                    label="Remove from history"
                    heading={`Remove this ${kind === "insurance" ? "policy" : "licence"} from the history?`}
                    confirm={kind === "insurance" ? "Remove policy" : "Remove licence"}
                    disabled={pending}
                    onConfirm={() => onRemoveTerm(r.id)}
                  >
                    {`${recordEvent(kind, r)}, expiring ${fmtDay(r.expiresOn)}, comes out of the history. There is no undo.`}
                  </RemoveFromHistory>
                </div>
              </HistoryRow>
            );
          })}
        </Group>
      )}

      {/* Paperwork that belongs to the card but sits under no term. It would
          otherwise be invisible, which a document store must never be. */}
      {current && loose.length > 0 && (
        <Group name="Other documents">
          <DocRows docs={loose} openId={openDoc} onOpen={setOpenDoc} />
        </Group>
      )}

      <FrameFoot>
        <Button kind="second" onClick={onEdit}>
          Edit details
        </Button>
        <span className="mk-gap" />
        <Button kind="quiet" onClick={onClose}>
          Close
        </Button>
        <Button kind="main" onClick={onUpdate}>
          {UPDATE_LABEL[kind]}
        </Button>
      </FrameFoot>
    </>
  );
}
