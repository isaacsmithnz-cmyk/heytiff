"use client";

import { Icon } from "@/components/shell/icon";
import { preValidate } from "@/lib/staff/pre-validate";
import { SectionCard, StaticCard } from "./section-card";
import { Detail, DetailPanel, DetailPanels } from "./detail";
import { Field, TextArea } from "./fields";
import type { SaveSection } from "./types";

/* Internal notes — admin only, and never on your own card (notes are written
   ABOUT someone, so the page omits this section when you're looking at
   yourself). Admin mode only: there is no `notes` key in the self allowlist. */
export function NotesCard({
  notes,
  onSave,
}: {
  notes: { notes?: string | null } | null;
  onSave: SaveSection;
}) {
  const values = { notes: notes?.notes ?? "" };
  return (
    <>
      <SectionCard
        icon="note"
        title="Notes"
        sub="Internal — visible to managers & admin"
        values={values}
        onSave={(fields) => onSave("notes", fields)}
        validate={(fields) => preValidate("admin", "notes", fields)}
        read={({ edit }) =>
          values.notes ? (
            <DetailPanels>
              {/* prose, so a plain panel body rather than the label/value <dl> */}
              <DetailPanel title="Internal notes" wide plain>
                <p className="ro-note">{values.notes}</p>
              </DetailPanel>
            </DetailPanels>
          ) : (
            <DetailPanels>
              <DetailPanel title="Internal notes">
                <Detail label="Notes" value="" onAdd={edit} addLabel="Write" />
              </DetailPanel>
            </DetailPanels>
          )
        }
        edit={({ draft, set }) => (
          <div className="frow">
            <Field label="Notes">
              <TextArea
                name="notes"
                placeholder="e.g. First-aid officer · prefers north-side jobs · on light duties until June"
                value={draft.notes}
                style={{ minHeight: 120 }}
                onChange={(v) => set("notes", v)}
              />
            </Field>
          </div>
        )}
      />
      <StaticCard
        icon="alert"
        iconStyle={{ background: "rgba(240,164,49,.14)", color: "#d98a00" }}
        title="Flags"
        sub="Things that need attention"
      >
        <div className="ro-empty">
          <span className="ei">
            <Icon name="check" size={20} />
          </span>
          <b>No active flags</b>
          <em>This staff member is all clear.</em>
        </div>
      </StaticCard>
    </>
  );
}
