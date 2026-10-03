"use client";

import { useState } from "react";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import type { JobSummaryRead } from "@/lib/workboard/job-summary";
import type { MirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import { fmtMinutesAsHours, type AllJobRow } from "@/lib/workboard/all-jobs";

/* THE SUMMARY — what the job is, then where it's up to beside who's been on
   site (Isaac, 2026-10-02: "more difference between summary of the job and
   where it's up to… one line, two lines max… where it's up to can be the
   bullet points… fill dead space and use a little colour").

   THE JOB is the office's own words on a tinted panel under the job type's
   dot, held to two lines. The words are never cut: "Show all" opens the
   rest in place, because a summary must never be the only copy of what the
   customer was promised.

   WHERE IT'S UP TO is the stored summary as bullets — no lead sentence
   standing over them as a header — and it wears its stamp: when it was
   written, and what moved it. No money in here, ever.

   ON SITE counts the hours and lists the last few days with who went. A
   check-in left open adds a name and no hours (sm8CheckInLeftOpen).

   The customer and their contacts live in the rail, on every part of the
   card. */

/** Past this many characters, or with a second paragraph, the job's words
    fold to two lines. */
const FOLD_AT = 180;
const DAYS_SHOWN = 4;

export function JobSummaryFace({
  loading,
  detail,
  row,
  summary,
  pending,
  category,
}: {
  loading: boolean;
  detail: MirrorJobDetail | null;
  row: AllJobRow;
  summary: JobSummaryRead | null;
  /** The record read (or the first derive) is still out — hold the slot. */
  pending: boolean;
  category: { name: string; colour: string | null } | null;
}) {
  const [open, setOpen] = useState(false);
  const what = (detail?.description ?? row.title)?.trim() || "";
  const folds = what.length > FOLD_AT || /\n\s*\S/.test(what);
  /* the lead was the header Isaac found messy; with points it goes, and on
     a summary written as one sentence it is the one bullet */
  const bullets = summary ? (summary.points.length > 0 ? summary.points : summary.lead ? [summary.lead] : []) : [];
  const days = detail?.visits.slice(0, DAYS_SHOWN) ?? [];

  return (
    <>
      <section className="jcl-job" aria-label="The job">
        {category && (
          <p className="jcl-kind">
            {category.colour && <i className="wb2-catdot" style={{ background: category.colour }} aria-hidden />}
            {category.name}
          </p>
        )}
        {loading && !detail ? (
          <p className="int-hint">Reading it from the mirror…</p>
        ) : what ? (
          <>
            <p className={"jcl-what" + (folds && !open ? " folded" : "")}>{what}</p>
            {folds && (
              <button type="button" className="jcl-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
                {open ? "Show less" : "Show all"}
              </button>
            )}
          </>
        ) : (
          <p className="jcl-what">Nothing written on the job.</p>
        )}
      </section>

      <div className="jcl-two">
        {/* THE SLOT NEVER JUMPS: until the record read (or the first derive)
            answers, the same card stands in the summary's place wearing the
            skeleton's sweep, shapes only. It resolves to the words or to
            nothing. */}
        {!summary && pending ? (
          <section className="jcl-card ups" aria-hidden="true">
            <span className="wb2-jcskel t" />
            <span className="wb2-jcskel p" />
            <span className="wb2-jcskel p short" />
          </section>
        ) : summary && bullets.length > 0 ? (
          <section className="jcl-card ups" aria-label="Where it’s up to">
            <div className="jcl-cardhead">
              <h3>Where it&rsquo;s up to</h3>
              {summary.eventOn && (
                <em>
                  {`Updated ${fmtAuWeekdayDayMonth(summary.eventOn)}`}
                  {summary.eventLabel ? `, ${summary.eventLabel}` : ""}
                </em>
              )}
            </div>
            <ul className="wb2-jcups-pts">
              {bullets.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {detail && days.length > 0 && (
          <section className="jcl-card" aria-label="On site">
            <div className="jcl-cardhead">
              <h3>On site</h3>
              <em>{`${detail.visits.length} day${detail.visits.length === 1 ? "" : "s"}`}</em>
            </div>
            {detail.timeOnSite && detail.timeOnSite.minutes > 0 && (
              <p className="jcl-hrs">
                <b>{fmtMinutesAsHours(detail.timeOnSite.minutes)}</b>
                <span>on site so far</span>
              </p>
            )}
            <ul className="jcl-days">
              {days.map((v) => (
                <li key={v.day}>
                  <b>{fmtAuWeekdayDayMonth(v.day)}</b>
                  <span>
                    {v.crew.length === 0
                      ? "Nobody named"
                      : v.crew.map((c) => c.name + (c.leftOpen ? ", check-in left open" : "")).join(v.crew.some((c) => c.leftOpen) ? " — " : ", ")}
                  </span>
                  <em>{v.minutes > 0 ? fmtMinutesAsHours(v.minutes) : "—"}</em>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {detail?.workDone && (
        <section className="wb2-jcsec" aria-label="What was done">
          <div className="wb2-jcdhead">
            <b>What was done</b>
          </div>
          <p className="wb2-shtext wb2-jcread">{detail.workDone.trim()}</p>
        </section>
      )}
    </>
  );
}
