"use client";

import { AddressField } from "@/components/address/address-field";
import { type StaffProfile } from "@/lib/staff/profile";
import { dateInputValue, formatAuDate } from "@/lib/au-dates";
import { preValidate } from "@/lib/staff/pre-validate";
import { SectionCard, type SectionBodyContext } from "./section-card";
import { Detail, DetailPanel, DetailPanels } from "./detail";
import { DateField, Seg, SelectInput, TextInput } from "./fields";
import type { ProfileMode, SaveSection } from "./types";
import { EMPLOYMENT_TYPES } from "@/lib/staff/employment";
import { AU_STATES } from "@/lib/org/settings";

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
  // job_title and state are in ADMIN_SECTIONS but not SELF_EDITABLE_SECTIONS:
  // your role — and which state's holiday calendar pays you — are things the
  // business sets, not things you type about yourself.
  return mode === "admin"
    ? { ...base, job_title: p?.job_title ?? "", state: p?.state ?? "" }
    : base;
}

export function PersonalCard({
  profile,
  mode,
  email,
  addressLookup = false,
  today,
  orgState = null,
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
  /** the org's home state — see the Holiday state row in the read view */
  orgState?: string | null;
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

     ONE LIST, BOTH MODES. Each row names what it reads as and what it becomes,
     so editing swaps the contents of a value slot and nothing else — the
     labels don't move, the panels don't dissolve, and "+ Add" now opens the
     form with the control landing exactly where the blank was. See detail.tsx.

     There is no empty state. A blank card renders the same three panels with a
     "+ Add" in every value slot, which is strictly more useful than a
     paragraph explaining that it's blank. */
  const body = ({ editing, draft, set, invalid, edit, errorFor }: SectionBodyContext) => (
    <DetailPanels>
      <DetailPanel title="Identity">
        <Detail
          label="First name"
          req
          editing={editing}
          value={values.first_name}
          onAdd={edit}
          error={errorFor("first_name", "Check this")}
          control={
            <TextInput
              name="first_name"
              placeholder="e.g. Jordan"
              value={draft.first_name}
              invalid={invalid("first_name")}
              onChange={(v) => set("first_name", v)}
            />
          }
        />
        <Detail
          label="Last name"
          req
          editing={editing}
          value={values.last_name}
          onAdd={edit}
          control={
            <TextInput
              name="last_name"
              placeholder="e.g. Mills"
              value={draft.last_name}
              onChange={(v) => set("last_name", v)}
            />
          }
        />
        <Detail
          label="Preferred name"
          editing={editing}
          value={values.preferred_name}
          onAdd={edit}
          control={
            <TextInput
              name="preferred_name"
              placeholder="e.g. Jordy"
              value={draft.preferred_name}
              onChange={(v) => set("preferred_name", v)}
            />
          }
        />
        <Detail
          label="Date of birth"
          editing={editing}
          value={born}
          onAdd={edit}
          addLabel="Set"
          error={errorFor("birthday", "Pick a real date")}
          control={
            <DateField
              name="birthday"
              value={draft.birthday}
              invalid={invalid("birthday")}
              onChange={(v) => set("birthday", v)}
              today={today}
            />
          }
        />
      </DetailPanel>

      <DetailPanel title="Contact">
        {/* no control: you change this by changing how you sign in */}
        <Detail label="Email" value={email} small />
        <Detail
          label="Mobile"
          req
          editing={editing}
          value={values.phone}
          onAdd={edit}
          control={
            <TextInput
              name="phone"
              type="tel"
              placeholder="04xx xxx xxx"
              value={draft.phone}
              onChange={(v) => set("phone", v)}
            />
          }
        />
        {/* One line, and it stays one line: a staff member's home address is
            read, not queried, so the whole formatted address goes in the same
            box AddressField already writes to via onChange. No onResolve —
            there are no sibling fields here to fill. */}
        <Detail
          label="Address"
          editing={editing}
          value={values.address}
          onAdd={edit}
          small
          control={
            <AddressField
              name="address"
              placeholder="Street, suburb, state, postcode"
              value={draft.address}
              enabled={addressLookup}
              onChange={(v) => set("address", v)}
            />
          }
        />
      </DetailPanel>

      <DetailPanel title="Employment" wide split>
        <Detail
          label="Start date"
          editing={editing}
          value={started}
          onAdd={edit}
          addLabel="Set"
          error={errorFor("start_date", "Pick a real date")}
          control={
            <DateField
              name="start_date"
              value={draft.start_date}
              invalid={invalid("start_date")}
              onChange={(v) => set("start_date", v)}
              today={today}
            />
          }
        />
        <Detail
          label="Status"
          editing={editing}
          value={
            <span className={values.status === "Active" ? "ro-state ok" : "ro-state"}>
              {values.status}
            </span>
          }
          control={
            <Seg
              value={draft.status}
              greenValue="Active"
              options={["Active", "Inactive"]}
              onChange={(v) => set("status", v)}
            />
          }
        />
        <Detail
          label="Type"
          editing={editing}
          value={values.employment_type}
          onAdd={edit}
          addLabel="Select"
          control={
            <SelectInput
              name="employment_type"
              placeholder="Select employment type"
              options={EMPLOYMENT}
              value={draft.employment_type}
              onChange={(v) => set("employment_type", v)}
            />
          }
        />
        {mode === "admin" && (
          <Detail
            label="Job title"
            editing={editing}
            value={values.job_title}
            onAdd={edit}
            control={
              <TextInput
                name="job_title"
                placeholder="e.g. Lead Installer"
                value={draft.job_title ?? ""}
                onChange={(v) => set("job_title", v)}
              />
            }
          />
        )}
        {mode === "admin" && (
          /* RESOLVED, not described. This read "Same as organisation", which is
             a sentence about a setting rather than an answer to "which public
             holidays does this person get paid for". The org's own state is the
             answer; the qualifier only says where it came from. */
          <Detail
            label="Holiday state"
            editing={editing}
            value={values.state || orgState || ""}
            sub={!values.state && orgState ? "Organisation default" : undefined}
            onAdd={edit}
            addLabel="Set"
            control={
              <SelectInput
                name="state"
                placeholder={orgState ? `Organisation default (${orgState})` : "Same as organisation"}
                options={AU_STATES}
                value={draft.state ?? ""}
                onChange={(v) => set("state", v)}
              />
            }
          />
        )}
      </DetailPanel>
    </DetailPanels>
  );

  return (
    <SectionCard
      variant="section"
      icon="user"
      title="Personal details"
      sub="Identity, contact & employment basics"
      values={values}
      startEditing={startEditing}
      onSave={(fields) => onSave("personal", fields)}
      validate={(fields) => preValidate(mode, "personal", fields)}
      body={body}
    />
  );
}
