import { LEAVE_LABEL, type LeaveKind, type LeaveRequest } from "@/lib/timepay/leave";

/* Who's off today — the team roster the dashboard shows managers.

   Pure over already-fetched rows: the query hands us approved leave that
   overlaps today and any public holiday the org closes for today, and this
   shapes them for display. Gated on `team` at the loader, never here. */

export type OnLeaveToday = {
  staffId: string;
  name: string;
  kind: LeaveKind;
  /** "Annual leave" etc. — the human label for the kind. */
  label: string;
};

export type RosterToday = {
  /** The holiday name if the org closes today, else null. */
  publicHoliday: string | null;
  /** Everyone on approved leave that covers today, by name. */
  onLeave: OnLeaveToday[];
};

export function rosterToday(
  approvedLeave: readonly LeaveRequest[],
  holidaysToday: readonly { date: string; name: string }[],
  today: string,
): RosterToday {
  const onLeave = approvedLeave
    // The query filters to approved + overlapping, but re-check the span here so
    // the derivation stands on its own: a request covers today when it starts on
    // or before today and ends on or after it (end date is inclusive).
    .filter((r) => r.startDate <= today && today <= r.endDate)
    .map((r) => ({
      staffId: r.staffId,
      name: r.staffName?.trim() || "Unnamed",
      kind: r.kind,
      label: LEAVE_LABEL[r.kind],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const ph = holidaysToday.find((h) => h.date === today);
  return { publicHoliday: ph ? ph.name : null, onLeave };
}
