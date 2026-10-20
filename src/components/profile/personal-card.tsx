"use client";

import { requiredField } from "@/lib/staff/completeness";
import { useState } from "react";
import { Icon } from "@/components/shell/icon";
import { AddressField } from "@/components/address/address-field";
import { SignInEmailModal } from "./signin-email-modal";
import type { EmailChangeOutcome } from "@/app/actions/account";
import { type StaffProfile } from "@/lib/staff/profile";
import { dateInputValue, formatAuDate } from "@/lib/au-dates";
import { preValidate } from "@/lib/staff/pre-validate";
import { SectionCard, type GroupHead, type SectionBodyContext } from "./section-card";
import { Detail, DetailPanel, DetailPanels } from "./detail";
import { DateField, ScaledInput, Seg, SelectInput, TextInput } from "./fields";
import type { ProfileMode, SaveResult, SaveSection } from "./types";
import { EMPLOYMENT_TYPES } from "@/lib/staff/employment";
import {
  BOOT_SCALES,
  UNIFORM_FIELDS,
  bootLadder,
  uniformDisplay,
  uniformValues,
} from "@/lib/staff/uniform";
import { AU_STATES } from "@/lib/org/settings";
import { ALIAS_WORDS, aliasListText, parseAliasList } from "@/lib/staff/aliases";

/* the one list, shared with the Rate Calculator and Time & Pay — a label
   added here has to classify there too */
const EMPLOYMENT = EMPLOYMENT_TYPES;

/** The card's four parts, each a group of its own on Team's person page. */
export type PersonalPart = "name" | "contact" | "employment" | "uniform";

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
    // shirt / jacket / trousers / boots — self-editable in both modes, so they
    // sit in the base rather than the admin half below
    ...uniformValues(p),
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
  onChangeSignInEmail,
  addressLookup = false,
  today,
  orgState = null,
  startEditing,
  focusField,
  aliases = [],
  onSaveAliases,
  onSave,
  group,
  only,
}: {
  /** drawn as a titled group with its own Edit, on Team's person page */
  group?: GroupHead;
  /** one part of the card as its own group (Team's person page) */
  only?: PersonalPart;
  profile: StaffProfile | null;
  /* Present only on your OWN card — the action moves whoever the session is,
     so an admin viewing a colleague is handed nothing and the row stays the
     read-only fact it has always been. Handed in rather than imported: a
     client component that imports a `"use server"` module drags Next's
     server runtime into every jsdom suite that renders this screen. */
  onChangeSignInEmail?: (next: string) => Promise<EmailChangeOutcome>;
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
  /** the column Summary's Add pointed at — the form opens on it */
  focusField?: string;
  /** The nicknames the person goes by — learned by Tiff or typed here. */
  aliases?: string[];
  /** Saves the "Also called" list. Handed in, like the sign-in move above;
      without it the row isn't drawn. */
  onSaveAliases?: (names: string[]) => Promise<SaveResult>;
  onSave: SaveSection;
}) {
  /* "ALSO CALLED" RIDES THE CARD'S OWN DRAFT as one comma list, so it is
     edited, saved and cancelled with the rest of the card — but it is not a
     column: it is taken off before the section save and goes to its own
     action (staff_aliases). */
  const values: Record<string, string> = {
    ...personalValues(profile, mode),
    ...(onSaveAliases ? { aliases: aliasListText(aliases) } : {}),
  };
  const saveCard = async (fields: Record<string, string>): Promise<SaveResult> => {
    const { aliases: typed, ...rest } = fields;
    if (onSaveAliases && typed !== undefined && typed !== values.aliases) {
      const { names, refused } = parseAliasList(typed);
      if (refused.length) return { ok: false, error: ALIAS_WORDS.notAName(refused[0]), fields: ["aliases"] };
      const r = await onSaveAliases(names);
      if (!r.ok) return r;
    }
    return onSave("personal", rest);
  };
  // what the uniform rows READ as, which is not what they submit: a boot size
  // reads with its scale attached and saves as the two columns it is
  const display = uniformDisplay(profile);
  // read mode is dd/mm/yyyy — how an Australian reads a date. Only ENTRY is ISO,
  // because that is what a calendar picker speaks.
  const born = formatAuDate(profile?.birthday);
  const started = formatAuDate(profile?.start_date);

  /* Four groups rather than one long list — you come to this card looking for
     ONE of "who are they", "how do I reach them", "how are they employed" or
     "what do I order them", and grouping means you stop reading as soon as
     you've found it. Uniform is a group for exactly that reason: it is the
     question a supplier asks, never mixed with the ones payroll asks.

     ONE LIST, BOTH MODES. Each row names what it reads as and what it becomes,
     so editing swaps the contents of a value slot and nothing else — the
     labels don't move, the panels don't dissolve, and "+ Add" now opens the
     form with the control landing exactly where the blank was. See detail.tsx.

     There is no empty state. A blank card renders the same four panels with a
     "+ Add" in every value slot, which is strictly more useful than a
     paragraph explaining that it's blank. */
  /* The new address, held until the session catches up. `email` comes from
     the Auth0 session, and although the action now rewrites that cookie, the
     already-rendered server component still holds the claim it was given —
     so without this the row would show the old address until a navigation. */
  const [changed, setChanged] = useState<{ email: string; verificationSent: boolean } | null>(
    null,
  );
  const [emailOpen, setEmailOpen] = useState(false);

  /* THE PARTS. On Team's person page each part is its own group with its
     own Edit (`only`): Name, Contact (with the date of birth), Employment,
     Uniform. Everywhere else the four panels sit together, as before. */
  const body = ({ editing, draft, set, invalid, edit, errorFor }: SectionBodyContext) => {
    const nameRows = (
      <>
          <Detail
            label="First name"
            req={requiredField("first_name")}
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
            req={requiredField("last_name")}
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
            label={only ? "Goes by" : "Preferred name"}
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
          {onSaveAliases && (
            <Detail
              label={ALIAS_WORDS.label}
              editing={editing}
              value={values.aliases}
              onAdd={edit}
              error={errorFor("aliases", "Check these")}
              control={
                <TextInput
                  name="aliases"
                  placeholder={ALIAS_WORDS.placeholder}
                  value={draft.aliases}
                  invalid={invalid("aliases")}
                  onChange={(v) => set("aliases", v)}
                />
              }
            />
          )}
      </>
    );
    const dobRow = (
      <>
          <Detail
            label="Date of birth"
            req={requiredField("birthday")}
            editing={editing}
            value={born}
            onAdd={edit}
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
      </>
    );
    const contactRows = (
      <>
          {/* NOT AN EDITABLE FIELD, and deliberately not part of this card's
              save. It is the address you SIGN IN with, so moving it moves an
              account rather than a detail — it goes through its own action,
              behind its own confirmation, and only on your own card. The row
              was always read-only here; what is new is that it now says where
              you go to change it instead of leaving you to guess. */}
          <Detail
            label="Email"
            value={changed?.email ?? email}
            small
            action={
              onChangeSignInEmail && !editing ? (
                <button type="button" className="pdact" onClick={() => setEmailOpen(true)}>
                  Change
                </button>
              ) : undefined
            }
          />
          <Detail
            label="Mobile"
            req={requiredField("phone")}
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
            req={requiredField("address")}
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
      </>
    );
    const employmentRows = (
      <>
          <Detail
            label="Start date"
            req={requiredField("start_date")}
            editing={editing}
            value={started}
            onAdd={edit}
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
          {/* Shown to everyone, editable only by an admin — you should be able to
              see whether your card is active without being able to switch it off.
              The server agrees: `status` is absent from SELF_EDITABLE_SECTIONS,
              so a self save that carries it is dropped rather than refused. */}
          <Detail
            label="Status"
            editing={editing && mode === "admin"}
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
            req={requiredField("employment_type")}
            editing={editing}
            value={values.employment_type}
            onAdd={edit}
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
      </>
    );
    const uniformRows = (
      <>
          {UNIFORM_FIELDS.map((f) => (
            <Detail
              key={f.key}
              label={f.label}
              editing={editing}
              // boots read "10 AU/UK" — the size never appears without the
              // system it is quoted on
              value={display[f.key]}
              onAdd={edit}
              control={
                f.scaleKey ? (
                  <ScaledInput
                    name={f.key}
                    placeholder={f.placeholder}
                    // the ladder IS the scale's ladder — switch to EU and the
                    // suggestions become 37–49, not 4–14
                    suggestions={bootLadder(draft[f.scaleKey])}
                    value={draft[f.key]}
                    onChange={(v) => set(f.key, v)}
                    scale={draft[f.scaleKey]}
                    scaleName={f.scaleKey}
                    scales={BOOT_SCALES}
                    scaleLabel={`${f.label} — size scale`}
                    onScaleChange={(v) => set(f.scaleKey!, v)}
                  />
                ) : (
                  <TextInput
                    name={f.key}
                    placeholder={f.placeholder}
                    suggestions={f.suggestions}
                    value={draft[f.key]}
                    onChange={(v) => set(f.key, v)}
                  />
                )
              }
            />
          ))}
      </>
    );
    if (only) {
      const rows =
        only === "name" ? (
          nameRows
        ) : only === "contact" ? (
          <>
            {contactRows}
            {dobRow}
          </>
        ) : only === "employment" ? (
          employmentRows
        ) : (
          uniformRows
        );
      return <dl className="pdl">{rows}</dl>;
    }
    return (
      <DetailPanels>
        <DetailPanel title="Identity">
          {nameRows}
          {dobRow}
        </DetailPanel>
        <DetailPanel title="Contact">{contactRows}</DetailPanel>
        <DetailPanel title="Employment" wide split>
          {employmentRows}
        </DetailPanel>
        <DetailPanel title="Uniform" wide split>
          {uniformRows}
        </DetailPanel>
      </DetailPanels>
    );
  };

  return (
    <>
      <SectionCard
        variant={group ? "group" : "section"}
        title={group?.title ?? "Personal details"}
        editLabel={group?.editLabel}
      lead={group?.lead}
        values={values}
        startEditing={startEditing}
        focusField={focusField}
        onSave={saveCard}
        validate={(fields) => preValidate(mode, "personal", fields)}
        body={body}
      />
      {emailOpen && onChangeSignInEmail && (
        <SignInEmailModal
          current={changed?.email ?? email ?? null}
          onChange={onChangeSignInEmail}
          onClose={() => setEmailOpen(false)}
          onChanged={(email, verificationSent) => setChanged({ email, verificationSent })}
        />
      )}

      {/* WHAT STILL HAS TO HAPPEN, and it must outlive the dialog. Closing on
          success and updating the row silently loses the one instruction that
          matters — the address has moved, but it is UNVERIFIED until someone
          opens that inbox, and nothing else on this screen will ever say so.
          It sits under the card because that is where the eye already is when
          the dialog gets out of the way. */}
      {changed && (
        <p className="pacct-ok">
          <Icon name="check" size={14} />
          <span>
            You sign in as <b>{changed.email}</b> from now on.{" "}
            {changed.verificationSent
              ? "Check that inbox for a message asking you to verify it."
              : "The verification message couldn’t be sent — verify it from Auth0 when you can."}
          </span>
        </p>
      )}
    </>
  );
}
