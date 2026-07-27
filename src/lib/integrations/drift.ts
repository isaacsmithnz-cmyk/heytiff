/* The scheduled drift check — pure decisions, so the expensive ones are
   testable without spending a Xero call to find out.

   WHY A SCHEDULE AT ALL. Xero publishes no payroll webhook: their event
   catalogue is Contact, Invoice, Subscription and Credit Note, and nothing
   fires when a pay template changes. So a wage rise entered in Xero is
   invisible here until somebody goes looking, and "somebody remembers to look"
   is not a mechanism. Polling is what every integration in this position does.

   WHY IT IS AFFORDABLE. `If-Modified-Since` on the employee list turns the
   usual week into ONE call for a whole organisation: ask "has anyone changed
   since I last looked?", get an empty list, stop. Only when Xero says
   something moved does the sweep pay for the per-employee reads. Against a
   60/minute and 1,000/day budget, that is the difference between a schedule
   you can run weekly and one you can't run at all.

   WHY A CHANGE TRIGGERS A FULL RECOMPUTE rather than examining only who
   changed. A drift nobody has adopted is still a drift next week, but the
   employee it belongs to won't come back in a modified-since window that
   starts after their change. Counting only the newly-modified would quietly
   drop a standing difference back to zero and take the flag down with it —
   the exact failure the flag exists to prevent. So the window decides WHETHER
   to look, and looking always means looking at everyone linked. */

import { fmtAuDayMonth } from "@/lib/au-dates";
import type { WageDrift } from "./wage";

/** How long a sweep result is trusted before it is worth looking again, even
    with nothing modified. Belt for a missed webhook we never had: a clock
    skew or a Xero-side backfill that doesn't move updatedDateUtc would
    otherwise leave a stale count indefinitely. */
export const MAX_AGE_HOURS = 24 * 30;

export type SweepDecision =
  /** Never swept, or the last sweep is too old to trust — look at everyone. */
  | { kind: "full"; reason: "never-checked" | "stale" }
  /** Ask Xero what changed since this instant first; usually nothing. */
  | { kind: "since"; since: Date };

/** What the next sweep should do, given when we last looked. */
export function planSweep(checkedAt: string | null, now: number): SweepDecision {
  if (!checkedAt) return { kind: "full", reason: "never-checked" };
  const at = Date.parse(checkedAt);
  if (Number.isNaN(at)) return { kind: "full", reason: "never-checked" };
  if (now - at > MAX_AGE_HOURS * 3_600_000) return { kind: "full", reason: "stale" };
  return { kind: "since", since: new Date(at) };
}

/** Does a modified-since answer mean there is work to do?

    Any employee coming back means SOMETHING about payroll moved — a rate, a
    name, a termination. Which one it was isn't worth deducing: the recompute
    that follows is the same either way. */
export function needsRecompute(changedEmployeeIds: string[]): boolean {
  return changedEmployeeIds.length > 0;
}

/** Which drifts count as "worth telling someone about".

    Only a real hourly-vs-hourly difference. A match obviously isn't drift; a
    salary Xero states no hours for isn't either — there is no number to
    disagree with, and flagging it weekly would train people to ignore the
    flag. */
export function countDrifting(drifts: WageDrift[]): number {
  return drifts.filter((d) => d.kind === "differs").length;
}

/** How many comparisons never happened. A run with any of these must not
    record a count: the failed rows would silently fall out of it, and a
    deflated count reads as "all good". */
export function countUnreadable(drifts: WageDrift[]): number {
  return drifts.filter((d) => d.kind === "unreadable").length;
}

export type DriftFlag = {
  /** Null when this workspace has never been swept. */
  count: number | null;
  checkedAt: string | null;
};

/** The one line the Time & Pay screen shows, or null for silence.

    Silence is the common case and is deliberate: a workspace whose wages agree
    should see nothing at all, so that seeing something means something. The
    line carries WHEN we last looked — a count with no age reads as live truth,
    and this one can be a week old. */
export function driftNote(flag: DriftFlag): string | null {
  if (flag.count === null || flag.count <= 0) return null;
  const base =
    flag.count === 1
      ? "One person's pay rate differs from Xero"
      : `${flag.count} people's pay rates differ from Xero`;
  const looked = flag.checkedAt ? ` (last looked ${fmtAuDayMonth(flag.checkedAt)})` : "";
  return `${base}${looked}.`;
}
