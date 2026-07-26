"use client";

import type { StaffProfile } from "@/lib/staff/profile";
import { preValidate } from "@/lib/staff/pre-validate";
import { SectionCard } from "./section-card";
import { Detail, DetailPanel, DetailPanels } from "./detail";
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
      read={({ edit }) =>
        lines.length > 0 ? (
          <DetailPanels>
            {/* a list of chips, not label/value pairs — plain panel body */}
            <DetailPanel title="Tickets & courses" wide plain>
              <div className="qual-list">
                {lines.map((l, i) => (
                  <span key={i} className="qual">
                    {l}
                  </span>
                ))}
              </div>
            </DetailPanel>
          </DetailPanels>
        ) : (
          <DetailPanels>
            <DetailPanel title="Tickets & courses">
              <Detail label="Qualifications" value="" onAdd={edit} addLabel="List" />
            </DetailPanel>
          </DetailPanels>
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
