"use client";

import type { StaffProfile } from "@/lib/staff/profile";
import { preValidate } from "@/lib/staff/pre-validate";
import { SectionCard } from "./section-card";
import { Field, TextArea } from "./fields";
import type { ProfileMode, SaveSection } from "./types";

/* Free-text tickets & courses. Shares the `licences` section with the
   Compliance card above it — that section's allowlist is exactly one column
   (qualifications), so this is the only card that writes it. */
export function qualificationsValues(p: StaffProfile | null): Record<string, string> {
  return { qualifications: p?.qualifications ?? "" };
}

export function QualificationsCard({
  profile,
  mode,
  onSave,
}: {
  profile: StaffProfile | null;
  mode: ProfileMode;
  onSave: SaveSection;
}) {
  const values = qualificationsValues(profile);
  const lines = values.qualifications
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <SectionCard
      icon="grad"
      title="Other qualifications"
      sub="Free-text list of tickets & courses"
      values={values}
      onSave={(fields) => onSave("licences", fields)}
      validate={(fields) => preValidate(mode, "licences", fields)}
      read={
        lines.length > 0 ? (
          <div className="qual-list">
            {lines.map((l, i) => (
              <span key={i} className="qual">
                {l}
              </span>
            ))}
          </div>
        ) : (
          <div className="ro-rows">
            <div className="ro-row">
              <em>Qualifications</em>
              <b>
                <span className="ro-none">None listed</span>
              </b>
            </div>
          </div>
        )
      }
      edit={({ draft, set }) => (
        <div className="frow">
          <Field label="Qualifications">
            <TextArea
              name="qualifications"
              placeholder="One per line — e.g. EWP ticket, Working at Heights, Confined Spaces…"
              value={draft.qualifications}
              onChange={(v) => set("qualifications", v)}
            />
          </Field>
        </div>
      )}
    />
  );
}
