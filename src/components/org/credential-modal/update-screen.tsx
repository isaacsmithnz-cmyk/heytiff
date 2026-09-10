"use client";

import { useState } from "react";
import { readOrgCredentialDocument, type ReadOrgCredResult } from "@/app/actions/org-credential-ai";
import { Btn } from "@/components/record-modal/parts";
import { fmtDay } from "@/lib/format/day";
import { ScanCard, type ScanMode } from "@/components/record-modal/scan-card";
import type { OrgCredential } from "@/lib/org/credentials";
import {
  CREDENTIAL_DOC_KIND,
  currentRecord,
  type CredentialRecordInput,
  type OrgCredentialRecord,
} from "@/lib/org/credential-records";
import { SCAN_COPY, TermFields, emptyTerm, termInput, type Term } from "./term-fields";

/* FILING THE NEXT TERM — a screen, not a panel that unrolls at the bottom.

   It used to be the last card in a long scroll: press "Record renewal" and a
   scan panel appeared below the history, off the bottom of the modal, with no
   sign anything had happened. Isaac's words were "a bit hard to miss". The
   fix is not a louder panel; it is that filing a certificate is a JOB, and a
   job gets the screen to itself — the same bargain "Card details" already
   makes behind the back chevron.

   A screen rather than a second modal on top of the first: this one is already
   portalled to <body> because the shell's `will-change` makes `.page.in` a
   containing block for position:fixed (see index.tsx), and stacking a second
   portal over it buys nothing a swap doesn't already give — the panel takes
   the whole surface either way, and Escape has one meaning instead of two.

   THE WORD IS "UPDATE", NOT "RENEWAL". Nothing has renewed the first time you
   file a certificate, and nothing has renewed when a broker reissues one
   mid-term with a corrected address. Updating is what the person is doing;
   keeping the one before is what the screen does about it. */

export function UpdateScreen({
  credential,
  records,
  today,
  pending,
  error,
  onRecord,
  onFile,
  onCancel,
}: {
  credential: OrgCredential;
  records: OrgCredentialRecord[];
  today: string;
  pending: boolean;
  error: string | null;
  onRecord: (input: CredentialRecordInput) => void;
  /** Files a scan that carries no expiry against the card itself. */
  onFile: (documentId: string) => void;
  onCancel: () => void;
}) {
  const kind = credential.kind;
  const current = currentRecord(records);

  const [mode, setMode] = useState<ScanMode>("idle");
  const [term, setTerm] = useState<Term>(emptyTerm);
  const [docId, setDocId] = useState<string | null>(null);

  const showFields = mode === "scanned" || mode === "manual";
  /* WHAT THE PRIMARY BUTTON DOES follows what the panel is holding.

     With an expiry it saves a term, as it always has. WITHOUT ONE it files the
     certificate against the card and says so. A licence with no renewal date
     can never have a term (expires_on is NOT NULL), so this was a "Save
     licence" that could not be pressed, and the file the panel had already
     uploaded was dropped, owned by nothing, the moment the person gave up. */
  const hasExpiry = term.expiresOn.trim().length > 0;
  const filingOnly = !hasExpiry && docId !== null;
  const canSave = (hasExpiry || filingOnly) && !pending;

  const fill = (r: ReadOrgCredResult) => {
    if (!r.ok) return;
    setTerm((p) => ({
      issuer: r.issuer ?? p.issuer,
      number: r.number ?? p.number,
      cover: r.cover ?? p.cover,
      sumInsured: r.sumInsured != null ? String(r.sumInsured) : p.sumInsured,
      premium: r.premium != null ? String(r.premium) : p.premium,
      excess: r.excess != null ? String(r.excess) : p.excess,
      workersCount: r.workersCount != null ? String(r.workersCount) : p.workersCount,
      wages: r.wages != null ? String(r.wages) : p.wages,
      startsOn: r.startsOn ?? p.startsOn,
      expiresOn: r.expiresOn ?? p.expiresOn,
    }));
  };

  const save = () => {
    if (!canSave) return;
    // it lands the way a term does: back on the card — see index.tsx
    if (filingOnly && docId) {
      onFile(docId);
      return;
    }
    onRecord({
      ...termInput(term),
      documentId: docId,
      source: mode === "scanned" ? "scan" : "manual",
    });
  };

  return (
    <>
      <div className="vm-body">
        {error && <div className="vm-err">{error}</div>}

        <ScanCard<ReadOrgCredResult>
          heading={kind === "insurance" ? "THE NEW CERTIFICATE" : "THE NEW LICENCE"}
          prompt={SCAN_COPY[kind].prompt}
          hint={SCAN_COPY[kind].hint}
          attachLabel={SCAN_COPY[kind].attach}
          docKind={CREDENTIAL_DOC_KIND[kind]}
          read={(b64, mt) => readOrgCredentialDocument(b64, mt, kind, credential.name)}
          onRead={(r, id) => {
            fill(r);
            setDocId(id);
          }}
          onAttached={(id) => setDocId(id)}
          mode={mode}
          onMode={(m) => {
            setMode(m);
            if (m === "idle") {
              setTerm(emptyTerm);
              setDocId(null);
            }
          }}
        >
          <TermFields kind={kind} name={credential.name} value={term} onChange={setTerm} today={today} />
        </ScanCard>
      </div>

      <div className="vm-foot">
        {/* What happens to the one it replaces, said where the decision is made
            rather than as a caption on a screen nobody is reading yet. It only
            appears when there IS one to keep — and never while the button is
            filing a document, because then nothing moves into the history. */}
        {current && !filingOnly && (
          <span className="vm-footnote">
            The term expiring {fmtDay(current.expiresOn)} moves into the history.
          </span>
        )}
        <Btn kind="outline" onClick={onCancel}>
          Cancel
        </Btn>
        {showFields && (
          <Btn kind="primary" onClick={save} disabled={!canSave}>
            {pending
              ? "Saving…"
              : filingOnly
                ? "File the document"
                : kind === "insurance"
                  ? "Save policy"
                  : "Save licence"}
          </Btn>
        )}
      </div>
    </>
  );
}
