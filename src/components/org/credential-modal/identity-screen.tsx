"use client";

import { useState } from "react";
import { DateField } from "@/components/ui/date-field";
import { Btn, Field } from "@/components/record-modal/parts";
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
   moments. ADDING starts here with the scan panel open: drop the certificate
   in, Tiff reads the term off it, and one Save writes both the card and its
   first term — the same two-in-one the fleet's Add vehicle makes from a rego
   certificate. EDITING an existing card shows only the identity, because by
   then the numbers and dates belong to the terms and are changed by recording
   a renewal, not by retyping them here.

   THE NAME IS NEVER SCANNED (see lib/org/cred-readers.ts): it is the person's
   word for the thing, it is what the history hangs off, and one badly-worded
   certificate must not be able to split a policy's history in two. */

const SWATCHES: { label: string; value: string }[] = [
  { label: "Auto", value: "" },
  { label: "Teal", value: "#00A389" },
  { label: "Blue", value: "#2E68FF" },
  { label: "Amber", value: "#F0A431" },
  { label: "Violet", value: "#8A2BE2" },
  { label: "Red", value: "#e0264f" },
];

export type IdentityDraft = {
  identity: OrgCredentialInput;
  /** Present only when adding and a term was scanned or typed. */
  term?: CredentialRecordInput;
};

export function IdentityScreen({
  credential,
  hasTerms,
  today,
  pending,
  onSave,
  onDelete,
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
}) {
  const adding = credential === null;
  const [kind, setKind] = useState<OrgCredKind>(credential?.kind ?? "licence");
  const [name, setName] = useState(credential?.name ?? "");
  const [color, setColor] = useState(credential?.color ?? "");
  const [number, setNumber] = useState(credential?.number ?? "");
  const [issuer, setIssuer] = useState(credential?.issuer ?? "");
  const [expiry, setExpiry] = useState(credential?.expiryDate ?? "");
  const [armed, setArmed] = useState(false);

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
    /* A scanned term only rides along when it carries the one thing that makes
       it a term. Everything else on a certificate is optional; the expiry is
       what the whole feature counts down to. */
    const carry = adding && scanned && term.expiresOn.trim();
    onSave({
      identity,
      term: carry ? { ...termInput(term), documentId: docId, source: mode === "scanned" ? "scan" : "manual" } : undefined,
    });
  };

  return (
    <>
      <div className="vm-body">
        {adding && (
          <ScanCard<ReadOrgCredResult>
            heading={`SCAN THE ${KIND_LABEL[kind].toUpperCase()}`}
            prompt={SCAN_COPY[kind].prompt}
            hint={SCAN_COPY[kind].hint}
            attachLabel={SCAN_COPY[kind].attach}
            docKind={CREDENTIAL_DOC_KIND[kind]}
            read={(b64, mt) => readOrgCredentialDocument(b64, mt, kind)}
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
            <TermFields kind={kind} value={term} onChange={setTerm} today={today} />
          </ScanCard>
        )}

        <div className="vm-card">
          <div className="vm-cardhead">
            <span className="vm-eyebrow">WHAT IT IS</span>
            {adding && scanned && <span className="vm-caption">Name it — the scan doesn&apos;t</span>}
          </div>

          <div className="vm-fields">
            <Field label="Type">
              <select
                className="vm-input"
                value={kind}
                aria-label="Type"
                onChange={(e) => setKind(e.target.value === "insurance" ? "insurance" : "licence")}
              >
                <option value="licence">Licence</option>
                <option value="insurance">Insurance</option>
              </select>
            </Field>
            <Field label="Name" req>
              <input
                className="vm-input"
                list="oc-names"
                aria-label="Name"
                placeholder={kind === "insurance" ? "e.g. Public liability" : "e.g. Contractor licence"}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <datalist id="oc-names">
                {suggestions.map((t) => (
                  <option key={t.name} value={t.name} />
                ))}
              </datalist>
            </Field>

            {/* Offered only while no term owns them. Once a renewal is on file
                these three are a cache of it, and typing over them here would
                describe a term that does not exist. */}
            {!hasTerms && (
              <>
                <Field label={kind === "insurance" ? "Policy no." : "Licence no."}>
                  <input
                    className="vm-input"
                    aria-label="Number"
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                  />
                </Field>
                <Field label={kind === "insurance" ? "Insurer" : "Issued by"}>
                  <input
                    className="vm-input"
                    aria-label="Issuer"
                    placeholder={kind === "insurance" ? "e.g. QBE" : "e.g. VBA"}
                    value={issuer}
                    onChange={(e) => setIssuer(e.target.value)}
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
          {pending ? "Saving…" : adding ? "Add card" : "Save"}
        </Btn>
      </div>
    </>
  );
}
