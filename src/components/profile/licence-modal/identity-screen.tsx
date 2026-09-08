"use client";

import { useState } from "react";
import { DateField } from "@/components/ui/date-field";
import { Btn, Field } from "@/components/record-modal/parts";
import { ScanCard, type ScanMode } from "@/components/record-modal/scan-card";
import { readStaffLicenceDocument, type ReadLicenceResult } from "@/app/actions/staff-licence-ai";
import { LICENCE_DOC_KIND, type LicenceTermInput } from "@/lib/staff/licence-records";
import { LIC_TYPES, defaultLicenceColor } from "@/lib/staff/licence";
import type { LicenceInput } from "../types";
import { SCAN_COPY, TermFields, emptyTerm, termInput, type Term } from "./term-fields";

/* WHAT THE TICKET IS — its name and the colour it wears.

   Two jobs in one screen, the same way the organisation's credential modal
   splits them. ADDING starts here with the scan panel open: photograph the
   card, Tiff reads the term off it, and one Save writes both the ticket and
   the period it is currently good for. EDITING an existing ticket shows only
   the identity, because by then the number and the expiry belong to the terms
   and are changed by recording a renewal, not by retyping them here.

   THE TYPE IS NEVER SCANNED (see lib/staff/licence-readers.ts): it is the
   person's word for the thing, it is what the history hangs off, and one
   oddly-worded card must not split a ticket's history in two. */

const SWATCHES: { label: string; value: string }[] = [
  { label: "Auto", value: "" },
  { label: "Teal", value: "#00A389" },
  { label: "Blue", value: "#2E68FF" },
  { label: "Amber", value: "#F0A431" },
  { label: "Violet", value: "#8A2BE2" },
  { label: "Red", value: "#e0264f" },
];

export type IdentityDraft = { identity: LicenceInput; term?: LicenceTermInput };

export function IdentityScreen({
  licence,
  staffId,
  hasTerms,
  today,
  pending,
  onSave,
  onDelete,
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
}) {
  const adding = licence === null;
  const [typeName, setTypeName] = useState(licence?.typeName ?? "");
  const [color, setColor] = useState(licence?.color ?? "");
  const [number, setNumber] = useState(licence?.licenceNumber ?? "");
  const [expiry, setExpiry] = useState(licence?.expiryDate ?? "");
  const [armed, setArmed] = useState(false);

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
    /* A scanned term only rides along when it carries the one thing that makes
       it a term. Everything else on a card is optional; the expiry is what the
       whole feature counts down to. */
    const carry = adding && scanned && term.expiresOn.trim();
    onSave({
      identity,
      term: carry
        ? { ...termInput(term), documentId: docId, source: mode === "scanned" ? "scan" : "manual" }
        : undefined,
    });
  };

  return (
    <>
      <div className="vm-body">
        {adding && (
          <ScanCard<ReadLicenceResult>
            heading="SCAN THE CARD"
            prompt={SCAN_COPY.prompt}
            hint={SCAN_COPY.hint}
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

        <div className="vm-card">
          <div className="vm-cardhead">
            <span className="vm-eyebrow">WHAT IT IS</span>
            {adding && scanned && <span className="vm-caption">Name it — the scan doesn&apos;t</span>}
          </div>

          <div className="vm-fields">
            <Field label="Licence or ticket" req>
              <input
                className="vm-input"
                list="lic-types"
                aria-label="Licence or ticket"
                placeholder="e.g. ARC licence"
                value={typeName}
                onChange={(e) => setTypeName(e.target.value)}
              />
              <datalist id="lic-types">
                {LIC_TYPES.map((t) => (
                  <option key={t.name} value={t.name} />
                ))}
              </datalist>
            </Field>

            {/* Offered only while no term owns them. Once a renewal is on file
                these two are a cache of it, and typing over them here would
                describe a term that does not exist. */}
            {!hasTerms && (
              <>
                <Field label="Licence no.">
                  <input
                    className="vm-input"
                    aria-label="Licence no."
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                  />
                </Field>
                {!adding && (
                  <Field label="Expiry">
                    <DateField
                      size="lg"
                      clearable
                      today={today}
                      value={expiry || null}
                      onChange={(iso) => setExpiry(iso ?? "")}
                      aria-label="Expiry"
                    />
                  </Field>
                )}
              </>
            )}
          </div>

          <div className="vm-divider">
            <span className="vm-eyebrow">COLOUR</span>
          </div>
          <div className="vm-sw" role="group" aria-label="Colour">
            {SWATCHES.map((s) => (
              <button
                key={s.label}
                type="button"
                className={`vm-swb${color === s.value ? " on" : ""}${s.value ? "" : " auto"}`}
                style={s.value ? { background: s.value } : undefined}
                aria-label={s.label}
                aria-pressed={color === s.value}
                onClick={() => setColor(s.value)}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="vm-foot">
        {onDelete && (
          <button
            type="button"
            className={`vm-btn danger${armed ? " arm" : ""}`}
            style={{ marginRight: "auto" }}
            disabled={pending}
            onClick={() => (armed ? onDelete() : setArmed(true))}
          >
            {armed ? "Tap again to delete" : "Delete"}
          </button>
        )}
        <Btn kind="primary" onClick={save} disabled={!canSave}>
          {pending ? "Saving…" : adding ? "Add licence" : "Save"}
        </Btn>
      </div>
    </>
  );
}
