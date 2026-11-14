"use client";

import type { CSSProperties } from "react";
import { pastQuote, sinceRows, type JobScopeRead } from "@/lib/jobs/job-scope";
import type { SummaryGroup } from "@/lib/jobs/job-summary-rows";
import { JobScope } from "./job-scope";
import { JobSummary } from "./job-summary";
import { useFitHeight } from "./use-fit-height";

/* A JOB'S SCOPE TAB (Isaac, 13 November 2026: "Give scope its own tab ...
   That way the activity section can get as much width as it needs"; mock A
   approved 14 November, https://claude.ai/artifact/6JjEtQm7aukwxDsHQfKY5e).

   The whole Scope on the left, and in a 380 column on the right Since the
   quote, once the quote has gone out, then Latest updates. The tab fits the
   screen and each card scrolls inside itself (use-fit-height). The Scope
   starts from its second sentence here: its first is the description, under
   the job's name.

   A job with no Scope, one made before October or not yet written for,
   shows its Summary there as the Overview did (call 3): the full ServiceM8
   description, or what was quoted. */

export function JobScopeTab({
  scope,
  reading = false,
  onUndo,
  onLeave,
  updateHref,
  summary,
}: {
  scope: JobScopeRead | null;
  /** Tiff is reading something new on the job. */
  reading?: boolean;
  onUndo?: () => Promise<void>;
  /** Leave out, off Since the quote. */
  onLeave?: (text: string) => Promise<void>;
  /** The quote, opened on Update quote with what's changing written in. */
  updateHref?: string;
  /** For a job with no Scope: the quote's groups, the office's words, and
      whether the quote has been asked. */
  summary: { fromQuote: SummaryGroup[] | null; description: string; read: boolean };
}) {
  const [ref, height] = useFitHeight<HTMLDivElement>();
  const style = height == null ? undefined : ({ "--fit-h": `${height}px` } as CSSProperties);
  if (!scope)
    return (
      <div className="jov jst jst--one" ref={ref} style={style}>
        <JobSummary fromQuote={summary.fromQuote} description={summary.description} read={summary.read} />
      </div>
    );
  const rows = pastQuote(scope) ? sinceRows(scope) : null;
  const rail = reading || scope.updates.length > 0 || (!!rows && rows.open.length + rows.inVersion.length > 0);
  return (
    <div className={`jov jst${rail ? "" : " jst--one"}`} ref={ref} style={style}>
      <div className="jst-brief">
        <JobScope scope={scope} part="brief" />
      </div>
      {rail && (
        <div className="jst-rail">
          <JobScope scope={scope} part="rail" reading={reading} onUndo={onUndo} onLeave={onLeave} updateHref={updateHref} />
        </div>
      )}
    </div>
  );
}
