"use client";

import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import type { HomeIssue } from "@/lib/dashboard/issues";

/* AN ISSUE, OPENED IN PLACE on the new Home's list (./home-list).

   An issue is the "this keeps happening" row the note router writes: no
   assignee, no date, nothing to tick — a fact about a site that stays true
   until somebody says it is not. So its row has no door to go through. It
   opens where it stands: where it is, what it is on, how often it has been
   seen, the diary entry that raised it, and its one action, Mark resolved.
   Ported from the issue pane of today's Tasks face (./home-tasks), which
   the crew keep until the flip; nothing here is shared with it.

   Resolving is a single press, so it is reversible: the detail closes and
   the row says "Resolved." with Undo (`reopenIssue`) before it folds away
   — the list holds that, not this. */

/** "Once, on Thu 30 July." · "3 times, first Thu 30 July, last Mon 14 Sept." */
export function issueSeenWords(issue: Pick<HomeIssue, "occurrences" | "firstSeen" | "lastSeen">): string {
  const fmt = fmtAuWeekdayDayMonth;
  return issue.occurrences > 1
    ? `${issue.occurrences} times, first ${fmt(issue.firstSeen)}, last ${fmt(issue.lastSeen)}.`
    : `Once, on ${fmt(issue.lastSeen)}.`;
}

export function HomeListIssue({
  id,
  issue,
  entryId,
  grow,
  onOpenEntry,
  onResolve,
}: {
  /** What the row's title controls. */
  id: string;
  issue: HomeIssue;
  /** The diary entry that raised it, or null for one typed elsewhere. */
  entryId: string | null;
  /** Opened by a pointer, so it grows open; from the keyboard it is simply
      there (law 8). */
  grow: boolean;
  /** `pointer` is false for Open in diary pressed from the keyboard. */
  onOpenEntry: (entryId: string, pointer: boolean) => void;
  onResolve: () => void;
}) {
  return (
    <div className="hd-ls-in" id={id} data-grow={grow ? "" : undefined}>
      <div className="hd-ls-iss">
        <dl className="hd-ls-facts">
          <div>
            <dt>Where</dt>
            <dd className={issue.where ? undefined : "unset"}>{issue.where ?? "Not on a job"}</dd>
          </div>
          <div>
            <dt>Equipment</dt>
            <dd className={issue.equipmentRef ? undefined : "unset"}>{issue.equipmentRef ?? "Not named"}</dd>
          </div>
          <div>
            <dt>Seen</dt>
            <dd>{issueSeenWords(issue)}</dd>
          </div>
        </dl>
        <div className="hd-ls-acts">
          <button type="button" className="hd-ls-vb" onClick={onResolve}>
            Mark resolved
          </button>
          {entryId && (
            <button type="button" className="hd-ls-link" onClick={(e) => onOpenEntry(entryId, e.detail > 0)}>
              Open in diary
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
