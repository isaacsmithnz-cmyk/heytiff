"use client";

import { TiffGlyph } from "@/components/notes/tiff-mark";
import type { CSSProperties, ReactNode } from "react";
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
  onUpdate,
  summary,
  side,
  busy = null,
}: {
  scope: JobScopeRead | null;
  /** Tiff is reading something new on the job. */
  reading?: boolean;
  onUndo?: () => Promise<void>;
  /** Leave out, off Since the quote. */
  onLeave?: (text: string) => Promise<void>;
  /** Price, opened on Update quote with what's changing written in. */
  onUpdate?: () => void;
  /** For a job with no Scope: the quote's groups, the office's words, and
      whether the quote has been asked. */
  summary: { fromQuote: SummaryGroup[] | null; description: string; read: boolean };
  /** Under the right column: the job's plans and designs (Isaac, 15
      November 2026: "Plans move too"). */
  side?: ReactNode;
  /** What Tiff is doing to the scope right now, in words ("Updating the
      scope from the plans"), said at its top while she does it. */
  busy?: string | null;
}) {
  const [ref, height] = useFitHeight<HTMLDivElement>();
  const style = height == null ? undefined : ({ "--fit-h": `${height}px` } as CSSProperties);
  /* a job with no Scope keeps the column for its plans and designs (3346) */
  /* Tiff at work on the scope, said at its top (Isaac, 21 November 2026:
     "there was no indication of it doing anything") */
  const working = busy ? (
    <p className="qt-working jst-busy" role="status">
      <TiffGlyph working size={20} />
      {busy}
      <span className="tc-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </p>
  ) : null;
  if (!scope)
    return (
      <div className={`jov jst${side ? "" : " jst--one"}`} ref={ref} style={style}>
        <div className="jst-brief">
          {working}
          <JobSummary fromQuote={summary.fromQuote} description={summary.description} read={summary.read} />
        </div>
        {side && <div className="jst-rail">{side}</div>}
      </div>
    );
  const rows = pastQuote(scope) ? sinceRows(scope) : null;
  const said = reading || scope.updates.length > 0 || (!!rows && rows.open.length + rows.inVersion.length > 0);
  const rail = said || !!side;
  return (
    <div className={`jov jst${rail ? "" : " jst--one"}`} ref={ref} style={style}>
      <div className="jst-brief">
        {working}
        <JobScope scope={scope} part="brief" />
      </div>
      {rail && (
        <div className="jst-rail">
          {said && <JobScope scope={scope} part="rail" reading={reading} onUndo={onUndo} onLeave={onLeave} onUpdate={onUpdate} />}
          {side}
        </div>
      )}
    </div>
  );
}
