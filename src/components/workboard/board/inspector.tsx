"use client";

import { useEffect, type ReactNode } from "react";
import { Icon } from "@/components/shell/icon";

/* THE INSPECTOR — what is selected on the board, beside the board.

   It replaces three overlays that each answered part of "what is this": the
   focus stack a schedule block opened (a scrim and a card per person), the
   capacity day card (a scrim and the day's jobs), and — on the three lists —
   the job sheet itself, which a click opened whole to show a description the
   row had truncated. The board stays visible and nothing has to be dismissed:
   the next thing you click replaces what is here, which is the scanning motion
   the board is for. The job sheet is still one press away, and still the only
   place a job's money, visits, photos and documents live.

   THE ANATOMY IS THE STAFF CARD'S LEDGER, not a new vocabulary: a title, the
   facts as a label column with the answer beside it and a hairline between
   rows, a group you read under a quiet label, and the one primary action at
   the foot. A card that won that argument on 2026-09-16 does not need a second
   dress for the same kind of fact.

   It is not a dialog. There is no scrim, focus is not moved into it (the
   person is scanning with the pointer, and taking the caret away mid-scan is
   the thing a dialog does), and Escape closes it only when nothing else on the
   page has claimed Escape first. */

export function Inspector({
  label,
  kicker,
  title,
  onClose,
  actions,
  children,
}: {
  /** What the region is, for a screen reader: "Job 2587", "Wednesday 16 September". */
  label: string;
  /** The line above the title: the number and the category, or the day's figures. */
  kicker?: ReactNode;
  title: ReactNode;
  onClose: () => void;
  /** The pinned foot — one primary action, and at most two others. */
  actions?: ReactNode;
  children?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      /* a sheet or a modal over the board owns its own Escape; this only
         answers one that reached the document unclaimed */
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="wb2-insp" aria-label={label}>
      <div className="wb2-insph">
        <div className="wb2-inspt">
          {kicker && <span className="wb2-inspk">{kicker}</span>}
          <h3>{title}</h3>
        </div>
        <button type="button" className="wb2-inspx" aria-label="Close the panel" onClick={onClose}>
          <Icon name="x" size={15} />
        </button>
      </div>
      <div className="wb2-inspb">{children}</div>
      {actions && <div className="wb2-inspa">{actions}</div>}
    </aside>
  );
}

/** The facts, as the staff card sets them: a label column, the answer beside it. */
export function Ledger({ children }: { children: ReactNode }) {
  return <dl className="wb2-insl">{children}</dl>;
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="wb2-insr">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Something you read rather than act on: no box, a hairline top, a quiet label. */
export function Reading({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="wb2-insg" aria-label={label}>
      <span className="wb2-insgl">{label}</span>
      {children}
    </section>
  );
}

/** The board and the panel side by side; each scrolls on its own. */
export function Split({ children, aside }: { children: ReactNode; aside: ReactNode }) {
  return (
    <div className="wb2-split">
      <div className="wb2-splitm">{children}</div>
      {aside}
    </div>
  );
}
