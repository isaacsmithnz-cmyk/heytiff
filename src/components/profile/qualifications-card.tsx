"use client";

import type { StaffProfile } from "@/lib/staff/profile";
import { preValidate } from "@/lib/staff/pre-validate";
import { SectionCard } from "./section-card";
import { Field, TextArea } from "./fields";
import type { ProfileMode, SaveSection } from "./types";

/* Free-text qualifications — the courses and trade certificates that are
   not a card with a number and an expiry (those are the licence wall above).
   Shares the `licences` section with the Compliance card — that section's
   allowlist is exactly one column (qualifications), so this is the only card
   that writes it.

   ONE NAME. The card said "Other qualifications", the panel inside it said
   "Tickets & courses", the empty row said "Qualifications", and the
   placeholder's first example was an EWP ticket — a card with a number and an
   expiry, which belongs on the wall. "Ticket" is the wall's word; this list
   is the qualifications, and says so once. */
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
      // Left as the default framed card ON PURPOSE: this is the SECOND section
      // on the Compliance tab, so it genuinely has a name of its own to say —
      // the tab's title is already spoken for by the licence wall above it.
      title="Other qualifications"
      values={values}
      onSave={(fields) => onSave("licences", fields)}
      validate={(fields) => preValidate(mode, "licences", fields)}
      read={({ edit }) =>
        lines.length > 0 ? (
          /* a list of chips straight under the card's title — the title
             already names the list, so no panel inside it names it again */
          <div className="qual-list">
            {lines.map((l, i) => (
              <span key={i} className="qual">
                {l}
              </span>
            ))}
          </div>
        ) : (
          <button type="button" className="padd" onClick={edit}>
            <span aria-hidden="true">+</span>
            List qualifications
          </button>
        )
      }
      edit={({ draft, set }) => (
        <div className="frow">
          <Field label="Qualifications">
            <TextArea
              name="qualifications"
              placeholder="One per line, e.g. Cert III Refrigeration, Working at heights, First aid"
              value={draft.qualifications}
              onChange={(v) => set("qualifications", v)}
            />
          </Field>
        </div>
      )}
    />
  );
}
