"use client";

import { Icon } from "@/components/shell/icon";
import { type StaffProfile } from "@/lib/staff/profile";
import { dateInputValue, formatAuDate } from "@/lib/au-dates";
import { licenceStatus } from "@/lib/staff/licence";
import { preValidate } from "@/lib/staff/pre-validate";
import { SectionCard, type SectionBodyContext } from "./section-card";
import { Detail, DetailPanel, DetailPanels } from "./detail";
import { DateField, SelectInput, TextInput } from "./fields";
import type { ProfileMode, SaveSection } from "./types";

export const WORK_RIGHTS = [
  "Australian citizen",
  "Permanent resident",
  "Full working rights (visa)",
  "Conditional working rights (visa)",
  "No working rights",
] as const;

/** The two statuses that make every visa field meaningless. */
export const NO_VISA_STATUSES: readonly string[] = ["Australian citizen", "Permanent resident"];

export const isNoVisa = (status: string) => NO_VISA_STATUSES.includes(status);

export function workRightsValues(p: StaffProfile | null): Record<string, string> {
  return {
    work_rights_status: p?.work_rights_status ?? "",
    visa_type: p?.visa_type ?? "",
    // ISO: these are picked, not typed. Read mode formats them for itself.
    visa_expiry: dateInputValue(p?.visa_expiry),
    hours_condition: p?.hours_condition ?? "",
    vevo_checked_at: dateInputValue(p?.vevo_checked_at),
  };
}

/* Work rights.

   The visa block is UNMOUNTED for a citizen or permanent resident, not dimmed.
   The old card rendered it always and merely faded it, which left disabled
   inputs holding stale visa numbers on the card of someone who has never held
   a visa — and, because the values were still in the DOM, made "what does this
   record actually say" ambiguous. Choosing a no-visa status here submits the
   visa fields as empty, so buildPatch nulls the columns and the record says
   what the card says.

   Within one edit session the typed values are kept in the draft, so flicking
   the status back and forth doesn't punish a misclick. */
export function WorkRightsCard({
  profile,
  mode,
  today,
  startEditing,
  onSave,
}: {
  profile: StaffProfile | null;
  mode: ProfileMode;
  today: string;
  startEditing?: boolean;
  onSave: SaveSection;
}) {
  const values = workRightsValues(profile);
  const status = values.work_rights_status;

  const expiryStatus = licenceStatus(profile?.visa_expiry ?? null, today);
  const visaExpiry = formatAuDate(profile?.visa_expiry);
  const vevoChecked = formatAuDate(profile?.vevo_checked_at);

  /* ONE LIST, BOTH MODES — see detail.tsx. Status leads, the visa panel
     follows from it.

     THE VISA PANEL IS UNMOUNTED for a citizen or permanent resident, not
     dimmed, and that rule now holds in BOTH modes off one condition: read mode
     hides it because a card showing "Visa expiry —" for someone who has never
     held one answers a question nobody asked, and edit mode hides it because
     saving a no-visa status blanks those columns. They used to be two separate
     conditions in two separate renders; a divergence there would have shown a
     panel the save was about to empty.

     Mid-edit the condition follows the DRAFT, so choosing "Australian citizen"
     folds the visa panel away as you pick it. The typed values stay in the
     draft, so flicking the status back doesn't punish a misclick. */
  const body = ({ editing, draft, set, invalid, edit, errorFor }: SectionBodyContext) => {
    const liveStatus = editing ? draft.work_rights_status : status;
    const liveNoVisa = isNoVisa(liveStatus);

    /* The two modes ask a slightly different question of the same condition,
       and they always did. READING, an unanswered status shows nothing but the
       status: listing visa fields for a person nobody has classified invites
       an answer to a question that may not apply. EDITING, an unanswered
       status still offers them, because the form's job is to be fillable and
       making you choose a status before you may type a visa number is a gate
       nobody asked for. Only a positive no-visa choice hides them there. */
    const showVisa = editing ? !liveNoVisa : Boolean(liveStatus) && !liveNoVisa;

    return (
      <DetailPanels>
        <DetailPanel title="Right to work" wide={liveNoVisa || !liveStatus}>
          <Detail
            label="Status"
            req
            editing={editing}
            value={status}
            onAdd={edit}
            addLabel="Select"
            control={
              <SelectInput
                name="work_rights_status"
                placeholder="— Select —"
                options={WORK_RIGHTS}
                value={draft.work_rights_status}
                onChange={(v) => set("work_rights_status", v)}
              />
            }
          />
          {liveNoVisa && (
            <Detail
              label="Visa required"
              value={
                <span className="ro-state ok">
                  <Icon name="check" size={13} />
                  No — full working rights
                </span>
              }
            />
          )}
        </DetailPanel>

        {showVisa && (
          <DetailPanel title="Visa">
            <Detail
              label="Type"
              editing={editing}
              value={values.visa_type}
              onAdd={edit}
              control={
                <TextInput
                  name="visa_type"
                  placeholder="e.g. 482 TSS, 500 Student, 417 WHM"
                  value={draft.visa_type}
                  onChange={(v) => set("visa_type", v)}
                />
              }
            />
            <Detail
              label="Expiry"
              editing={editing}
              value={
                visaExpiry ? (
                  <span className={`ro-state ${expiryStatus.tone}`}>
                    {visaExpiry} · {expiryStatus.label}
                  </span>
                ) : (
                  ""
                )
              }
              onAdd={edit}
              addLabel="Set"
              error={errorFor("visa_expiry", "Pick a real date")}
              control={
                <DateField
                  name="visa_expiry"
                  value={draft.visa_expiry}
                  invalid={invalid("visa_expiry")}
                  onChange={(v) => set("visa_expiry", v)}
                  today={today}
                />
              }
            />
            <Detail
              label="Hours cap"
              editing={editing}
              value={values.hours_condition}
              onAdd={edit}
              control={
                <TextInput
                  name="hours_condition"
                  placeholder="e.g. unlimited, 48 hrs/fortnight"
                  value={draft.hours_condition}
                  onChange={(v) => set("hours_condition", v)}
                />
              }
            />
            <Detail
              label="VEVO checked"
              editing={editing}
              value={vevoChecked}
              onAdd={edit}
              addLabel="Set"
              error={errorFor("vevo_checked_at", "Pick a real date")}
              control={
                /* a check you already did — it can't be in the future */
                <DateField
                  name="vevo_checked_at"
                  value={draft.vevo_checked_at}
                  max={today}
                  invalid={invalid("vevo_checked_at")}
                  onChange={(v) => set("vevo_checked_at", v)}
                  today={today}
                />
              }
            />
          </DetailPanel>
        )}
      </DetailPanels>
    );
  };

  return (
    <SectionCard
      variant="section"
      icon="passport"
      title="Work rights"
      sub="Australian working-rights / visa status"
      values={values}
      startEditing={startEditing}
      onSave={(fields) => onSave("workrights", fields)}
      validate={(fields) => preValidate(mode, "workrights", fields)}
      transform={workRightsPayload}
      body={body}
    />
  );
}

/* The submitted payload for this card. Exported so the screen (and the tests)
   use one rule: a no-visa status blanks the visa columns rather than leaving
   whatever was there before. */
export function workRightsPayload(draft: Record<string, string>): Record<string, string> {
  if (!isNoVisa(draft.work_rights_status)) return draft;
  return {
    ...draft,
    visa_type: "",
    visa_expiry: "",
    hours_condition: "",
    vevo_checked_at: "",
  };
}
