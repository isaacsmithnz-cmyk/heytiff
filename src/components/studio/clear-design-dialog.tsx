"use client";

/* CLEAR DESIGN (the next flow): what comes off the plans and what stays, and
   the version kept as an option if you want it. Saying so keeps you where you
   were, with a toast and Undo (rule 51). */

import { useState } from "react";
import { Dialog } from "@/components/parts/dialog";
import { Tick } from "@/components/parts/tick";
import { useToast } from "@/components/parts/toast";
import type { DesignDocument } from "@/lib/studio/document";
import { clearList, keptLabelOf } from "@/lib/studio/clear-design";

export function ClearDesignDialog({
  doc,
  onClose,
  onClear,
}: {
  doc: DesignDocument;
  onClose: () => void;
  onClear: (keep: boolean) => Promise<{ kept: string | null; undo: () => void } | null>;
}) {
  const toast = useToast();
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  const { off, stays } = clearList(doc);
  const clear = async () => {
    setBusy(true);
    const done = await onClear(keep);
    onClose();
    if (done) toast({ text: done.kept ? `Design cleared. ${done.kept} kept.` : "Design cleared", undo: done.undo });
  };
  return (
    <Dialog
      heading="Clear design?"
      onClose={onClose}
      foot={
        <>
          <button type="button" className="pt-btn pt-btn--36 pt-btn--second" data-autofocus onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="pt-btn pt-btn--36 pt-btn--danger" disabled={busy} aria-busy={busy || undefined} onClick={() => void clear()}>
            Clear design
          </button>
        </>
      }
    >
      <div className="ds-clear">
        <div>
          <h3>Comes off the plans</h3>
          {off.length ? off.map((l) => <p key={l}>{l}</p>) : <p>Nothing has been added yet</p>}
        </div>
        <div>
          <h3>Stays</h3>
          {stays.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
      </div>
      <Tick label={`Keep this version as ${keptLabelOf(doc)}`} checked={keep} onChange={setKeep} />
    </Dialog>
  );
}
