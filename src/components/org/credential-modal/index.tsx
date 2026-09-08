"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import { IconBtn } from "@/components/record-modal/parts";
import type { StoredDocument } from "@/lib/documents/query";
import {
  orgCredBadge,
  type OrgCredential,
  type OrgCredentialInput,
} from "@/lib/org/credentials";
import type {
  CredentialRecordInput,
  OrgCredentialRecord,
} from "@/lib/org/credential-records";
import type { CredResult } from "../types";
import { IdentityScreen, type IdentityDraft } from "./identity-screen";
import { RecordScreen } from "./record-screen";

/* The credential modal: one modal, two screens, one `screen` value.

   It replaces the flat six-field form that WAS the whole feature. That form
   could only ever describe the term the business is in right now, and saving a
   renewal into it destroyed the one before — so there was no answer to "what
   have we paid for public liability since 2022" and no way to prove cover on
   the day of a job three years ago.

   Now the card is an identity and its terms are a history, and the modal wears
   the vehicle card's own clothes: the `.vm` shell, its cards, its detail
   grids, its scan panel, its remind-me chips. Deliberately literal — an owner
   who has recorded a rego renewal already knows how to record a policy.

   PORTALLED TO <body>, and that is not a preference: the shell keeps
   `will-change` on `.page.in`, which makes it a containing block for
   position:fixed, so a modal rendered inside the page would anchor to the page
   and land halfway down the scroll.

   Nothing is fetched here. The screen hands down everything the credential
   owns and every write is one of its actions followed by router.refresh(),
   the same as the fleet and the same as everywhere else. */

export type Screen = "record" | "details";

export function CredentialModal({
  credential,
  records,
  documents,
  reminders,
  today,
  initialScreen,
  onAdd,
  onSaveIdentity,
  onDelete,
  onRecord,
  onAttach,
  onRemoveTerm,
  onRemind,
  onClose,
}: {
  /** null = adding a new card; the modal opens on the details screen. */
  credential: OrgCredential | null;
  records: OrgCredentialRecord[];
  documents: StoredDocument[];
  reminders: number[];
  today: string;
  initialScreen?: Screen;
  onAdd: (input: OrgCredentialInput, term?: CredentialRecordInput) => Promise<CredResult>;
  onSaveIdentity: (input: OrgCredentialInput) => Promise<CredResult>;
  onDelete: () => Promise<CredResult>;
  onRecord: (input: CredentialRecordInput) => Promise<CredResult>;
  onAttach: (recordId: string, documentId: string) => Promise<CredResult>;
  onRemoveTerm: (recordId: string) => Promise<CredResult>;
  onRemind: (leadDays: number, on: boolean) => Promise<CredResult>;
  onClose: () => void;
}) {
  const adding = credential === null;
  const [screen, setScreen] = useState<Screen>(initialScreen ?? (adding ? "details" : "record"));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Escape leaves the way the back chevron does: the details screen of an
     existing card goes home, everything else closes. Never a surprise
     dismissal mid-form. */
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
  const run = async (fn: () => Promise<CredResult>, after?: () => void) => {
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

  const badge = credential ? orgCredBadge(credential) : null;
  const title = adding ? "Add licence or insurance" : credential.name;
  const eyebrow = adding
    ? "LICENCES & INSURANCE"
    : credential.kind === "insurance"
      ? "INSURANCE POLICY"
      : "BUSINESS LICENCE";

  return createPortal(
    <div className="vm-ov" onClick={onClose}>
      <div
        className="vm"
        role="dialog"
        aria-modal="true"
        aria-label={adding ? "Add licence or insurance" : credential.name}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="vm-head sub">
          <div className="vm-headl">
            {screen === "details" && !adding ? (
              <IconBtn icon="chevL" label="Back" onClick={() => setScreen("record")} size={18} />
            ) : null}
            <div className="vm-titles">
              <span className="vm-eyebrow">{eyebrow}</span>
              <h2 className="vm-title sub">{screen === "details" && !adding ? "Card details" : title}</h2>
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

        {screen === "details" || !credential ? (
          <>
            {error && (
              <div className="vm-body">
                <div className="vm-err">{error}</div>
              </div>
            )}
            <IdentityScreen
              credential={credential}
              hasTerms={records.length > 0}
              today={today}
              pending={pending}
              onSave={saveIdentity}
              onDelete={credential ? () => void run(onDelete) : undefined}
            />
          </>
        ) : (
          <RecordScreen
            credential={credential}
            records={records}
            documents={documents}
            reminders={reminders}
            today={today}
            pending={pending}
            error={error}
            onRecord={(input) => void run(() => onRecord(input), () => undefined)}
            onAttach={(recordId, documentId) => void run(() => onAttach(recordId, documentId), () => undefined)}
            onRemoveTerm={(recordId) => void run(() => onRemoveTerm(recordId), () => undefined)}
            onRemind={(lead, on) => void run(() => onRemind(lead, on), () => undefined)}
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
