"use client";

import { IdCard } from "@/components/cards/id-card";
import type { StaffProfile } from "@/lib/staff/profile";
import { preValidate } from "@/lib/staff/pre-validate";
import { SectionCard } from "./section-card";
import { Detail, DetailPanel, DetailPanels } from "./detail";
import { Field, SelectInput, TextInput } from "./fields";
import type { ProfileMode, SaveSection } from "./types";

const RELATIONSHIPS = ["Partner", "Parent", "Sibling", "Friend", "Other"] as const;

export function emergencyValues(p: StaffProfile | null): Record<string, string> {
  return {
    emergency_name: p?.emergency_name ?? "",
    emergency_phone: p?.emergency_phone ?? "",
    emergency_relationship: p?.emergency_relationship ?? "",
    emergency_alt_phone: p?.emergency_alt_phone ?? "",
  };
}

/* The in-case-of-emergency card, deliberately a LIGHT card: it's the one thing
   on this screen someone might have to read off a phone screen at speed on a
   site, so the numbers are tel: links and the contrast is maximal. */
export function EmergencyCard({
  profile,
  mode,
  org,
  startEditing,
  onSave,
}: {
  profile: StaffProfile | null;
  mode: ProfileMode;
  org: string | null;
  startEditing?: boolean;
  onSave: SaveSection;
}) {
  const values = emergencyValues(profile);
  const blank = !values.emergency_name && !values.emergency_phone;

  const tel = (n: string) =>
    n ? (
      <a className="idc-tel" href={`tel:${n.replace(/\s+/g, "")}`}>
        {n}
      </a>
    ) : (
      "—"
    );

  /* Nothing recorded: ask for it where the answer goes, rather than explaining
     the blank. One name and one number is the whole ask — it is the first
     thing anyone looks for if something happens on site. */
  const read = ({ edit }: { edit: () => void }) =>
    blank ? (
      <DetailPanels>
        <DetailPanel title="In case of emergency" wide split>
          <Detail label="Contact name" value="" onAdd={edit} />
          <Detail label="Contact phone" value="" onAdd={edit} />
          <Detail label="Relationship" value="" onAdd={edit} addLabel="Select" />
          <Detail label="Alternate phone" value="" onAdd={edit} />
        </DetailPanel>
      </DetailPanels>
    ) : (
      <IdCard
        variant="light"
        org={org}
        badge={{ label: "ICE", color: "#2E68FF" }}
        initials={initialsOf(values.emergency_name)}
        name={values.emergency_name || "—"}
        sub={
          values.emergency_relationship ? (
            <span className="idc-pill">{values.emergency_relationship}</span>
          ) : (
            "Emergency contact"
          )
        }
        facts={[
          { em: "Phone", b: tel(values.emergency_phone) },
          { em: "Alt phone", b: tel(values.emergency_alt_phone) },
        ]}
      />
    );

  return (
    <SectionCard
      icon="phone"
      title="Emergency contact"
      sub="Who we call if something happens on site"
      values={values}
      startEditing={startEditing}
      onSave={(fields) => onSave("emergency", fields)}
      validate={(fields) => preValidate(mode, "emergency", fields)}
      read={read}
      edit={({ draft, set }) => (
        <>
          <div className="frow c2">
            <Field label="Contact name" req>
              <TextInput
                name="emergency_name"
                placeholder="e.g. Sarah Mills"
                value={draft.emergency_name}
                onChange={(v) => set("emergency_name", v)}
              />
            </Field>
            <Field label="Contact phone" req>
              <TextInput
                name="emergency_phone"
                type="tel"
                placeholder="04xx xxx xxx"
                value={draft.emergency_phone}
                onChange={(v) => set("emergency_phone", v)}
              />
            </Field>
          </div>
          <div className="frow c2">
            <Field label="Relationship">
              <SelectInput
                name="emergency_relationship"
                placeholder="Select relationship"
                options={RELATIONSHIPS}
                value={draft.emergency_relationship}
                onChange={(v) => set("emergency_relationship", v)}
              />
            </Field>
            <Field label="Alternate phone">
              <TextInput
                name="emergency_alt_phone"
                type="tel"
                placeholder="Optional"
                value={draft.emergency_alt_phone}
                onChange={(v) => set("emergency_alt_phone", v)}
              />
            </Field>
          </div>
        </>
      )}
    />
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
