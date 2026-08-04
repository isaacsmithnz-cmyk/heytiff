"use client";

import { Icon } from "@/components/shell/icon";
import { preValidate } from "@/lib/staff/pre-validate";
import { SectionCard, StaticCard } from "./section-card";
import { DetailPanel, DetailPanels } from "./detail";
import { TextArea } from "./fields";
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
        variant="section"
        icon="note"
        title="Notes"
        sub="Internal — visible to managers & admin"
        values={values}
        onSave={(fields) => onSave("notes", fields)}
        validate={(fields) => preValidate("admin", "notes", fields)}
        /* Prose, so a plain panel body rather than the label/value <dl> — and
           the textarea takes the paragraph's own place, at its own width. The
           note you were reading and the box you type it into are the same
           shape in the same spot; only the blank state differs, because a
           blank has to offer a way in. */
        body={({ editing, draft, set, edit }) => (
          <DetailPanels>
            <DetailPanel title="Internal notes" wide plain>
              {editing ? (
                <TextArea
                  name="notes"
                  placeholder="e.g. First-aid officer · prefers north-side jobs · on light duties until June"
                  value={draft.notes}
                  style={{ minHeight: 120 }}
                  onChange={(v) => set("notes", v)}
                />
              ) : values.notes ? (
                <p className="ro-note">{values.notes}</p>
              ) : (
                <button type="button" className="padd" onClick={edit}>
                  <span aria-hidden="true">+</span>
                  Write
                  <i className="sr-only"> internal notes</i>
                </button>
              )}
            </DetailPanel>
          </DetailPanels>
        )}
      />
      {/* The SECOND section on this tab, so it keeps a card's frame and its own
          name — the same rule Qualifications follows on Compliance. As a bare
          section it rendered a second `.psechd` with no title, so "Things that
          need attention" sat under the notes panel reading as a caption for
          the notes. */}
      <StaticCard
        variant="card"
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
