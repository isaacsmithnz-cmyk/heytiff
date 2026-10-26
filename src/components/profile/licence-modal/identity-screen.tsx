"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/parts/dialog";
import { Button } from "@/components/parts/button";
import { Field, TextInput } from "@/components/parts/field";
import { ColourDiscs, DateIn, FrameFoot } from "@/components/record-modal/parts";
import { ScanCard, type ScanMode } from "@/components/record-modal/scan-card";
import { readStaffLicenceDocument, type ReadLicenceResult } from "@/app/actions/staff-licence-ai";
import { LICENCE_DOC_KIND, type LicenceTermInput } from "@/lib/staff/licence-records";
import { LIC_TYPES, defaultLicenceColor } from "@/lib/staff/licence";
import type { LicenceInput } from "../types";
import { SCAN_COPY, TermFields, emptyTerm, termInput, type Term } from "./term-fields";

/* WHAT THE TICKET IS — its name and the colour it wears (the old-modals
   mock's "Add a licence or ticket", 560 wide).

   Two jobs in one screen, the same way the organisation's credential modal
   splits them. ADDING starts here with the scan panel open: photograph the
   card, Tiff reads the term off it, and one Save writes both the ticket and
   the period it is currently good for. EDITING an existing ticket shows only
   the identity, because by then the number and the expiry belong to the terms
   and are changed by recording a renewal, not by retyping them here.

   THE TYPE IS NEVER SCANNED (see lib/staff/licence-readers.ts): it is the
   person's word for the thing, it is what the history hangs off, and one
   oddly-worded card must not split a ticket's history in two. */

export type IdentityDraft = { identity: LicenceInput; term?: LicenceTermInput };

export function IdentityScreen({
  licence,
  staffId,
  hasTerms,
  today,
  pending,
  onSave,
  onDelete,
  onBack,
  onClose,
}: {
  /** null = adding a new ticket. */
  licence: { typeName: string; licenceNumber: string | null; expiryDate: string | null; color: string | null } | null;
  /** Whose card this is — the scan action gates on it. */
  staffId: string;
  /** Terms exist, so number and expiry are derived and not offered here. */
  hasTerms: boolean;
  today: string;
  pending: boolean;
  onSave: (draft: IdentityDraft) => void;
  onDelete?: () => void;
  /** Back to the ticket's record, when editing one. */
  onBack?: () => void;
  onClose: () => void;
}) {
  const adding = licence === null;
  const [typeName, setTypeName] = useState(licence?.typeName ?? "");
  const [color, setColor] = useState(licence?.color ?? "");
  const [number, setNumber] = useState(licence?.licenceNumber ?? "");
  const [expiry, setExpiry] = useState(licence?.expiryDate ?? "");
  const [asking, setAsking] = useState(false);

  const [mode, setMode] = useState<ScanMode>("idle");
  const [term, setTerm] = useState<Term>(emptyTerm);
  const [docId, setDocId] = useState<string | null>(null);
  const scanned = mode === "scanned" || mode === "manual";

  const canSave = typeName.trim().length > 0 && !pending;

  const fill = (r: ReadLicenceResult) => {
    if (!r.ok) return;
    setTerm((p) => ({
      number: r.number ?? p.number,
      issuer: r.issuer ?? p.issuer,
      issuingState: r.issuingState ?? p.issuingState,
      classes: r.classes ?? p.classes,
      startsOn: r.startsOn ?? p.startsOn,
      expiresOn: r.expiresOn ?? p.expiresOn,
    }));
  };

  const save = () => {
    if (!canSave) return;
    const identity: LicenceInput = {
      typeName,
      color: color || defaultLicenceColor(typeName),
      // typed here only while there is no term to own them
      ...(hasTerms ? {} : { licenceNumber: number, expiryDate: expiry }),
    };
    /* WHATEVER THE SCAN PANEL HOLDS GOES WITH THE SAVE, expiry or not. It used
       to go only with an expiry, and a white card — which has none — lost the
       photo it had already uploaded and the number read off it. The action
       decides what it is: the first term when it has an expiry, the ticket's
       own number and photo when it hasn't (splitAddScan, in
       lib/staff/licence-records.ts). */
    const carry = adding && scanned;
    onSave({
      identity,
      term: carry
        ? { ...termInput(term), documentId: docId, source: mode === "scanned" ? "scan" : "manual" }
        : undefined,
    });
  };

  return (
    <>
      {adding && (
        <ScanCard<ReadLicenceResult>
          heading="Scan the card"
          prompt={SCAN_COPY.prompt}
          note={SCAN_COPY.note}
          paper={SCAN_COPY.paper}
          attachLabel={SCAN_COPY.attach}
          docKind={LICENCE_DOC_KIND}
          read={(b64, mt) => readStaffLicenceDocument(b64, mt, staffId)}
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
          <TermFields value={term} onChange={setTerm} today={today} />
        </ScanCard>
      )}

      <div className="mk-records-grid mk-records-grid--2">
        <Field label="Licence or ticket" className="mk-records-wide">
          <TextInput list="lic-types" placeholder="ARC licence" value={typeName} onChange={(e) => setTypeName(e.target.value)} />
        </Field>
        <datalist id="lic-types">
          {LIC_TYPES.map((t) => (
            <option key={t.name} value={t.name} />
          ))}
        </datalist>

        {/* NOT WHILE ADDING. The number is what the scan above is about to
            hand over, and the scan asks for it itself, on the term; "Enter it
            by hand" is the way in without a photo.

            It survives on the EDIT screen for a ticket with no term, like a
            white card: a term's `expires_on` cannot be null, so a ticket that
            never lapses keeps its number on itself. Once a term exists both
            go: they are a cache of the newest term, and typing over them here
            would describe a term that does not exist. */}
        {!adding && !hasTerms && (
          <>
            <Field label="Licence no.">
              <TextInput value={number} onChange={(e) => setNumber(e.target.value)} />
            </Field>
            <DateIn label="Expiry" today={today} value={expiry} onChange={setExpiry} />
          </>
        )}
        <div className="mk-records-wide">
          <ColourDiscs value={color} onChange={setColor} />
        </div>
      </div>

      <FrameFoot>
        {onDelete && (
          <>
            <Button kind="delete" disabled={pending} onClick={() => setAsking(true)}>
              Delete licence
            </Button>
            <span className="mk-gap" />
          </>
        )}
        <Button kind="quiet" onClick={onBack ?? onClose}>
          {onBack ? "Back" : "Cancel"}
        </Button>
        <Button kind="main" onClick={save} disabled={!canSave}>
          {pending ? "Saving the licence" : adding ? "Add licence" : "Save details"}
        </Button>
      </FrameFoot>
      {onDelete && (
        <ConfirmDialog
          open={asking}
          heading={`Delete ${licence?.typeName || "this licence"}?`}
          confirm="Delete licence"
          onConfirm={() => {
            setAsking(false);
            onDelete();
          }}
          onClose={() => setAsking(false)}
        >
          <p>It comes off this person&apos;s papers, with its whole history. There is no undo.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
