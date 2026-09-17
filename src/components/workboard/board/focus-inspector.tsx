"use client";

import type { CSSProperties } from "react";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { clockLabel, fmtHoursShort } from "@/lib/workboard/schedule";
import type { FocusJob, FocusMark } from "@/lib/workboard/focus";
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

/* THE ONE STATE THE HEAD SAYS, in its colour (law 26): the most telling mark
   the job wears, in the order a dispatcher needs it — what went wrong before
   what is merely so. The key below still decodes every mark the blocks draw. */
const HEAD_STATE: { kind: FocusMark["kind"]; tone: "dan" | "warn" | "ok" | "" }[] = [
  { kind: "dan", tone: "dan" },
  { kind: "late", tone: "dan" },
  { kind: "stale", tone: "warn" },
  { kind: "done", tone: "ok" },
  { kind: "on", tone: "ok" },
  { kind: "idle", tone: "" },
];

export function FocusInspector({
  job,
  day,
  onOpen,
  onClose,
  onBack,
}: {
  job: FocusJob;
  /** The day the job was read off, for the line under the title. */
  day?: string;
  onOpen: () => void;
  onClose: () => void;
  /** Present when the job was opened out of a day: puts the day back. */
  onBack?: () => void;
}) {
  const crew = job.entries.length;
  const head = HEAD_STATE.map((h) => ({ ...h, mark: job.marks.find((m) => m.kind === h.kind) })).find(
    (h) => h.mark
  );
  /* where and when as one sentence: the site, the day, and the span the job
     holds on it across everyone booked to it */
  const start = Math.min(...job.entries.map((e) => e.startMin));
  const end = Math.max(...job.entries.map((e) => e.endMin));
  const meta = [
    job.suburb,
    day ? fmtAuWeekdayDayMonth(day) : null,
    `${clockLabel(start)}–${clockLabel(end)}`,
    fmtHoursShort(end - start),
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Inspector
      label={`Job ${job.jobNumber ? `#${job.jobNumber} ` : ""}${job.clientName ?? ""}`.trim()}
      kicker={
        <>
          {job.jobNumber && <b className="wb2-inspno">{job.jobNumber}</b>}
          <span>{job.label}</span>
          {head?.mark && (
            <span className={"wb2-inspword" + (head.tone ? ` ${head.tone}` : "")}>
              {head.mark.word.split(" — ")[0]}
            </span>
          )}
        </>
      }
      title={job.clientName ?? "Unnamed client"}
      meta={meta}
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
                    {m.kind === "late" || m.kind === "dan" ? "!" : ""}
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
