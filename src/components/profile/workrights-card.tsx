"use client";

import { Icon } from "@/components/shell/icon";
import { type StaffProfile } from "@/lib/staff/profile";
import { dateInputValue, formatAuDate } from "@/lib/au-dates";
import { licenceStatus } from "@/lib/staff/licence";
import { preValidate } from "@/lib/staff/pre-validate";
import { SectionCard } from "./section-card";
import { Detail, DetailPanel, DetailPanels } from "./detail";
import { DateField, Field, InfoTip, SelectInput, TextInput } from "./fields";
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
  const noVisa = isNoVisa(status);

  const expiryStatus = licenceStatus(profile?.visa_expiry ?? null, today);
  const visaExpiry = formatAuDate(profile?.visa_expiry);
  const vevoChecked = formatAuDate(profile?.vevo_checked_at);

  /* Nothing recorded: every employer has to hold evidence of the right to
     work, so the blank card asks for the status where the answer goes rather
     than explaining itself. Once there is one, it becomes the card.

     ONLY the status is offered. The visa fields follow from it — a citizen has
     none, and the edit form unmounts them for exactly that reason — so listing
     them here would invite an answer to a question that may not apply. */
  const read = ({ edit }: { edit: () => void }) =>
    !status ? (
      <DetailPanels>
        <DetailPanel title="Right to work" wide>
          <Detail label="Status" value="" onAdd={edit} addLabel="Select" />
        </DetailPanel>
      </DetailPanels>
    ) : (
      <DetailPanels>
        <DetailPanel title="Right to work" wide={noVisa}>
          <Detail label="Status" value={status} />
          {noVisa && (
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

        {/* The visa panel is UNMOUNTED for a citizen or permanent resident, not
            dimmed — the same rule the edit form applies, and the reason saving a
            no-visa status blanks those columns. A card that shows "Visa expiry —"
            for someone who has never held one is answering a question nobody
            asked. */}
        {!noVisa && (
          <DetailPanel title="Visa">
            <Detail label="Type" value={values.visa_type} onAdd={edit} />
            <Detail
              label="Expiry"
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
            />
            <Detail label="Hours cap" value={values.hours_condition} onAdd={edit} />
            <Detail label="VEVO checked" value={vevoChecked} onAdd={edit} addLabel="Set" />
          </DetailPanel>
        )}
      </DetailPanels>
    );

  return (
    <SectionCard
      icon="passport"
      title="Work rights"
      sub="Australian working-rights / visa status"
      values={values}
      startEditing={startEditing}
      onSave={(fields) => onSave("workrights", fields)}
      validate={(fields) => preValidate(mode, "workrights", fields)}
      transform={workRightsPayload}
      read={read}
      edit={({ draft, set, invalid }) => {
        const draftNoVisa = isNoVisa(draft.work_rights_status);
        return (
          <>
            <div className="frow c2">
              <Field label="Work rights status">
                <SelectInput
                  name="work_rights_status"
                  placeholder="— Select —"
                  options={WORK_RIGHTS}
                  value={draft.work_rights_status}
                  onChange={(v) => set("work_rights_status", v)}
                />
              </Field>
              <div />
            </div>
            {draftNoVisa ? (
              <div className="wr-nov">
                <Icon name="check" size={15} />
                <span>
                  <b>No visa required</b>
                  <em>Full working rights — nothing expires, nothing to check.</em>
                </span>
              </div>
            ) : (
              <>
                <div className="frow c2">
                  <Field label="Visa type">
                    <TextInput
                      name="visa_type"
                      placeholder="e.g. 482 TSS, 500 Student, 417 WHM"
                      value={draft.visa_type}
                      onChange={(v) => set("visa_type", v)}
                    />
                  </Field>
                  <Field
                    label="Visa expiry"
                    error={invalid("visa_expiry") ? "Pick a real date" : null}
                  >
                    <DateField
                      name="visa_expiry"
                      value={draft.visa_expiry}
                      invalid={invalid("visa_expiry")}
                      onChange={(v) => set("visa_expiry", v)}
                      today={today}
                    />
                  </Field>
                </div>
                <div className="frow c2">
                  <Field
                    label={
                      <>
                        Hours condition{" "}
                        <span style={{ color: "#9ca3af", fontWeight: 600 }}>(cap, if any)</span>
                      </>
                    }
                  >
                    <TextInput
                      name="hours_condition"
                      placeholder="e.g. unlimited, 48 hrs/fortnight"
                      value={draft.hours_condition}
                      onChange={(v) => set("hours_condition", v)}
                    />
                  </Field>
                  <Field
                    label={
                      <>
                        VEVO last checked
                        <InfoTip>
                          VEVO (Visa Entitlement Verification Online) is the Australian
                          Government service that confirms a person’s visa and working-rights
                          conditions. Record the date you last checked it.
                        </InfoTip>
                      </>
                    }
                    error={invalid("vevo_checked_at") ? "Pick a real date" : null}
                  >
                    {/* a check you already did — it can't be in the future */}
                    <DateField
                      name="vevo_checked_at"
                      value={draft.vevo_checked_at}
                      max={today}
                      invalid={invalid("vevo_checked_at")}
                      onChange={(v) => set("vevo_checked_at", v)}
                      today={today}
                    />
                  </Field>
                </div>
              </>
            )}
          </>
        );
      }}
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
