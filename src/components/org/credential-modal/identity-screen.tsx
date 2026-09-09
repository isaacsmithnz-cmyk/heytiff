"use client";

import { useState } from "react";
import { DateField } from "@/components/ui/date-field";
import { Btn, Field, Segmented } from "@/components/record-modal/parts";
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

/* The colours a card may wear. NO STATE COLOUR IS OFFERED HERE: a card's badge
   says what the thing IS and its chip says how it is DOING, so danger red on a
   badge put "#e0264f INS" one line above a teal "Valid" on the same card and
   made the wall unreadable at a glance. Slate takes red's slot. Teal stays
   because the registry itself issues it to the ARC authorisation — but it is
   the registry's to give, not a decoration to pick. */
const SWATCHES: { label: string; value: string }[] = [
  { label: "Auto", value: "" },
  { label: "Teal", value: "#00A389" },
  { label: "Blue", value: "#2E68FF" },
  { label: "Amber", value: "#F0A431" },
  { label: "Violet", value: "#8A2BE2" },
  { label: "Slate", value: "#5B6478" },
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
        <div className="vm-card">
          <div className="vm-cardhead">
            <span className="vm-eyebrow">WHAT IT IS</span>
          </div>

          {/* Its own row above the boxes, because it is not one more field: it
              chooses the reader, the words and the filing kind for everything
              under it. A two-value choice is a segmented control everywhere
              else in this app, and `.vm-seg` is the portalled twin of `.seg` —
              `.fg` never reaches a modal on <body>. */}
          <div className="vm-typerow">
            <span className="vm-fl">Type</span>
            <Segmented<OrgCredKind>
              items={[
                { key: "licence", label: "Licence" },
                { key: "insurance", label: "Insurance" },
              ]}
              active={kind}
              onSelect={setKind}
              ariaLabel="Type"
            />
          </div>

          {/* SOLO when the boxes below own the number and the issuer: one
              narrow field with two empty thirds beside it reads as a form that
              lost its other fields, so Name takes the room they left. */}
          <div className={`vm-fields${!adding && !hasTerms && !scanned ? "" : " solo"}`}>
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

            {/* NOT WHILE ADDING, AT ALL. This screen's headline act is "scan
                the certificate", and the number and the issuer are the two
                things the scan is about to hand over — asking for them by hand
                first is the same mistake the Type box made, one row down. They
                belong to a TERM, and the panel below asks for them there.

                They survive on the EDIT screen for the one card that can hold
                no term: a licence with no renewal date, whose `expires_on`
                cannot be null, so its number and issuer have nowhere else to
                live. Once a term exists they go for good — the newest one owns
                those columns and typing over them here would describe a term
                that does not exist. */}
            {!adding && !hasTerms && !scanned && (
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
              </>
            )}
          </div>

        </div>

        {adding && (
          <ScanCard<ReadOrgCredResult>
            heading={`SCAN THE ${KIND_LABEL[kind].toUpperCase()}`}
            prompt={SCAN_COPY[kind].prompt}
            hint={SCAN_COPY[kind].hint}
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

        {/* LAST, and its own card. It is the only cosmetic choice on the
            screen, and while it lived inside "What it is" it sat between the
            two questions that matter and the certificate drop zone — a colour
            picker standing between a person and the thing they came to do. */}
        <div className="vm-card">
          <div className="vm-cardhead">
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
