"use client";

import { Field, TextInput } from "@/components/parts/field";
import { Chooser } from "@/components/parts/chooser";
import { DateIn } from "@/components/record-modal/parts";
import { WORK_RIGHTS, isNoVisa } from "@/lib/staff/work-rights";
import type { WorkRightsCheckInput } from "@/lib/staff/work-rights-records";

/* THE FIELDS ONE CHECK HAS.

   THE VISA BLOCK IS UNMOUNTED FOR A CITIZEN OR PERMANENT RESIDENT, not dimmed
   — the rule the Work rights card has carried since it was built, and it holds
   here for the same reason plus one more: `buildWorkRightsCheckRow` DROPS
   those three values for a no-visa status, so a field left on screen would be
   collecting something that is about to be thrown away.

   NO NAME, NO DATE OF BIRTH, NO NATIONALITY, NO PASSPORT NUMBER. There is
   nowhere here to type one because there is nowhere in the table to keep one —
   see lib/staff/work-rights-readers.ts for the whole argument. */

/* THE WORDS FOLLOW THE CHECK THAT WAS MADE. A visa is looked up and the site
   gives you a result; a citizen's passport is sighted, and the document IS
   the evidence. One set of words for each — "file what it said" is nonsense
   about a passport, which said nothing. */
export const SCAN_COPY = {
  heading: "File what it said",
  prompt: "Scan or upload what the check gave you",
  paper: "the check",
  attach: "Attach the visa check result or the grant letter",
};

export const SCAN_COPY_NO_VISA = {
  heading: "File the document",
  prompt: "Scan or upload the passport or citizenship certificate",
  paper: "the document",
  attach: "Attach the passport or citizenship certificate",
};

export type Check = {
  status: string;
  visaType: string;
  hoursCondition: string;
  expiresOn: string;
  checkedOn: string;
};

export const emptyCheck: Check = {
  status: "",
  visaType: "",
  hoursCondition: "",
  expiresOn: "",
  checkedOn: "",
};

export function checkInput(c: Check, source: string): WorkRightsCheckInput {
  return {
    status: c.status,
    visaType: c.visaType,
    hoursCondition: c.hoursCondition,
    expiresOn: c.expiresOn,
    checkedOn: c.checkedOn,
    source,
  };
}

export function CheckFields({
  value,
  onChange,
  today,
}: {
  value: Check;
  onChange: (c: Check) => void;
  today: string;
}) {
  const set = (k: keyof Check) => (v: string) => onChange({ ...value, [k]: v });
  const noVisa = value.status !== "" && isNoVisa(value.status);

  return (
    <div className="mk-records-grid mk-records-grid--2">
      <Field label="Right to work" className="mk-records-wide">
        <Chooser
          placeholder="Choose the right to work"
          options={WORK_RIGHTS.map((w) => ({ value: w, label: w }))}
          value={value.status || null}
          onChange={set("status")}
        />
      </Field>

      {!noVisa && (
        <>
          <Field label="Visa">
            <TextInput placeholder="482 Skills in Demand" value={value.visaType} onChange={(e) => set("visaType")(e.target.value)} />
          </Field>
          <Field label="Work condition">
            <TextInput placeholder="No work limitation" value={value.hoursCondition} onChange={(e) => set("hoursCondition")(e.target.value)} />
          </Field>
          <DateIn label="Visa expiry" today={today} value={value.expiresOn} onChange={set("expiresOn")} />
        </>
      )}

      <DateIn label="Checked on" today={today} value={value.checkedOn} onChange={set("checkedOn")} />
    </div>
  );
}
