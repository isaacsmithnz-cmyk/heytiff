"use client";

import { useState } from "react";
import { Button } from "@/components/parts/button";
import { summaryFromText, type SummaryGroup } from "@/lib/jobs/job-summary-rows";
import { JobSection } from "./job-section";

/* THE SUMMARY (Isaac, 25 October 2026, "Yes, build the refined Overview
   A"; the walk of the same day): what the job is, as rows under 14/600
   subheadings, the thing in ink on the left and its model number grey at 13
   on the right.

   Its groups are the job's quote's systems where the quote can say what
   the job is (read with the Overview's conversation, job-summary-rows),
   else the description's own headings and lines. Nothing is written for
   it: a description with no heading is its lines as plain rows.

   Each group shows its first four rows, then a quiet "Show 16 more" that
   opens that group, so every system shows on the first look; an opened
   group ends in "Show fewer", which folds it back (Isaac, 25 October 2026).
   The head's
   one button, quiet, shows the description as the office wrote it under a
   quote's rows; a Summary that is the description has nothing more to
   show, and no button. */

/** The rows a group shows before its Show N more. */
export const SUMMARY_ROWS = 4;

export function JobSummary({
  fromQuote,
  description,
  read,
}: {
  /** The quote's groups; null when the quote can't say. */
  fromQuote: SummaryGroup[] | null;
  /** The job's words, as the office wrote them. */
  description: string;
  /** The quote has been asked (null means none, not not-yet). */
  read: boolean;
}) {
  const [full, setFull] = useState(false);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const quote = !!fromQuote && fromQuote.length > 0;
  const groups = quote ? fromQuote : read ? summaryFromText(description) : [];
  const offer = quote && !!description;
  return (
    <JobSection
      name="Summary"
      icon="file"
      hue="pink"
      className="jov-summary"
      action={
        offer ? (
          <Button kind="quiet" size={32} aria-expanded={full} onClick={() => setFull((f) => !f)}>
            {full ? "Hide the full description" : "Show the full description"}
          </Button>
        ) : null
      }
    >
      {!read || groups.length === 0 ? (
        <ul className="jov-rows">
          <li className="jov-row jov-none">{read ? "Nothing written about the job." : "Reading the job"}</li>
        </ul>
      ) : (
        groups.map((g) => {
          const open = opened.has(g.key);
          const long = g.rows.length > SUMMARY_ROWS;
          const more = open ? 0 : g.rows.length - SUMMARY_ROWS;
          return (
            <div className="jov-group" key={g.key}>
              {g.title && <h3 className="jov-sub">{g.title}</h3>}
              <ul className="jov-rows">
                {(more > 0 ? g.rows.slice(0, SUMMARY_ROWS) : g.rows).map((r) => (
                  <li key={r.key} className="jov-row">
                    <span className="jov-thing">{r.thing}</span>
                    {r.detail && <span className="jov-detail">{r.detail}</span>}
                  </li>
                ))}
              </ul>
              {long && (
                <div className="jov-more">
                  <Button
                    kind="quiet"
                    size={32}
                    aria-expanded={open}
                    onClick={() =>
                      setOpened((o) => {
                        const next = new Set(o);
                        if (open) next.delete(g.key);
                        else next.add(g.key);
                        return next;
                      })
                    }
                  >
                    {open ? "Show fewer" : `Show ${more} more`}
                  </Button>
                </div>
              )}
            </div>
          );
        })
      )}
      {quote && full && description && <p className="jov-words">{description}</p>}
    </JobSection>
  );
}
