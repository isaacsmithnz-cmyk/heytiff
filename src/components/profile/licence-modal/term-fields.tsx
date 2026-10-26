"use client";

import { DateIn } from "@/components/record-modal/parts";
import { Field, TextInput } from "@/components/parts/field";
import { Chooser } from "@/components/parts/chooser";
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
  prompt: "Snap or upload the card",
  /* A fact about what is kept, not a hint about the form: the reader never
     takes a name, a birthday or an address off the card. */
  note: "Only the number, issuer, classes and expiry are read, not your name, date of birth or address.",
  paper: "the card",
  attach: "Attach a photo of the card",
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
}: {
  value: Term;
  onChange: (t: Term) => void;
  today: string;
}) {
  const set = (k: keyof Term) => (v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="mk-records-grid">
      <Field label="Licence no.">
        <TextInput value={value.number} onChange={(e) => set("number")(e.target.value)} />
      </Field>
      <Field label="Issued by">
        <TextInput placeholder="Service NSW" value={value.issuer} onChange={(e) => set("issuer")(e.target.value)} />
      </Field>
      <Field label="State">
        <Chooser
          placeholder="State"
          options={AU_LICENCE_STATES.map((st) => ({ value: st, label: st }))}
          value={value.issuingState || null}
          onChange={set("issuingState")}
        />
      </Field>
      <Field label="Classes">
        <TextInput placeholder="C, LR" value={value.classes} onChange={(e) => set("classes")(e.target.value)} />
      </Field>
      <DateIn label="Issued" today={today} value={value.startsOn} onChange={set("startsOn")} />
      <DateIn label="Expiry" today={today} value={value.expiresOn} onChange={set("expiresOn")} />
    </div>
  );
}
