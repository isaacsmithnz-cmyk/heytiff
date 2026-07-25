"use client";

import { Icon } from "@/components/shell/icon";
import { IdCard } from "@/components/cards/id-card";
import { type StaffProfile } from "@/lib/staff/profile";
import { dateInputValue, formatAuDate } from "@/lib/au-dates";
import { licenceStatus } from "@/lib/staff/licence";
import { preValidate } from "@/lib/staff/pre-validate";
import { SectionCard } from "./section-card";
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
  org,
  today,
  onSave,
}: {
  profile: StaffProfile | null;
  mode: ProfileMode;
  org: string | null;
  today: string;
  onSave: SaveSection;
}) {
  const values = workRightsValues(profile);
  const status = values.work_rights_status;
  const noVisa = isNoVisa(status);

  const expiryStatus = licenceStatus(profile?.visa_expiry ?? null, today);
  const visaExpiry = formatAuDate(profile?.visa_expiry);
  const vevoChecked = formatAuDate(profile?.vevo_checked_at);

  const read = !status ? (
    <div className="ro-empty">
      <span className="ei">
        <Icon name="passport" size={20} />
      </span>
      <b>Work rights not recorded</b>
      <em>
        Every employer has to hold evidence of the right to work. Set the status
        and, if there is a visa, its expiry — it warns before it lapses.
      </em>
    </div>
  ) : (
    <IdCard
      variant="dark"
      org={org}
      badge={{ label: "WORK RIGHTS", color: "#00E5C0" }}
      initials={noVisa ? "AU" : "VISA"}
      name={noVisa ? status : values.visa_type || "Visa"}
      sub={noVisa ? "Unrestricted right to work in Australia" : status}
      facts={
        noVisa
          ? undefined
          : [
              {
                em: "Expiry",
                b: visaExpiry || "—",
                tone: visaExpiry ? expiryStatus.tone : "mute",
              },
              { em: "Hours cap", b: values.hours_condition || "None recorded" },
              { em: "VEVO checked", b: vevoChecked || "Never" },
            ]
      }
    >
      {noVisa && (
        <div className="idc-note ok">
          <Icon name="check" size={13} />
          No visa required — full working rights
        </div>
      )}
    </IdCard>
  );

  return (
    <SectionCard
      icon="passport"
      title="Work rights"
      sub="Australian working-rights / visa status"
      values={values}
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
