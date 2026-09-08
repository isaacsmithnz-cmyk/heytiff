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

/* Moved to lib/staff/work-rights.ts — a pure module, because the compliance
   chip on the server needs `isNoVisa` and this file is "use client".
   Re-exported so existing importers are untouched. */
export { WORK_RIGHTS, NO_VISA_STATUSES, isNoVisa } from "@/lib/staff/work-rights";
import { WORK_RIGHTS, isNoVisa } from "@/lib/staff/work-rights";

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
  checkCount = 0,
  onOpenChecks,
  onSave,
}: {
  profile: StaffProfile | null;
  mode: ProfileMode;
  today: string;
  startEditing?: boolean;
  /* HOW MANY CHECKS ARE ON FILE, and the reason this card can be read-only.

     These five columns are a CACHE of the newest check
     (docs/migrations/staff_work_rights_records.sql). Once a check exists,
     editing them here would write values no check supports and the next check
     recorded would silently overwrite them — two doors telling different
     stories about whether somebody may legally work. So the edit cycle is
     withdrawn and the modal becomes the only door. Both section-savers refuse
     the fields as well, because a Server Function is reachable by direct POST.

     Zero checks — every workspace on the day this ships — leaves the card
     exactly as it has always been. */
  checkCount?: number;
  /** Opens the checks modal. Absent means the caller has not wired it. */
  onOpenChecks?: () => void;
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
      <>
      {onOpenChecks && (
        <div className="wr-checks">
          <span className="wr-checksl">
            <b>{checkCount === 0 ? "No checks recorded" : checkCount === 1 ? "1 check on file" : `${checkCount} checks on file`}</b>
            <em>
              {checkCount === 0
                ? "Scan a VEVO result or grant notice to start the record"
                : "The status above is the newest check"}
            </em>
          </span>
          <button type="button" className="pbtn" onClick={onOpenChecks}>
            <Icon name="shield" size={15} />
            {checkCount === 0 ? "Record a check" : "Checks"}
          </button>
        </div>
      )}
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
            {/* "VEVO checked" until now. VEVO is the government's visa
                register, and the acronym is what a compliance consultant calls
                it, not what the person filling this in calls it — the field
                records the day somebody confirmed this person may work, so it
                says that. The COLUMN stays `vevo_checked_at`: renaming it is a
                migration, and the name is accurate where it lives. */}
            <Detail
              label="Right to work checked"
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
      </>
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
      editable={checkCount === 0}
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
