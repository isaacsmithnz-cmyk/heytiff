"use client";

import { Icon } from "@/components/shell/icon";
import {
  completenessSummary,
  type Completeness,
  type CompletenessSection,
} from "@/lib/staff/completeness";

/* "36% complete — and here is the way in."

   This was a full-width banner inside the card: a ring, a headline, a button
   and a seven-item checklist. It was the biggest object on Summary for the
   smallest amount of information on it, and every one of those seven items was
   a field the panels below already showed as blank.

   So the list is GONE, not relocated, and what replaced it says the same thing
   in two places that were already there:
     · which section is short — the tab's own count badge ("Personal 3"),
     · which field is short — the dash in that section's panel.
   The button keeps the one job the list did that nothing else does: it opens
   the first missing field's form.

   And because it is a strip in the breadcrumb row rather than a block in the
   card, it is on screen from EVERY tab instead of only the first. You can be
   standing in Work rights and still see the card is 36% done.

   It renders only while something is missing. There is no "all done" state — a
   finished card should give the row back, and the tabs losing their counts
   already says it. */
export function CompletionStrip({
  completeness,
  onFix,
}: {
  completeness: Completeness;
  /** jump to the section that owns a field and open its form */
  onFix: (section: CompletenessSection) => void;
}) {
  if (completeness.complete) return null;
  const first = completeness.missing[0];

  return (
    <div className="pdone">
      <Ring percent={completeness.percent} />
      <div className="pdone-k">
        <b>{completeness.percent}% complete</b>
        <em>{completenessSummary(completeness)}</em>
      </div>
      <button type="button" className="pbtn primary" onClick={() => onFix(first.section)}>
        <Icon name="edit" size={14} />
        Fill in missing details
      </button>
    </div>
  );
}

/* pathLength={100} makes the dash array a literal percentage — no arithmetic
   on the radius, and no drift if the ring is ever resized. */
function Ring({ percent }: { percent: number }) {
  return (
    <svg className="pring" viewBox="0 0 40 40" width="38" height="38" aria-hidden="true">
      <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="5" />
      <circle
        cx="20"
        cy="20"
        r="16"
        fill="none"
        className="v"
        strokeWidth="5"
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray={`${percent} 100`}
        transform="rotate(-90 20 20)"
      />
    </svg>
  );
}
