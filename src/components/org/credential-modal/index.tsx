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
import { UpdateScreen } from "./update-screen";

/* The credential modal: one modal, three screens, one `screen` value.

   It replaces the flat six-field form that WAS the whole feature. That form
   could only ever describe the term the business is in right now, and saving a
   renewal into it destroyed the one before — so there was no answer to "what
   have we paid for public liability since 2022" and no way to prove cover on
   the day of a job three years ago.

   Now the card is an identity and its terms are a history, and the modal wears
   the vehicle card's own clothes: the `.vm` shell, its cards, its detail
   grids, its scan panel, its menus. Deliberately literal — an owner who has
   recorded a rego renewal already knows how to update a policy.

   PORTALLED TO <body>, and that is not a preference: the shell keeps
   `will-change` on `.page.in`, which makes it a containing block for
   position:fixed, so a modal rendered inside the page would anchor to the page
   and land halfway down the scroll.

   Nothing is fetched here. The screen hands down everything the credential
   owns and every write is one of its actions followed by router.refresh(),
   the same as the fleet and the same as everywhere else. */

/* Three, and the two that are not "record" both wear a back chevron: the
   card's own details, and filing its next term. */
export type Screen = "record" | "details" | "update";

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
  /** Files a document against the card; a null term means the card itself. */
  onAttach: (recordId: string | null, documentId: string) => Promise<CredResult>;
  onRemoveTerm: (recordId: string) => Promise<CredResult>;
  onRemind: (leadDays: number, on: boolean) => Promise<CredResult>;
  onClose: () => void;
}) {
  const adding = credential === null;
  const [screen, setScreen] = useState<Screen>(initialScreen ?? (adding ? "details" : "record"));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Escape leaves the way the back chevron does: a sub-screen of an existing
     card goes home, everything else closes. Never a surprise dismissal
     mid-form. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (screen !== "record" && !adding) setScreen("record");
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
  const sub = screen !== "record" && !adding;
  const title = adding
    ? "Add licence or insurance"
    : screen === "details"
      ? "Card details"
      : screen === "update"
        ? credential.kind === "insurance"
          ? "Update policy"
          : "Update licence"
        : credential.name;
  const eyebrow = adding
    ? "LICENCES & INSURANCE"
    : sub
      ? credential.name.toUpperCase()
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
            {sub ? (
              <IconBtn icon="chevL" label="Back" onClick={() => setScreen("record")} size={18} />
            ) : null}
            <div className="vm-titles">
              <span className="vm-eyebrow">{eyebrow}</span>
              <h2 className="vm-title sub">{title}</h2>
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
            onCancel={() => {
              setError(null);
              setScreen("record");
            }}
          />
        ) : screen === "details" || !credential ? (
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
            onAttach={(recordId, documentId) => void run(() => onAttach(recordId, documentId), () => undefined)}
            onRemoveTerm={(recordId) => void run(() => onRemoveTerm(recordId), () => undefined)}
            onRemind={(lead, on) => void run(() => onRemind(lead, on), () => undefined)}
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
      </div>
    </div>,
    document.body,
  );
}
