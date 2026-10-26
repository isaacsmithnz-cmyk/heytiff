"use client";

import { useState } from "react";
import { FrameTitle, RecordError, RecordFrame } from "@/components/record-modal/parts";
import { scanInProgress } from "@/components/record-modal/scan-card";
import type { StoredDocument } from "@/lib/documents/query";
import type { StaffLicence } from "@/lib/staff/types";
import type { LicenceScanDetails, LicenceTermInput, StaffLicenceRecord } from "@/lib/staff/licence-records";
import { withCleanup } from "@/lib/ui/with-cleanup";
import type { LicenceInput, SaveResult } from "../types";
import { IdentityScreen, type IdentityDraft } from "./identity-screen";
import { RecordScreen } from "./record-screen";

/* The licence modal: one modal, two screens, one `screen` value.

   It replaces NOTHING, which is the point. A staff ticket had an inline
   add-form and an × to delete, and no detail view at all — so recording a
   renewal meant deleting the licence and adding it back, and the term before
   it went with it. There was no answer to "was this person ticketed on the day
   of that job", which is the question that actually gets asked.

   It wears the record window (record-modal/parts, the old-modals mock of
   27 October 2026), as the vehicle's records and the organisation's papers
   do: one Dialog, a status line, groups under a hairline. Deliberately
   literal — a manager who has recorded a rego renewal and a public liability
   renewal already knows how to record an ARC ticket.

   Nothing is fetched here. The Compliance card hands down everything the
   licence owns and every write is one of its bound actions — which is where
   self and admin diverge, and the only place they do. */

export type Screen = "record" | "details";

export function LicenceModal({
  licence,
  staffId,
  records,
  documents,
  today,
  warnDays,
  onAdd,
  onSaveIdentity,
  onDelete,
  onRecord,
  onAttach,
  onRemoveTerm,
  onClose,
}: {
  /** null = adding a new ticket; the modal opens on the details screen. */
  licence: StaffLicence | null;
  staffId: string;
  records: StaffLicenceRecord[];
  documents: StoredDocument[];
  today: string;
  warnDays: number;
  onAdd: (input: LicenceInput, term?: LicenceTermInput) => Promise<SaveResult>;
  onSaveIdentity: (input: LicenceInput) => Promise<SaveResult>;
  onDelete: () => Promise<SaveResult>;
  onRecord: (input: LicenceTermInput) => Promise<SaveResult>;
  /** Files a document against the ticket; a null term means the card itself. */
  onAttach: (termId: string | null, documentId: string, details?: LicenceScanDetails) => Promise<SaveResult>;
  onRemoveTerm: (termId: string) => Promise<SaveResult>;
  onClose: () => void;
}) {
  const adding = licence === null;
  const [screen, setScreen] = useState<Screen>(adding ? "details" : "record");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Escape and the scrim leave the way Back does: the details screen of an
     existing ticket goes home, everything else closes. While a scan is in
     progress they do nothing — see scanInProgress. */
  const softClose = () => {
    if (scanInProgress()) return;
    if (screen === "details" && !adding) setScreen("record");
    else onClose();
  };

  /* ONE PLACE THAT RUNS A WRITE, so every refusal lands in the same banner and
     the busy state can never be left on by a path that forgot to clear it. */
  const run = async (fn: () => Promise<SaveResult>, after?: () => void) => {
    setPending(true);
    setError(null);
    await withCleanup(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (after) after();
      else onClose();
    }, () => setPending(false));
  };

  const saveIdentity = (draft: IdentityDraft) =>
    adding
      ? run(() => onAdd(draft.identity, draft.term))
      : run(() => onSaveIdentity(draft.identity), () => setScreen("record"));

  const onDetails = screen === "details" || !licence;
  return (
    <RecordFrame width={onDetails ? 560 : 720} onClose={softClose}>
      <FrameTitle>{adding ? "Add a licence or ticket" : onDetails ? "Licence details" : licence.typeName}</FrameTitle>
      {onDetails ? (
        <>
          {error && <RecordError>{error}</RecordError>}
          <IdentityScreen
            licence={licence}
            staffId={staffId}
            hasTerms={records.length > 0}
            today={today}
            pending={pending}
            onSave={saveIdentity}
            onDelete={licence ? () => void run(onDelete) : undefined}
            onBack={adding ? undefined : () => setScreen("record")}
            onClose={onClose}
          />
        </>
      ) : (
        <RecordScreen
          licence={licence}
          staffId={staffId}
          records={records}
          documents={documents}
          today={today}
          warnDays={warnDays}
          pending={pending}
          error={error}
          onRecord={(input) => void run(() => onRecord(input), () => undefined)}
          onAttach={(termId, documentId) => void run(() => onAttach(termId, documentId), () => undefined)}
          onFile={(documentId, details, after) => void run(() => onAttach(null, documentId, details), after)}
          onRemoveTerm={(termId) => void run(() => onRemoveTerm(termId), () => undefined)}
          onEdit={() => {
            setError(null);
            setScreen("details");
          }}
          onClose={onClose}
        />
      )}
    </RecordFrame>
  );
}
