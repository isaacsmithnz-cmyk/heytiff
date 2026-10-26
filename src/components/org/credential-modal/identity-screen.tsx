"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/parts/dialog";
import { Button } from "@/components/parts/button";
import { Field, TextInput } from "@/components/parts/field";
import { Tray } from "@/components/parts/tabs";
import { ColourDiscs, DateIn, FrameFoot } from "@/components/record-modal/parts";
import { ScanCard, type ScanMode } from "@/components/record-modal/scan-card";
import { readOrgCredentialDocument, type ReadOrgCredResult } from "@/app/actions/org-credential-ai";
import {
  ORG_CRED_TYPES,
  defaultColorFor,
  type OrgCredKind,
  type OrgCredentialInput,
} from "@/lib/org/credentials";
import { CREDENTIAL_DOC_KIND, type CredentialRecordInput } from "@/lib/org/credential-records";
import { KIND_LABEL, SCAN_COPY, TermFields, emptyTerm, termInput, type Term } from "./term-fields";

/* WHAT THE CARD IS — its name, its kind and the colour it wears.

   Two jobs in one screen, because they are the same conversation at different
   moments. ADDING answers "what is this" and THEN offers the scan: drop the
   certificate in, Tiff reads the term off it, and one Save writes both the
   card and its first term — the same two-in-one the fleet's Add vehicle makes
   from a rego certificate. EDITING an existing card shows only the identity,
   because by then the numbers and dates belong to the terms and are changed by
   recording a renewal, not by retyping them here.

   THE TYPE IS ASKED BEFORE THE SCANNER, and that ordering is load-bearing.
   The scan panel is not neutral: it picks the reader Tiff uses, the words on
   the drop zone, and the kind the uploaded file is stamped with — all from
   whatever Type says at that instant. Scanner-first meant a person met a panel
   headed "SCAN THE LICENCE CERTIFICATE" before anyone had asked what they were
   holding, and the default answered for them. Isaac's icare certificate of
   currency went in that way on 2026-09-08: read by the licence reader, so
   "Cover" came out as the industry classification "423300 Air Conditioning and
   Heating Services", and stamped `org_licence`, so the card it created could
   not adopt it. Two boxes and one plain question, first, and none of that
   happens.

   THE NAME IS NEVER SCANNED (see lib/org/cred-readers.ts): it is the person's
   word for the thing, it is what the history hangs off, and one badly-worded
   certificate must not be able to split a policy's history in two. */

/* The colours a card may wear are the record window's (RECORD_COLOURS):
   the palette's bright values, never red or blue. A card's colour says what
   the thing IS and its state word says how it is DOING, so no state colour
   is offered. */

export type IdentityDraft = {
  identity: OrgCredentialInput;
  /** Present when adding and the scan panel was used — a term only if it
      carries an expiry; the action sorts out which (splitAddScan). */
  term?: CredentialRecordInput;
};

export function IdentityScreen({
  credential,
  hasTerms,
  today,
  pending,
  onSave,
  onDelete,
  onBack,
  onClose,
}: {
  /** null = adding a new card. */
  credential: {
    kind: OrgCredKind;
    name: string;
    number: string | null;
    issuer: string | null;
    expiryDate: string | null;
    color: string | null;
  } | null;
  /** Terms exist, so number/issuer/expiry are derived and not offered here. */
  hasTerms: boolean;
  today: string;
  pending: boolean;
  onSave: (draft: IdentityDraft) => void;
  onDelete?: () => void;
  /** Back to the card's record, when editing one. */
  onBack?: () => void;
  onClose: () => void;
}) {
  const adding = credential === null;
  const [kind, setKind] = useState<OrgCredKind>(credential?.kind ?? "licence");
  const [name, setName] = useState(credential?.name ?? "");
  const [color, setColor] = useState(credential?.color ?? "");
  const [number, setNumber] = useState(credential?.number ?? "");
  const [issuer, setIssuer] = useState(credential?.issuer ?? "");
  const [expiry, setExpiry] = useState(credential?.expiryDate ?? "");
  const [asking, setAsking] = useState(false);

  /* The scan, offered only while adding. An existing card renews through the
     record panel on the screen behind this one — two doors to the same write
     would be two places to look for the history. */
  const [mode, setMode] = useState<ScanMode>("idle");
  const [term, setTerm] = useState<Term>(emptyTerm);
  const [docId, setDocId] = useState<string | null>(null);
  const scanned = mode === "scanned" || mode === "manual";

  const suggestions = ORG_CRED_TYPES.filter((t) => t.kind === kind);
  const canSave = name.trim().length > 0 && !pending;

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
    const identity: OrgCredentialInput = {
      kind,
      name,
      color: color || defaultColorFor(kind, name),
      // typed here only while there is no term to own them
      ...(hasTerms ? {} : { number, issuer, expiryDate: expiry }),
    };
    /* WHATEVER THE SCAN PANEL HOLDS GOES WITH THE SAVE, expiry or not. It used
       to go only with an expiry, and a licence with no renewal date lost the
       certificate it had already uploaded and the number and issuer read off
       it. The action decides what it is: the first term when it has an expiry,
       the card's own details and document when it hasn't (splitAddScan, in
       lib/org/credential-records.ts). */
    const carry = adding && scanned;
    onSave({
      identity,
      term: carry ? { ...termInput(term), documentId: docId, source: mode === "scanned" ? "scan" : "manual" } : undefined,
    });
  };

  return (
    <>
      <div className="mk-records-grid mk-records-grid--2">
        {/* Its own row above the boxes, because it is not one more field: it
            chooses the reader, the words and the filing kind for everything
            under it. */}
        <div className="pt-field mk-records-wide">
          <span className="pt-field-label">Type</span>
          <Tray<OrgCredKind>
            options={[
              { value: "licence", label: "Licence" },
              { value: "insurance", label: "Insurance" },
            ]}
            value={kind}
            onChange={setKind}
            ariaLabel="Type"
          />
        </div>

        <Field label="Name" className="mk-records-wide">
          <TextInput
            list="oc-names"
            placeholder={kind === "insurance" ? "Public liability" : "Contractor licence"}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <datalist id="oc-names">
          {suggestions.map((t) => (
            <option key={t.name} value={t.name} />
          ))}
        </datalist>

        {/* NOT WHILE ADDING, AT ALL. This screen's headline act is "scan the
            certificate", and the number and the issuer are the two things the
            scan is about to hand over. They belong to a TERM, and the scan
            below asks for them there.

            They survive on the EDIT screen for the one card that can hold no
            term: a licence with no renewal date, whose `expires_on` cannot be
            null, so its number and issuer have nowhere else to live. Once a
            term exists they go for good. */}
        {!adding && !hasTerms && !scanned && (
          <>
            <Field label={kind === "insurance" ? "Policy no." : "Licence no."}>
              <TextInput aria-label="Number" value={number} onChange={(e) => setNumber(e.target.value)} />
            </Field>
            <Field label={kind === "insurance" ? "Insurer" : "Issued by"}>
              <TextInput aria-label="Issuer" placeholder={kind === "insurance" ? "QBE" : "VBA"} value={issuer} onChange={(e) => setIssuer(e.target.value)} />
            </Field>
            <DateIn label="Expiry" today={today} value={expiry} onChange={setExpiry} />
          </>
        )}
      </div>

      {adding && (
        <ScanCard<ReadOrgCredResult>
          heading={`Scan the ${KIND_LABEL[kind].toLowerCase()}`}
          prompt={SCAN_COPY[kind].prompt}
          paper={SCAN_COPY[kind].paper}
          attachLabel={SCAN_COPY[kind].attach}
          docKind={CREDENTIAL_DOC_KIND[kind]}
          read={(b64, mt) => readOrgCredentialDocument(b64, mt, kind, name)}
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
          <TermFields kind={kind} name={name} value={term} onChange={setTerm} today={today} />
        </ScanCard>
      )}

      {/* LAST: it is the only cosmetic choice on the screen, and it must not
          stand between a person and the certificate they came to file. */}
      <ColourDiscs value={color} onChange={setColor} />

      <FrameFoot>
        {onDelete && (
          <>
            <Button kind="delete" disabled={pending} onClick={() => setAsking(true)}>
              Delete card
            </Button>
            <span className="mk-gap" />
          </>
        )}
        <Button kind="quiet" onClick={onBack ?? onClose}>
          {onBack ? "Back" : "Cancel"}
        </Button>
        <Button kind="main" onClick={save} disabled={!canSave}>
          {pending ? "Saving the card" : adding ? "Add card" : "Save details"}
        </Button>
      </FrameFoot>
      {onDelete && (
        <ConfirmDialog
          open={asking}
          heading={`Delete ${credential?.name || "this card"}?`}
          confirm="Delete card"
          onConfirm={() => {
            setAsking(false);
            onDelete();
          }}
          onClose={() => setAsking(false)}
        >
          <p>It comes off the organisation&apos;s papers, with its history and every document filed under it. There is no undo.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
