"use client";

import { Field, TextInput } from "@/components/parts/field";
import { DateIn } from "@/components/record-modal/parts";
import { termFieldsFor, termLabelFor, type OrgCredKind } from "@/lib/org/credentials";
import type { CredentialRecordInput } from "@/lib/org/credential-records";

/* THE FIELDS ONE TERM HAS, in one place because two screens fill them: adding
   a card scans its first term, and an existing card records its next one. Two
   copies of this grid would be two chances for a scan to fill a box on one
   screen that the other doesn't have.

   What differs between one paper and another is the vocabulary and WHICH BOXES
   EXIST — and the second of those is not a licence/insurance split. A workers
   compensation policy has no limit and no excess either, because the
   employer's liability under the state Act is uncapped. Both are tables:
   the words here, the boxes in `termFieldsFor` (lib/org/credentials.ts). */

export const KIND_LABEL: Record<OrgCredKind, string> = {
  licence: "Licence certificate",
  insurance: "Certificate of currency",
};

export const SCAN_COPY: Record<OrgCredKind, { prompt: string; paper: string; attach: string }> = {
  insurance: {
    prompt: "Scan or upload the certificate of currency",
    paper: "the certificate",
    attach: "Attach the certificate or policy schedule",
  },
  licence: {
    prompt: "Scan or upload the licence certificate",
    paper: "the certificate",
    attach: "Attach the certificate",
  },
};

export const PROVIDER_LABEL: Record<OrgCredKind, string> = {
  insurance: "Insurer",
  licence: "Issued by",
};
const PROVIDER_HINT: Record<OrgCredKind, string> = {
  insurance: "QBE",
  licence: "Australian Refrigeration Council",
};
const NUMBER_LABEL: Record<OrgCredKind, string> = {
  insurance: "Policy no.",
  licence: "Licence no.",
};
const COVER_LABEL: Record<OrgCredKind, string> = {
  insurance: "Cover",
  licence: "Classes of work",
};
const COVER_HINT: Record<OrgCredKind, string> = {
  insurance: "Public and products liability",
  licence: "Split system, install and decommission",
};
const START_LABEL: Record<OrgCredKind, string> = {
  insurance: "Starts",
  licence: "Issued",
};
const PRICE_LABEL: Record<OrgCredKind, string> = {
  insurance: "Premium",
  licence: "Fee paid",
};

export type Term = {
  issuer: string;
  number: string;
  cover: string;
  sumInsured: string;
  premium: string;
  excess: string;
  workersCount: string;
  wages: string;
  startsOn: string;
  expiresOn: string;
};

export const emptyTerm: Term = {
  issuer: "",
  number: "",
  cover: "",
  sumInsured: "",
  premium: "",
  excess: "",
  workersCount: "",
  wages: "",
  startsOn: "",
  expiresOn: "",
};

/** The draft, as the action takes it. The validator in lib decides what is
    legal; this only reshapes. */
export function termInput(t: Term): CredentialRecordInput {
  return {
    issuer: t.issuer,
    number: t.number,
    cover: t.cover,
    sumInsured: t.sumInsured,
    premium: t.premium,
    excess: t.excess,
    workersCount: t.workersCount,
    wages: t.wages,
    startsOn: t.startsOn,
    expiresOn: t.expiresOn,
  };
}

export function TermFields({
  kind,
  name = "",
  value,
  onChange,
  today,
}: {
  kind: OrgCredKind;
  /** The card's name — it decides which of the four optional facts this paper
      carries. See termFieldsFor: a workers compensation certificate prints no
      limit and no excess, and two empty boxes on a screen where an empty limit
      is a real problem elsewhere is worse than no boxes. */
  name?: string;
  value: Term;
  onChange: (t: Term) => void;
  today: string;
}) {
  const fields = termFieldsFor(kind, name);
  /* A paper's own word beats the kind's. On a workers compensation certificate
     the cover wording is boilerplate — every NSW one recites the same statutory
     liability — and the line that varies, and that the certificate tells
     principals to confirm, is the industry classification. */
  const coverOverride = termLabelFor(kind, name, "cover");
  const coverLabel = coverOverride ?? COVER_LABEL[kind];
  const set = (k: keyof Term) => (v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="mk-records-grid">
      <Field label={PROVIDER_LABEL[kind]}>
        <TextInput placeholder={PROVIDER_HINT[kind]} value={value.issuer} onChange={(e) => set("issuer")(e.target.value)} />
      </Field>
      <Field label={NUMBER_LABEL[kind]}>
        <TextInput value={value.number} onChange={(e) => set("number")(e.target.value)} />
      </Field>
      {fields.includes("cover") && (
        <Field label={coverLabel}>
          <TextInput
            placeholder={coverOverride ? "423300 Air Conditioning and Heating Services" : COVER_HINT[kind]}
            value={value.cover}
            onChange={(e) => set("cover")(e.target.value)}
          />
        </Field>
      )}
      {fields.includes("sumInsured") && (
        <Field label="Limit of liability ($)">
          <TextInput inputMode="decimal" placeholder="20,000,000" value={value.sumInsured} onChange={(e) => set("sumInsured")(e.target.value)} />
        </Field>
      )}
      <DateIn label={START_LABEL[kind]} today={today} value={value.startsOn} onChange={set("startsOn")} />
      <DateIn label="Expiry" today={today} value={value.expiresOn} onChange={set("expiresOn")} />
      {fields.includes("workers") && (
        <Field label="Workers covered">
          <TextInput
            inputMode="numeric"
            placeholder="11"
            value={value.workersCount}
            /* Digits only on the way in. A head count is whole by nature, and
               a box that accepts "11.5" is a box that has to explain itself
               later. The validator drops a bad one either way. */
            onChange={(e) => set("workersCount")(e.target.value.replace(/[^0-9]/g, ""))}
          />
        </Field>
      )}
      {fields.includes("wages") && (
        <Field label="Wages declared ($)">
          <TextInput inputMode="decimal" placeholder="943,669" value={value.wages} onChange={(e) => set("wages")(e.target.value)} />
        </Field>
      )}
      {fields.includes("premium") && (
        <Field label={`${PRICE_LABEL[kind]} ($)`}>
          <TextInput inputMode="decimal" value={value.premium} onChange={(e) => set("premium")(e.target.value)} />
        </Field>
      )}
      {fields.includes("excess") && (
        <Field label="Excess ($)">
          <TextInput inputMode="decimal" value={value.excess} onChange={(e) => set("excess")(e.target.value)} />
        </Field>
      )}
    </div>
  );
}
