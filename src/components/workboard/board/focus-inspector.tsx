"use client";

import type { CSSProperties } from "react";
import { clockLabel } from "@/lib/workboard/schedule";
import type { FocusJob } from "@/lib/workboard/focus";
import { Fact, Inspector, Ledger, Reading } from "./inspector";

/* ONE JOB OFF THE DAY, in the inspector — what the focus stack was, without
   the scrim.

   The stack existed to answer "which of these rectangles are the same job",
   and it replaced a hover that only ever answered for a mouse. This answers it
   the same way for the pointer, the keyboard and the touchscreen, and leaves
   the day visible while it does. `focusJobOf` builds it, as it built the stack,
   so the schedule and the capacity day still read one job one way.

   THE KEY STAYS. Each mark is drawn in the job's own paint beside its word, so
   what it decodes is literally the block that was clicked — the Schedule key's
   swatch mirroring the cap on the board's blocks, which law 14 keeps as that
   board's vocabulary. */

export function FocusInspector({
  job,
  onOpen,
  onClose,
  onBack,
}: {
  job: FocusJob;
  onOpen: () => void;
  onClose: () => void;
  /** Present when the job was opened out of a day: puts the day back. */
  onBack?: () => void;
}) {
  const crew = job.entries.length;

  return (
    <Inspector
      label={`Job ${job.jobNumber ? `#${job.jobNumber} ` : ""}${job.clientName ?? ""}`.trim()}
      kicker={job.jobNumber ? <b>#{job.jobNumber}</b> : undefined}
      title={job.clientName ?? "Unnamed client"}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="pbtn primary" onClick={onOpen}>
            Open job
          </button>
          {onBack && (
            <button type="button" className="pbtn ghost" onClick={onBack}>
              Back to the day
            </button>
          )}
        </>
      }
    >
      <Ledger>
        {job.suburb && <Fact label="Site">{job.suburb}</Fact>}
        {/* the category leads the key because it IS the colour — the cap —
            and the state words follow, each only if this job wears it */}
        {job.marks.length > 0 && (
          <Fact label="On the board">
            <span
              className="wb2-scfkey wb2-inspkey"
              style={{
                "--fill": job.paint.fill,
                "--bar": job.paint.bar,
                "--pale": job.paint.pale,
                "--pale-edge": job.paint.paleEdge,
              } as CSSProperties}
            >
              {job.marks.map((m) => (
                <span key={m.kind}>
                  <i className={m.kind} aria-hidden="true">
                    {m.kind === "late" ? "!" : ""}
                  </i>
                  {m.word}
                </span>
              ))}
            </span>
          </Fact>
        )}
      </Ledger>

      {/* WHO IS ON IT — one row per person, the time they hold and what their
          booking is doing. A one-person job is a list of one rather than a
          different layout: the second step stays where it is. */}
      <Reading label={crew === 1 ? "On this job" : `${crew} people on this job`}>
        <ul className="wb2-inspcrew">
          {job.entries.map((e) => (
            <li key={e.key} className={e.done ? "done" : undefined}>
              <b>{e.who}</b>
              <span>{`${clockLabel(e.startMin)}–${clockLabel(e.endMin)}`}</span>
              {e.state && <em>{e.state}</em>}
            </li>
          ))}
        </ul>
      </Reading>
    </Inspector>
  );
}
