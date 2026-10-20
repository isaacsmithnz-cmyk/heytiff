"use client";

import { requiredField } from "@/lib/staff/completeness";
import { IdCard } from "@/components/cards/id-card";
import { StateWord } from "@/components/parts/state";
import { EMERGENCY_RELATIONSHIPS, type StaffProfile } from "@/lib/staff/profile";
import { preValidate } from "@/lib/staff/pre-validate";
import { SectionCard, type GroupHead, type SectionBodyContext } from "./section-card";
import { Detail, DetailPanel, DetailPanels } from "./detail";
import { SelectInput, TextInput } from "./fields";
import type { ProfileMode, SaveSection } from "./types";

const RELATIONSHIPS = EMERGENCY_RELATIONSHIPS;

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
  focusField,
  onSave,
  group,
  rail = false,
}: {
  /** drawn as a titled group with its own Edit, on Team's person page: the
      rows read in both modes, since the plastic card is the phone's */
  group?: GroupHead;
  /** the person page's right-hand card: the name large, then the numbers,
      and what's missing said in amber */
  rail?: boolean;
  profile: StaffProfile | null;
  mode: ProfileMode;
  org: string | null;
  startEditing?: boolean;
  /** the column Summary's Add pointed at — the form opens on it */
  focusField?: string;
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

  /* ONE LIST, BOTH MODES — see detail.tsx.

     THIS SECTION IS THE ONE EXCEPTION to "the rows are there in both modes",
     and the reason is the ICE card. It is the one thing on this screen someone
     might have to read off a phone at speed on a site, which is why it was
     chosen as a plastic card rather than a list in the first place — and a
     card is not a thing you can type into. So it IS the read view, and the
     rows ARE the edit view.

     Showing both would be the doubling we just took off Summary; showing the
     card while editing would be worse still, because it renders `values` and
     the rows render `draft`, so it would sit there contradicting what you were
     typing. Blank, there is no card to show and the rows are the whole
     section — which is also how "+ Add" gets somewhere to live. */
  const notSet = <StateWord tone="look">Not set</StateWord>;
  const railRead = (
    <>
      <p className="tm2-ename">{values.emergency_name || notSet}</p>
      <dl className="pdl">
        <div className="pdrow">
          <dt>Phone</dt>
          <dd>{values.emergency_phone ? tel(values.emergency_phone) : notSet}</dd>
        </div>
        <div className="pdrow">
          <dt>Relationship</dt>
          <dd>{values.emergency_relationship || notSet}</dd>
        </div>
        {values.emergency_alt_phone && (
          <div className="pdrow">
            <dt>Other phone</dt>
            <dd>{tel(values.emergency_alt_phone)}</dd>
          </div>
        )}
      </dl>
    </>
  );

  const body = ({ editing, draft, set, edit }: SectionBodyContext) => (
    <>
      {rail && !editing && railRead}
      {!blank && !editing && !group && (
        <IdCard
          variant="light"
          org={org}
          /* "ICE" — in case of emergency — is the compliance world's
             acronym, and this card exists to be read off a phone at speed by
             whoever has to make the call. It says the word. */
          badge={{ label: "Emergency", color: "#2E68FF" }}
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
      )}

      {(blank || editing || group) && !(rail && !editing) && (
      <DetailPanels>
        <DetailPanel title="In case of emergency" wide split>
          <Detail
            label="Contact name"
            req={requiredField("emergency_name")}
            editing={editing}
            value={values.emergency_name}
            onAdd={edit}
            control={
              <TextInput
                name="emergency_name"
                placeholder="e.g. Sarah Mills"
                value={draft.emergency_name}
                onChange={(v) => set("emergency_name", v)}
              />
            }
          />
          <Detail
            label="Contact phone"
            req={requiredField("emergency_phone")}
            editing={editing}
            value={values.emergency_phone}
            onAdd={edit}
            control={
              <TextInput
                name="emergency_phone"
                type="tel"
                placeholder="04xx xxx xxx"
                value={draft.emergency_phone}
                onChange={(v) => set("emergency_phone", v)}
              />
            }
          />
          <Detail
            label="Relationship"
            editing={editing}
            value={values.emergency_relationship}
            onAdd={edit}
            control={
              <SelectInput
                name="emergency_relationship"
                placeholder="Select relationship"
                options={RELATIONSHIPS}
                value={draft.emergency_relationship}
                onChange={(v) => set("emergency_relationship", v)}
              />
            }
          />
          <Detail
            label="Alternate phone"
            editing={editing}
            value={values.emergency_alt_phone}
            onAdd={edit}
            control={
              <TextInput
                name="emergency_alt_phone"
                type="tel"
                placeholder="Optional"
                value={draft.emergency_alt_phone}
                onChange={(v) => set("emergency_alt_phone", v)}
              />
            }
          />
        </DetailPanel>
      </DetailPanels>
      )}
    </>
  );

  return (
    <SectionCard
      variant={group ? "group" : "section"}
      title={group?.title ?? "Emergency contact"}
      editLabel={group?.editLabel}
      lead={group?.lead}
      values={values}
      startEditing={startEditing}
      focusField={focusField}
      onSave={(fields) => onSave("emergency", fields)}
      validate={(fields) => preValidate(mode, "emergency", fields)}
      body={body}
    />
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
