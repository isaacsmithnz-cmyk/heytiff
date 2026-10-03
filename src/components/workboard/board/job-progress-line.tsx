"use client";

import { Fragment } from "react";
import type { JobStep, StepKey } from "@/lib/workboard/job-steps";

/* THE PROGRESS LINE across the top of the job card (Isaac, 2026-10-01: "a
   progress line across the top… click on the line which would display the
   different parts of the job"). Seven steps, each a button that opens its
   part of the job below: Quoted opens the quote, Installation the visits.

   The step the job is at says so in `aria-current`; the one that is open
   below is pressed. They are often the same step and need not be. A link
   between two steps is drawn in ink once the step before it is done. */

export function JobProgressLine({
  steps,
  open,
  onOpen,
}: {
  steps: JobStep[];
  /** the step whose part is open below, when a step opened it */
  open: StepKey | null;
  onOpen: (key: StepKey) => void;
}) {
  return (
    <nav className="jcl-line" aria-label="Where the job is up to">
      {steps.map((s, i) => (
        <Fragment key={s.key}>
          {i > 0 && <span className={"jcl-link" + (steps[i - 1]!.state === "done" ? " done" : "")} aria-hidden />}
          <button
            type="button"
            className={`jcl-step ${s.state}` + (open === s.key ? " on" : "")}
            aria-pressed={open === s.key}
            aria-current={s.state === "now" || s.state === "warn" || s.state === "bad" ? "step" : undefined}
            onClick={() => onOpen(s.key)}
          >
            <i className="jcl-dot" aria-hidden />
            <span className="jcl-sl">
              <b>{s.label}</b>
              {s.fact && <em>{s.fact}</em>}
            </span>
          </button>
        </Fragment>
      ))}
    </nav>
  );
}
