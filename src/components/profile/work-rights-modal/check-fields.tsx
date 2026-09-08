"use client";

import { DateField } from "@/components/ui/date-field";
import { Field } from "@/components/record-modal/parts";
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

export const SCAN_COPY = {
  prompt: "Scan or upload the VEVO result or visa grant notice",
  hint:
    "The entitlement, visa, work condition and dates are read from the document and it's " +
    "filed as the evidence for this check. Nothing else on it is read — not the name, date " +
    "of birth, nationality or passport number. PDF, JPG or photo.",
  attach: "Optional: attach the VEVO result or grant notice",
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
    <div className="vm-fields">
      <Field label="Right to work" req>
        <select
          className="vm-input"
          aria-label="Right to work"
          value={value.status}
          onChange={(e) => set("status")(e.target.value)}
        >
          <option value="">Select…</option>
          {WORK_RIGHTS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>

      {!noVisa && (
        <>
          <Field label="Visa">
            <input
              className="vm-input"
              aria-label="Visa"
              placeholder="e.g. 482 Temporary Skill Shortage"
              value={value.visaType}
              onChange={(e) => set("visaType")(e.target.value)}
            />
          </Field>
          <Field label="Work condition">
            <input
              className="vm-input"
              aria-label="Work condition"
              placeholder="e.g. No work limitation"
              value={value.hoursCondition}
              onChange={(e) => set("hoursCondition")(e.target.value)}
            />
          </Field>
          <Field label="Visa expiry">
            <DateField
              size="lg"
              clearable
              today={today}
              value={value.expiresOn || null}
              onChange={(iso) => set("expiresOn")(iso ?? "")}
              aria-label="Visa expiry"
            />
          </Field>
        </>
      )}

      <Field label="Checked on" req>
        <DateField
          size="lg"
          clearable
          today={today}
          value={value.checkedOn || null}
          onChange={(iso) => set("checkedOn")(iso ?? "")}
          aria-label="Checked on"
        />
      </Field>
    </div>
  );
}
