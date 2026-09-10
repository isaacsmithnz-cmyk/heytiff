"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import { IconBtn } from "@/components/record-modal/parts";
import type { StoredDocument } from "@/lib/documents/query";
import { credBadgeCode } from "@/lib/staff/licence";
import type { StaffLicence } from "@/lib/staff/types";
import type { LicenceTermInput, StaffLicenceRecord } from "@/lib/staff/licence-records";
import type { LicenceInput, SaveResult } from "../types";
import { IdentityScreen, type IdentityDraft } from "./identity-screen";
import { RecordScreen } from "./record-screen";

/* The licence modal: one modal, two screens, one `screen` value.

   It replaces NOTHING, which is the point. A staff ticket had an inline
   add-form and an × to delete, and no detail view at all — so recording a
   renewal meant deleting the licence and adding it back, and the term before
   it went with it. There was no answer to "was this person ticketed on the day
   of that job", which is the question that actually gets asked.

   It wears the vehicle card's clothes, through the organisation's credential
   modal: the `.vm` shell, its cards, its detail grids, its scan panel, its
   remind-me chips. Deliberately literal — a manager who has recorded a rego
   renewal and a public liability renewal already knows how to record an ARC
   ticket.

   PORTALLED TO <body>, and that is not a preference: the shell keeps
   `will-change` on `.page.in`, which makes it a containing block for
   position:fixed, so a modal rendered inside the page would anchor to the page
   and land halfway down the scroll.

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
  onAttach: (termId: string | null, documentId: string) => Promise<SaveResult>;
  onRemoveTerm: (termId: string) => Promise<SaveResult>;
  onClose: () => void;
}) {
  const adding = licence === null;
  const [screen, setScreen] = useState<Screen>(adding ? "details" : "record");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Escape leaves the way the back chevron does: the details screen of an
     existing ticket goes home, everything else closes. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (screen === "details" && !adding) setScreen("record");
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [screen, adding, onClose]);

  /* ONE PLACE THAT RUNS A WRITE, so every refusal lands in the same banner and
     the busy state can never be left on by a path that forgot to clear it. */
  const run = async (fn: () => Promise<SaveResult>, after?: () => void) => {
    setPending(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (after) after();
      else onClose();
    } finally {
      setPending(false);
    }
  };

  const saveIdentity = (draft: IdentityDraft) =>
    adding
      ? run(() => onAdd(draft.identity, draft.term))
      : run(() => onSaveIdentity(draft.identity), () => setScreen("record"));

  const badge = licence ? credBadgeCode(licence.typeName) : null;

  return createPortal(
    <div className="vm-ov" onClick={onClose}>
      <div
        className="vm"
        role="dialog"
        aria-modal="true"
        aria-label={adding ? "Add a licence or ticket" : licence.typeName}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="vm-head sub">
          <div className="vm-headl">
            {screen === "details" && !adding ? (
              <IconBtn icon="chevL" label="Back" onClick={() => setScreen("record")} size={18} />
            ) : null}
            <div className="vm-titles">
              <span className="vm-eyebrow">{adding ? "COMPLIANCE" : "LICENCE OR TICKET"}</span>
              <h2 className="vm-title sub">
                {screen === "details" && !adding ? "Licence details" : adding ? "Add a licence or ticket" : licence.typeName}
              </h2>
            </div>
          </div>
          <div className="vm-headr">
            {badge && (
              <span className="vm-badge" style={{ background: `${badge.color}18`, color: badge.color }}>
                {badge.code}
              </span>
            )}
            <button type="button" className="vm-iconbtn" aria-label="Close" onClick={onClose}>
              <Icon name="x" size={18} />
            </button>
          </div>
        </div>

        {screen === "details" || !licence ? (
          <>
            {error && (
              <div className="vm-body">
                <div className="vm-err">{error}</div>
              </div>
            )}
            <IdentityScreen
              licence={licence}
              staffId={staffId}
              hasTerms={records.length > 0}
              today={today}
              pending={pending}
              onSave={saveIdentity}
              onDelete={licence ? () => void run(onDelete) : undefined}
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
            onFile={(documentId, after) => void run(() => onAttach(null, documentId), after)}
            onRemoveTerm={(termId) => void run(() => onRemoveTerm(termId), () => undefined)}
            onEdit={() => {
              setError(null);
              setScreen("details");
            }}
            onClose={onClose}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
