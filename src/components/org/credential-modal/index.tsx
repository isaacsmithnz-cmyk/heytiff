"use client";

import { useState } from "react";
import { FrameTitle, RecordError, RecordFrame } from "@/components/record-modal/parts";
import { scanInProgress } from "@/components/record-modal/scan-card";
import type { StoredDocument } from "@/lib/documents/query";
import type { OrgCredential, OrgCredentialInput } from "@/lib/org/credentials";
import type {
  CredentialRecordInput,
  CredentialScanDetails,
  OrgCredentialRecord,
} from "@/lib/org/credential-records";
import { withCleanup } from "@/lib/ui/with-cleanup";
import type { CredResult } from "../types";
import { IdentityScreen, type IdentityDraft } from "./identity-screen";
import { RecordScreen } from "./record-screen";
import { UpdateScreen } from "./update-screen";

/* The credential modal: one modal, three screens, one `screen` value.

   It replaces the flat six-field form that WAS the whole feature. That form
   could only ever describe the term the business is in right now, and saving a
   renewal into it destroyed the one before — so there was no answer to "what
   have we paid for public liability since 2022" and no way to prove cover on
   the day of a job three years ago.

   Now the card is an identity and its terms are a history, and the modal wears
   the record window (record-modal/parts, the old-modals mock of 27 October
   2026), as a licence and the vehicle's records do. Deliberately literal — an
   owner who has recorded a rego renewal already knows how to update a policy.

   Nothing is fetched here. The screen hands down everything the credential
   owns and every write is one of its actions followed by router.refresh(),
   the same as the fleet and the same as everywhere else. */

/* Three, and the two that are not "record" both have Back in the foot: the
   card's own details, and filing its next term. */
export type Screen = "record" | "details" | "update";

export function CredentialModal({
  credential,
  records,
  documents,
  today,
  warnDays,
  initialScreen,
  onAdd,
  onSaveIdentity,
  onDelete,
  onRecord,
  onAttach,
  onRemoveTerm,
  onClose,
}: {
  /** null = adding a new card; the modal opens on the details screen. */
  credential: OrgCredential | null;
  records: OrgCredentialRecord[];
  documents: StoredDocument[];
  today: string;
  /** The org's expiry window — lib/expiry.ts. */
  warnDays: number;
  initialScreen?: Screen;
  onAdd: (input: OrgCredentialInput, term?: CredentialRecordInput) => Promise<CredResult>;
  onSaveIdentity: (input: OrgCredentialInput) => Promise<CredResult>;
  onDelete: () => Promise<CredResult>;
  onRecord: (input: CredentialRecordInput) => Promise<CredResult>;
  /** Files a document against the card; a null term means the card itself. */
  onAttach: (recordId: string | null, documentId: string, details?: CredentialScanDetails) => Promise<CredResult>;
  onRemoveTerm: (recordId: string) => Promise<CredResult>;
  onClose: () => void;
}) {
  const adding = credential === null;
  const [screen, setScreen] = useState<Screen>(initialScreen ?? (adding ? "details" : "record"));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Escape and the scrim leave the way Back does: a sub-screen of an
     existing card goes home, everything else closes. Never a surprise
     dismissal mid-form. While a scan is in progress they do nothing — see
     scanInProgress. */
  const softClose = () => {
    if (scanInProgress()) return;
    if (screen !== "record" && !adding) setScreen("record");
    else onClose();
  };

  /* ONE PLACE THAT RUNS A WRITE, so every refusal lands in the same banner and
     the busy state can never be left on by a path that forgot to clear it. */
  const run = async (fn: () => Promise<CredResult>, after?: () => void) => {
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

  const title = adding
    ? "Add licence or insurance"
    : screen === "details"
      ? "Card details"
      : screen === "update"
        ? credential.kind === "insurance"
          ? "Update policy"
          : "Update licence"
        : credential.name;

  return (
    <RecordFrame width={screen === "record" && !adding ? 720 : 560} onClose={softClose}>
      <FrameTitle>{title}</FrameTitle>
      {screen === "update" && credential ? (
        <UpdateScreen
          credential={credential}
          records={records}
          today={today}
          pending={pending}
          error={error}
          /* Saved, it goes back to the card it just changed rather than
             closing — the new term is the thing the person came to see. */
          onRecord={(input) => void run(() => onRecord(input), () => setScreen("record"))}
          /* A scan with no expiry is FILED rather than saved as a term, and
             lands the same way: back on the card, listed with its paperwork.
             A null record is the card's own. A refusal keeps this screen and
             its scan, so pressing again is a retry. */
          onFile={(documentId, details) => void run(() => onAttach(null, documentId, details), () => setScreen("record"))}
          onCancel={() => {
            setError(null);
            setScreen("record");
          }}
        />
      ) : screen === "details" || !credential ? (
        <>
          {error && <RecordError>{error}</RecordError>}
          <IdentityScreen
            credential={credential}
            hasTerms={records.length > 0}
            today={today}
            pending={pending}
            onSave={saveIdentity}
            onDelete={credential ? () => void run(onDelete) : undefined}
            onBack={adding ? undefined : () => setScreen("record")}
            onClose={onClose}
          />
        </>
      ) : (
        <RecordScreen
          credential={credential}
          records={records}
          documents={documents}
          today={today}
          warnDays={warnDays}
          pending={pending}
          error={error}
          onAttach={(recordId, documentId) => void run(() => onAttach(recordId, documentId), () => undefined)}
          onRemoveTerm={(recordId) => void run(() => onRemoveTerm(recordId), () => undefined)}
          onUpdate={() => {
            setError(null);
            setScreen("update");
          }}
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
