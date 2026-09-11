"use client";

import { DateField } from "@/components/ui/date-field";
import { Field } from "@/components/record-modal/parts";
import { AU_LICENCE_STATES } from "@/lib/staff/licence-readers";
import type { LicenceTermInput } from "@/lib/staff/licence-records";

/* THE FIELDS ONE TERM OF A TICKET HAS, in one place because two screens fill
   them: adding a licence scans its first term, and an existing licence records
   its next one. Two copies of this grid would be two chances for a scan to
   fill a box on one screen that the other does not have.

   NO NAME AND NO DATE OF BIRTH — see lib/staff/licence-readers.ts. This grid
   is what the card is FOR (is this person ticketed, and until when), not a
   transcription of a government ID. */

export const SCAN_COPY = {
  prompt: "Scan or photograph the licence",
  hint:
    "The number, issuer, classes and expiry are read from the card and it's filed under this " +
    "licence. Nothing else on it is read — not your name, date of birth or address. " +
    "Photo or PDF.",
  attach: "Optional: attach a photo of the card",
};

export type Term = {
  number: string;
  issuer: string;
  issuingState: string;
  classes: string;
  startsOn: string;
  expiresOn: string;
};

export const emptyTerm: Term = {
  number: "",
  issuer: "",
  issuingState: "",
  classes: "",
  startsOn: "",
  expiresOn: "",
};

/** The draft, as the action takes it. The validator in lib decides what is
    legal; this only reshapes. */
export function termInput(t: Term): LicenceTermInput {
  return {
    number: t.number,
    issuer: t.issuer,
    issuingState: t.issuingState,
    classes: t.classes,
    startsOn: t.startsOn,
    expiresOn: t.expiresOn,
  };
}

export function TermFields({
  value,
  onChange,
  today,
  expiryRequired,
}: {
  value: Term;
  onChange: (t: Term) => void;
  today: string;
  /** Whether the button can do nothing without an expiry, which is what the
      star says. Adding never needs one, and a renewal needs one only while no
      document is waiting: with one, the button files it instead. */
  expiryRequired: boolean;
}) {
  const set = (k: keyof Term) => (v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="vm-fields">
      <Field label="Licence no.">
        <input
          className="vm-input"
          aria-label="Licence no."
          value={value.number}
          onChange={(e) => set("number")(e.target.value)}
        />
      </Field>
      <Field label="Issued by">
        <input
          className="vm-input"
          aria-label="Issued by"
          placeholder="e.g. Service NSW"
          value={value.issuer}
          onChange={(e) => set("issuer")(e.target.value)}
        />
      </Field>
      <Field label="State">
        <select
          className="vm-input"
          aria-label="State"
          value={value.issuingState}
          onChange={(e) => set("issuingState")(e.target.value)}
        >
          <option value="">—</option>
          {AU_LICENCE_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Classes">
        <input
          className="vm-input"
          aria-label="Classes"
          placeholder="e.g. C, LR"
          value={value.classes}
          onChange={(e) => set("classes")(e.target.value)}
        />
      </Field>
      <Field label="Issued">
        <DateField
          size="lg"
          clearable
          today={today}
          value={value.startsOn || null}
          onChange={(iso) => set("startsOn")(iso ?? "")}
          aria-label="Issued"
        />
      </Field>
      <Field label="Expiry" req={expiryRequired}>
        <DateField
          size="lg"
          clearable
          today={today}
          value={value.expiresOn || null}
          onChange={(iso) => set("expiresOn")(iso ?? "")}
          aria-label="Expiry"
        />
      </Field>
    </div>
  );
}
