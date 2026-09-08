"use client";

import { DateField } from "@/components/ui/date-field";
import { Field, MoneyInput } from "@/components/record-modal/parts";
import type { OrgCredKind } from "@/lib/org/credentials";
import type { CredentialRecordInput } from "@/lib/org/credential-records";

/* THE FIELDS ONE TERM HAS, in one place because two screens fill them: adding
   a card scans its first term, and an existing card records its next one. Two
   copies of this grid would be two chances for a scan to fill a box on one
   screen that the other doesn't have.

   What differs between a policy and a licence is the vocabulary and two boxes
   (a limit and an excess are insurance facts; a licence has neither), and both
   are tables here rather than two components. */

export const KIND_LABEL: Record<OrgCredKind, string> = {
  licence: "Licence certificate",
  insurance: "Certificate of currency",
};

export const SCAN_COPY: Record<OrgCredKind, { prompt: string; hint: string; attach: string }> = {
  insurance: {
    prompt: "Scan or upload the certificate of currency",
    hint: "Insurer, policy number, limit and expiry are read from the document, and it's filed under this policy. PDF, JPG or photo.",
    attach: "Optional: attach the certificate or policy schedule",
  },
  licence: {
    prompt: "Scan or upload the licence certificate",
    hint: "Licence number, issuing authority, classes and expiry are read from the document, and it's filed under this licence. PDF, JPG or photo.",
    attach: "Optional: attach the certificate",
  },
};

export const PROVIDER_LABEL: Record<OrgCredKind, string> = {
  insurance: "Insurer",
  licence: "Issued by",
};
const PROVIDER_HINT: Record<OrgCredKind, string> = {
  insurance: "e.g. QBE",
  licence: "e.g. Australian Refrigeration Council",
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
  insurance: "e.g. Public and products liability",
  licence: "e.g. Split system — install and decommission",
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
    startsOn: t.startsOn,
    expiresOn: t.expiresOn,
  };
}

export function TermFields({
  kind,
  value,
  onChange,
  today,
}: {
  kind: OrgCredKind;
  value: Term;
  onChange: (t: Term) => void;
  today: string;
}) {
  const set = (k: keyof Term) => (v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="vm-fields">
      <Field label={PROVIDER_LABEL[kind]}>
        <input
          className="vm-input"
          aria-label={PROVIDER_LABEL[kind]}
          placeholder={PROVIDER_HINT[kind]}
          value={value.issuer}
          onChange={(e) => set("issuer")(e.target.value)}
        />
      </Field>
      <Field label={NUMBER_LABEL[kind]}>
        <input
          className="vm-input"
          aria-label={NUMBER_LABEL[kind]}
          value={value.number}
          onChange={(e) => set("number")(e.target.value)}
        />
      </Field>
      <Field label={COVER_LABEL[kind]}>
        <input
          className="vm-input"
          aria-label={COVER_LABEL[kind]}
          placeholder={COVER_HINT[kind]}
          value={value.cover}
          onChange={(e) => set("cover")(e.target.value)}
        />
      </Field>
      {kind === "insurance" && (
        <Field label="Limit of liability">
          <MoneyInput
            value={value.sumInsured}
            onChange={set("sumInsured")}
            placeholder="20,000,000"
            ariaLabel="Limit of liability"
          />
        </Field>
      )}
      <Field label={START_LABEL[kind]}>
        <DateField
          size="lg"
          clearable
          today={today}
          value={value.startsOn || null}
          onChange={(iso) => set("startsOn")(iso ?? "")}
          aria-label={START_LABEL[kind]}
        />
      </Field>
      <Field label="Expiry" req>
        <DateField
          size="lg"
          clearable
          today={today}
          value={value.expiresOn || null}
          onChange={(iso) => set("expiresOn")(iso ?? "")}
          aria-label="Expiry"
        />
      </Field>
      <Field label={PRICE_LABEL[kind]}>
        <MoneyInput value={value.premium} onChange={set("premium")} ariaLabel={PRICE_LABEL[kind]} />
      </Field>
      {kind === "insurance" && (
        <Field label="Excess">
          <MoneyInput value={value.excess} onChange={set("excess")} ariaLabel="Excess" />
        </Field>
      )}
    </div>
  );
}
