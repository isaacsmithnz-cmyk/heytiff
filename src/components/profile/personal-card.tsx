"use client";

import { AddressField } from "@/components/address/address-field";
import { type StaffProfile } from "@/lib/staff/profile";
import { dateInputValue, formatAuDate } from "@/lib/au-dates";
import { preValidate } from "@/lib/staff/pre-validate";
import { SectionCard } from "./section-card";
import { Detail, DetailPanel, DetailPanels } from "./detail";
import { DateField, Field, Seg, SelectInput, TextInput } from "./fields";
import type { ProfileMode, SaveSection } from "./types";
import { EMPLOYMENT_TYPES } from "@/lib/staff/employment";

/* the one list, shared with the Rate Calculator and Time & Pay — a label
   added here has to classify there too */
const EMPLOYMENT = EMPLOYMENT_TYPES;

/** The EDIT values. Dates are ISO here because the pickers speak ISO; read
    mode formats them as dd/mm/yyyy for itself, straight off the profile. */
export function personalValues(p: StaffProfile | null, mode: ProfileMode): Record<string, string> {
  const base = {
    first_name: p?.first_name ?? "",
    last_name: p?.last_name ?? "",
    preferred_name: p?.preferred_name ?? "",
    phone: p?.phone ?? "",
    birthday: dateInputValue(p?.birthday),
    address: p?.address ?? "",
    start_date: dateInputValue(p?.start_date),
    employment_type: p?.employment_type ?? "",
    status: p?.status ?? "Active",
  };
  // job_title is in ADMIN_SECTIONS but not in SELF_EDITABLE_SECTIONS: your role
  // is something the business sets, not something you type about yourself.
  return mode === "admin" ? { ...base, job_title: p?.job_title ?? "" } : base;
}

export function PersonalCard({
  profile,
  mode,
  email,
  addressLookup = false,
  today,
  startEditing,
  onSave,
}: {
  profile: StaffProfile | null;
  mode: ProfileMode;
  /** the sign-in address. Shown, never edited: it is the Auth0 identity, not
      a column this card's allowlist can reach. */
  email?: string;
  /** server-computed Boolean(GOOGLE_MAPS_API_KEY). False leaves Address the
      plain text box it has always been — the field never depends on it. */
  addressLookup?: boolean;
  /** the server's AU day, for the date pickers */
  today?: string;
  startEditing?: boolean;
  onSave: SaveSection;
}) {
  const values = personalValues(profile, mode);
  // read mode is dd/mm/yyyy — how an Australian reads a date. Only ENTRY is ISO,
  // because that is what a calendar picker speaks.
  const born = formatAuDate(profile?.birthday);
  const started = formatAuDate(profile?.start_date);

  /* Three groups rather than one long list — you come to this card looking for
     ONE of "who are they", "how do I reach them" or "how are they employed",
     and grouping means you stop reading as soon as you've found it.

     There is no empty state any more. A blank card renders the same three
     panels with an "+ Add" in every value slot, which is strictly more useful
     than a paragraph explaining that it's blank: each button opens this card's
     form with the field it names. */
  const read = ({ edit }: { edit: () => void }) => (
    <DetailPanels>
      <DetailPanel title="Identity">
        <Detail label="First name" value={values.first_name} onAdd={edit} />
        <Detail label="Last name" value={values.last_name} onAdd={edit} />
        <Detail label="Preferred name" value={values.preferred_name} onAdd={edit} />
        <Detail label="Date of birth" value={born} onAdd={edit} addLabel="Set" />
      </DetailPanel>

      <DetailPanel title="Contact">
        {/* no onAdd: you change this by changing how you sign in */}
        <Detail label="Email" value={email} small />
        <Detail label="Mobile" value={values.phone} onAdd={edit} />
        <Detail label="Address" value={values.address} onAdd={edit} small />
      </DetailPanel>

      <DetailPanel title="Employment" wide split>
        <Detail label="Start date" value={started} onAdd={edit} addLabel="Set" />
        <Detail
          label="Status"
          value={
            <span className={values.status === "Active" ? "ro-state ok" : "ro-state"}>
              {values.status}
            </span>
          }
        />
        <Detail
          label="Type"
          value={values.employment_type}
          onAdd={edit}
          addLabel="Select"
        />
        {mode === "admin" && (
          <Detail label="Job title" value={values.job_title} onAdd={edit} />
        )}
      </DetailPanel>
    </DetailPanels>
  );

  return (
    <SectionCard
      icon="user"
      title="Personal details"
      sub="Identity, contact & employment basics"
      values={values}
      startEditing={startEditing}
      onSave={(fields) => onSave("personal", fields)}
      validate={(fields) => preValidate(mode, "personal", fields)}
      read={read}
      edit={({ draft, set, invalid }) => (
        <>
          {/* A name is two fields, not one free-text box: first and last are
              what we store, and full_name is derived on save. */}
          <div className="frow c2">
            <Field label="First name" req error={invalid("first_name") ? "Check this" : null}>
              <TextInput
                name="first_name"
                placeholder="e.g. Jordan"
                value={draft.first_name}
                onChange={(v) => set("first_name", v)}
              />
            </Field>
            <Field label="Last name" req>
              <TextInput
                name="last_name"
                placeholder="e.g. Mills"
                value={draft.last_name}
                onChange={(v) => set("last_name", v)}
              />
            </Field>
          </div>
          <div className="frow c2">
            <Field label="Preferred / nickname">
              <TextInput
                name="preferred_name"
                placeholder="e.g. Jordy"
                value={draft.preferred_name}
                onChange={(v) => set("preferred_name", v)}
              />
            </Field>
            <Field label="Phone" req>
              <TextInput
                name="phone"
                type="tel"
                placeholder="04xx xxx xxx"
                value={draft.phone}
                onChange={(v) => set("phone", v)}
              />
            </Field>
          </div>
          <div className="frow c2">
            <Field label="Birthday" error={invalid("birthday") ? "Pick a real date" : null}>
              <DateField
                name="birthday"
                value={draft.birthday}
                invalid={invalid("birthday")}
                onChange={(v) => set("birthday", v)}
                today={today}
              />
            </Field>
            <Field label="Start date" error={invalid("start_date") ? "Pick a real date" : null}>
              <DateField
                name="start_date"
                value={draft.start_date}
                invalid={invalid("start_date")}
                onChange={(v) => set("start_date", v)}
                today={today}
              />
            </Field>
          </div>
          {/* One line, and it stays one line: a staff member's home address is
              read, not queried, so the whole formatted address goes in the same
              box AddressField already writes to via onChange. No onResolve —
              there are no sibling fields here to fill. */}
          <div className="frow">
            <Field label="Address">
              <AddressField
                name="address"
                placeholder="Street, suburb, state, postcode"
                value={draft.address}
                enabled={addressLookup}
                onChange={(v) => set("address", v)}
              />
            </Field>
          </div>
          <div className="frow c2">
            <Field label="Employment type">
              <SelectInput
                name="employment_type"
                placeholder="Select employment type"
                options={EMPLOYMENT}
                value={draft.employment_type}
                onChange={(v) => set("employment_type", v)}
              />
            </Field>
            <Field label="Status">
              <Seg
                value={draft.status}
                greenValue="Active"
                options={["Active", "Inactive"]}
                onChange={(v) => set("status", v)}
              />
            </Field>
          </div>
          {mode === "admin" && (
            <div className="frow c2">
              <Field label="Job title" help="Shown on their card and in the Team directory">
                <TextInput
                  name="job_title"
                  placeholder="e.g. Lead Installer"
                  value={draft.job_title ?? ""}
                  onChange={(v) => set("job_title", v)}
                />
              </Field>
              <div />
            </div>
          )}
        </>
      )}
    />
  );
}
