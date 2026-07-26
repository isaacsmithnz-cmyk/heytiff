"use client";

import { Icon } from "@/components/shell/icon";
import {
  completenessSummary,
  type Completeness,
  type CompletenessSection,
} from "@/lib/staff/completeness";

/* "40% complete — here is what's missing, and here is where to fix it."

   Every item is a BUTTON, not a bullet: it opens the section that owns the
   field with that card's edit form already up, so the distance between reading
   "Date of birth" and typing one is a single click. A checklist you cannot act
   on is just a scolding.

   It renders only while something is missing. There is no "all done" banner —
   a finished card should give the screen back, and the tabs losing their amber
   dots already says it. */
export function CompletenessBanner({
  completeness,
  onFix,
}: {
  completeness: Completeness;
  /** jump to a section and open its edit form */
  onFix: (section: CompletenessSection) => void;
}) {
  if (completeness.complete) return null;
  const first = completeness.missing[0];

  return (
    <div className="ptodo">
      <div className="ptodo-top">
        <Ring percent={completeness.percent} />
        <div className="ptodo-k">
          <b>{completeness.percent}% complete</b>
          <em>{completenessSummary(completeness)}</em>
        </div>
        <button type="button" className="pbtn primary" onClick={() => onFix(first.section)}>
          <Icon name="edit" size={14} />
          Fill in missing details
        </button>
      </div>

      <ul className="pcheck">
        {completeness.missing.map((f) => (
          <li key={String(f.key)}>
            <button type="button" className="pci" onClick={() => onFix(f.section)}>
              <span className="tk" aria-hidden="true" />
              {f.label}
              {f.required && <b className="req"> · required</b>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* pathLength={100} makes the dash array a literal percentage — no arithmetic
   on the radius, and no drift if the ring is ever resized. */
function Ring({ percent }: { percent: number }) {
  return (
    <svg className="pring" viewBox="0 0 40 40" width="52" height="52" aria-hidden="true">
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
