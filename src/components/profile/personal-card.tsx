"use client";

import { Icon } from "@/components/shell/icon";
import { IdCard } from "@/components/cards/id-card";
import { AddressField } from "@/components/address/address-field";
import { type StaffProfile } from "@/lib/staff/profile";
import { dateInputValue, formatAuDate } from "@/lib/au-dates";
import { preValidate } from "@/lib/staff/pre-validate";
import { SectionCard } from "./section-card";
import { DateField, Field, FactRow, Seg, SelectInput, TextInput } from "./fields";
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
  org,
  initials,
  addressLookup = false,
  today,
  onSave,
}: {
  profile: StaffProfile | null;
  mode: ProfileMode;
  org: string | null;
  initials: string;
  /** server-computed Boolean(GOOGLE_MAPS_API_KEY). False leaves Address the
      plain text box it has always been — the field never depends on it. */
  addressLookup?: boolean;
  /** the server's AU day, for the date pickers */
  today?: string;
  onSave: SaveSection;
}) {
  const values = personalValues(profile, mode);
  const fullName = [values.first_name, values.last_name].filter(Boolean).join(" ");
  const jobTitle = profile?.job_title ?? "";
  const blank = !fullName && !values.phone && !values.address && !values.birthday;
  // read mode is dd/mm/yyyy — how an Australian reads a date. Only ENTRY is ISO,
  // because that is what a calendar picker speaks.
  const born = formatAuDate(profile?.birthday);
  const started = formatAuDate(profile?.start_date);

  const sub = [jobTitle, values.employment_type].filter(Boolean).join(" · ");

  const read = blank ? (
    <div className="ro-empty">
      <span className="ei">
        <Icon name="user" size={20} />
      </span>
      <b>No details yet</b>
      <em>
        Add your details and this becomes your staff card — name, role and the
        basics your team can actually use.
      </em>
    </div>
  ) : (
    <>
      <IdCard
        variant="dark"
        org={org}
        badge={{ label: "STAFF", color: "#00E5C0" }}
        photoUrl={profile?.photo_url ?? null}
        initials={initials}
        name={fullName || "—"}
        sub={sub || "Staff member"}
        facts={[
          { em: "Started", b: started || "—" },
          { em: "Phone", b: values.phone || "—" },
          { em: "Date of birth", b: born || "—" },
        ]}
      />
      <div className="ro-rows">
        <FactRow label="Preferred name" value={values.preferred_name} />
        <FactRow label="Address" value={values.address} />
        <FactRow
          label="Status"
          value={
            <span className={values.status === "Active" ? "ro-state ok" : "ro-state"}>
              {values.status}
            </span>
          }
        />
      </div>
    </>
  );

  return (
    <SectionCard
      icon="user"
      title="Personal details"
      sub="Identity, contact & employment basics"
      values={values}
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
